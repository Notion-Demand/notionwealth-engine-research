# Company Memory Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every company a durable, incrementally-updated markdown memory page that accumulates across quarters and across every user/surface that triggers an analysis, replacing the current behavior where each new quarter pair silently overwrites the last.

**Architecture:** One new module (`lib/company-memory.ts`) owns a `company_memory` (current page) + `company_memory_history` (append-only versions) pair of Postgres tables. It hooks into the single existing choke point where every analysis pipeline run is persisted — `saveAnalysis()` in `lib/analysis-cache.ts` — so the memory update fires regardless of which of the three existing call sites (`/api/v1/analyze`, `/api/v1/sectors/seed`, `/api/v1/seed-analysis`) triggered it. A Gemini call merges each quarter's newly-extracted facts into the existing page under a fixed set of section headers. A bare read-only route renders the result.

**Tech Stack:** Next.js 14 (App Router) · TypeScript · Supabase (Postgres, service-role client) · `@google/generative-ai` (Gemini 2.5 Flash Lite) · `@vercel/functions` (`waitUntil`) · `react-markdown` + `remark-gfm` (new)

## Global Constraints

- No RLS on `company_memory` / `company_memory_history` — global data, service-role access only, matching the existing `user_credits` / `analysis_results` pattern.
- `company_memory_history` is append-only: no `UPDATE` or `DELETE` statements against it, ever.
- A memory-update failure must never fail or block the request it rides on (`saveAnalysis()`'s caller always succeeds/fails on the same terms it does today).
- A malformed/empty LLM response must never overwrite the existing page — discard and keep the previous version.
- No new nav entry, no edit UI. Phase 1 viewer is read-only.
- No test runner exists in this repo (`npm test` is not defined) — verification is via manual scripts (`npx tsx`) and `npm run dev` + `curl`/browser checks, not an automated test suite.
- This repo has no `middleware.ts` — no route-level auth gating exists, so the new viewer route needs no auth check (consistent with `company_memory` being global, unauthenticated read data).

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/011_company_memory.sql`

**Interfaces:**
- Produces: `company_memory` table (`ticker` PK, `content`, `version`, `last_quarter_pair`, `updated_at`) and `company_memory_history` table (`id`, `ticker`, `version`, `content`, `quarter_pair`, `created_at`), both used by every later task.

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- 011_company_memory.sql — Corporate memory (Phase 1)
-- ============================================================
-- Per-company markdown memory page, incrementally merged by an LLM after
-- every new quarter analyzed for that ticker, regardless of which user or
-- surface triggered the analysis. Global data — no RLS, service-role only,
-- same pattern as analysis_results / user_credits.

CREATE TABLE IF NOT EXISTS company_memory (
  ticker            TEXT PRIMARY KEY,
  content           TEXT NOT NULL,
  version           INT NOT NULL DEFAULT 1,
  last_quarter_pair TEXT NOT NULL,     -- "{q_prev}:{q_curr}", for idempotency
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Append-only history: every version that ever existed for a ticker.
-- No UPDATE or DELETE statements are ever run against this table.
CREATE TABLE IF NOT EXISTS company_memory_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker        TEXT NOT NULL,
  version       INT NOT NULL,
  content       TEXT NOT NULL,
  quarter_pair  TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_memory_history_ticker
  ON company_memory_history(ticker, created_at DESC);
```

- [ ] **Step 2: Apply the migration**

Paste the file contents into the Supabase project's SQL editor (Settings →
SQL Editor) and run it. This matches how every prior migration in
`supabase/migrations/` has been applied in this project — there is no local
Supabase CLI project set up.

- [ ] **Step 3: Verify the tables exist**

Run this in the same SQL editor:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('company_memory', 'company_memory_history');
```

Expected: both rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/011_company_memory.sql
git commit -m "feat: add company_memory tables for corporate memory Phase 1"
```

---

### Task 2: Memory template and storage helpers

**Files:**
- Create: `lib/company-memory.ts`
- Create: `scripts/verify-company-memory-storage.ts`

**Interfaces:**
- Consumes: `supabaseAdmin()` from `@/lib/supabase/admin` (existing).
- Produces:
  - `export const MEMORY_SECTIONS: string[]`
  - `export function buildBlankTemplate(ticker: string): string`
  - `export interface CompanyMemoryRow { ticker: string; content: string; version: number; lastQuarterPair: string; updatedAt: string; }`
  - `export async function getCompanyMemory(ticker: string): Promise<CompanyMemoryRow | null>`
  - `export async function writeCompanyMemory(ticker: string, content: string, quarterPair: string, nextVersion: number): Promise<void>`

