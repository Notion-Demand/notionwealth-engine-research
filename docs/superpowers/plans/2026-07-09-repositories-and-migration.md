# Repositories and Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all 31 files' direct `supabaseAdmin()` calls with 11 domain repositories (interface + `SupabaseXRepository` implementation, each returning a domain entity it owns), wired through one composition root, using the Strangler Fig pattern — one domain migrated and verified at a time, live system running throughout.

**Architecture:** Each domain gets `lib/repositories/<domain>.ts` containing a domain entity type, a repository `interface`, and a `SupabaseXRepository implements` class wrapping today's actual queries with identical behavior. `lib/repositories/index.ts` is the single composition root instantiating every repository; every caller (existing files being migrated, and later the Services/API layer) imports repo instances from there, never a concrete class or `supabaseAdmin()` directly.

**Tech Stack:** Next.js 14 (App Router) API routes, TypeScript, `@supabase/supabase-js` (via `supabaseAdmin()`, unchanged underneath the new repositories), no test runner (verification is `npx tsc --noEmit` + manual dev-server smoke checks).

## Global Constraints

- No RLS changes, no schema changes — every table's structure is unchanged; only the *access path* moves.
- Repositories own persistence only — no orchestration, no caching, no calls to other repositories (per the spec's Architectural Principles).
- Repositories return domain entities they own and define, in camelCase — never the raw persisted/pipeline shape directly (e.g. `DashboardPayload`'s `overall_signal` becomes `Analysis.overallSignal`).
- One domain's migration never touches another domain's files. Each task is independently committable and independently revertable.
- No automated test runner exists in this repo. Every task verifies via `npx tsc --noEmit` (must be clean) plus a manual dev-server smoke check of the affected route(s) (documented per task).
- `lib/repositories/index.ts` is the only file that instantiates concrete repository classes; every other file imports named instances from it (e.g. `import { analysisRepo } from "@/lib/repositories"`).
- This plan covers repositories and migration only. The Services layer and Public API (Part 2 of the spec) are a separate plan, written after this one lands and the real entity shapes below are settled.

---

### Task 1: Composition root scaffold + AnalysisRepository

**Files:**
- Create: `lib/repositories/index.ts`
- Create: `lib/repositories/analysis.ts`
- Modify: `lib/analysis-cache.ts` (delete — superseded by `lib/repositories/analysis.ts`)
- Modify: `app/api/v1/analyze/route.ts` (uses `saveAnalysis`/`getCachedAnalysis` from `lib/analysis-cache.ts`)
- Modify: `app/api/v1/sectors/seed/route.ts:403` (`saveAnalysis` call)
- Modify: `app/api/v1/seed-analysis/route.ts` (uses `getCachedAnalysis`/`saveAnalysis`)
- Modify: `lib/nifty200-sampler.ts:75-100`
- Modify: `app/api/v1/screener/route.ts:225-270`
- Modify: `app/api/v1/calendar/route.ts:154-170`
- Modify: `app/api/v1/calendar/seed/route.ts:453-455`
- Modify: `app/api/v1/analyze/history/route.ts`

**Interfaces:**
- Produces: `Analysis`, `AnalysisRecord`, `AnalysisRepository` interface, `analysisRepo` instance exported from `lib/repositories/index.ts`. Every later task's repository is added to this same `index.ts` file.

- [ ] **Step 1: Create the domain entity and repository interface**

```ts
// lib/repositories/analysis.ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SectionalInsight, KeyMetrics } from "@/lib/pipeline";

// ── Domain entity ─────────────────────────────────────────────────────────────
// Field-for-field equivalent of lib/pipeline.ts's DashboardPayload, renamed to
// camelCase — DashboardPayload's snake_case mirrors a JSON wire format, which
// is a storage/wire concern that stops at this repository's boundary.

export interface Analysis {
  ticker: string;
  quarter: string;
  quarterPrevious: string;
  evasivenessScore: number;
  sections: SectionalInsight[];
  overallScore: number;
  overallSignal: "Positive" | "Negative" | "Mixed" | "Noise";
  summary: string;
  validationScore: number;
  flaggedCount: number;
  marketAlignmentPct: number;
  stockPriceChange: number;
  marketSources: string[];
  earningsDelta: string[];
  fcfImplications: string[];
  keyMetrics?: KeyMetrics;
}

export interface AnalysisRecord {
  ticker: string;
  quarterPrevious: string;
  quarter: string;
  analysis: Analysis;
  createdAt: string;
}

// ── Repository interface ────────────────────────────────────────────────────

export interface AnalysisRepository {
  getCachedAnalysis(ticker: string, qPrev: string, qCurr: string, opts?: { strict?: boolean }): Promise<Analysis | null>;
  saveAnalysis(userId: string | null, ticker: string, qPrev: string, qCurr: string, analysis: Analysis): Promise<string>;
  /** nifty200-sampler.ts: extra Nifty200 signals for sector narrative context. */
  listRecentByTickersAndQuarter(tickers: string[], qCurr: string, limit: number): Promise<AnalysisRecord[]>;
  /** screener Pass 1 (Nifty50): best available analysis per ticker, any quarter. */
  listAllByTickers(tickers: string[]): Promise<AnalysisRecord[]>;
  /** screener Pass 2 (Nifty200 non-N50): current quarter pair only. */
  listByTickersAndQuarterPair(tickers: string[], qPrev: string, qCurr: string): Promise<AnalysisRecord[]>;
  /** calendar route: which of these tickers already have any analysis (to mark "confirmed"). */
  listTickersWithAnalysis(tickers: string[]): Promise<string[]>;
  /** calendar seed route: every (ticker, qCurr) pair ever analyzed, unfiltered. */
  listAllTickerQuarterPairs(): Promise<{ ticker: string; qCurr: string }[]>;
  /** analyze/history route: one user's own recent analyses. */
  listUserHistory(userId: string, limit: number): Promise<(AnalysisRecord & { id: string })[]>;
}
```

- [ ] **Step 2: Implement the Supabase-backed repository**

Append to the same file:

```ts
// ── Mapping: persisted (DashboardPayload-shaped JSONB) <-> Analysis entity ────

interface StoredPayload {
  company_ticker: string;
  quarter: string;
  quarter_previous: string;
  executive_evasiveness_score: number;
  insights: SectionalInsight[];
  overall_score: number;
  overall_signal: "Positive" | "Negative" | "Mixed" | "Noise";
  summary: string;
  validation_score: number;
  flagged_count: number;
  market_alignment_pct: number;
  stock_price_change: number;
  market_sources: string[];
  earnings_delta: string[];
  fcf_implications: string[];
  key_metrics?: KeyMetrics;
}

function toEntity(ticker: string, qPrev: string, qCurr: string, raw: unknown): Analysis {
  const p = (typeof raw === "string" ? JSON.parse(raw) : raw) as StoredPayload;
  return {
    ticker,
    quarter: qCurr,
    quarterPrevious: qPrev,
    evasivenessScore: p.executive_evasiveness_score,
    sections: p.insights,
    overallScore: p.overall_score,
    overallSignal: p.overall_signal,
    summary: p.summary,
    validationScore: p.validation_score,
    flaggedCount: p.flagged_count,
    marketAlignmentPct: p.market_alignment_pct,
    stockPriceChange: p.stock_price_change,
    marketSources: p.market_sources,
    earningsDelta: p.earnings_delta,
    fcfImplications: p.fcf_implications,
    keyMetrics: p.key_metrics,
  };
}

function fromEntity(a: Analysis): StoredPayload {
  return {
    company_ticker: a.ticker,
    quarter: a.quarter,
    quarter_previous: a.quarterPrevious,
    executive_evasiveness_score: a.evasivenessScore,
    insights: a.sections,
    overall_score: a.overallScore,
    overall_signal: a.overallSignal,
    summary: a.summary,
    validation_score: a.validationScore,
    flagged_count: a.flaggedCount,
    market_alignment_pct: a.marketAlignmentPct,
    stock_price_change: a.stockPriceChange,
    market_sources: a.marketSources,
    earnings_delta: a.earningsDelta,
    fcf_implications: a.fcfImplications,
    key_metrics: a.keyMetrics,
  };
}

// ── Supabase implementation ──────────────────────────────────────────────────

export class SupabaseAnalysisRepository implements AnalysisRepository {
  async getCachedAnalysis(ticker: string, qPrev: string, qCurr: string, opts: { strict?: boolean } = {}): Promise<Analysis | null> {
    const strict = opts.strict ?? true;
    const { data } = await supabaseAdmin()
      .from("analysis_results")
      .select("payload")
      .eq("company_ticker", ticker.toUpperCase())
      .eq("q_prev", qPrev)
      .eq("q_curr", qCurr)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data?.payload) return null;
    let raw: StoredPayload;
    try {
      raw = typeof data.payload === "string" ? JSON.parse(data.payload) : (data.payload as StoredPayload);
    } catch {
      return null;
    }
    if (!Array.isArray(raw.insights) || raw.insights.length === 0) return null;
    if (strict && !Array.isArray(raw.earnings_delta)) return null;

    return toEntity(ticker.toUpperCase(), qPrev, qCurr, raw);
  }

  async saveAnalysis(userId: string | null, ticker: string, qPrev: string, qCurr: string, analysis: Analysis): Promise<string> {
    try {
      if (!Array.isArray(analysis.sections) || analysis.sections.length === 0) {
        return "not-cached-empty";
      }
      const tickerUp = ticker.toUpperCase();
      const db = supabaseAdmin();

      await db.from("analysis_results").delete().eq("company_ticker", tickerUp).eq("q_prev", qPrev).eq("q_curr", qCurr);

      const { data } = await db
        .from("analysis_results")
        .insert({
          user_id: userId,
          company_ticker: tickerUp,
          q_prev: qPrev,
          q_curr: qCurr,
          payload: fromEntity(analysis),
        })
        .select("id")
        .single();
      return data?.id ?? "unknown";
    } catch (e) {
      console.error("Failed to save analysis result:", e);
      return "unknown";
    }
  }

  async listRecentByTickersAndQuarter(tickers: string[], qCurr: string, limit: number): Promise<AnalysisRecord[]> {
    const { data, error } = await supabaseAdmin()
      .from("analysis_results")
      .select("company_ticker, payload")
      .eq("q_curr", qCurr)
      .in("company_ticker", tickers)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((row) => ({
      ticker: row.company_ticker,
      quarterPrevious: "",
      quarter: qCurr,
      analysis: toEntity(row.company_ticker, "", qCurr, row.payload),
      createdAt: "",
    }));
  }

  async listAllByTickers(tickers: string[]): Promise<AnalysisRecord[]> {
    const { data, error } = await supabaseAdmin()
      .from("analysis_results")
      .select("company_ticker, q_curr, q_prev, payload, created_at")
      .in("company_ticker", tickers)
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data.map((row) => ({
      ticker: row.company_ticker,
      quarterPrevious: row.q_prev,
      quarter: row.q_curr,
      analysis: toEntity(row.company_ticker, row.q_prev, row.q_curr, row.payload),
      createdAt: row.created_at,
    }));
  }

  async listByTickersAndQuarterPair(tickers: string[], qPrev: string, qCurr: string): Promise<AnalysisRecord[]> {
    const { data } = await supabaseAdmin()
      .from("analysis_results")
      .select("company_ticker, q_curr, q_prev, payload, created_at")
      .eq("q_prev", qPrev)
      .eq("q_curr", qCurr)
      .in("company_ticker", tickers)
      .order("created_at", { ascending: false });
    if (!data) return [];
    return data.map((row) => ({
      ticker: row.company_ticker,
      quarterPrevious: row.q_prev,
      quarter: row.q_curr,
      analysis: toEntity(row.company_ticker, row.q_prev, row.q_curr, row.payload),
      createdAt: row.created_at,
    }));
  }

  async listTickersWithAnalysis(tickers: string[]): Promise<string[]> {
    const { data } = await supabaseAdmin()
      .from("analysis_results")
      .select("company_ticker")
      .in("company_ticker", tickers);
    return (data ?? []).map((r) => r.company_ticker);
  }

  async listAllTickerQuarterPairs(): Promise<{ ticker: string; qCurr: string }[]> {
    const { data } = await supabaseAdmin().from("analysis_results").select("company_ticker, q_curr");
    return (data ?? []).map((r) => ({ ticker: r.company_ticker, qCurr: r.q_curr }));
  }

  async listUserHistory(userId: string, limit: number): Promise<(AnalysisRecord & { id: string })[]> {
    const { data } = await supabaseAdmin()
      .from("analysis_results")
      .select("id, company_ticker, q_curr, payload, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) => ({
      id: row.id,
      ticker: row.company_ticker,
      quarterPrevious: "",
      quarter: row.q_curr,
      analysis: toEntity(row.company_ticker, "", row.q_curr, row.payload),
      createdAt: row.created_at,
    }));
  }
}
```

- [ ] **Step 3: Create the composition root**

```ts
// lib/repositories/index.ts
import { SupabaseAnalysisRepository } from "./analysis";

export const analysisRepo = new SupabaseAnalysisRepository();
```

- [ ] **Step 4: Verify the new module compiles standalone**

Run: `npx tsc --noEmit`
Expected: errors only in the files this task hasn't migrated yet (Steps 5-9 below fix those) — no errors inside `lib/repositories/analysis.ts` or `lib/repositories/index.ts` themselves.

- [ ] **Step 5: Migrate `lib/analysis-cache.ts`'s callers, then delete it**

`app/api/v1/analyze/route.ts`, `app/api/v1/sectors/seed/route.ts`, and `app/api/v1/seed-analysis/route.ts` all do:
```ts
import { getCachedAnalysis, saveAnalysis } from "@/lib/analysis-cache";
```
Change each to:
```ts
import { analysisRepo } from "@/lib/repositories";
```
and replace every call `getCachedAnalysis(ticker, qPrev, qCurr)` with `analysisRepo.getCachedAnalysis(ticker, qPrev, qCurr)`, and `saveAnalysis(userId, ticker, qPrev, qCurr, payload)` with `analysisRepo.saveAnalysis(userId, ticker, qPrev, qCurr, payload)` — `payload` here is already `DashboardPayload`-shaped from `runPipeline()`; since `Analysis`'s fields are a camelCase mirror of the same data, the call sites that only pass `payload` straight through (not read individual fields) need no further change beyond the import and function-call rename. Where a call site reads an individual field off the returned value (e.g. `result.overall_signal`), rename to the camelCase entity field (`result.overallSignal`).

Delete `lib/analysis-cache.ts` once no file imports it.

- [ ] **Step 6: Migrate `lib/nifty200-sampler.ts`**

Find (around line 88-94):
```ts
const { data, error } = await supabaseAdmin()
    .from("analysis_results")
    .select("company_ticker, payload")
    .eq("q_curr", qCurr)
    .in("company_ticker", candidateTickers)
    .order("created_at", { ascending: false })
    .limit(maxSamples * 3);

if (error || !data || data.length === 0) return [];
```
Replace with:
```ts
import { analysisRepo } from "@/lib/repositories";
// ...
const records = await analysisRepo.listRecentByTickersAndQuarter(candidateTickers, qCurr, maxSamples * 3);
if (records.length === 0) return [];
```
Update the loop below this to read `record.analysis.overallSignal` / `record.analysis.overallScore` / `record.analysis.summary` (or whichever fields it builds `CompactSignal` from) instead of destructuring `row.payload` — read the existing loop body first to match field-for-field.

- [ ] **Step 7: Migrate `app/api/v1/screener/route.ts`**

Replace the Pass 1 query (`n50Rows`) with:
```ts
const n50Records = await analysisRepo.listAllByTickers(nifty50Tickers);
```
and the Pass 1 dedup loop's `row.company_ticker` / `row.q_curr` / `row.payload` with `record.ticker` / `record.quarter` / `record.analysis`.

Replace the Pass 2 query (`n200Rows`) with:
```ts
const n200Records = await analysisRepo.listByTickersAndQuarterPair(nifty200OnlyTickers, Q_PREV, Q_CURR);
```
with the same field renames in its dedup loop. Remove the now-unused `DbRow` type if nothing else in the file references it.

- [ ] **Step 8: Migrate `app/api/v1/calendar/route.ts` and `app/api/v1/calendar/seed/route.ts`**

In `calendar/route.ts`, replace:
```ts
const { data: analyzed } = await supabaseAdmin()
    .from("analysis_results")
    .select("company_ticker")
    .in("company_ticker", relevantTickers);
```
with:
```ts
const analyzedTickers = await analysisRepo.listTickersWithAnalysis(relevantTickers);
```
and update whatever set-membership check follows (e.g. `new Set(analyzed?.map(r => r.company_ticker))`) to `new Set(analyzedTickers)`.

In `calendar/seed/route.ts`, replace:
```ts
const { data: analyzed } = await supabaseAdmin()
    .from("analysis_results")
    .select("company_ticker, q_curr");
const confirmedSet = new Set(
    (analyzed ?? []).map((r) => `${r.company_ticker}:${r.q_curr}`)
);
```
with:
```ts
const pairs = await analysisRepo.listAllTickerQuarterPairs();
const confirmedSet = new Set(pairs.map((p) => `${p.ticker}:${p.qCurr}`));
```

- [ ] **Step 9: Migrate `app/api/v1/analyze/history/route.ts`**

Replace the whole handler body's query:
```ts
const { data } = await supabaseAdmin()
  .from("analysis_results")
  .select("id, company_ticker, q_curr, payload, created_at")
  .eq("user_id", userId)
  .order("created_at", { ascending: false })
  .limit(20);

return NextResponse.json(data ?? []);
```
with:
```ts
const history = await analysisRepo.listUserHistory(userId, 20);
return NextResponse.json(history);
```
Note: this changes the JSON shape returned to the frontend (from raw DB row columns to the `AnalysisRecord & { id: string }` shape with camelCase fields and a nested `analysis` object). Check whether any frontend code consumes `/api/v1/analyze/history`'s response shape directly (grep the frontend for a fetch to this endpoint) and update that call site's field access to match, or confirm nothing currently consumes it if it's unused.

- [ ] **Step 10: Full verification**

Run: `npx tsc --noEmit`
Expected: clean, zero errors.

Start the dev server (`npm run dev`) and manually smoke-check: `/dashboard` (run or view a cached analysis), `/screener` (loads without error), `/calendar` (loads, shows confirmed/unconfirmed markers), `/insights` history if surfaced anywhere. Since this repo has placeholder Supabase credentials in some environments, a live check may not be possible everywhere — if so, confirm at minimum that each route returns a clean response shape (no thrown error) when hit via `curl`, and note in your report which checks could run live vs. which only got a type-check pass.

- [ ] **Step 11: Commit**

```bash
git add lib/repositories/index.ts lib/repositories/analysis.ts app/api/v1/analyze/route.ts app/api/v1/sectors/seed/route.ts app/api/v1/seed-analysis/route.ts lib/nifty200-sampler.ts app/api/v1/screener/route.ts app/api/v1/calendar/route.ts app/api/v1/calendar/seed/route.ts app/api/v1/analyze/history/route.ts
git rm lib/analysis-cache.ts
git commit -m "feat: introduce AnalysisRepository, migrate all analysis_results call sites"
```

---

### Task 2: SectorRepository

**Files:**
- Create: `lib/repositories/sectors.ts`
- Modify: `lib/repositories/index.ts` (add `sectorRepo`)
- Modify: `app/api/v1/sectors/route.ts`
- Modify: `app/api/v1/sectors/seed/route.ts:452-492`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `Sector`, `SectorRepository`, `sectorRepo` instance.

- [ ] **Step 1: Create the domain entity and repository**

```ts
// lib/repositories/sectors.ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SectorNarrative } from "@/lib/sector-narrative";

export interface CompanySignal {
  ticker: string;
  signal: string;
  direction: "positive" | "neutral" | "negative";
  score: number;
  marketCap: number;
  weightPct: number;
}

export interface SectorDimension {
  dimension: string;
  signal: string;
  direction: "strengthening" | "stable" | "weakening";
  weightedScore: number;
  details: string[];
  companySignals: CompanySignal[];
}

export interface Sector {
  sector: string;
  sectorLabel: string;
  companyCount: number;
  quarter: string;
  quarterPrevious: string;
  dimensions: SectorDimension[];
  isSubSector?: boolean;
  parentSector?: string;
  thesis?: string;
  narrative?: SectorNarrative;
}

export interface SectorRecord {
  sector: string;
  quarter: string;
  payload: Sector;
  createdAt: string;
}

export interface SectorRepository {
  listBySectors(sectors: string[]): Promise<SectorRecord[]>;
  getBySector(sector: string): Promise<Sector | null>;
  /** Delete-then-insert: replaces all rows for this sector with one fresh row. */
  replaceSector(sector: string, quarter: string, payload: Sector): Promise<{ id: string | null; error: string | null }>;
}

interface StoredSector {
  sector: string;
  sector_label: string;
  company_count: number;
  quarter: string;
  quarter_previous: string;
  dimensions: {
    dimension: string;
    signal: string;
    direction: "strengthening" | "stable" | "weakening";
    weighted_score: number;
    details: string[];
    company_signals: {
      ticker: string; signal: string; direction: "positive" | "neutral" | "negative";
      score: number; market_cap: number; weight_pct: number;
    }[];
  }[];
  is_sub_sector?: boolean;
  parent_sector?: string;
  thesis?: string;
  narrative?: SectorNarrative;
}

function toEntity(raw: unknown): Sector {
  const p = raw as StoredSector;
  return {
    sector: p.sector,
    sectorLabel: p.sector_label,
    companyCount: p.company_count,
    quarter: p.quarter,
    quarterPrevious: p.quarter_previous,
    dimensions: p.dimensions.map((d) => ({
      dimension: d.dimension,
      signal: d.signal,
      direction: d.direction,
      weightedScore: d.weighted_score,
      details: d.details,
      companySignals: d.company_signals.map((c) => ({
        ticker: c.ticker, signal: c.signal, direction: c.direction,
        score: c.score, marketCap: c.market_cap, weightPct: c.weight_pct,
      })),
    })),
    isSubSector: p.is_sub_sector,
    parentSector: p.parent_sector,
    thesis: p.thesis,
    narrative: p.narrative,
  };
}

function fromEntity(s: Sector): StoredSector {
  return {
    sector: s.sector,
    sector_label: s.sectorLabel,
    company_count: s.companyCount,
    quarter: s.quarter,
    quarter_previous: s.quarterPrevious,
    dimensions: s.dimensions.map((d) => ({
      dimension: d.dimension,
      signal: d.signal,
      direction: d.direction,
      weighted_score: d.weightedScore,
      details: d.details,
      company_signals: d.companySignals.map((c) => ({
        ticker: c.ticker, signal: c.signal, direction: c.direction,
        score: c.score, market_cap: c.marketCap, weight_pct: c.weightPct,
      })),
    })),
    is_sub_sector: s.isSubSector,
    parent_sector: s.parentSector,
    thesis: s.thesis,
    narrative: s.narrative,
  };
}

export class SupabaseSectorRepository implements SectorRepository {
  async listBySectors(sectors: string[]): Promise<SectorRecord[]> {
    const { data, error } = await supabaseAdmin()
      .from("sector_intelligence")
      .select("sector, quarter, payload, created_at")
      .in("sector", sectors)
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data.map((row) => ({
      sector: row.sector,
      quarter: row.quarter,
      payload: toEntity(row.payload),
      createdAt: row.created_at,
    }));
  }

  async getBySector(sector: string): Promise<Sector | null> {
    const { data } = await supabaseAdmin()
      .from("sector_intelligence")
      .select("payload")
      .eq("sector", sector)
      .maybeSingle();
    if (!data?.payload) return null;
    return toEntity(data.payload);
  }

  async replaceSector(sector: string, quarter: string, payload: Sector): Promise<{ id: string | null; error: string | null }> {
    await supabaseAdmin().from("sector_intelligence").delete().eq("sector", sector);
    const { data, error } = await supabaseAdmin()
      .from("sector_intelligence")
      .insert({ sector, quarter, payload: fromEntity(payload) as unknown as Record<string, unknown> })
      .select("id")
      .single();
    return { id: data?.id ?? null, error: error ? `${error.message} (code=${error.code})` : null };
  }
}
```

- [ ] **Step 2: Add to the composition root**

```ts
// lib/repositories/index.ts — add
import { SupabaseSectorRepository } from "./sectors";
export const sectorRepo = new SupabaseSectorRepository();
```

- [ ] **Step 3: Migrate `app/api/v1/sectors/route.ts`**

Replace:
```ts
const query = supabaseAdmin()
    .from("sector_intelligence")
    .select("sector, quarter, payload, created_at")
    .in("sector", validSectors)
    .order("created_at", { ascending: false });

const { data: rows, error } = await query;
```
with:
```ts
import { sectorRepo } from "@/lib/repositories";
// ...
const rows = await sectorRepo.listBySectors(validSectors);
```
The rest of the handler (dedup-by-sector, quarter comparison, filtering, sorting) operates on `rows` — update field access from `row.payload.company_count` etc. to `row.payload.companyCount` (the entity's camelCase fields) throughout this file, including the `_debug` block. Remove the local `SectorIntelligence`/`SectorDimension`/`CompanySignal` interfaces from this file — import `Sector` from `@/lib/repositories/sectors` instead.

- [ ] **Step 4: Migrate `app/api/v1/sectors/seed/route.ts`**

Replace the "carry over existing narrative" read (lines ~452-456):
```ts
const { data: existingRow } = await supabaseAdmin()
    .from("sector_intelligence")
    .select("payload")
    .eq("sector", sector)
    .maybeSingle();
if (existingRow?.payload) {
    const existingPayload = existingRow.payload as unknown as SectorIntelligence;
    if (existingPayload.narrative) {
        sectorIntel.narrative = existingPayload.narrative;
        log.push(`[${sector}] Carried over existing narrative`);
    }
}
```
with:
```ts
const existing = await sectorRepo.getBySector(sector);
if (existing?.narrative) {
    sectorIntel.narrative = existing.narrative;
    log.push(`[${sector}] Carried over existing narrative`);
}
```

Replace the delete+insert (lines ~472-492):
```ts
await supabaseAdmin().from("sector_intelligence").delete().eq("sector", sector);

const { data: insertData, error: insertErr } = await supabaseAdmin()
    .from("sector_intelligence")
    .insert({ sector, quarter, payload: sectorIntel as unknown as Record<string, unknown> })
    .select("id")
    .single();

if (insertErr) {
    log.push(`[${sector}] DB INSERT ERROR: ${insertErr.message} (code=${insertErr.code})`);
} else {
    log.push(`[${sector}] Stored sector intelligence: ${companyPayloads.length} companies, quarter=${quarter} id=${insertData?.id}`);
}
```
with:
```ts
const { id, error: replaceError } = await sectorRepo.replaceSector(sector, quarter, sectorIntel);
if (replaceError) {
    log.push(`[${sector}] DB INSERT ERROR: ${replaceError}`);
} else {
    log.push(`[${sector}] Stored sector intelligence: ${companyPayloads.length} companies, quarter=${quarter} id=${id}`);
}
```
`sectorIntel` here must already be assembled with camelCase fields matching `Sector` (it's built by `computeSectorIntelligence` elsewhere in this file/`lib/sector-narrative.ts` machinery) — if that builder currently produces snake_case fields, add the field renames at construction time rather than special-casing this call site.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — expected clean.
Smoke check: `npm run dev`, hit `GET /api/v1/sectors` and `GET /api/v1/sectors?sector=Banking`, confirm a 200 with a `sectors` array (or an empty-but-valid response if no live DB credentials — note which in your report).

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/index.ts lib/repositories/sectors.ts app/api/v1/sectors/route.ts app/api/v1/sectors/seed/route.ts
git commit -m "feat: introduce SectorRepository, migrate sector_intelligence call sites"
```

---

### Task 3: KpiRepository

**Files:**
- Create: `lib/repositories/kpis.ts`
- Modify: `lib/repositories/index.ts` (add `kpiRepo`)
- Modify: `app/api/v1/kpis/route.ts`

**Interfaces:**
- Consumes: `KPIEntry` type from `lib/kpi-extractor.ts` (existing, unchanged).
- Produces: `KpiSnapshot`, `KpiRepository`, `kpiRepo` instance.

- [ ] **Step 1: Create the domain entity and repository**

```ts
// lib/repositories/kpis.ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { KPIEntry } from "@/lib/kpi-extractor";

export interface KpiSnapshot {
  ticker: string;
  company: string;
  sector: string;
  quarter: string;
  quarterPrevious: string;
  kpis: KPIEntry[];
}

export interface KpiRepository {
  getLatestByTicker(ticker: string): Promise<KpiSnapshot | null>;
  upsertSnapshot(snapshot: KpiSnapshot): Promise<{ error: string | null }>;
  listAll(sectorFilter?: string): Promise<KpiSnapshot[]>;
  deleteAll(): Promise<void>;
}

interface StoredKpiRow {
  company_ticker: string;
  company: string;
  sector: string;
  quarter: string;
  quarter_previous: string;
  kpis: KPIEntry[];
  created_at: string;
}

function toEntity(row: StoredKpiRow): KpiSnapshot {
  return {
    ticker: row.company_ticker,
    company: row.company,
    sector: row.sector,
    quarter: row.quarter,
    quarterPrevious: row.quarter_previous,
    kpis: row.kpis,
  };
}

export class SupabaseKpiRepository implements KpiRepository {
  async getLatestByTicker(ticker: string): Promise<KpiSnapshot | null> {
    const { data } = await supabaseAdmin()
      .from("kpi_snapshots")
      .select("*")
      .eq("company_ticker", ticker)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return toEntity(data as StoredKpiRow);
  }

  async upsertSnapshot(snapshot: KpiSnapshot): Promise<{ error: string | null }> {
    const { error } = await supabaseAdmin()
      .from("kpi_snapshots")
      .upsert(
        {
          company_ticker: snapshot.ticker,
          quarter: snapshot.quarter,
          quarter_previous: snapshot.quarterPrevious,
          sector: snapshot.sector,
          kpis: snapshot.kpis,
        },
        { onConflict: "company_ticker,quarter" }
      );
    return { error: error ? error.message : null };
  }

  async listAll(sectorFilter?: string): Promise<KpiSnapshot[]> {
    let query = supabaseAdmin().from("kpi_snapshots").select("*").order("created_at", { ascending: false });
    if (sectorFilter) query = query.eq("sector", sectorFilter);
    const { data, error } = await query;
    if (error || !data) return [];
    const seen = new Set<string>();
    const result: KpiSnapshot[] = [];
    for (const row of data as StoredKpiRow[]) {
      if (seen.has(row.company_ticker)) continue;
      seen.add(row.company_ticker);
      result.push(toEntity(row));
    }
    return result;
  }

  async deleteAll(): Promise<void> {
    await supabaseAdmin().from("kpi_snapshots").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }
}
```

Note: `getLatestByTicker` uses `.maybeSingle()` here (not the original's `.single()`) — the original's use of `.single()` with only `data` destructured (error ignored) was already functionally equivalent to "treat no-row as falsy," and `.maybeSingle()` makes that explicit and correct rather than relying on an unchecked error path. This is the one deliberate, minimal behavior clarification in this task — flag it in your report, don't apply similar "improvements" elsewhere without calling them out the same way.

- [ ] **Step 2: Add to the composition root**

```ts
// lib/repositories/index.ts — add
import { SupabaseKpiRepository } from "./kpis";
export const kpiRepo = new SupabaseKpiRepository();
```

- [ ] **Step 3: Migrate `app/api/v1/kpis/route.ts`**

Replace Query A (single-ticker cache lookup) with `await kpiRepo.getLatestByTicker(ticker)`.
Replace Query B (upsert after fresh extraction) with `await kpiRepo.upsertSnapshot(snapshot)` — `snapshot` here is already `KPISnapshot`-shaped from `extractKPIs()`; construct the `KpiSnapshot` entity from it (same fields, renamed `quarter_previous` → `quarterPrevious`, `ticker` → `ticker`) before calling.
Replace Query C (all/sector-filtered listing) with `await kpiRepo.listAll(sectorFilter)`.
Replace Query D (delete-all) with `await kpiRepo.deleteAll()`.

Update all downstream field access in this route from snake_case to the entity's camelCase.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expected clean.
Smoke check: `GET /api/v1/kpis?ticker=TCS`, `GET /api/v1/kpis?all=1`.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/index.ts lib/repositories/kpis.ts app/api/v1/kpis/route.ts
git commit -m "feat: introduce KpiRepository, migrate kpi_snapshots call sites"
```

---

### Task 4: WatchlistRepository (RLS-scoped — deliberate exception)

**Files:**
- Create: `lib/repositories/watchlist.ts`
- Modify: `lib/repositories/index.ts` (add `watchlistRepo`)
- Modify: `app/api/v1/user-tickers/route.ts`

**Interfaces:**
- Produces: `WatchlistTicker`, `WatchlistRepository`, `watchlistRepo` instance.

**Important — read before starting:** `user_tickers` is the one domain in this migration that uses a request-scoped, RLS-authenticated Supabase client (`createClient()` from `@/lib/supabase/server`, built from the request's session cookies), not the service-role `supabaseAdmin()` client every other repository uses. A singleton instantiated once in `lib/repositories/index.ts` cannot hold a fixed client for this domain, since the correct client differs per request. This repository's methods therefore take the Supabase client as an explicit first parameter, and the composition root still exports a singleton *repository instance* (its methods are stateless aside from the passed-in client) — this is a deliberate, documented exception to the "repository holds its own client" pattern used everywhere else, made specifically to preserve RLS enforcement exactly as it works today. Do not "fix" this by switching to `supabaseAdmin()` with manual `user_id` filtering — that would silently change the security model.

- [ ] **Step 1: Create the domain entity and repository**

```ts
// lib/repositories/watchlist.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface WatchlistTicker {
  ticker: string;
  name: string;
  sector: string;
  addedAt: string;
}

export interface WatchlistRepository {
  list(supabase: SupabaseClient): Promise<{ tickers: WatchlistTicker[]; error: string | null }>;
  add(supabase: SupabaseClient, userId: string, ticker: string, name: string, sector: string): Promise<{ ticker: WatchlistTicker | null; error: string | null }>;
  remove(supabase: SupabaseClient, userId: string, ticker: string): Promise<void>;
}

function toEntity(row: { ticker: string; name: string; sector: string; added_at: string }): WatchlistTicker {
  return { ticker: row.ticker, name: row.name, sector: row.sector, addedAt: row.added_at };
}

export class SupabaseWatchlistRepository implements WatchlistRepository {
  async list(supabase: SupabaseClient) {
    const { data, error } = await supabase
      .from("user_tickers")
      .select("ticker, name, sector, added_at")
      .order("added_at", { ascending: false });
    return { tickers: (data ?? []).map(toEntity), error: error ? error.message : null };
  }

  async add(supabase: SupabaseClient, userId: string, ticker: string, name: string, sector: string) {
    const { data, error } = await supabase
      .from("user_tickers")
      .upsert({ user_id: userId, ticker, name: name || ticker, sector }, { onConflict: "user_id,ticker" })
      .select("ticker, name, sector, added_at")
      .single();
    return { ticker: data ? toEntity(data) : null, error: error ? error.message : null };
  }

  async remove(supabase: SupabaseClient, userId: string, ticker: string): Promise<void> {
    await supabase.from("user_tickers").delete().eq("user_id", userId).eq("ticker", ticker);
  }
}
```

- [ ] **Step 2: Add to the composition root**

```ts
// lib/repositories/index.ts — add
import { SupabaseWatchlistRepository } from "./watchlist";
export const watchlistRepo = new SupabaseWatchlistRepository();
```

- [ ] **Step 3: Migrate `app/api/v1/user-tickers/route.ts`**

Keep the existing `createClient()` (from `@/lib/supabase/server`) and `supabase.auth.getUser()` auth check exactly as-is in each handler — only the table queries move.

GET handler: replace the query with `const { tickers, error } = await watchlistRepo.list(supabase);` and adjust the response/error handling to match (return the existing `UserTicker[]` shape by mapping `tickers` — either keep this route's external JSON shape as `{ ticker, name, sector, added_at }` by mapping `addedAt` back to `added_at` in the response, or update the frontend consumer if one exists; check `app/dashboard/DashboardClient.tsx`'s watchlist hook for how it currently parses this endpoint's response before deciding, since the plan's principle is "repositories return entities," not "every route's JSON wire format must change").

POST handler: keep the ticker-regex validation (`^[A-Z0-9&.-]{1,20}$`) as-is, then replace the upsert with `const { ticker: saved, error } = await watchlistRepo.add(supabase, user.id, ticker, name, sector);`.

DELETE handler: replace with `await watchlistRepo.remove(supabase, user.id, ticker);` (matching today's behavior of not checking the result).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expected clean.
Smoke check: with a logged-in session, `GET /api/v1/user-tickers`, `POST` a ticker, `DELETE` it — confirm the watchlist UI on `/dashboard` still adds/removes/persists tickers correctly.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/index.ts lib/repositories/watchlist.ts app/api/v1/user-tickers/route.ts
git commit -m "feat: introduce WatchlistRepository (RLS-scoped), migrate user_tickers call sites"
```

---

### Task 5: CreditsRepository

**Files:**
- Create: `lib/repositories/credits.ts`
- Modify: `lib/repositories/index.ts` (add `creditsRepo`)
- Modify: `lib/credits.ts` (becomes a thin wrapper over the repository, keeping its existing exported function signatures so callers don't change)
- Delete: none (`lib/credits.ts` stays, its internals change)

**Interfaces:**
- Produces: `CreditStatus` (unchanged shape), `CreditsRepository`, `creditsRepo` instance. `lib/credits.ts` keeps exporting `getCreditStatus(userId)` and `checkAndDeduct(userId, action)` with identical signatures — no caller of `lib/credits.ts` needs to change.

**Note on scope:** `checkAndDeduct`'s `ACTION_COSTS` lookup and its "is this allowed" decision is business logic, not persistence — per the Architectural Principles it doesn't belong inside a repository. It's staying in `lib/credits.ts` as a thin function that calls the repository for the actual DB read/write, rather than being pulled into `CreditsRepository` itself or into a formal Service (Services are Plan B's scope, not this plan's). This keeps the repository persistence-only without expanding this plan's scope into building the Services layer early.

- [ ] **Step 1: Create the domain entity and repository**

```ts
// lib/repositories/credits.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface CreditStatus {
  used: number;
  quota: number;
  remaining: number;
  month: string;
}

export interface CreditsRepository {
  getOrCreateStatus(userId: string, month: string, defaultQuota: number): Promise<CreditStatus>;
  setUsed(userId: string, month: string, used: number): Promise<void>;
}

export class SupabaseCreditsRepository implements CreditsRepository {
  async getOrCreateStatus(userId: string, month: string, defaultQuota: number): Promise<CreditStatus> {
    const { data } = await supabaseAdmin()
      .from("user_credits")
      .select("used, quota")
      .eq("user_id", userId)
      .eq("month", month)
      .maybeSingle();

    if (data) {
      return { used: data.used, quota: data.quota, remaining: data.quota - data.used, month };
    }

    await supabaseAdmin()
      .from("user_credits")
      .upsert({ user_id: userId, month, used: 0, quota: defaultQuota }, { onConflict: "user_id,month" });

    return { used: 0, quota: defaultQuota, remaining: defaultQuota, month };
  }

  async setUsed(userId: string, month: string, used: number): Promise<void> {
    await supabaseAdmin().from("user_credits").update({ used }).eq("user_id", userId).eq("month", month);
  }
}
```

- [ ] **Step 2: Add to the composition root**

```ts
// lib/repositories/index.ts — add
import { SupabaseCreditsRepository } from "./credits";
export const creditsRepo = new SupabaseCreditsRepository();
```

- [ ] **Step 3: Rewrite `lib/credits.ts` as a thin wrapper**

```ts
// lib/credits.ts
/**
 * User credits system.
 * 1 credit = $0.01. Default monthly quota = 600 ($6).
 *
 * Cost per action:
 *   Delta Analysis:    3 credits ($0.03)
 *   Deep Dive:         1 credit  ($0.01)
 *   Multi-Quarter:     4 credits ($0.04)
 *   Screener/etc:      0 credits (DB reads)
 */
import { creditsRepo } from "@/lib/repositories";
import type { CreditStatus } from "@/lib/repositories/credits";

const DEFAULT_QUOTA = 2_500;

export const ACTION_COSTS: Record<string, number> = {
  delta: 3,
  solo: 1,
  insights: 4,
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type { CreditStatus };

export async function getCreditStatus(userId: string): Promise<CreditStatus> {
  return creditsRepo.getOrCreateStatus(userId, currentMonth(), DEFAULT_QUOTA);
}

export async function checkAndDeduct(
  userId: string,
  action: string
): Promise<{ allowed: boolean; remaining: number; cost: number }> {
  const cost = ACTION_COSTS[action] ?? 0;
  if (cost === 0) return { allowed: true, remaining: 0, cost: 0 };

  const status = await getCreditStatus(userId);

  if (status.remaining < cost) {
    return { allowed: false, remaining: status.remaining, cost };
  }

  await creditsRepo.setUsed(userId, status.month, status.used + cost);

  return { allowed: true, remaining: status.remaining - cost, cost };
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expected clean. No caller of `lib/credits.ts` needs any change (`getCreditStatus`/`checkAndDeduct` signatures are unchanged) — confirm with `grep -rn "from \"@/lib/credits\"" app lib` that every caller still compiles untouched.

Smoke check: trigger an action that costs credits (e.g. a delta analysis run) and confirm the credits indicator in the nav bar (`components/Nav.tsx`'s `CreditsIndicator`) still reflects the deduction.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/index.ts lib/repositories/credits.ts lib/credits.ts
git commit -m "feat: introduce CreditsRepository, keep lib/credits.ts as a thin wrapper"
```

---

### Task 6: SoloAnalysisRepository

**Files:**
- Create: `lib/repositories/soloAnalysis.ts`
- Modify: `lib/repositories/index.ts` (add `soloAnalysisRepo`)
- Modify: `lib/solo-pipeline.ts`

**Interfaces:**
- Produces: `SoloAnalysis`, `SoloSection`, `SoloAnalysisRepository`, `soloAnalysisRepo` instance.

- [ ] **Step 1: Create the domain entity and repository**

```ts
// lib/repositories/soloAnalysis.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface SoloSection {
  title: string;
  bullets: string[];
}

export interface SoloAnalysis {
  ticker: string;
  quarter: string;
  headline: string;
  managementTone: string;
  sections: SoloSection[];
}

export interface SoloAnalysisRepository {
  getCached(ticker: string, quarter: string): Promise<SoloAnalysis | null>;
  saveAnalysis(ticker: string, quarter: string, analysis: SoloAnalysis): Promise<string>;
}

interface StoredSoloPayload {
  company_ticker: string;
  quarter: string;
  headline: string;
  management_tone: string;
  sections: SoloSection[];
}

function toEntity(ticker: string, quarter: string, raw: unknown): SoloAnalysis {
  const p = (typeof raw === "string" ? JSON.parse(raw) : raw) as StoredSoloPayload;
  return {
    ticker,
    quarter,
    headline: p.headline,
    managementTone: p.management_tone,
    sections: p.sections,
  };
}

function fromEntity(a: SoloAnalysis): StoredSoloPayload {
  return {
    company_ticker: a.ticker,
    quarter: a.quarter,
    headline: a.headline,
    management_tone: a.managementTone,
    sections: a.sections,
  };
}

export class SupabaseSoloAnalysisRepository implements SoloAnalysisRepository {
  async getCached(ticker: string, quarter: string): Promise<SoloAnalysis | null> {
    const { data } = await supabaseAdmin()
      .from("solo_analysis_cache")
      .select("payload")
      .eq("ticker", ticker)
      .eq("quarter", quarter)
      .maybeSingle();
    if (!data?.payload) return null;
    const entity = toEntity(ticker, quarter, data.payload);
    if (!entity.sections || entity.sections.length === 0) return null;
    return entity;
  }

  async saveAnalysis(ticker: string, quarter: string, analysis: SoloAnalysis): Promise<string> {
    try {
      await supabaseAdmin().from("solo_analysis_cache").delete().eq("ticker", ticker).eq("quarter", quarter);
      const { data } = await supabaseAdmin()
        .from("solo_analysis_cache")
        .insert({ ticker, quarter, payload: fromEntity(analysis) })
        .select("id")
        .single();
      return data?.id ?? "unknown";
    } catch {
      return "unknown";
    }
  }
}
```

- [ ] **Step 2: Add to the composition root**

```ts
// lib/repositories/index.ts — add
import { SupabaseSoloAnalysisRepository } from "./soloAnalysis";
export const soloAnalysisRepo = new SupabaseSoloAnalysisRepository();
```

- [ ] **Step 3: Migrate `lib/solo-pipeline.ts`**

Replace the module-private `getCached`/`setCache` functions (lines ~133-162) with calls to `soloAnalysisRepo.getCached(ticker, quarter)` / `soloAnalysisRepo.saveAnalysis(ticker, quarter, payload)`, removing the now-redundant local functions. Update the cache-check call site (line ~173-176) and the `SoloPayload` type usages throughout this file to `SoloAnalysis` (import from `@/lib/repositories/soloAnalysis` instead of defining locally) — keep the exported `SoloPayload`/`SoloSection` names as type aliases (`export type SoloPayload = SoloAnalysis;`) if any other file imports them, to avoid a wider ripple; check with `grep -rn "SoloPayload\|SoloSection" app lib` first.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expected clean.
Smoke check: run a Solo/quick analysis from `/dashboard`, confirm the cached result still renders on a repeat request without re-running the pipeline.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/index.ts lib/repositories/soloAnalysis.ts lib/solo-pipeline.ts
git commit -m "feat: introduce SoloAnalysisRepository, migrate solo_analysis_cache call sites"
```

---

### Task 7: InsightsRepository

**Files:**
- Create: `lib/repositories/insights.ts`
- Modify: `lib/repositories/index.ts` (add `insightsRepo`)
- Modify: `lib/insights-pipeline.ts`
- Modify: `lib/divergence-score.ts`

**Interfaces:**
- Produces: `InsightsSummary`, `InsightsRepository`, `insightsRepo` instance.

**Flag before starting — pre-existing inconsistency, not to be silently fixed:** `lib/divergence-score.ts` reads `overall_signal`/`overall_score` off whatever's stored in `insights_cache.payload`, but those fields don't exist anywhere on `InsightsPayload` (the type actually written into `insights_cache` by `lib/insights-pipeline.ts` — it has `management_credibility_score`, not `overall_score`/`overall_signal`). This looks like a pre-existing bug — `concallSignal`/`concallScore` in `computeDivergence()`'s result are likely always `null`/`undefined` in practice. This task preserves that behavior exactly (Strangler Fig — migrate, don't redesign) via a separate, loosely-typed repository method for that one read. Note this in your task report as a discovered issue for the human to decide whether to fix separately; do not fix it as part of this migration.

- [ ] **Step 1: Create the domain entity and repository**

```ts
// lib/repositories/insights.ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { QuarterBrief, RecurringTheme, GuidanceTrack } from "@/lib/insights-pipeline";

export interface InsightsSummary {
  ticker: string;
  quartersAnalyzed: string[];
  quarterBriefs: QuarterBrief[];
  recurringThemes: RecurringTheme[];
  guidanceTracks: GuidanceTrack[];
  managementCredibilityScore: number;
  newBusinessSignals: string[];
  keyWatchpoints: string[];
  segmentNarrative: string;
}

export interface InsightsRepository {
  getCached(ticker: string, quartersKey: string, ttlDays: number): Promise<InsightsSummary | null>;
  saveInsights(ticker: string, quartersKey: string, insights: InsightsSummary): Promise<void>;
  /**
   * Reads the latest cached payload for a ticker with NO quartersKey/TTL filter,
   * returned as a loosely-typed record rather than InsightsSummary. Exists
   * solely for lib/divergence-score.ts's pre-existing read of overall_signal/
   * overall_score — fields that do not exist on InsightsSummary. This is a
   * known, unresolved inconsistency being preserved as-is, not a new contract.
   */
  getLatestRawPayload(ticker: string): Promise<Record<string, unknown> | null>;
}

interface StoredInsights {
  ticker: string;
  quarters_analyzed: string[];
  quarter_briefs: QuarterBrief[];
  recurring_themes: RecurringTheme[];
  guidance_tracks: GuidanceTrack[];
  management_credibility_score: number;
  new_business_signals: string[];
  key_watchpoints: string[];
  segment_narrative: string;
}

function toEntity(raw: StoredInsights): InsightsSummary {
  return {
    ticker: raw.ticker,
    quartersAnalyzed: raw.quarters_analyzed,
    quarterBriefs: raw.quarter_briefs,
    recurringThemes: raw.recurring_themes,
    guidanceTracks: raw.guidance_tracks,
    managementCredibilityScore: raw.management_credibility_score,
    newBusinessSignals: raw.new_business_signals,
    keyWatchpoints: raw.key_watchpoints,
    segmentNarrative: raw.segment_narrative,
  };
}

function fromEntity(s: InsightsSummary): StoredInsights {
  return {
    ticker: s.ticker,
    quarters_analyzed: s.quartersAnalyzed,
    quarter_briefs: s.quarterBriefs,
    recurring_themes: s.recurringThemes,
    guidance_tracks: s.guidanceTracks,
    management_credibility_score: s.managementCredibilityScore,
    new_business_signals: s.newBusinessSignals,
    key_watchpoints: s.keyWatchpoints,
    segment_narrative: s.segmentNarrative,
  };
}

export class SupabaseInsightsRepository implements InsightsRepository {
  async getCached(ticker: string, quartersKey: string, ttlDays: number): Promise<InsightsSummary | null> {
    try {
      const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabaseAdmin()
        .from("insights_cache")
        .select("payload")
        .eq("ticker", ticker)
        .eq("quarters_key", quartersKey)
        .gte("created_at", cutoff)
        .maybeSingle();
      if (error || !data) return null;
      return toEntity(data.payload as StoredInsights);
    } catch {
      return null;
    }
  }

  async saveInsights(ticker: string, quartersKey: string, insights: InsightsSummary): Promise<void> {
    await supabaseAdmin()
      .from("insights_cache")
      .upsert(
        { ticker, quarters_key: quartersKey, payload: fromEntity(insights), created_at: new Date().toISOString() },
        { onConflict: "ticker,quarters_key" }
      );
  }

  async getLatestRawPayload(ticker: string): Promise<Record<string, unknown> | null> {
    const { data } = await supabaseAdmin()
      .from("insights_cache")
      .select("payload")
      .eq("ticker", ticker)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.payload as Record<string, unknown>) ?? null;
  }
}
```

- [ ] **Step 2: Add to the composition root**

```ts
// lib/repositories/index.ts — add
import { SupabaseInsightsRepository } from "./insights";
export const insightsRepo = new SupabaseInsightsRepository();
```

- [ ] **Step 3: Migrate `lib/insights-pipeline.ts`**

Replace `getCachedInsights` (lines ~254-274) with a call to `insightsRepo.getCached(ticker, qKey, 30)`, removing the local `CACHE_TTL_DAYS` constant and function (or keep the constant and pass it through, whichever keeps the diff smaller — prefer keeping `CACHE_TTL_DAYS = 30` defined once in this file and passing it as the third argument).

Replace `setCachedInsights` (lines ~276-287) with a call to `insightsRepo.saveInsights(ticker, qKey, payload)`, removing the local function. Keep the fire-and-forget `.catch()` call style at the call site unchanged.

Update the exported `InsightsPayload` type (and any other file importing it) to alias `InsightsSummary`: check `grep -rn "InsightsPayload" app lib` for consumers before deciding whether to keep `InsightsPayload` as an exported alias here or update those consumers directly.

- [ ] **Step 4: Migrate `lib/divergence-score.ts`**

Replace the read at lines ~61-67:
```ts
const { data } = await supabaseAdmin()
    .from("insights_cache")
    .select("payload")
    .eq("ticker", ticker)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

const payload = data?.payload as ...
```
with:
```ts
const payload = await insightsRepo.getLatestRawPayload(ticker);
```
keeping the subsequent `overall_signal`/`overall_score` field reads unchanged (this preserves the pre-existing behavior flagged above, including its likely-always-null result).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — expected clean.
Smoke check: run Multi-Quarter Insights for a ticker on `/insights`, confirm cached re-runs still serve from cache; hit `/api/v1/divergence?ticker=X` and confirm it still responds (even if `concallSignal`/`concallScore` are null, matching pre-existing behavior).

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/index.ts lib/repositories/insights.ts lib/insights-pipeline.ts lib/divergence-score.ts
git commit -m "feat: introduce InsightsRepository, migrate insights_cache call sites"
```

---

### Task 8: PromoterActivityRepository

**Files:**
- Create: `lib/repositories/promoterActivity.ts`
- Modify: `lib/repositories/index.ts` (add `promoterActivityRepo`)
- Modify: `app/api/v1/divergence/route.ts`

**Interfaces:**
- Consumes: `PromoterActivityEvent` type shape from `lib/promoter-activity-fetcher.ts` (existing, unchanged) — the repository's entity mirrors it.
- Produces: `PromoterActivityEvent` (repository's own, camelCase), `PromoterActivityRepository`, `promoterActivityRepo` instance.

- [ ] **Step 1: Create the domain entity and repository**

```ts
// lib/repositories/promoterActivity.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface PromoterActivityEvent {
  ticker: string;
  newsId: string;
  disclosureDate: string;
  subcatName: string;
  headline: string;
  attachmentName: string;
  eventType: string;
}

export interface PromoterActivityRepository {
  getFetchLog(ticker: string): Promise<{ fetchedAt: string } | null>;
  saveFetchLog(ticker: string, fetchedAt: string, rowCount: number): Promise<{ error: string | null }>;
  upsertEvents(events: PromoterActivityEvent[]): Promise<{ error: string | null }>;
  listByTicker(ticker: string): Promise<{ events: PromoterActivityEvent[]; error: string | null }>;
}

function toEntity(row: {
  news_id: string; disclosure_date: string; subcat_name: string;
  headline: string; attachment_name: string; event_type: string;
}, ticker: string): PromoterActivityEvent {
  return {
    ticker,
    newsId: row.news_id,
    disclosureDate: row.disclosure_date,
    subcatName: row.subcat_name,
    headline: row.headline,
    attachmentName: row.attachment_name,
    eventType: row.event_type,
  };
}

export class SupabasePromoterActivityRepository implements PromoterActivityRepository {
  async getFetchLog(ticker: string): Promise<{ fetchedAt: string } | null> {
    const { data } = await supabaseAdmin()
      .from("promoter_activity_fetch_log")
      .select("fetched_at")
      .eq("ticker", ticker)
      .maybeSingle();
    return data ? { fetchedAt: data.fetched_at } : null;
  }

  async saveFetchLog(ticker: string, fetchedAt: string, rowCount: number): Promise<{ error: string | null }> {
    const { error } = await supabaseAdmin()
      .from("promoter_activity_fetch_log")
      .upsert({ ticker, fetched_at: fetchedAt, row_count: rowCount }, { onConflict: "ticker" });
    return { error: error ? error.message : null };
  }

  async upsertEvents(events: PromoterActivityEvent[]): Promise<{ error: string | null }> {
    if (events.length === 0) return { error: null };
    const { error } = await supabaseAdmin().from("promoter_activity").upsert(
      events.map((e) => ({
        ticker: e.ticker,
        news_id: e.newsId,
        disclosure_date: e.disclosureDate,
        subcat_name: e.subcatName,
        headline: e.headline,
        attachment_name: e.attachmentName,
        event_type: e.eventType,
      })),
      { onConflict: "ticker,news_id" }
    );
    return { error: error ? error.message : null };
  }

  async listByTicker(ticker: string): Promise<{ events: PromoterActivityEvent[]; error: string | null }> {
    const { data, error } = await supabaseAdmin()
      .from("promoter_activity")
      .select("news_id, disclosure_date, subcat_name, headline, attachment_name, event_type")
      .eq("ticker", ticker)
      .order("disclosure_date", { ascending: false });
    if (error) return { events: [], error: error.message };
    return { events: (data ?? []).map((row) => toEntity(row, ticker)), error: null };
  }
}
```

- [ ] **Step 2: Add to the composition root**

```ts
// lib/repositories/index.ts — add
import { SupabasePromoterActivityRepository } from "./promoterActivity";
export const promoterActivityRepo = new SupabasePromoterActivityRepository();
```

- [ ] **Step 3: Migrate `app/api/v1/divergence/route.ts`**

Replace the fetch-log read (lines ~32-36) with `const log = await promoterActivityRepo.getFetchLog(ticker);` and keep the `isStale` computation as-is against `log?.fetchedAt`.

Replace the `promoter_activity` upsert (lines ~44-55) — `events` here comes from `fetchPromoterActivity(bseCode)` (an existing `PromoterActivityEvent[]` with a different field-casing than the repository's own entity; construct the repository's `PromoterActivityEvent[]` from it inline) — with:
```ts
const { error: upsertError } = await promoterActivityRepo.upsertEvents(
  events.map((e) => ({
    ticker,
    newsId: e.newsId,
    disclosureDate: e.disclosureDate,
    subcatName: e.subcatName,
    headline: e.headline,
    attachmentName: e.attachmentName,
    eventType: e.eventType,
  }))
);
if (upsertError) {
  console.error("[divergence] promoter_activity upsert failed:", upsertError);
}
```

Replace the fetch-log upsert (lines ~61-69) with `await promoterActivityRepo.saveFetchLog(ticker, new Date().toISOString(), events.length);`, keeping its error logging.

Replace the final read (lines ~73-77) with:
```ts
const { events: rows, error } = await promoterActivityRepo.listByTicker(ticker);
if (error) {
  return NextResponse.json({ detail: `DB error: ${error}` }, { status: 500 });
}
```
and pass `rows` (now already `PromoterActivityEvent[]` with the repository's camelCase fields) to `computeDivergence` — check `lib/divergence-score.ts`'s `computeDivergence` signature for what field names it expects on its `events` parameter and adjust either that function or this call site's mapping so they agree (this file and `lib/divergence-score.ts` share the concept of a promoter activity event under two different casings today; picking one — the repository's camelCase entity — and updating `computeDivergence`'s parameter type to match is the cleaner outcome, but is optional scope for this task if it turns out to be a larger ripple than expected; note your choice in the report either way).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expected clean.
Smoke check: `GET /api/v1/divergence?ticker=TCS`, confirm a 200 response with the expected shape.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/index.ts lib/repositories/promoterActivity.ts app/api/v1/divergence/route.ts
git commit -m "feat: introduce PromoterActivityRepository, migrate promoter_activity call sites"
```

---

### Task 9: CalendarRepository

**Files:**
- Create: `lib/repositories/calendar.ts`
- Modify: `lib/repositories/index.ts` (add `calendarRepo`)
- Modify: `app/api/v1/calendar/route.ts`
- Modify: `app/api/v1/calendar/seed/route.ts`

**Interfaces:**
- Produces: `EarningsEvent`, `CalendarRepository`, `calendarRepo` instance.

- [ ] **Step 1: Create the domain entity and repository**

```ts
// lib/repositories/calendar.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface EarningsEvent {
  ticker: string;
  date: string;
  quarter: string;
  source: string;
  confirmed: boolean;
}

export interface CalendarRepository {
  listInRange(fromDate: string, toDate: string): Promise<{ events: EarningsEvent[]; error: string | null }>;
  upsertEvents(events: (EarningsEvent & { updatedAt: string })[]): Promise<{ inserted: number; error: string | null }>;
}

function toEntity(row: { ticker: string; date: string; quarter: string; source: string; confirmed: boolean }): EarningsEvent {
  return row;
}

export class SupabaseCalendarRepository implements CalendarRepository {
  async listInRange(fromDate: string, toDate: string): Promise<{ events: EarningsEvent[]; error: string | null }> {
    const { data, error } = await supabaseAdmin()
      .from("earnings_calendar")
      .select("ticker, date, quarter, source, confirmed")
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("date");
    if (error) return { events: [], error: error.message };
    return { events: (data ?? []).map(toEntity), error: null };
  }

  async upsertEvents(events: (EarningsEvent & { updatedAt: string })[]): Promise<{ inserted: number; error: string | null }> {
    const rows = events.map((e) => ({
      ticker: e.ticker,
      date: e.date,
      quarter: e.quarter,
      source: e.source,
      confirmed: e.confirmed,
      updated_at: e.updatedAt,
    }));
    const { error } = await supabaseAdmin().from("earnings_calendar").upsert(rows, { onConflict: "ticker,quarter" });
    return { inserted: error ? 0 : rows.length, error: error ? error.message : null };
  }
}
```

- [ ] **Step 2: Add to the composition root**

```ts
// lib/repositories/index.ts — add
import { SupabaseCalendarRepository } from "./calendar";
export const calendarRepo = new SupabaseCalendarRepository();
```

- [ ] **Step 3: Migrate `app/api/v1/calendar/route.ts`**

Replace the primary read (lines ~154-159) with:
```ts
const { events: dbRows, error: dbError } = await calendarRepo.listInRange(fromDate, toDate);
```
Keep the rest of the handler's logic (grouping by date, the `seeded` flag, the "no live fallback fetch" behavior) unchanged — it already consumed `dbRows`/`dbError` by these names, so only the query construction changes; field access on each row moves from snake_case (there wasn't any snake_case here already, since the original `select` already used plain column names matching the entity 1:1) to the `EarningsEvent` type import.

(Note: `analysis_results` reads in this same file were already migrated in Task 1 — this task only touches the `earnings_calendar` query.)

- [ ] **Step 4: Migrate `app/api/v1/calendar/seed/route.ts`**

Replace the upsert (lines ~500-511):
```ts
const rows = Array.from(resolved.values()).map(({ ticker, date, source }) => ({
    ticker, date, quarter, source,
    confirmed: confirmedSet.has(`${ticker}:${quarter}`),
    updated_at: new Date().toISOString(),
}));

const { error } = await supabaseAdmin()
    .from("earnings_calendar")
    .upsert(rows, { onConflict: "ticker,quarter" });

if (error) {
    log.push(`DB upsert error: ${error.message}`);
} else {
    log.push(`Upserted ${rows.length} rows for ${quarter}`);
    totalUpserted += rows.length;
}
```
with:
```ts
const events = Array.from(resolved.values()).map(({ ticker, date, source }) => ({
    ticker, date, quarter, source,
    confirmed: confirmedSet.has(`${ticker}:${quarter}`),
    updatedAt: new Date().toISOString(),
}));

const { inserted, error } = await calendarRepo.upsertEvents(events);

if (error) {
    log.push(`DB upsert error: ${error}`);
} else {
    log.push(`Upserted ${inserted} rows for ${quarter}`);
    totalUpserted += inserted;
}
```
(This file's `analysis_results` read for `confirmedSet` was already migrated in Task 1 — only the `earnings_calendar` upsert changes here.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — expected clean.
Smoke check: `GET /api/v1/calendar?month=7&year=2026` on `/calendar`, and (if safe to run against live data) trigger `/api/v1/calendar/seed` for one quarter and confirm rows appear.

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/index.ts lib/repositories/calendar.ts app/api/v1/calendar/route.ts app/api/v1/calendar/seed/route.ts
git commit -m "feat: introduce CalendarRepository, migrate earnings_calendar call sites"
```

---

### Task 10: ConcallRepository

**Files:**
- Create: `lib/repositories/concalls.ts`
- Modify: `lib/repositories/index.ts` (add `concallRepo`)
- Modify: `app/api/v1/concall/route.ts`

**Interfaces:**
- Produces: `ConcallLink`, `ConcallRepository`, `concallRepo` instance.

- [ ] **Step 1: Create the domain entity and repository**

```ts
// lib/repositories/concalls.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ConcallLink {
  ticker: string;
  quarter: string;
  youtubeUrl: string;
  videoId: string | null;
  videoTitle: string | null;
  channelTitle: string | null;
  fetchedAt: string;
}

export interface ConcallRepository {
  getCached(ticker: string, quarter: string): Promise<ConcallLink | null>;
  saveLink(link: ConcallLink): Promise<void>;
}

function toEntity(ticker: string, quarter: string, row: {
  youtube_url: string; video_id: string | null; video_title: string | null; channel_title: string | null;
}): ConcallLink {
  return {
    ticker,
    quarter,
    youtubeUrl: row.youtube_url,
    videoId: row.video_id,
    videoTitle: row.video_title,
    channelTitle: row.channel_title,
    fetchedAt: "",
  };
}

export class SupabaseConcallRepository implements ConcallRepository {
  async getCached(ticker: string, quarter: string): Promise<ConcallLink | null> {
    const { data } = await supabaseAdmin()
      .from("concall_links")
      .select("youtube_url, video_id, video_title, channel_title")
      .eq("ticker", ticker)
      .eq("quarter", quarter)
      .maybeSingle();
    if (!data) return null;
    return toEntity(ticker, quarter, data);
  }

  async saveLink(link: ConcallLink): Promise<void> {
    await supabaseAdmin()
      .from("concall_links")
      .upsert(
        {
          ticker: link.ticker,
          quarter: link.quarter,
          youtube_url: link.youtubeUrl,
          video_id: link.videoId,
          video_title: link.videoTitle,
          channel_title: link.channelTitle,
          fetched_at: link.fetchedAt || new Date().toISOString(),
        },
        { onConflict: "ticker,quarter" }
      );
  }
}
```

- [ ] **Step 2: Add to the composition root**

```ts
// lib/repositories/index.ts — add
import { SupabaseConcallRepository } from "./concalls";
export const concallRepo = new SupabaseConcallRepository();
```

- [ ] **Step 3: Migrate `app/api/v1/concall/route.ts`**

Replace the cache read (lines ~134-140):
```ts
const { data: cached } = await supabaseAdmin()
    .from("concall_links")
    .select("youtube_url, video_id, video_title, channel_title")
    .eq("ticker", ticker)
    .eq("quarter", quarter)
    .maybeSingle();

if (cached) {
    const result: ConcallResult = {
        url: cached.youtube_url, videoId: cached.video_id ?? null,
        title: cached.video_title ?? null, channel: cached.channel_title ?? null,
        direct: !!cached.video_id, query,
    };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
```
with:
```ts
const cached = await concallRepo.getCached(ticker, quarter);

if (cached) {
    const result: ConcallResult = {
        url: cached.youtubeUrl, videoId: cached.videoId,
        title: cached.videoTitle, channel: cached.channelTitle,
        direct: !!cached.videoId, query,
    };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
```

Replace the cache write (lines ~174-184):
```ts
await supabaseAdmin()
    .from("concall_links")
    .upsert({
        ticker, quarter,
        youtube_url: result.url, video_id: result.videoId,
        video_title: result.title, channel_title: result.channel,
        fetched_at: new Date().toISOString(),
    }, { onConflict: "ticker,quarter" });
```
with:
```ts
await concallRepo.saveLink({
    ticker, quarter,
    youtubeUrl: result.url, videoId: result.videoId,
    videoTitle: result.title, channelTitle: result.channel,
    fetchedAt: new Date().toISOString(),
});
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expected clean.
Smoke check: `GET /api/v1/concall?ticker=TCS&quarter=Q3_2026` twice — second call should return a cached hit.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/index.ts lib/repositories/concalls.ts app/api/v1/concall/route.ts
git commit -m "feat: introduce ConcallRepository, migrate concall_links call sites"
```

---

### Task 11: StorageRepository

**Files:**
- Create: `lib/repositories/storage.ts`
- Modify: `lib/repositories/index.ts` (add `storageRepo`)
- Modify: `lib/pipeline.ts`
- Modify: `lib/transcript-fetcher.ts`
- Modify: `lib/solo-pipeline.ts`
- Modify: `lib/kpi-extractor.ts`
- Modify: `lib/insights-pipeline.ts`
- Modify: `app/api/v1/available/route.ts`
- Modify: `app/api/v1/request/route.ts`
- Modify: `app/api/v1/seed-transcripts/route.ts`
- Modify: `app/api/v1/seed-analysis/route.ts`
- Modify: `app/api/v1/sectors/seed/route.ts`
- Modify: `app/api/v1/transcript/download/route.ts`

**Interfaces:**
- Produces: `TranscriptFile`, `StorageRepository`, `storageRepo` instance.

This is the largest fan-out (11 files) but the smallest interface — four operations total (`list`, `download`, `upload`, `createSignedUrl`), all against the fixed `"transcripts"` bucket. Confirmed via investigation: `.getPublicUrl()` and `.remove()` are not used anywhere in this codebase — the repository does not need to support them.

- [ ] **Step 1: Create the repository**

```ts
// lib/repositories/storage.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

const BUCKET = "transcripts";

export interface TranscriptFile {
  name: string;
}

export interface ListOptions {
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: { column: string; order: "asc" | "desc" };
}

export interface StorageRepository {
  list(options: ListOptions): Promise<TranscriptFile[]>;
  /** Wraps the while(true)-paginated "list every file, 100 at a time" pattern used across 5 call sites. */
  listAllPaginated(pageSize?: number): Promise<TranscriptFile[]>;
  download(path: string): Promise<Buffer>;
  upload(path: string, data: Buffer): Promise<void>;
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string>;
}

export class SupabaseStorageRepository implements StorageRepository {
  async list(options: ListOptions): Promise<TranscriptFile[]> {
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).list("", options);
    if (error) throw new Error(`Storage list failed: ${error.message}`);
    return data ?? [];
  }

  async listAllPaginated(pageSize = 100): Promise<TranscriptFile[]> {
    const all: TranscriptFile[] = [];
    let offset = 0;
    while (true) {
      const { data: page, error } = await supabaseAdmin().storage.from(BUCKET).list("", { limit: pageSize, offset });
      if (error) throw new Error(`Storage list failed: ${error.message}`);
      if (!page || page.length === 0) break;
      all.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  }

  async download(path: string): Promise<Buffer> {
    const { data: blob, error } = await supabaseAdmin().storage.from(BUCKET).download(path);
    if (error || !blob) throw new Error(`Storage download failed for ${path}: ${error?.message}`);
    return Buffer.from(await blob.arrayBuffer());
  }

  async upload(path: string, data: Buffer): Promise<void> {
    const { error } = await supabaseAdmin()
      .storage.from(BUCKET)
      .upload(path, data, { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(`Storage upload failed for ${path}: ${error.message}`);
  }

  async createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw new Error(`Signed URL failed for ${path}: ${error?.message}`);
    return data.signedUrl;
  }
}
```

Note: `download` returns a `Buffer` (via `blob.arrayBuffer()`) rather than the raw Supabase `Blob` — check each call site's current usage of the downloaded blob (e.g. `lib/pipeline.ts`'s `extractPdfText` likely calls `.arrayBuffer()` or similar itself already) and adjust either this repository method or the call site so the PDF-parsing step downstream still receives the type it expects (a `Buffer`/`ArrayBuffer` — `pdf-parse`, used elsewhere in this codebase, accepts a `Buffer`).

- [ ] **Step 2: Add to the composition root**

```ts
// lib/repositories/index.ts — add
import { SupabaseStorageRepository } from "./storage";
export const storageRepo = new SupabaseStorageRepository();
```

- [ ] **Step 3: Migrate the paginated-listing call sites (5 files)**

In each of `lib/pipeline.ts` (`resolvePdfKey`), `lib/transcript-fetcher.ts`, `app/api/v1/request/route.ts`, `app/api/v1/seed-transcripts/route.ts`, and `app/api/v1/seed-analysis/route.ts`, replace the `while(true) { ...list(..., {limit:100, offset})... }` loop with:
```ts
const files = await storageRepo.listAllPaginated();
```
then adapt the surrounding logic (which today builds up an array or a Set of filenames across pages) to operate on `files` (an array of `{ name: string }`) directly instead of accumulating pages itself.

- [ ] **Step 4: Migrate the search-based listing call sites (6 files)**

In `app/api/v1/available/route.ts` (both the per-ticker fan-out at `search: ticker` and the debug branch at `search`), `app/api/v1/transcript/download/route.ts`, `lib/insights-pipeline.ts`'s `getQuartersForTicker`, `app/api/v1/sectors/seed/route.ts` (search+paginated with early-exit), and `lib/kpi-extractor.ts`, replace each direct `.storage.from(BUCKET).list("", {...})` call with `await storageRepo.list({...})`, passing the same options object each call site already builds (`search`, `limit`, `offset`, `sortBy`) unchanged.

`app/api/v1/available/route.ts`'s Step 1 (full pagination with `sortBy`) should use `storageRepo.list({ limit: 1000, offset, sortBy: { column: "name", order: "asc" } })` in its own loop (this one isn't the standard 100-per-page pattern, so it's not folded into `listAllPaginated` — keep its existing loop structure, just swap the storage call).

- [ ] **Step 5: Migrate the download call sites (4 files)**

In `lib/pipeline.ts` (`extractPdfText`), `lib/solo-pipeline.ts` (`extractText`), `lib/insights-pipeline.ts` (`fetchTranscriptText`), and `lib/kpi-extractor.ts`, replace each `.storage.from(BUCKET).download(path)` call with `await storageRepo.download(path)`, which now throws on failure instead of returning `{ data, error }` — wrap each call site in the existing try/catch it already has (all four already have error handling around the download; adjust to catch the thrown error rather than checking a returned `error` field).

- [ ] **Step 6: Migrate the upload call sites (3 files)**

In `app/api/v1/seed-transcripts/route.ts`, `app/api/v1/request/route.ts`, and `lib/transcript-fetcher.ts` (`fetchAndUploadTranscripts`), replace each `.storage.from(BUCKET).upload(filename, pdf, {...})` call with `await storageRepo.upload(filename, pdf)`.

- [ ] **Step 7: Migrate the signed-URL call site**

In `app/api/v1/transcript/download/route.ts`, replace:
```ts
const { data: signed, error } = await supabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrl(found.name, 300);
```
with:
```ts
const signedUrl = await storageRepo.createSignedUrl(found.name, 300);
```
(now throws on failure instead of returning an error — wrap in this route's existing try/catch, or add one if the current code checks `error` explicitly).

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit` — expected clean.
Smoke check: run a fresh analysis for a ticker with an existing transcript on `/dashboard` (exercises download + list), and — if safe to run against live storage — trigger `/api/v1/seed-transcripts` for one ticker (exercises upload) and `/api/v1/transcript/download` (exercises the signed URL path).

- [ ] **Step 9: Commit**

```bash
git add lib/repositories/index.ts lib/repositories/storage.ts lib/pipeline.ts lib/transcript-fetcher.ts lib/solo-pipeline.ts lib/kpi-extractor.ts lib/insights-pipeline.ts app/api/v1/available/route.ts app/api/v1/request/route.ts app/api/v1/seed-transcripts/route.ts app/api/v1/seed-analysis/route.ts app/api/v1/sectors/seed/route.ts app/api/v1/transcript/download/route.ts
git commit -m "feat: introduce StorageRepository, migrate all transcripts bucket call sites"
```

---

## Self-review notes (spec coverage, placeholders, consistency)

**Spec coverage:** all 11 repositories from the spec's table are covered (Tasks 1-11) plus the composition root (built incrementally across every task). `ApiAccessRepository` is correctly excluded — it belongs to the Services/Public API plan (Plan B), not this one. Auth is correctly excluded per the spec's explicit non-goal.

**Discovered during planning, not in the original spec:**
- `AnalysisRepository` needed 6 more methods than the spec's illustrative two (`getCachedAnalysis`/`saveAnalysis`), because `analysis_results` is read from 6 files beyond `lib/analysis-cache.ts` (`nifty200-sampler.ts`, `screener/route.ts` ×2, both calendar routes, `analyze/history/route.ts`). This is exactly the "audit real call sites" work the spec deferred to planning.
- `WatchlistRepository` (`user_tickers`) is RLS-scoped via a request-context client, unlike every other domain's use of `supabaseAdmin()` — documented as a deliberate exception in Task 4 rather than silently normalized away.
- `lib/divergence-score.ts` reads fields off `insights_cache.payload` that don't exist on the type actually written there (`InsightsPayload`) — a likely pre-existing bug, preserved as-is per Strangler Fig discipline and flagged in Task 7 for a human decision, not fixed here.
- `CreditsRepository`'s scope required a judgment call: `checkAndDeduct`'s cost-lookup/decision logic is business logic, not persistence, but building a formal Service for it is Plan B's scope — Task 5 keeps it as a thin wrapper function in `lib/credits.ts` rather than either stuffing it into the repository or prematurely building a Service.

**Type consistency:** every task's Supabase implementation method name and signature matches its own task's interface declaration; cross-task consumers (e.g. Task 1's `analysisRepo` used nowhere else in this plan) have no signature drift to check since each repository is consumed only within its own task in this plan (Services/API consumption is Plan B).
