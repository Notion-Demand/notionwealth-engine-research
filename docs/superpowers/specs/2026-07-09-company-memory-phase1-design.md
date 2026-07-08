# Company Memory — Phase 1 Design

## Context

Quantalyze's pipeline already extracts rich structured signal per earnings call
(thematic sections, KPI deltas, evasiveness score, stock reaction, guidance
bullets), but none of it accumulates. `lib/analysis-cache.ts:saveAnalysis()`
does a `DELETE` + `INSERT` keyed on `(ticker, q_prev, q_curr)` — a re-run of
the same quarter pair replaces the prior payload outright, and different
quarter pairs for the same ticker never get stitched together into a
continuous view of "how has this company behaved over time." The product's
long-term thesis (a proprietary intelligence layer that compounds, distinct
from a chatbot wrapper) depends on that memory existing.

This spec covers **Phase 1 only**: a per-company memory page that
incrementally accumulates across every quarter analyzed, for every company,
regardless of which user or product surface triggered the analysis. It is the
foundation later phases (cross-company relationship graph, compound queries,
feedback loops) build on — none of that is in scope here.

### Reference pattern

Modeled on Andrej Karpathy's `llm-wiki` pattern
(https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): raw
source material is append-only and untouched; an LLM maintains a separate,
structured, human-readable markdown layer on top, updated incrementally
rather than re-derived from scratch each time. The point of markdown-as-
source-of-truth is that every claim traces back to a page a human can read,
edit, or delete — no black-box vector store.

Adapted for this stack: the "files" live in Postgres (this app runs on
Vercel, whose filesystem is ephemeral/read-only in production, and it's
already Supabase-backed everywhere else) rather than as literal `.md` files
on disk or git-committed pages.

## Non-goals (deferred to later phases)

- Cross-company relationship graph (competitor/supplier backlinks between
  company pages)