- [ ] **Step 1: Create `lib/company-memory.ts` with the section template and blank-page builder**

```ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NIFTY200 } from "@/lib/nifty200";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompanyMemoryRow {
  ticker: string;
  content: string;
  version: number;
  lastQuarterPair: string;
  updatedAt: string;
}

// ── Section template ──────────────────────────────────────────────────────────
// Fixed headers so future filtered "views" (a value-investor lens, a momentum
// lens, etc.) can read specific sections back out rather than needing a
// different schema. Do not add or rename sections without updating the
// merge prompt in mergeCompanyMemory().

export const MEMORY_SECTIONS = [
  "Snapshot",
  "Business Mix",
  "KPI Trajectory",
  "Guidance & Promises",
  "Beats & Misses",
  "Strategic Initiatives",
  "Capital Allocation",
  "Management & Governance",
  "Competitive Landscape",
  "Customers & Suppliers",
  "Hiring & Organizational Signals",
  "Risks & Opportunities",
  "Analyst Sentiment",
  "Forward-Looking Statements",
  "Revision Log",
] as const;

/**
 * The starting page for a ticker with no memory yet. Every section is
 * present but empty so the merge prompt always sees the full fixed
 * structure, even on the very first quarter.
 */
export function buildBlankTemplate(ticker: string): string {
  const info = NIFTY200[ticker];
  const name = info?.name ?? ticker;
  const sector = info?.sector ?? "Unknown";

  const header = `# ${name} (${ticker})\n\n` + `## Snapshot\n\nSector: ${sector}. No quarters analyzed yet.\n`;

  const rest = MEMORY_SECTIONS.slice(1)
    .map((section) => `## ${section}\n\n_No data yet._\n`)
    .join("\n");

  return `${header}\n${rest}`;
}
```

- [ ] **Step 2: Add DB read/write helpers to the same file**

```ts
// ── Storage ───────────────────────────────────────────────────────────────────

export async function getCompanyMemory(ticker: string): Promise<CompanyMemoryRow | null> {
  const { data } = await supabaseAdmin()
    .from("company_memory")
    .select("ticker, content, version, last_quarter_pair, updated_at")
    .eq("ticker", ticker)
    .maybeSingle();

  if (!data) return null;
  return {
    ticker: data.ticker,
    content: data.content,
    version: data.version,
    lastQuarterPair: data.last_quarter_pair,
    updatedAt: data.updated_at,
  };
}

/**
 * Writes a new current page and appends the same content to history.
 * Callers are responsible for the idempotency check (see updateCompanyMemory) —
 * this function always writes.
 */
export async function writeCompanyMemory(
  ticker: string,
  content: string,
  quarterPair: string,
  nextVersion: number
): Promise<void> {
  const db = supabaseAdmin();

  await db.from("company_memory").upsert({
    ticker,
    content,
    version: nextVersion,
    last_quarter_pair: quarterPair,
    updated_at: new Date().toISOString(),
  });

  await db.from("company_memory_history").insert({
    ticker,
    content,
    version: nextVersion,
    quarter_pair: quarterPair,
  });
}
```

- [ ] **Step 3: Write the verification script**

```ts
// scripts/verify-company-memory-storage.ts
//
// Dry-runs the Task 2 storage helpers against real Supabase. Run with:
//   npx tsx --env-file=.env.local scripts/verify-company-memory-storage.ts
import { buildBlankTemplate, getCompanyMemory, writeCompanyMemory } from "../lib/company-memory";

const TEST_TICKER = "ZZTEST";

