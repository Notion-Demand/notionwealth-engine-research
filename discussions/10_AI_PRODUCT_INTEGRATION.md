# 10. AI Product Integration — How the Model Becomes a Product

This document traces every AI capability in the **live** Quantalyze product end-to-end: from the
Gemini call, through validation and persistence, to what a user sees and does next. All file/line
citations are to the live `app/`, `lib/`, `components/` tree unless explicitly marked
**IMPLEMENTED-BUT-ARCHIVED** (the `finance-agent/` and `disclosure-analysis-pipeline/` prototypes,
which have zero import edges into the live app — confirmed by `grep -rln "finance-agent"` returning
nothing under `app/`, `lib/`, `components/`).

Every pipeline in this product uses **one model**: `gemini-2.5-flash-lite`, temperature `0`,
`responseMimeType: "application/json"` with an explicit `responseSchema` — verified in
`lib/pipeline.ts:194-207`, `lib/solo-pipeline.ts:167-176`, `lib/insights-pipeline.ts:85-93`,
`lib/sector-narrative.ts:119-133`, and `lib/kpi-extractor.ts:369-376` (this last one at
temperature `0.1`). There is no model routing, no fallback model, no A/B model selection anywhere
in the codebase — one model, one provider, hardcoded as a string literal in five separate files.

---

## Capability 1 — Delta Analysis (5-agent pipeline)

**AI capability**: quarter-over-quarter narrative-shift detection across 5 financial domains,
signal scoring, and synthesis into "what changed" / "what it means financially."

**Chain**:

1. **Product feature**: Dashboard → Concall Analysis, delta mode (`app/dashboard/DashboardClient.tsx`
   drives `EarningsReport.tsx` — IMPLEMENTED).
2. **User action**: user picks a ticker + confirms the globally fixed quarter pair
   (`qCurr`/`qPrev` are module-level constants derived from `QUARTERS[0]`/`QUARTERS[1]` in
   `lib/nifty50.ts`, per `PRODUCT_NOTES.md` "2026-05-26 — Earnings Analysis: Global Quarter Pair"),
   then clicks Analyze. This POSTs to `/api/v1/analyze` (`lib/api.ts:55-109`,
   `runAnalysisStream`) — IMPLEMENTED.
3. **Backend entry**: `POST /api/v1/analyze` (`app/api/v1/analyze/route.ts`). Auth is checked
   first (`getCurrentUser()`, 401 if absent), storage keys are resolved before opening the
   stream (`resolvePdfKey` × 2, 422 if either PDF is missing), then a Postgres cache lookup
   (`analysisRepo.getCachedAnalysis`) — cache hit short-circuits straight to a one-line NDJSON
   `done` event with **zero Gemini calls and zero credit deduction**
   (`app/api/v1/analyze/route.ts:52-73`). On cache miss, `checkAndDeduct(userId, "delta")` — 3
   credits (`lib/credits.ts:16-20`) — runs before the pipeline starts, so a failed pipeline still
   costs the user credits already deducted (see 11_PRODUCTION_ENGINEERING.md, Reliability).
4. **Pipeline function**: `runPipeline(qPrevKey, qCurrKey, onProgress)` in `lib/pipeline.ts:759-881`.
5. **Data/context it needs**: two PDF transcripts pulled from `AzureBlobStorageRepository`
   (`lib/repositories/storage.ts`, wired via `storageRepo` in `lib/repositories/index.ts:24`),
   parsed with `pdf-parse` and hard-capped at 120,000 characters
   (`lib/pipeline.ts:238,256-259` — "Large conglomerate calls run 2-3+ hours"). No RAG, no vector
   store, no retrieval step of any kind — the entire context is "whatever fits in 120K chars of
   one PDF," raw, unfiltered, unranked.