- Compound / cross-cutting queries ("which companies quietly increased AI
  hiring before revenue accelerated")
- User feedback / correction loop on memory content
- Backfilling memory for quarter pairs analyzed before this ships
- Any editing UI — Phase 1 is read-only

## Architecture

One hook point: `saveAnalysis()` in `lib/analysis-cache.ts`. Three routes
already call it today —

- `app/api/v1/analyze/route.ts` (Dashboard / Concall Analysis, user-initiated)
- `app/api/v1/sectors/seed/route.ts` (sector seeding)
- `app/api/v1/seed-analysis/route.ts` (bulk seeding)

Because all three already funnel through this single function, adding the
memory-update call there means *any* new analysis — from any user, any
account, any surface — feeds the same shared per-company memory. No
additional call sites need to change.

```
saveAnalysis(userId, ticker, qPrev, qCurr, payload)
  └─ existing: persist analysis_results row (unchanged)
  └─ new: updateCompanyMemory(ticker, payload, qPrev, qCurr)   [fire-and-forget]
```

`updateCompanyMemory` failures must never fail or block the caller's
response — it rides along as a side effect, not a dependency.

## Data model

New migration `supabase/migrations/011_company_memory.sql`:

```sql
CREATE TABLE IF NOT EXISTS company_memory (
  ticker            TEXT PRIMARY KEY,
  content           TEXT NOT NULL,
  version           INT NOT NULL DEFAULT 1,
  last_quarter_pair TEXT NOT NULL,     -- "{q_prev}:{q_curr}", for idempotency
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

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

No RLS restricting by `user_id` — this table is intentionally global, same
as the existing `analysis_results` cache-read pattern (`getCachedAnalysis`
already ignores `user_id` and reads via `supabaseAdmin()`). Reads happen
through the service role from server routes only.

`company_memory_history` is append-only: no `UPDATE` or `DELETE` statements
against it, ever. It is the audit trail — every version that ever existed
for a ticker, in order.

## Update mechanism

New file `lib/company-memory.ts`:

```ts
export async function updateCompanyMemory(
  ticker: string,
  payload: DashboardPayload,
  qPrev: string,
  qCurr: string
): Promise<void>
```

1. `quarterPair = `${qPrev}:${qCurr}``. Read the existing `company_memory`
   row for `ticker`. If `existing.last_quarter_pair === quarterPair`, skip —
   this exact quarter pair has already been merged (handles re-runs of the
   same analysis without double-merging).
2. If no row exists, start from a blank template (the section headers below,
   empty) rather than requiring any backfill.
3. One Gemini call: `{ currentPage, newFacts }` → merge prompt (below) →
   full new page text.
4. Reject the call if the response is empty, fails schema/shape validation,
   or errors — keep the previous version untouched. A bad merge must never
   overwrite good memory.
5. On success: upsert `company_memory` (new `content`, `version + 1`,
   `last_quarter_pair = quarterPair`), and insert a row into
   `company_memory_history` with the same `content`/`version`/`quarter_pair`.

`newFacts` passed into the prompt is the existing `DashboardPayload` for that
quarter pair — the five thematic sections' `key_takeaways`, `earnings_delta`,
`fcf_implications`, `executive_evasiveness_score`, `stock_price_change`,
`key_metrics`, `summary`. No new extraction step is needed for Phase 1; the
pipeline already produces enough raw signal, it just currently gets thrown
away after one quarter pair.

### Merge prompt

Plays the same role as Karpathy's `CLAUDE.md` schema file — it is what turns
a generic "summarize this" call into a disciplined memory maintainer. Fixed
instructions:

- Output the full page, under the fixed section headers below — do not
  invent new top-level sections, do not drop a section that has no new
  information this quarter (carry it forward unchanged).
- Update `Guidance & Promises` rows: any promise whose target quarter has now
  arrived gets its status resolved (kept / broken / partial) against this
  quarter's actuals; new promises get appended as `pending`.
- Update `Beats & Misses`, `KPI Trajectory`, `Strategic Initiatives` by
  appending this quarter's row(s) rather than replacing prior rows.
- `Management & Governance` accumulates a running read on say-do pattern and
  evasiveness — update the running note, don't just restate this quarter's
  score in isolation.
- Append one line to `Revision Log` summarizing what changed this update.
- Keep prose terse — this is a reference page, not a report.

## Page template

Fixed section headers (covers the full node list from the original brief —
Company, Quarter, Segment, Geography, Product, KPI, Guidance, Beat/Miss,
Strategic Initiative, Capital Allocation, Hiring Trends, Customer/Supplier/
Competitor Mentions, Risk Factors, Opportunities, Analyst Questions,
Management Answers, Confidence Level, Sentiment, Action Items,
Forward-looking Statements). Fixed headers matter beyond Phase 1: any future
"view" or data product (a value-investor lens, a momentum lens, an alt-data
lens) is a filtered read over these same sections rather than a different
schema.

1. **Snapshot** — company, sector, quarter last updated
2. **Business Mix** — segments / geography / products
3. **KPI Trajectory** — tracked KPIs, trend direction over time
4. **Guidance & Promises** — promise → target quarter → status (pending/kept/broken/partial)
5. **Beats & Misses** — expected vs. actual, by quarter
6. **Strategic Initiatives** — initiative → launched → status (active/abandoned/completed)
7. **Capital Allocation** — capex, buybacks, dividends, M&A pattern over time
8. **Management & Governance** — say-do track record, evasiveness pattern, insider activity, leadership changes
9. **Competitive Landscape** — competitors mentioned, positioning shifts
10. **Customers & Suppliers** — concentration, relationship shifts
11. **Hiring & Organizational Signals**
12. **Risks & Opportunities** — currently open items
13. **Analyst Sentiment** — recurring concerns, confidence trend
14. **Forward-Looking Statements** — outstanding guidance not yet resolved
15. **Revision Log** — auto-appended one-liner per quarter update

## Surfacing

One new route, `app/memory/[ticker]/page.tsx`: server component, fetches
`company_memory.content` for the ticker, renders it read-only. No markdown
renderer exists in this codebase today (`react-markdown` is not a
dependency) — Phase 1 adds it as the one new package this work requires. No
nav entry, no edit affordance. Reachable via a plain link added next to the
ticker header in the Dashboard/Insights screens.

If no memory row exists yet for a ticker (nothing analyzed since this
shipped), show a plain empty state — not an error.

## Error handling

- `updateCompanyMemory` failures (Gemini error, malformed output, timeout)
  are logged and swallowed — the calling `saveAnalysis()` request succeeds
  regardless.
- Malformed/empty LLM response: discard, keep existing `company_memory` row
  as-is, do not write to history.
- Idempotency guard (`last_quarter_pair` check) prevents duplicate merges
  when a quarter pair is re-analyzed (e.g. a user re-runs Concall Analysis
  for a ticker already seeded via sector seed).

## Testing

No test runner exists in this repo yet. Phase 1 verification is manual:

- A standalone script that dry-runs `updateCompanyMemory` against a handful
  of real `DashboardPayload` rows already sitting in `analysis_results`, to
  sanity-check prompt output before wiring it live.
- Manual check via the `/memory/[ticker]` viewer after a real pipeline run.