async function main() {
  const blank = buildBlankTemplate(TEST_TICKER);
  console.log("--- blank template ---");
  console.log(blank.slice(0, 200));
  if (!blank.includes("## Snapshot") || !blank.includes("## Revision Log")) {
    throw new Error("blank template missing expected sections");
  }

  await writeCompanyMemory(TEST_TICKER, blank, "Q1_2026:Q2_2026", 1);
  const row = await getCompanyMemory(TEST_TICKER);
  if (!row || row.version !== 1 || row.lastQuarterPair !== "Q1_2026:Q2_2026") {
    throw new Error(`unexpected row after write: ${JSON.stringify(row)}`);
  }
  console.log("--- read back ---");
  console.log(row.ticker, row.version, row.lastQuarterPair);

  console.log("PASS");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
```

- [ ] **Step 4: Run the verification script**

Run: `npx tsx --env-file=.env.local scripts/verify-company-memory-storage.ts`
Expected: prints the blank template excerpt, the read-back row
(`ZZTEST 1 Q1_2026:Q2_2026`), then `PASS`.

- [ ] **Step 5: Clean up the test row**

Run this in the Supabase SQL editor:

```sql
DELETE FROM company_memory_history WHERE ticker = 'ZZTEST';
DELETE FROM company_memory WHERE ticker = 'ZZTEST';
```

- [ ] **Step 6: Commit**

```bash
git add lib/company-memory.ts scripts/verify-company-memory-storage.ts
git commit -m "feat: add company memory template and storage helpers"
```

---

### Task 3: Merge prompt and Gemini call

**Files:**
- Modify: `lib/company-memory.ts`
- Create: `scripts/dry-run-memory-merge.ts`

**Interfaces:**
- Consumes: `DashboardPayload` from `@/lib/pipeline` (existing — fields used: `insights`, `earnings_delta`, `fcf_implications`, `executive_evasiveness_score`, `stock_price_change`, `key_metrics`, `summary`, `overall_signal`, `overall_score`).
- Produces: `export async function mergeCompanyMemory(currentPage: string, ticker: string, payload: DashboardPayload, qPrev: string, qCurr: string): Promise<string | null>` — returns `null` on any failure (network, timeout, empty response); never throws.

- [ ] **Step 1: Add the fact-briefing builder and merge function**

```ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { DashboardPayload } from "@/lib/pipeline";

// ── Merge ─────────────────────────────────────────────────────────────────────

const MERGE_TIMEOUT_MS = 25_000;

function getGenAI(): GoogleGenerativeAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Compresses this quarter's DashboardPayload into the raw facts the merge
 * prompt needs — no new extraction, just reformatting what the pipeline
 * already produced.
 */
function buildFactsBrief(payload: DashboardPayload, qPrev: string, qCurr: string): string {
  const sectionLines = payload.insights
    .map((s) => `${s.section_name}: ${s.key_takeaways.join(" | ")}`)
    .join("\n");

  const km = payload.key_metrics;
  const metricsLine = km
    ? [km.revenue, km.revenue_growth, km.ebitda_margin, km.ebitda_change, km.pat, km.pat_growth]
        .filter(Boolean)
        .join(", ")
    : "none reported";

  return (
    `Quarter pair: ${qPrev} -> ${qCurr}\n` +
    `Overall signal: ${payload.overall_signal} (${payload.overall_score.toFixed(1)})\n` +
    `Summary: ${payload.summary}\n` +
    `Key metrics: ${metricsLine}\n` +
    `Stock reaction: ${payload.stock_price_change > 0 ? "+" : ""}${payload.stock_price_change.toFixed(1)}%\n` +
    `Executive evasiveness score: ${payload.executive_evasiveness_score.toFixed(1)}\n\n` +
    `What changed this quarter:\n${payload.earnings_delta.join("\n")}\n\n` +
    `Financial implications:\n${payload.fcf_implications.join("\n")}\n\n` +
    `Thematic section takeaways:\n${sectionLines}`
  );
}

/**
 * Merges this quarter's facts into the existing memory page. Returns null
 * on any failure — callers must keep the previous page untouched.
 */
export async function mergeCompanyMemory(
  currentPage: string,
  ticker: string,
  payload: DashboardPayload,
  qPrev: string,
  qCurr: string
): Promise<string | null> {
  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
      systemInstruction:
        "You maintain a durable corporate memory page for one company, written for a " +
        "serious equity analyst. You update it every quarter with new facts. You never " +
        "delete a section, you never invent a new top-level section, and you never " +
        "restate a fact that hasn't changed just to fill space. Be terse and specific — " +
        "cite real numbers and quarters, not vague language.",
      generationConfig: { temperature: 0.15 },
    });

    const sectionList = MEMORY_SECTIONS.map((s) => `## ${s}`).join("\n");

    const prompt =
      `Company: ${ticker}\n\n` +
      `CURRENT MEMORY PAGE:\n${currentPage}\n\n` +
      `NEW FACTS FROM ${qCurr} (vs ${qPrev}):\n${buildFactsBrief(payload, qPrev, qCurr)}\n\n` +
      `Produce the FULL updated memory page using exactly these section headers, in this order:\n${sectionList}\n\n` +
      `Rules:\n` +
      `- Update "Guidance & Promises": resolve any promise whose target quarter is now ${qCurr} ` +
      `(mark it kept, broken, or partial based on the new facts), and append any new promise made this quarter as pending.\n` +
      `- Append this quarter's row(s) to "Beats & Misses", "KPI Trajectory", and "Strategic Initiatives" rather than replacing prior rows.\n` +
      `- Update the running note in "Management & Governance" — don't just restate this quarter's evasiveness score in isolation, ` +
      `describe the pattern across quarters.\n` +
      `- Carry forward any section unchanged this quarter rather than dropping it.\n` +
      `- Append exactly one line to "Revision Log" summarizing what changed in this update.\n` +
      `- Keep prose terse — this is a reference page, not a report.`;

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Memory merge timed out after ${MERGE_TIMEOUT_MS}ms`)), MERGE_TIMEOUT_MS)
    );

    const result = await Promise.race([model.generateContent(prompt), timeout]);
    const text = result.response.text().trim();

    if (!text || !text.includes("## Revision Log")) {
      console.error(`[company-memory] merge for ${ticker} produced no usable output`);
      return null;
    }
    return text;
  } catch (e) {
    console.error(`[company-memory] merge failed for ${ticker}:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}