6. **What the model generates** — five sequential agent calls per analysis:
   - **Phase 2** (parallel, 11 Gemini calls): 5 thematic agents (`AGENT_PROMPTS` —
     Revenue & Growth, Margins & Profitability, Cost Structure, CapEx & Balance Sheet,
     Macro & Risk, `lib/pipeline.ts:281-364`) run once per quarter (×2) against
     `QUARTER_SNAPSHOT_SCHEMA` (`section_name`, `key_takeaways[]`, `raw_quotes[]`,
     `lib/pipeline.ts:83-91`), plus 1 evasiveness-scoring call against `EVASIVENESS_SCHEMA`
     (`score: number 0-10`, `lib/pipeline.ts:133-140,477-493`) fed only the last 30,000 chars.
   - **Phase 3** (parallel, up to 5 calls): `runTemporalDelta` per section that has both a prev
     and curr snapshot, against `SECTIONAL_INSIGHT_SCHEMA` — an array of `MetricDelta` objects
     with `subtopic`, verbatim `quote_old`/`quote_new`, `signal_classification` (enum
     Positive/Negative/Noise), `signal_score` (-10..+10), `ui_component_type` (enum
     metric_card/status_warning/quote_expander) (`lib/pipeline.ts:93-131,495-551`).
   - **Phase 4** (parallel, 3 Gemini calls + 1 non-Gemini fetch): `runEarningsDeltaAgent` (8-10
     bullets, `BULLETS_SCHEMA`), `runFCFImplicationsAgent` (5-6 bullets), `runKeyMetricsAgent`
     (`KEY_METRICS_SCHEMA` — revenue/EBITDA/PAT strings), plus `fetchStockPriceChange` which
     hits the unofficial Yahoo Finance chart API directly (`lib/pipeline.ts:696-722`) — the one
     non-AI data point blended into the payload.

   **Total Gemini calls per delta run**: 10 thematic + 1 evasiveness + up to 5 delta + 3 synthesis
   = **~19-20 calls**, matching `TECHNICAL_ARCHITECTURE.md`'s stated "~20 calls" figure. Note: the
   file header comment at `lib/pipeline.ts:2-3` says "8 parallel Gemini calls (4 thematic agents ×
   2 quarters)" — this is **stale**; `AGENT_PROMPTS` actually has 5 keys, not 4, so it's 10 calls,
   not 8. Documentation drift inside the source file itself, not just in the top-level docs.

7. **How output is validated** — entirely local, no second LLM pass:
   - `localValidation()` (`lib/pipeline.ts:631-658`, no LLM) flags any `MetricDelta` where
     `signal_classification` and `signal_score` sign disagree (e.g. "Positive" but score `-3`),
     setting `validation_status: "flagged"` and computing a 0-100 `validation_score` from the
     flagged fraction.
   - `computeMarketAlignment()` (`lib/pipeline.ts:725-755`, no LLM) compares each non-Noise
     signal's direction against the Yahoo Finance stock move (>2%/-2% thresholds) and tags
     `market_validation: "aligned" | "divergent" | "unclear"`.
   - This is **consistency checking, not correctness checking** — nothing verifies the extracted
     quotes actually appear in the source transcript, and nothing catches a hallucinated number.
     The only ground-truthing against reality is the market-alignment heuristic, and that's a
     sentiment-vs-price correlation, not a factual check.
8. **Product object**: `DashboardPayload` (`lib/pipeline.ts:62-79`) is the canonical shape. It is
   converted via `fromDashboardPayload()`/`toEntity()` (`lib/repositories/analysis.ts:75-99`) into
   the `Analysis` domain entity and persisted through `PostgresAnalysisRepository.saveAnalysis()`
   (`lib/repositories/analysis.ts:308-325`) as a JSONB blob in `analysis_results.payload`
   (`supabase/migrations/001_initial.sql:37-45`) — an atomic delete-then-insert, not an upsert, to
   avoid duplicate-row races. Zero-insight results are explicitly not cached
   (`if (!Array.isArray(analysis.sections) || analysis.sections.length === 0) return
   "not-cached-empty"`, `lib/repositories/analysis.ts:163-165`).