```

- [ ] **Step 2: Write the dry-run script**

```ts
// scripts/dry-run-memory-merge.ts
//
// Pulls one real cached DashboardPayload and runs it through the merge
// prompt against a blank page, printing the result for manual review.
// Run with:
//   npx tsx --env-file=.env.local scripts/dry-run-memory-merge.ts TCS
import { supabaseAdmin } from "../lib/supabase/admin";
import { buildBlankTemplate, mergeCompanyMemory } from "../lib/company-memory";
import type { DashboardPayload } from "../lib/pipeline";

async function main() {
  const ticker = process.argv[2];
  if (!ticker) {
    console.error("Usage: dry-run-memory-merge.ts <TICKER>");
    process.exit(1);
  }

  const { data } = await supabaseAdmin()
    .from("analysis_results")
    .select("payload, q_prev, q_curr")
    .eq("company_ticker", ticker.toUpperCase())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    console.error(`No cached analysis found for ${ticker}`);
    process.exit(1);
  }

  const payload = data.payload as DashboardPayload;
  const blank = buildBlankTemplate(ticker.toUpperCase());

  const merged = await mergeCompanyMemory(blank, ticker.toUpperCase(), payload, data.q_prev, data.q_curr);

  if (!merged) {
    console.error("Merge returned null — check the error logged above");
    process.exit(1);
  }

  console.log(merged);
}

main();
```

- [ ] **Step 3: Run the dry-run against a real ticker**

Run: `npx tsx --env-file=.env.local scripts/dry-run-memory-merge.ts TCS`
(substitute any ticker known to have a cached `analysis_results` row)

Expected: full markdown page printed to stdout, containing all 15 section
headers from `MEMORY_SECTIONS`, with "Guidance & Promises" and "Revision
Log" populated with content specific to that ticker's actual quarter data
(not generic placeholder text). Read it — this is the actual quality bar
for the whole feature.

- [ ] **Step 4: Commit**

```bash
git add lib/company-memory.ts scripts/dry-run-memory-merge.ts
git commit -m "feat: add Gemini merge prompt for company memory updates"
```

---

### Task 4: Orchestrator with idempotency and validation

**Files:**
- Modify: `lib/company-memory.ts`
- Modify: `scripts/dry-run-memory-merge.ts` (extend into an idempotency check)

**Interfaces:**
- Consumes: `getCompanyMemory`, `writeCompanyMemory`, `mergeCompanyMemory`, `buildBlankTemplate` (all Task 2/3).
- Produces: `export async function updateCompanyMemory(ticker: string, payload: DashboardPayload, qPrev: string, qCurr: string): Promise<void>` — the single entry point Task 5 wires into `saveAnalysis()`. Never throws.

- [ ] **Step 1: Add the orchestrator**

```ts
// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Merges this quarter's analysis into the ticker's memory page. Safe to call
 * on every analysis run — skips if this exact quarter pair was already
 * merged, and never throws (callers should not need to catch this, but
 * still may want to for logging).
 */
export async function updateCompanyMemory(
  ticker: string,
  payload: DashboardPayload,
  qPrev: string,
  qCurr: string
): Promise<void> {
  const quarterPair = `${qPrev}:${qCurr}`;

  try {
    const existing = await getCompanyMemory(ticker);

    if (existing?.lastQuarterPair === quarterPair) {
      return; // already merged this exact quarter pair — no-op
    }

    const currentPage = existing?.content ?? buildBlankTemplate(ticker);
    const nextVersion = (existing?.version ?? 0) + 1;

    const merged = await mergeCompanyMemory(currentPage, ticker, payload, qPrev, qCurr);
    if (!merged) {
      return; // mergeCompanyMemory already logged the failure — keep existing page
    }

    await writeCompanyMemory(ticker, merged, quarterPair, nextVersion);
  } catch (e) {
    console.error(`[company-memory] updateCompanyMemory failed for ${ticker}:`, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 2: Extend the dry-run script into an idempotency check**

Replace the body of `scripts/dry-run-memory-merge.ts` with:

```ts
// scripts/dry-run-memory-merge.ts
//
// Pulls one real cached DashboardPayload, runs it through updateCompanyMemory
// twice with the same quarter pair, and confirms the second call is a no-op.
// Run with:
//   npx tsx --env-file=.env.local scripts/dry-run-memory-merge.ts TCS
import { supabaseAdmin } from "../lib/supabase/admin";
import { getCompanyMemory, updateCompanyMemory } from "../lib/company-memory";
import type { DashboardPayload } from "../lib/pipeline";

async function main() {
  const ticker = process.argv[2]?.toUpperCase();
  if (!ticker) {
    console.error("Usage: dry-run-memory-merge.ts <TICKER>");
    process.exit(1);
  }

  const { data } = await supabaseAdmin()
    .from("analysis_results")
    .select("payload, q_prev, q_curr")
    .eq("company_ticker", ticker)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    console.error(`No cached analysis found for ${ticker}`);
    process.exit(1);
  }

  const payload = data.payload as DashboardPayload;

  console.log("--- first call ---");
  await updateCompanyMemory(ticker, payload, data.q_prev, data.q_curr);
  const afterFirst = await getCompanyMemory(ticker);
  console.log(`version=${afterFirst?.version} lastQuarterPair=${afterFirst?.lastQuarterPair}`);
  console.log(afterFirst?.content.slice(0, 300));

  console.log("\n--- second call (same quarter pair, expect no-op) ---");
  await updateCompanyMemory(ticker, payload, data.q_prev, data.q_curr);
  const afterSecond = await getCompanyMemory(ticker);
  console.log(`version=${afterSecond?.version} (expected: unchanged from ${afterFirst?.version})`);

  if (afterSecond?.version !== afterFirst?.version) {
    throw new Error("idempotency check FAILED — second call was not a no-op");
  }
  console.log("PASS");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
```

- [ ] **Step 3: Run it**

Run: `npx tsx --env-file=.env.local scripts/dry-run-memory-merge.ts TCS`
Expected: first call prints `version=1`, the merged page excerpt; second
call prints `version=1 (expected: unchanged from 1)` and finally `PASS`.

- [ ] **Step 4: Clean up the real ticker's test memory row**

This wrote a real row for whichever ticker you tested with, using version 1.
Since this is meant to be the actual seed of that company's memory going
forward, no cleanup is needed — leave it. If you tested with a ticker you
don't want seeded yet, delete it:

```sql
DELETE FROM company_memory_history WHERE ticker = 'TCS';
DELETE FROM company_memory WHERE ticker = 'TCS';
```

(substitute the ticker you actually used)

- [ ] **Step 5: Commit**

```bash
git add lib/company-memory.ts scripts/dry-run-memory-merge.ts
git commit -m "feat: add idempotent updateCompanyMemory orchestrator"
```

---

### Task 5: Wire into saveAnalysis()

**Files:**
- Modify: `lib/analysis-cache.ts`

**Interfaces:**
- Consumes: `updateCompanyMemory` from `@/lib/company-memory` (Task 4); `waitUntil` from `@vercel/functions`.
- Produces: nothing new — this task only adds a side effect to the existing `saveAnalysis()` export, whose signature does not change.

- [ ] **Step 1: Add the imports**

In `lib/analysis-cache.ts`, add alongside the existing imports:

```ts
import { waitUntil } from "@vercel/functions";
import { updateCompanyMemory } from "@/lib/company-memory";
```

- [ ] **Step 2: Fire the memory update after a successful save**

In `saveAnalysis()`, the existing insert block ends with:

```ts
    const { data } = await supabaseAdmin()
      .from("analysis_results")
      .insert({
        user_id: userId,
        company_ticker: tickerUp,
        q_prev: qPrev,
        q_curr: qCurr,
        payload: payload,
      })
      .select("id")
      .single();
    return data?.id ?? "unknown";
```

Change it to fire the memory update before returning, using `waitUntil` so
the update keeps running after the response is sent instead of risking
being killed when the serverless function exits:

```ts
    const { data } = await supabaseAdmin()
      .from("analysis_results")
      .insert({
        user_id: userId,
        company_ticker: tickerUp,
        q_prev: qPrev,
        q_curr: qCurr,
        payload: payload,
      })
      .select("id")
      .single();

    // Fire-and-forget: never let a memory-update failure affect this
    // request's outcome. waitUntil keeps it running past the response.
    waitUntil(
      updateCompanyMemory(tickerUp, payload, qPrev, qCurr).catch((e) => {
        console.error(`[analysis-cache] company memory update failed for ${tickerUp}:`, e instanceof Error ? e.message : String(e));
      })
    );

    return data?.id ?? "unknown";
```

- [ ] **Step 3: Write a small check script**

```ts
// scripts/check-memory-row.ts
//
// Prints the current company_memory row for a ticker. Run with:
//   npx tsx --env-file=.env.local scripts/check-memory-row.ts TCS
import { getCompanyMemory } from "../lib/company-memory";

async function main() {
  const ticker = process.argv[2]?.toUpperCase();
  if (!ticker) {
    console.error("Usage: check-memory-row.ts <TICKER>");
    process.exit(1);
  }
  const row = await getCompanyMemory(ticker);
  if (!row) {
    console.log(`No memory row for ${ticker}`);
    return;
  }
  console.log(`version=${row.version} lastQuarterPair=${row.lastQuarterPair} updatedAt=${row.updatedAt}`);
}

main();
```

- [ ] **Step 4: Verify with a real pipeline run**

Start the dev server: `npm run dev`

In another terminal, trigger a real analysis for a ticker that already has
cached transcripts (adjust quarters to whatever the project currently
seeds):

```bash
curl -s -X POST "http://localhost:3000/api/v1/seed-analysis?tickers=TCS&q_prev=Q2_2026&q_curr=Q3_2026&force=1"
```

Then check the memory table was written:

```bash
npx tsx --env-file=.env.local scripts/check-memory-row.ts TCS
```

Expected: prints `version=1 lastQuarterPair=Q2_2026:Q3_2026 updatedAt=...`
(version may be higher if this ticker was already touched in Task 4).

- [ ] **Step 5: Commit**

```bash
git add lib/analysis-cache.ts scripts/check-memory-row.ts
git commit -m "feat: trigger company memory update from saveAnalysis"
```

---

### Task 6: Read-only viewer route

**Files:**
- Modify: `package.json` (add `react-markdown`, `remark-gfm`)
- Create: `app/memory/[ticker]/page.tsx`

**Interfaces:**
- Consumes: `getCompanyMemory` from `@/lib/company-memory` (Task 2).
- Produces: a page at `/memory/[ticker]` — no exports consumed by other tasks.

- [ ] **Step 1: Install the markdown renderer**

```bash
npm install react-markdown remark-gfm
```

- [ ] **Step 2: Create the viewer page**

```tsx
// app/memory/[ticker]/page.tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getCompanyMemory } from "@/lib/company-memory";

export default async function CompanyMemoryPage({
  params,
}: {
  params: { ticker: string };
}) {
  const ticker = params.ticker.toUpperCase();
  const memory = await getCompanyMemory(ticker);

  if (!memory) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-xl font-semibold text-gray-900">{ticker}</h1>
        <p className="mt-4 text-sm text-gray-500">
          No memory has been built for {ticker} yet — it accumulates after
          the first quarter is analyzed for this ticker.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <p className="text-xs text-gray-400 mb-6">
        Version {memory.version} · last updated {new Date(memory.updatedAt).toLocaleDateString()} ·
        quarter pair {memory.lastQuarterPair}
      </p>
      <article className="prose-sm max-w-none [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_table]:w-full [&_table]:text-sm [&_th]:text-left [&_th]:border-b [&_th]:pb-1 [&_td]:border-b [&_td]:py-1 [&_td]:border-gray-100">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{memory.content}</ReactMarkdown>
      </article>
    </div>
  );
}
```

- [ ] **Step 3: Verify in the browser**

With `npm run dev` running, visit `http://localhost:3000/memory/TCS` (or
whichever ticker you seeded in Task 5).

Expected: the merged markdown page renders with headings for each of the
15 sections and a populated Guidance & Promises table. Then visit
`http://localhost:3000/memory/ZZZNOTREAL` — expected: the empty-state
message, not an error page.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app/memory/\[ticker\]/page.tsx
git commit -m "feat: add read-only company memory viewer route"
```

---

### Task 7: Link from Dashboard and Insights to the viewer

**Files:**
- Modify: `app/dashboard/DashboardClient.tsx:954-963`
- Modify: `app/insights/InsightsClient.tsx:736-743`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this is a UI-only addition.

- [ ] **Step 1: Add the link in DashboardClient.tsx**

`app/dashboard/DashboardClient.tsx:952-964` currently reads:

```tsx
        {result && !loading && (
          <div className="mt-8 space-y-2">
            <div className="flex justify-end">
              <button
                onClick={(e) => handleAnalyze(e, true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              >
                <RefreshCw size={12} />
                Clear cache &amp; re-analyze
              </button>
            </div>
            <EarningsReport payload={result} />
          </div>
        )}
```

Change the inner `<div className="flex justify-end">` to
`justify-between` and add the memory link before the existing button:

```tsx
        {result && !loading && (
          <div className="mt-8 space-y-2">
            <div className="flex justify-between items-center">
              <a
                href={`/memory/${ticker}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                title="View accumulated memory for this company"
              >
                Memory →
              </a>
              <button
                onClick={(e) => handleAnalyze(e, true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              >
                <RefreshCw size={12} />
                Clear cache &amp; re-analyze
              </button>
            </div>
            <EarningsReport payload={result} />
          </div>
        )}
```

`ticker` is already in scope here — it's the same state variable used at
line 944 (`<AgentPanel ... ticker={ticker} ... />`).

- [ ] **Step 2: Add the link in InsightsClient.tsx**

`app/insights/InsightsClient.tsx:735-743` currently reads:

```tsx
            {/* Hero bar */}
            <div className="rounded-xl border border-gray-200 bg-white px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{payload.ticker}</h3>
                <p className="text-sm text-gray-400">
                  {payload.quarters_analyzed.length} quarters analysed ·{" "}
                  {payload.quarters_analyzed.map((q) => quarterLabel(q)).join(", ")}
                </p>
              </div>
```

Add the link right after the `<h3>`:

```tsx
            {/* Hero bar */}
            <div className="rounded-xl border border-gray-200 bg-white px-6 py-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-gray-900">{payload.ticker}</h3>
                  <a
                    href={`/memory/${payload.ticker}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    title="View accumulated memory for this company"
                  >
                    Memory →
                  </a>
                </div>
                <p className="text-sm text-gray-400">
                  {payload.quarters_analyzed.length} quarters analysed ·{" "}
                  {payload.quarters_analyzed.map((q) => quarterLabel(q)).join(", ")}
                </p>
              </div>
```

- [ ] **Step 3: Verify in the browser**

With `npm run dev` running:
- Load `/dashboard`, select a ticker that has memory seeded (e.g. TCS from
  Task 5), run an analysis, and click the new "Memory →" link next to the
  "Clear cache & re-analyze" button.
- Load `/insights`, run the same ticker, and click the "Memory →" link next
  to the ticker heading in the hero bar.

Expected: both open `/memory/TCS` in a new tab, rendering the same page
verified in Task 6.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/DashboardClient.tsx app/insights/InsightsClient.tsx
git commit -m "feat: link Concall Analysis and Insights to the company memory viewer"
```