9. **Frontend rendering**: `app/api/v1/analyze/route.ts` streams NDJSON progress events (`start`,
   `thematic_done`, `evasiveness_done`, `delta_done`, `stock_done`, `done`) that `lib/api.ts`'s
   `runAnalysisStream` parses line-by-line and hands to `AgentPanel.tsx`
   (`makeInitialAgentState`, per-section `AgentStatus` state machine —
   `components/AgentPanel.tsx:14-33`), which renders live checkmarks/spinners per agent as the
   pipeline runs. The final payload renders in `components/EarningsReport.tsx` (780 lines) —
   `MetricCard` per delta signal, colored by `validation_status`/`market_validation`, plus the
   self-fetching `PromoterActivityBadge` (`components/EarningsReport.tsx:115-149`, its own
   independent `fetch("/api/v1/divergence?ticker=...")` call, not part of the pipeline payload).
10. **What the user does next**: export a branded PDF (`jsPDF` + `html2canvas`, per
    `TECHNICAL_ARCHITECTURE.md` §8 — client-side, not verified line-by-line here but consistent
    with `package.json`'s `jspdf`/`html2canvas` dependencies), download the source transcript
    (`/api/v1/transcript/download`), or re-run with `force: true` ("Clear cache & re-analyze",
    which bypasses the cache read but still re-deducts credits and re-writes the cache row).

---

## Capability 2 — Deep Dive (single-call analysis)

**Chain**: Dashboard → Deep Dive tab → `POST /api/v1/analyze/solo`
(`app/api/v1/analyze/solo/route.ts`) → `runSoloPipeline()` (`lib/solo-pipeline.ts:141-200`).

- **Context**: one transcript, same 120K-char cap, same `pdf-parse` extraction
  (`lib/solo-pipeline.ts:115-125`).
- **Generation**: a **single** Gemini call against `SOLO_SCHEMA`
  (`lib/solo-pipeline.ts:47-65`) — `{ headline, management_tone (enum of 5 values, not schema-
  enforced — see validation note below), sections: [{ title, bullets[] }] }`, 8-14 sections per
  the prompt (`SOLO_SYSTEM`, `lib/solo-pipeline.ts:67-111`).
- **Validation**: **none beyond JSON-schema conformance.** There is no local consistency check
  analogous to delta's `localValidation()` — `management_tone` is documented in the prompt as one
  of 5 enum strings but the actual `SOLO_SCHEMA` types it as a bare `STRING` with no
  `format: "enum"` constraint (`lib/solo-pipeline.ts:51`, contrast with
  `lib/pipeline.ts:100-104`'s `signal_classification` which does use `format: "enum"`) — so a
  model drift to an unlisted tone value would flow straight into the UI unvalidated. This is the
  weakest-validated of the four capabilities.
- **Persistence**: `soloAnalysisRepo.saveAnalysis()` → `solo_analysis_cache`
  (`supabase/migrations/009_solo_analysis_cache.sql`, permanent cache, keyed on
  `(ticker, quarter)`).
- **Credits**: 1 credit, deducted on **every** call including cache hits — a deliberate choice
  documented inline: "cache hits return fast but still cost 1 credit to discourage spam"
  (`app/api/v1/analyze/solo/route.ts:25-26`). This is the only capability where a cache hit still
  costs the user money — inconsistent with delta and insights, where cache hits are free.
- **Rendering**: sections render as expandable cards; "what user does next" mirrors delta (PDF
  export, re-run with `force`).

---

## Capability 3 — Multi-Quarter Insights (synthesis)

**Chain**: `/insights` → `POST /api/v1/insights` (`app/api/v1/insights/route.ts`) →
`runInsightsPipeline()` (`lib/insights-pipeline.ts:372-437`).

- **Context**: up to 8 quarters of transcripts discovered via `getQuartersForTicker()`
  (storage search, not a DB table — `lib/insights-pipeline.ts:276-293`), each capped at 120K
  chars, fetched in parallel (`Promise.all`, `lib/insights-pipeline.ts:404-408`).
- **Generation**: N per-quarter "brief" calls (parallel) against `QUARTER_BRIEF_SCHEMA` — 12
  required fields per quarter including `guidance_statements[]` and `new_developments[]`
  (`lib/insights-pipeline.ts:102-152`) — followed by 1 synthesis call against `SYNTHESIS_SCHEMA`
  (`lib/insights-pipeline.ts:184-221`) that consumes all N briefs concatenated as plain text
  (`buildDeltaSummary`-equivalent inline in `runSynthesisAgent`,
  `lib/insights-pipeline.ts:337-368`) and produces `recurring_themes[]`, `guidance_tracks[]`,
  `management_credibility_score` (0-10), `new_business_signals[]`, `key_watchpoints[]`,
  `segment_narrative`. **Total calls: N+1**, typically 5-9 as stated in
  `TECHNICAL_ARCHITECTURE.md` §4c.
- **Validation**: none beyond schema conformance — no cross-check that a `guidance_track`'s
  `initial_quarter` is actually one of the quarters analyzed, for instance.
- **Failure handling per sub-call**: unlike delta's agents (which return `null` and get filtered
  out on failure), a failed brief returns a fully-populated-but-empty `QuarterBrief` object
  (`lib/insights-pipeline.ts:317-334`) — so a silent per-quarter Gemini failure produces an
  indistinguishable "nothing was said this quarter" brief rather than an omitted quarter. The
  synthesis agent then reasons over that empty brief as if it were real data.
- **Persistence & cache**: `insights_cache`, keyed on `(ticker, sorted-quarters-key)`, 30-day
  app-enforced TTL (`insightsRepo.getCached`, `CACHE_TTL_DAYS = 30`,
  `lib/insights-pipeline.ts:253-262`). Cache writes are explicitly non-blocking — "errors are
  warned, not thrown — never fails the user response" (`lib/insights-pipeline.ts:431-434`).
- **Streaming gap**: `app/api/v1/insights/route.ts` has **no pipeline-level timeout wrapper** —
  contrast with `app/api/v1/analyze/route.ts:99-103`'s explicit 270s `setTimeout` that sends an
  `error` NDJSON event before Vercel/Azure kills the function. The insights route's `send()`
  (`app/api/v1/insights/route.ts:38-40`) also has no `closed` guard around `controller.enqueue`,
  so a client disconnect mid-stream can throw inside the route instead of being swallowed the way
  delta's does. This is a genuine reliability regression between the two routes despite both
  sharing `maxDuration = 300`.

---

## Capability 4 — KPI Extraction (hybrid: scrape + AI)

`lib/kpi-extractor.ts` — **not purely AI**. Standardized KPIs (Revenue, EBITDA, PAT, EPS, etc.)
come from scraping and regex-matching screener.in's quarterly HTML table
(`fetchScreenerFinancials`, `extractStandardKPIs`, `lib/kpi-extractor.ts:148-349`) — zero Gemini
calls. Only **sector-specific** KPIs (IT: deal wins/utilization/attrition; Banking: NIM/GNPA/CASA;
etc. — `SECTOR_KPI_PROMPT`, `lib/kpi-extractor.ts:46-95`) go through a Gemini call against
`SECTOR_KPI_SCHEMA` (`lib/kpi-extractor.ts:99-117`), and only for 5 hardcoded sectors — everything
else silently returns `[]` (`lib/kpi-extractor.ts:358-359`). This capability is the clearest
illustration of "AI only where it's actually needed" — hard numbers come from a scrape+regex
pipeline because, per `PRODUCT_NOTES.md` "2026-05-26 — Financials Dropped from Multi-Quarter
Insights," **the team already tried and abandoned LLM extraction of exact financial figures from
transcripts** as unreliable. KPI extraction is triggered from `/api/v1/kpis` and rendered on the
`/kpis` page (route file present at `app/api/v1/kpis/route.ts`, not traced line-by-line here).

---

## Capability 5 — Sector Narrative Generation

`lib/sector-narrative.ts:generateSectorNarrative()`, triggered from
`POST /api/v1/sectors/seed?narrative=true` (`app/api/v1/sectors/seed/route.ts`) — **not on every
seed**, only when explicitly requested, because narrative generation adds 4-25s including the
Nifty200 sampler step (`PRODUCT_NOTES.md` "2026-05-27 — PM-Grade Narrative Layer").

- **Context**: compact one-line briefs built from already-cached `DashboardPayload`s
  (`buildCompanyBrief`, `lib/sector-narrative.ts:60-80` — reuses delta-analysis output as input to
  a *third* AI capability, an example of AI output becoming AI input) plus up to 6 extended Nifty
  200 signals from `sampleNifty200Signals()` (`lib/nifty200-sampler.ts`, not read in full here but
  referenced at `lib/sector-narrative.ts:16,85-88,140-144`).
- **Generation**: 1 call, temperature `0.1`, 22s timeout via `Promise.race`
  (`NARRATIVE_TIMEOUT_MS = 22_000`, `lib/sector-narrative.ts:92,175-182`), against
  `NARRATIVE_SCHEMA` — 7 required string/array fields.
- **Validation/sanitization**: post-hoc array-length guards only — if `tailwinds`/`headwinds`/
  `key_triggers` come back empty, they're replaced with a placeholder string like "Data
  insufficient to identify tailwinds" (`lib/sector-narrative.ts:186-188`) so the UI never renders
  an empty section.
- **Failure mode**: returns `null` on any error (missing API key, timeout, parse failure) —
  caller is expected to degrade gracefully; the seed route carries over the previous narrative
  from the DB row when `narrative=true` isn't passed at all (`PRODUCT_NOTES.md`, same section).
- **Rendering**: `NarrativeCard` (not read in full; described in `PRODUCT_NOTES.md` as a
  collapsible indigo panel with 3 color-coded rows) on `/sectors`.

---

## Capability 6 — Divergence / Promoter Pledge Scoring

**This is explicitly NOT AI-driven** — worth stating plainly since the task brief asked to check.
`lib/divergence-score.ts:computeDivergence()` is pure arithmetic: count Reg-31 BSE filings in a
90-day window vs. a 450-day baseline normalized rate, threshold at 1.5× for "elevated"
(`lib/divergence-score.ts:36-58`). The only place AI enters is upstream — the `concallSignal`/
`concallScore` it cross-references were themselves produced by Capability 1's delta pipeline, if
available.

**A self-documented bug**: `lib/divergence-score.ts:60-67` contains an explicit code comment —
"this reads `overall_signal`/`overall_score` off whatever's stored in `insights_cache`, but
`InsightsWirePayload` ... has no such fields — it has `management_credibility_score` instead. This
means `concallSignal`/`concallScore` below are very likely always null in practice." The function
calls `insightsRepo.getLatestRawPayload(ticker)` (an `insights_cache` reader) when the
`overall_signal`/`overall_score` fields it wants actually live in `analysis_results` (the delta
pipeline's output), not `insights_cache` (the multi-quarter synthesis output). The consequence:
the **entire "flag" mechanic that is the headline feature of the Promoter Pledge Monitor**
(`flag = elevated AND concallSignal is Positive/Mixed`, `lib/divergence-score.ts:76-78`) is very
likely dead in production — `concallSignal` reads as `null`, so `flag` can never be `true` for any
ticker, meaning the badge can only ever show "elevated" (amber) but never the red "flag" state
its own styling table defines (`PROMOTER_BADGE_STYLES.flag`, `components/EarningsReport.tsx:109`).
The code comment itself says this was "preserved as-is per Strangler Fig discipline; flagged for a
human decision on whether to fix, not fixed here" — i.e., a known, accepted, unfixed defect,
carried through the Azure repository migration. This is the single most concrete AI-output-
validation gap found in the codebase: not a hallucination risk, but a **wiring bug that silently
neuters a scoring feature**, and it was caught and documented by whoever did the migration, not by
any test.

---

## The Integration Layer

The specific code that sits between "raw Gemini JSON" and "product UX" is not one file — it's a
consistent **four-part pattern repeated per capability**:

1. **Schema-constrained generation** — `responseSchema` objects (`QUARTER_SNAPSHOT_SCHEMA`,
   `SECTIONAL_INSIGHT_SCHEMA`, `SOLO_SCHEMA`, `QUARTER_BRIEF_SCHEMA`, `SYNTHESIS_SCHEMA`,
   `NARRATIVE_SCHEMA`, `KEY_METRICS_SCHEMA`, `SECTOR_KPI_SCHEMA` — eight distinct schemas across
   five files) are the actual contract between the model and the rest of the system. This is doing
   the job an API-contract layer would normally do for a REST integration: Gemini cannot return
   malformed JSON given `responseMimeType: "application/json"` + `responseSchema`, so
   `JSON.parse(result.response.text())` (repeated near-verbatim in every `invokeStructured`
   helper — `lib/pipeline.ts:213`, `lib/solo-pipeline.ts:184`, `lib/insights-pipeline.ts:99`) is
   allowed to be unguarded against parse errors, because the schema constraint upstream is
   trusted to have prevented them. (It is not, in fact, guarded against a **timeout** producing no
   response at all — see 11_PRODUCTION_ENGINEERING.md.)
2. **Wire-shape domain types** — `DashboardPayload`, `SoloPayload`, `InsightsPayload`,
   `SectorNarrative`, `KPISnapshot` are TypeScript interfaces that are simultaneously (a) what the
   Gemini calls' outputs get assembled into, (b) what gets persisted to JSONB, and (c) what the
   frontend consumes over NDJSON — one shape, three roles. `lib/repositories/analysis.ts:58-68`
   names this explicitly: "DashboardPayload's snake_case mirrors a JSON wire format ... a
   storage/wire concern that stops at this repository's boundary" — and then the same file defines
   a **separate** camelCase `Analysis` domain entity plus `toEntity()`/`fromEntity()` converters
   (`lib/repositories/analysis.ts:79-99,112-131`) specifically so that the AI-facing wire shape and
   the DB/domain shape can evolve independently. This converter pair *is* the integration layer in
   miniature — it's the one place where "what the model said" gets formally translated into "what
   the product's data model believes."
3. **The repository layer** (`lib/repositories/*.ts`, 12 interfaces, one composition root at
   `lib/repositories/index.ts`) — every pipeline function reaches storage only through a typed
   repository interface, never a raw SQL string or raw Supabase call inline in pipeline code. This
   is what let the whole backend swap from Supabase to Azure Postgres (see
   `docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md`) without touching a
   single pipeline file — a real, executed architectural payoff of the AI/storage boundary being
   drawn where it was.
4. **NDJSON stream shaping** — each `POST` route (`analyze`, `analyze/solo`, `insights`) wraps its
   pipeline call in a hand-rolled `ReadableStream` that multiplexes two event types onto one wire
   format: **progress events** (`onProgress` callbacks the pipeline itself emits, e.g.
   `thematic_done`) and **the final typed payload** (`{ type: "done", payload, id }`). The
   client-side counterpart (`lib/api.ts`'s three `run*Stream` functions,
   `lib/api.ts:55-109,147-195,206-259`) is copy-pasted three times with the same buffer-split-
   parse-flush logic — this is real, working integration code, but it is not itself abstracted
   into a shared helper, so a bug fixed in the delta stream parser is not automatically fixed in
   the insights or solo one (the `insights` route's missing `closed` guard, noted above, is exactly
   this kind of drift).

---

## Where AI Ends and Conventional Software Engineering Begins

The boundary is drawn cleanly and consistently across the codebase, and it's instructive to name
it precisely:

- **Inside the AI boundary**: extraction and synthesis of *qualitative, judgment-requiring*
  content from unstructured text — narrative shifts, tone, evasiveness, thematic evolution,
  guidance tracking. Every one of these tasks requires reading English prose and making a
  classification or synthesis judgment call that a regex or SQL query structurally cannot do.
- **Outside the AI boundary, deliberately**: exact financial figures. `PRODUCT_NOTES.md`'s
  "2026-05-26 — Financials Dropped from Multi-Quarter Insights" entry is the single clearest
  statement of this principle in the whole repo: "LLM extraction of specific financial numbers
  from earnings call transcripts is unreliable... Showing unreliable numbers in a PMS tool is
  worse than showing none." The team's response wasn't better prompting — it was **removing the
  LLM from that specific task** and later reintroducing exact numbers only via scrape+regex
  (`lib/kpi-extractor.ts`'s `extractStandardKPIs`, pure string/regex parsing of screener.in's HTML
  table, zero Gemini calls for the numeric path). `runKeyMetricsAgent` in the delta pipeline
  (`lib/pipeline.ts:608-627`) is the one place the delta payload still asks Gemini for numbers
  (`revenue`, `pat`, etc.) — but its own system prompt instructs "If a figure is NOT explicitly
  stated, leave the field as an empty string — do NOT estimate" (`lib/pipeline.ts:176`), and the
  code strips empty strings before returning (`lib/pipeline.ts:620-623`) — an attempt at the same
  discipline the team explicitly applied elsewhere, but notably *not* removed from this pipeline
  the way it was from Insights, so the two pipelines are inconsistent on this exact question.
- **Also outside the AI boundary**: signal/score consistency validation (`localValidation`,
  pure arithmetic), market alignment (price-move comparison, pure arithmetic), promoter pledge
  scoring (pure frequency-ratio arithmetic, Capability 6 above), caching/TTL logic, credit
  accounting, auth, and all persistence. None of these use a model, and none of them need to —
  they are exactly the kind of deterministic, auditable logic that conventional software handles
  better than an LLM call would, and the codebase never blurs this line by, say, asking Gemini to
  "double check" a validation score.
- **The one AI-generates-input-for-AI case**: sector narrative generation (Capability 5) consumes
  the *output* of delta analysis (Capability 1) as its input context. This is the one place a
  hallucination or extraction error in one pipeline could silently propagate into another
  pipeline's output — worth flagging as a compounding-error risk that has no mitigation in the
  code (no confidence threshold gating which `DashboardPayload`s get included in
  `buildCompanyBrief`).

**Bottom line for an interviewer's question "where's the AI engineering here vs. the software
engineering"**: the AI engineering is concentrated in five files (`lib/pipeline.ts`,
`lib/solo-pipeline.ts`, `lib/insights-pipeline.ts`, `lib/sector-narrative.ts`,
`lib/kpi-extractor.ts`) and is almost entirely *prompt design + schema design* — there is no
fine-tuning, no RAG, no agentic tool-use loop, no embeddings, no vector search anywhere in the live
product (FAISS and a Vertex AI + MCP-server agent loop exist only in the
**IMPLEMENTED-BUT-ARCHIVED** `finance-agent/` prototype, e.g. `finance-agent/mcp_server.py`,
`finance-agent/vertex.py` — never wired into `app/`). Everything downstream of `JSON.parse()` —
caching, credits, streaming, persistence, RLS/authz, retries at the DB-connection layer — is
conventional backend engineering, and it is measurably more mature (connection retry logic,
structured request logging, atomic upserts) than the AI-calling code sitting right next to it,
which has no retries, no circuit breaker, and no per-call telemetry at all (see
11_PRODUCTION_ENGINEERING.md, Reliability and Observability).
