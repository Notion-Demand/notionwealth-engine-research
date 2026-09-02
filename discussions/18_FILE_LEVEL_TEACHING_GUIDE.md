# File-Level Teaching Guide

This guide tiers the Quantalyze repository by how much a reader needs to understand
each file to reason about the system as a senior engineer would in an interview or a
design review. It is not exhaustive — the repo has roughly 300 tracked files across
`app/`, `lib/`, `components/`, `finance-agent/`, and `disclosure-analysis-pipeline/`.
Tiering criteria:

- **Tier 1 — must understand.** Files that encode a real architectural decision, sit
  on the hot path of the product's core value (transcript → structured signal), or
  are the seam another engineer would touch first to extend or debug the system.
  Every Tier 1 file below was actually read in full or in load-bearing part before
  being included — three files the task prompt suggested were kept only after
  verifying their role; none were dropped, though two (`lib/api-contracts/v1/company.ts`,
  `lib/public-api/product-routes.ts`) are genuinely small files whose importance is
  architectural (they're the anti-corruption boundary and routing table for the
  entire external product) rather than about line count.
- **Tier 2 — should understand.** Supporting systems a reader needs once they go one
  layer deeper — the other two pipelines, the composition roots, the service layer,
  the other repository implementations, external data-sourcing.
- **Tier 3 — nice to understand.** Static data registries, build/deploy config,
  one-off ops scripts, and files whose content is repetitive once the pattern from a
  Tier 1/2 sibling is understood (e.g. the ninth `PostgresXRepository` file looks
  like the second).

A note on ground truth before the tiers: **README.md and TECHNICAL_ARCHITECTURE.md
describe a Supabase-based system, but the code that actually runs (`lib/repositories/index.ts`,
`auth.ts`, `lib/postgres/client.ts`) is fully migrated to Azure Postgres, Azure Blob
Storage, and Microsoft Entra ID.** This guide describes the code as it actually is,
not as the (stale) top-level docs describe it — see `20_TECHNICAL_DEBT_AND_GAPS.md`
for the drift itself as a finding.

---

## TIER 1 — Must Understand

### FILE: lib/pipeline.ts
**ROLE:** The Delta Analysis pipeline — the product's original and most complex
feature. Turns two earnings-call transcript PDFs (previous quarter, current quarter)
into a structured, scored, quarter-over-quarter narrative-shift report.

**SYSTEM POSITION:** Core domain logic, called only from `app/api/v1/analyze/route.ts`.
Sits between the storage layer (`storageRepo`) and Gemini; has no knowledge of HTTP,
auth, or caching — those are the route handler's job.

**CALLED BY:** `app/api/v1/analyze/route.ts` (`runPipeline`, `resolvePdfKey`,
`parseFilename` are all imported from here). `lib/repositories/analysis.ts` imports
`DashboardPayload`/`SectionalInsight`/`KeyMetrics` as its wire-format types (not a
runtime call, a type dependency — see the ADR log on why the persisted shape reuses
the pipeline's shape rather than redeclaring it).

**CALLS:** `@google/generative-ai` (`GoogleGenerativeAI`, `SchemaType`) directly — no
abstraction layer. `pdf-parse` for text extraction. `storageRepo` (from
`lib/repositories`, concretely `AzureBlobStorageRepository`) for PDF bytes. `NIFTY50`/
`NIFTY200` static registries for ticker→NSE-symbol lookup. `fetch()` directly against
Yahoo Finance's unofficial chart API for stock price data — no wrapper, no retries
beyond the implicit browser-style fetch.

**KEY SYMBOLS:** `runPipeline()` (entry point), `AGENT_PROMPTS` (5 domain system
prompts: Revenue & Growth, Margins & Profitability, Cost Structure, CapEx & Balance
Sheet, Macro & Risk), `invokeStructured<T>()` (generic Gemini-call-with-schema-and-
timeout helper), `QUARTER_SNAPSHOT_SCHEMA`/`SECTIONAL_INSIGHT_SCHEMA`/`EVASIVENESS_SCHEMA`/
`BULLETS_SCHEMA`/`KEY_METRICS_SCHEMA` (Gemini `responseSchema` JSON-mode schemas),
`localValidation()` (pure-function signal/score consistency check, no LLM),
`computeMarketAlignment()` (stock-direction-vs-signal-direction check, no LLM),
`resolvePdfKey()`, `MAX_TRANSCRIPT_CHARS = 120_000`, `AGENT_TIMEOUT_MS = 25_000`.

**DATA:** Input: two storage keys (`TICKER_Q#_YYYY.pdf`). Output: `DashboardPayload` —
a large snake_case JSON object (ticker, quarter, quarter_previous, evasiveness score,
`insights: SectionalInsight[]`, overall score/signal, validation score, market
alignment %, stock price change, `earnings_delta: string[]`, `fcf_implications: string[]`,
`key_metrics`). This exact shape is both the pipeline's return value and the
persisted-and-replayed cache payload (see `lib/repositories/analysis.ts`).

**CONTROL FLOW:** `runPipeline(qPrevKey, qCurrKey, onProgress)` first parses both
filenames with `parseFilename()` (regex `^([A-Za-z]+)_Q(\d)_(\d{4})\.pdf$`) and
throws if the company tickers don't match. Phase 1: `extractPdfText()` runs on both
keys in `Promise.all` — downloads the buffer via `storageRepo.download()`, sniffs the
first 5 bytes for a `%PDF` header (throws a specific "delete it from storage and
re-request" error if not), parses with `pdf-parse`, and slices to 120,000 chars.
Phase 2: for each of the 5 `AGENT_PROMPTS` keys, `runThematicAgent()` fires once
against the previous-quarter text and once against the current-quarter text (10
calls), plus one `runEvasivenessAgent()` call against only the last 30,000 chars of
the current transcript — all 11 calls run inside one outer `Promise.all`, and each
call's completion invokes `onProgress()` to stream a `thematic_done`/`evasiveness_done`
NDJSON event to the client. Each `runThematicAgent()` is independently try/caught —
a failure returns `null`, which is filtered out before Phase 3, so one bad agent
doesn't kill the run. Phase 3: for every section where *both* quarters produced a
non-null snapshot, `runTemporalDelta()` fires (up to 5 parallel calls), comparing
`key_takeaways`/first-10-`raw_quotes` from each side and asking Gemini to classify
each shift Positive/Negative/Noise with a `signal_score` in [-10,10] and a UI hint
(`metric_card`/`status_warning`/`quote_expander`). Phase 4: `localValidation()` (pure
JS, no LLM) walks every metric and flags any Positive-signal-with-negative-score or
Negative-signal-with-positive-score mismatch, computing a 0-100 validation score;
in parallel, `fetchStockPriceChange()` hits Yahoo Finance for the quarter's price
delta (returns 0 silently on any failure — network error, unknown ticker, missing
NIFTY registry entry — and this 0 is indistinguishable in the output from "the stock
didn't move"), and `runEarningsDeltaAgent()`/`runFCFImplicationsAgent()`/
`runKeyMetricsAgent()` produce the three synthesis blocks. Phase 5: `computeMarketAlignment()`
tags every non-Noise metric `aligned`/`divergent`/`unclear` against the stock move
(>2%/<-2% thresholds), `computeOverallSignal()` averages all metric scores into one
number and a Positive/Negative/Mixed/Noise label, and the whole `DashboardPayload` is
assembled and returned — the caller (`app/api/v1/analyze/route.ts`) persists it and
streams a final `done` event.

**DESIGN:** Fan-out/fan-in parallelism (many independent Gemini calls in one
`Promise.all`, not a sequential chain) is the dominant pattern — explicitly justified
in `TECHNICAL_ARCHITECTURE.md` §10 as "10 agents finish in the time of 1" (~15-25s
wall-clock vs ~120s for one comprehensive call). Structured-output-via-schema
(Gemini's `responseSchema` + `responseMimeType: "application/json"`) replaces
free-text parsing entirely — every Gemini call in this file returns a
schema-conformant object or throws, never partially-parseable text. Local,
non-LLM validation (`localValidation`, `computeMarketAlignment`) is a deliberate
second layer of trust below the LLM layer — cheap, deterministic, catches a class of
LLM self-contradiction (calling something "Positive" with a negative score) that no
amount of prompt engineering fully eliminates.

**WHY:** Given a 25s-per-agent budget and a 270s pipeline-level ceiling (see
TRADEOFF), the only way to fit ~20 Gemini calls is aggressive parallelism — a
sequential design could not fit inside the timeout at all. Domain-specialized
prompts (one agent per financial theme) also produce materially better extraction
than one giant prompt covering everything, per the file's comments and the product's
own comparison to "3-analyst-team" quality.

**TRADEOFF:** *Single comprehensive call vs. many specialist calls* — chosen: many
specialists (this file), because parallel wall-clock time and per-domain prompt
quality both favor it; the tradeoff is cost (20 calls' worth of input-token overhead
vs 1) and orchestration complexity (this whole file). The Deep Dive pipeline
(`lib/solo-pipeline.ts`) is the other point on this spectrum — one call, cheaper,
used where cross-quarter delta isn't needed. *Gemini's SDK directly vs. an LLM
provider abstraction (LangChain, a custom `LLMClient` interface)* — chosen: direct
SDK calls, INFERRED reason: at a single-provider, single-model-family product this
early, an abstraction layer buys optionality (swap providers) at the cost of
indirection, and nothing in the repo's history suggests provider-swapping was ever
seriously entertained for the live app (unlike the archived `finance-agent/`, which
did build toward Vertex AI's SDK — see ADR #1). The cost of the direct-call choice
shows up concretely: `getGenAI()` is copy-pasted near-verbatim in `lib/pipeline.ts`,
`lib/solo-pipeline.ts`, and `lib/insights-pipeline.ts`.

**FAILURE:** A thematic/temporal-delta agent that throws is caught locally and
becomes `null`, silently reducing the insight count — the pipeline never surfaces
"4/5 sections succeeded" to the end user, only the UI's live agent-progress panel
would show it mid-run. `invokeStructured()` itself has no retry — a single Gemini
5xx or malformed-JSON response propagates as a thrown error from `model.generateContent()`
or `JSON.parse()`; for the 5 always-caught call sites this degrades gracefully, but
`extractPdfText()`'s PDF-parse failure and the top-level `runPipeline()` call in the
route handler are not internally caught — they surface as a `type: "error"` NDJSON
event and the whole analysis is lost (not partially cached). `fetchStockPriceChange()`
failing silently returns `0`, which then feeds `computeMarketAlignment()` as if the
stock were flat — a data-quality failure mode that's invisible to the user (no
"market data unavailable" state exists).

**PRODUCTION:** Add a shared, tested `LLMClient` wrapper (retry-with-backoff, one
`getGenAI()`, centralized token/cost logging) instead of three copies of the same
9-line function. Distinguish "0% price move" from "price data unavailable" in the
payload. Add per-agent retry (1 retry on timeout) before falling back to `null` —
right now a single 25s timeout is the only chance each agent gets. Add structured
tracing (span per Gemini call, per pipeline run) instead of `console.log`, especially
since Application Insights (added in the Azure hosting migration) only captures
request-level HTTP telemetry, not this file's internal fan-out.

**JD:** Multi-agent orchestration and prompt engineering at production scale;
structured/guaranteed-JSON LLM output design; cost/latency-aware system design
(20 calls under a hard timeout); resilience patterns for LLM pipelines (partial
failure, timeouts, degradation) — core to both the Azure Senior AI Engineer and the
Oneleet Full-Stack AI Product Engineer JDs' "ship AI features end-to-end" framing.

**INTERVIEW:**
1. "Why 5 parallel specialist agents instead of one comprehensive call — walk me
   through the latency and cost math, and when would you flip that decision?"
2. "One of your 10 thematic-agent calls times out. Trace exactly what happens to
   the final report the user sees, end to end."
3. "`fetchStockPriceChange` swallows every error into a `0`. What's wrong with that,
   concretely, and how would you fix it without adding a new state to every
   downstream consumer?"

**TRANSFERABLE SKILL:** Designing a fan-out/fan-in LLM pipeline against a hard wall-clock
budget — decomposing one big extraction task into independently-schema'd,
independently-failable parallel calls, then reassembling and validating the result
with cheap deterministic checks before it reaches a user.

---

### FILE: lib/solo-pipeline.ts
**ROLE:** The Deep Dive pipeline — single-quarter, single-Gemini-call comprehensive
earnings brief (8-14 sections), the cheapest and simplest of the three pipelines.

**SYSTEM POSITION:** Domain logic parallel to `lib/pipeline.ts`, called only from
`app/api/v1/analyze/solo/route.ts`. Reuses `resolvePdfKey`/`parseFilename` from
`lib/pipeline.ts` rather than redefining them — the one place the three pipelines
share code beyond the duplicated `getGenAI()`.

**CALLED BY:** `app/api/v1/analyze/solo/route.ts`.

**CALLS:** `@google/generative-ai` directly (own `getGenAI()`, a byte-for-byte
duplicate of `lib/pipeline.ts`'s). `soloAnalysisRepo`, `storageRepo` from
`lib/repositories`. `fromSoloWirePayload`/`toSoloWirePayload` from
`lib/repositories/soloAnalysis.ts` for the cache-entity mapping. `pdf-parse`.

**KEY SYMBOLS:** `runSoloPipeline()`, `SOLO_SCHEMA` (headline, management_tone,
`sections: {title, bullets}[]`), `TIMEOUT_MS = 55_000` (more than double
`lib/pipeline.ts`'s 25s per-agent timeout, since this is the *only* call and has no
sibling calls to hide latency behind).

**DATA:** Input: one storage key. Output: `SoloPayload` — `{company_ticker, quarter,
headline, management_tone, sections: SoloSection[]}`, cached in `solo_analysis_cache`
keyed on `(ticker, quarter)`.

**CONTROL FLOW:** Resolve the PDF key → check `solo_analysis_cache` (skipped if
`force`) → download + parse PDF (same 120K-char cap as the delta pipeline) → one
`invokeStructured()`-style call with a comprehensive system prompt asking for 8-14
thematic sections → cache the result → return, streaming `start`/`extracting`/
`analyzing`/`done` progress events (a much thinner state machine than the delta
pipeline's 11-agent progress stream).

**DESIGN:** The single-call design point on the same fan-out-vs-single-call spectrum
`lib/pipeline.ts` sits on. Deliberately not decomposed into specialist agents — per
`TECHNICAL_ARCHITECTURE.md` §10, "1 comprehensive call" for Deep Dive vs "5 specialist
agents" for Delta is a conscious per-feature choice, not an oversight.

**WHY:** Deep Dive doesn't need cross-quarter delta reasoning, so the parallelism
that buys `lib/pipeline.ts` its wall-clock win doesn't apply — one call at ~120K
input tokens is both cheaper (1 call vs. 20) and simpler to reason about, and the
55s timeout comfortably fits Vercel's original 300s function ceiling (and the
now-unbounded Azure Container Apps ceiling) without needing a sub-timeout.

**TRADEOFF:** Fewer, larger prompts (this file) vs. many, focused prompts
(`lib/pipeline.ts`) — the classic single-call-vs-decomposed-agents tradeoff, resolved
per-feature rather than dogmatically. The cost: a single 120K-token call to a model
covering 8-14 heterogeneous themes is more likely to under-serve any one theme than
a prompt written and tuned for exactly that theme (as `lib/pipeline.ts`'s 5 prompts
are).

**FAILURE:** No internal retry; a single Gemini failure surfaces as a `type: "error"`
progress event with no partial credit — unlike `lib/pipeline.ts`, there's no
per-section granularity to lose, so failure here is strictly binary (whole report
succeeds or fails).

**PRODUCTION:** Same `getGenAI()` deduplication opportunity as `lib/pipeline.ts`.
Given this is the cheapest, simplest pipeline, it's also the best candidate to pilot
a shared retry wrapper before rolling it out to the more complex pipelines.

**JD:** Demonstrates the "when NOT to multi-agent" judgment call — as valuable a
signal in a senior AI engineer interview as the more elaborate pipeline is.

**INTERVIEW:**
1. "Why does Deep Dive use one call while Delta uses five — what's the actual
   decision rule, and would you apply it to a fourth hypothetical feature?"
2. "This file's timeout is 55s vs. 25s in the delta pipeline — why the difference,
   and is 55s enough headroom for the worst-case 120K-char transcript?"

**TRANSFERABLE SKILL:** Recognizing when a single well-crafted comprehensive prompt
beats agent decomposition — matching pipeline shape to the actual reasoning task
instead of defaulting to multi-agent because it's available.

---

### FILE: app/api/v1/analyze/route.ts
**ROLE:** The HTTP entry point for Delta Analysis — the thinnest possible route
handler wrapping `runPipeline()`, and the one file that ties together auth,
per-user credits, caching, and NDJSON streaming for the product's flagship feature.

**SYSTEM POSITION:** Next.js App Router Route Handler (Node runtime, not Edge — it
imports `pdf-parse` transitively through `lib/pipeline.ts`). Top of the request
stack for `POST /api/v1/analyze`.

**CALLED BY:** The browser, via `lib/api.ts`'s `runAnalysisStream()`, from
`app/dashboard/DashboardClient.tsx`'s `handleAnalyze()`.

**CALLS:** `getCurrentUser()` (`lib/auth.ts` → Auth.js `auth()`), `resolvePdfKey()`
and `runPipeline()` (`lib/pipeline.ts`), `analysisRepo` (`lib/repositories`, concretely
`PostgresAnalysisRepository`), `toDashboardPayload`/`fromDashboardPayload`
(`lib/repositories/analysis.ts`), `checkAndDeduct()` (`lib/credits.ts`).

**KEY SYMBOLS:** `maxDuration = 300` (Next.js route-segment config — the platform-level
function timeout), `PIPELINE_TIMEOUT_MS = 270_000` (the file's own internal
timeout, 30s inside the platform ceiling), the `closed` flag guarding
`controller.enqueue()`.

**DATA:** Input: JSON body `{ticker, q_prev, q_curr, force?}`. Output: `Content-Type:
application/x-ndjson` stream of newline-delimited JSON progress events, terminating
in either `{type: "done", payload: DashboardPayload, id, fromCache?}` or
`{type: "error", detail}`.

**CONTROL FLOW:** `getCurrentUser()` — 401 if absent. Parse and validate the body
(422 if missing fields or `q_prev === q_curr`). `resolvePdfKey()` for both quarters
in parallel *before* opening the stream (422 with the underlying error if a PDF
doesn't exist) — this means the client gets a normal HTTP error response for a bad
request instead of a stream that opens and then immediately errors. Cache check:
`analysisRepo.getCachedAnalysis()` (skipped if `force: true`); on a hit, a
single-chunk stream is returned immediately with `fromCache: true` and **no credit
is deducted** — credit cost is explicitly gated to cache misses only. On a miss,
`checkAndDeduct(userId, "delta")` runs (429 if the user's monthly quota is
exhausted) — note this happens *after* the cache check but *before* the pipeline
runs, so a request that will 429 never touches Gemini. Then a `ReadableStream` is
opened: a `setTimeout` arms a 270s internal timeout that sends an `error` event and
closes the stream 30s before Vercel/Azure's platform-level `maxDuration` would kill
the function silently (a documented, deliberate margin — see ADR log). `runPipeline()`
runs with `send` as its progress callback, streaming every event `lib/pipeline.ts`
emits directly to the client. On success, `analysisRepo.saveAnalysis()` persists the
result (delete-then-insert on the `(ticker, q_prev, q_curr)` key, not an upsert) and
a final `done` event is sent with the real DB id. On any thrown error, an `error`
event is sent with the message. `finally` clears the timeout and closes the stream
if not already closed.

**DESIGN:** Streaming Server-Sent-Events-style progress over a hand-rolled NDJSON
protocol (not SSE, not WebSockets) — a `ReadableStream` with a `closed` guard flag to
make `enqueue()` idempotent-safe against a client that has already disconnected.
Credit deduction ordered strictly after the cache check (cache hits are free) —
economic logic living in the route handler, not the service/repository layer,
which is a direct instance of this codebase's "routes stay thin except where a
cross-cutting business rule genuinely belongs at the request boundary" tension (see
`20_TECHNICAL_DEBT_AND_GAPS.md` on the missing service layer for this route).

**WHY:** NDJSON over a raw HTTP stream needs zero new infrastructure (no WebSocket
gateway, works through any HTTP proxy/CDN) and gives the client real per-agent
progress for a run that can take up to several minutes — critical for a product
whose core loop is "watch 11 agents complete in real time" (`components/AgentPanel.tsx`).
The internal 270s/platform 300s margin exists because both Vercel and (per this
repo's own experience — see ADR log) Azure kill long-running functions without
sending any application-level signal, so the app must self-terminate first to give
the client an intelligible error instead of a stream that silently stops.

**TRADEOFF:** NDJSON vs. WebSockets — INFERRED (and explicitly stated in
`TECHNICAL_ARCHITECTURE.md` §6/§10) chosen for zero infra overhead and serverless
compatibility; the cost is at-most-one-directional progress (no client→server
mid-stream signal, e.g. no "cancel this run" message channel) and no automatic
reconnect/resume — if the connection drops, the whole run's progress is lost
client-side (though the *server-side* pipeline keeps running to completion and
still writes to cache, so a page refresh and re-request often instant-hits cache).
Cache check before credit deduction vs. after — chosen (cache-free) to reward
re-visits and avoid double-charging for a re-render of the same quarter pair; the
cost is that this ordering is a business rule now encoded as route-handler
control flow rather than something a product manager could tune via config.

**FAILURE:** A `runPipeline()` throw is caught by the outer try/catch and reported
as `type: "error"` — the stream still closes cleanly. A client that disconnects
mid-stream causes `controller.enqueue()` to throw, caught by `send()`'s own
try/catch which flips `closed = true` — but nothing stops `runPipeline()` itself
from continuing to burn Gemini calls for an abandoned request (no `AbortController`
wired from the client disconnect into the pipeline). A `force: true` re-run and a
crashed prior run racing on the same `(ticker, q_prev, q_curr)` key could both
attempt to insert — `saveAnalysis()`'s delete-then-insert is not transactional
(two separate `query()` calls, no `BEGIN`/`COMMIT`), so a concurrent pair of requests
can interleave into a delete-delete-insert-insert race, though the effect is at
worst a duplicate/stale-then-fresh row, not data loss.

**PRODUCTION:** Wire a client-abort → `AbortSignal` into `runPipeline()`'s Gemini
calls to stop burning tokens on abandoned requests. Wrap `saveAnalysis()`'s
delete+insert in a single transaction or an `ON CONFLICT` upsert. Move the
credit-check-then-pipeline-then-save sequence into a `lib/services/analysisService.ts`
(the Service Layer this codebase already has a composition root for, at
`lib/services/index.ts`, but which only the public API routes actually use).

**JD:** Real-time streaming API design under serverless constraints; auth +
metering + caching composed correctly at a request boundary; graceful degradation
under a hard platform timeout.

**INTERVIEW:**
1. "Why is the credit check placed after the cache check but before the pipeline
   call — what would break if you moved it to the very top of the handler?"
2. "The client's browser tab is closed mid-analysis. What keeps running on the
   server, for how long, and what does that cost?"
3. "Walk through exactly what the client receives if Gemini is having a bad day and
   3 of 11 thematic agents time out."

**TRANSFERABLE SKILL:** Composing auth, metering/rate-limiting, caching, and
long-running-job streaming correctly in one serverless request handler — the exact
shape of "wrap an expensive AI pipeline in a production-safe API" that most AI
product work reduces to.

---

### FILE: lib/repositories/analysis.ts
**ROLE:** The `AnalysisRepository` interface plus its two concrete implementations
(`SupabaseAnalysisRepository` — dead code kept past its documented removal date, and
`PostgresAnalysisRepository` — the one actually wired into production) — the
canonical example of this codebase's Repository/Strangler-Fig migration pattern.

**SYSTEM POSITION:** Persistence layer, directly below `lib/repositories/index.ts`
(the composition root) and above nothing — repositories "own persistence only," per
the architecture spec's rule 1, and this file has no orchestration or caching logic
of its own.

**CALLED BY:** `app/api/v1/analyze/route.ts`, `app/api/v1/screener/route.ts`,
`app/api/v1/calendar/route.ts` and `.../seed/route.ts`, `app/api/v1/analyze/history/route.ts`,
`lib/nifty200-sampler.ts`, `app/api/public/v1/data/companies/[ticker]/route.ts` (via
`getLatestByTicker`) — nine distinct call sites, all importing the singleton
`analysisRepo` from `lib/repositories/index.ts`, never this file's classes directly.

**CALLS:** `lib/postgres/client.ts`'s `query<T>()` helper (the active path);
`lib/supabase/admin.ts`'s `supabaseAdmin()` (the dormant path, still present).
Imports `DashboardPayload`/`SectionalInsight`/`KeyMetrics` as *types only* from
`lib/pipeline.ts`.

**KEY SYMBOLS:** `Analysis` (domain entity, camelCase), `AnalysisRecord`,
`AnalysisRepository` (the interface — 9 methods), `toEntity()`/`fromEntity()`
(bidirectional mapping between the persisted/wire snake_case `DashboardPayload`
shape and the camelCase `Analysis` domain entity — the Anti-Corruption Layer named
explicitly in the architecture spec), `fromDashboardPayload()`/`toDashboardPayload()`
(the exported wrappers other files actually call), `SupabaseAnalysisRepository`,
`PostgresAnalysisRepository`.

**DATA:** Persisted row: `analysis_results(id, user_id, company_ticker, q_prev,
q_curr, payload JSONB, created_at)`. In-process: `Analysis` (camelCase) ⇄
`DashboardPayload` (snake_case) via `toEntity`/`fromEntity`.

**CONTROL FLOW:** Every method on `PostgresAnalysisRepository` follows the same
shape: build a parameterized SQL string, call `query<RowShape>()`, map each row
through `toEntity()`. `getCachedAnalysis()` additionally applies cache-validity
rules that live in this repository, not the caller: it rejects a cached row whose
`insights` array is empty or missing, and — in `strict` mode (the default; the
sector-seeding caller explicitly opts out via `{strict: false}` because it doesn't
need synthesis fields) — also rejects a row missing `earnings_delta`, treating an
older-schema cached payload as a cache miss rather than serving a stale/incomplete
shape to a caller expecting the current one. `saveAnalysis()` first guards against
persisting an empty `sections` array (returns the sentinel id `"not-cached-empty"`
without writing), then does an explicit `DELETE ... WHERE (ticker, q_prev, q_curr)`
followed by an `INSERT ... RETURNING id` — two separate statements, not an upsert.

**DESIGN:** Repository Pattern (Fowler) + Strategy/Ports-and-Adapters (interface as
port, two classes as interchangeable adapters) + Anti-Corruption Layer (the
`toEntity`/`fromEntity` boundary) + Strangler Fig (both implementations coexist so
the swap at the composition root was a one-line, easily-reverted change) — all four
patterns are explicitly named and justified in
`docs/superpowers/specs/2026-07-09-data-wrapper-and-public-api-design.md`, not just
inferred from the code.

**WHY:** The stated motivation (`docs/superpowers/plans/2026-07-09-repositories-and-migration.md`)
was that 31 files called `supabaseAdmin()` directly before this refactor — the
repository layer was built specifically as prep for an already-decided Supabase→Azure
migration, to contain that future provider swap to ~12 files instead of 31. That bet
paid off exactly as designed: the later Postgres cutover (see ADR log) touched only
the repository implementations and the composition root, not a single route handler.

**TRADEOFF:** Reusing `DashboardPayload` as the storage/wire shape (`type StoredPayload
= DashboardPayload`) vs. defining a wholly separate persisted schema — chosen: reuse,
explicitly justified in the file's own comment as avoiding a redundant parallel type
for a shape that "IS what's persisted... and also still what runPipeline() returns."
The cost: `lib/repositories/analysis.ts` now has a compile-time dependency on
`lib/pipeline.ts`'s output shape, so a pipeline schema change is also, silently, a
storage schema change — there's no versioning or migration story for old cached rows
whose `DashboardPayload` shape has since evolved, beyond the blunt "empty
insights/missing earnings_delta ⇒ treat as cache miss" check in `getCachedAnalysis()`.

**FAILURE:** `saveAnalysis()` catches its own errors and returns the string
`"unknown"` rather than throwing — a caller checking a returned id for a specific
value would never notice a *failed* save vs. a *successful* one with an odd id,
though today no caller does that check, so it's latent rather than active. The
delete-then-insert is not wrapped in a transaction (see `app/api/v1/analyze/route.ts`'s
FAILURE section) — a crash between the two statements leaves that ticker/quarter-pair
with no cached row at all until the next successful run.

**PRODUCTION:** Delete `SupabaseAnalysisRepository` (and its counterparts in every
other repository file) — the migration spec's own exit criteria (one successful
production deployment, verification passed, 7 days with no incident) were satisfied
by 2026-07-20 per `docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md`;
as of this writing it is well past that date and the dead classes are still in the
tree, doubling the maintenance surface of every future interface change. Wrap
`saveAnalysis()`'s two statements in a transaction or switch to `INSERT ... ON
CONFLICT (company_ticker, q_prev, q_curr) DO UPDATE`.

**JD:** Repository pattern / clean architecture in a real production codebase (not a
toy example); a *demonstrated*, not just described, provider-migration story —
exactly the "own the plumbing that lets AI features ship on stable infrastructure"
half of both target JDs.

**INTERVIEW:**
1. "Two implementations of `AnalysisRepository` exist in this file. Which one runs
   in production, how do you know, and what does the other one's continued presence
   in the tree cost the team?"
2. "Why does this repository re-validate cache shape (`strict` mode, empty-insights
   check) instead of trusting whatever's in the table?"
3. "Design the transaction boundary you'd add to `saveAnalysis()` and explain what
   failure mode it closes."

**TRANSFERABLE SKILL:** Building a repository layer that actually earns its
complexity — proving the abstraction was worth it by pointing at the exact commit/
migration it made cheap, rather than adopting the pattern on faith.

---

### FILE: auth.ts
**ROLE:** The Auth.js (NextAuth v5) configuration — the entire authentication
surface of the live application, backed by Microsoft Entra External ID (not
Supabase Auth, despite what the top-level docs say).

**SYSTEM POSITION:** Repo-root singleton, imported by `lib/auth.ts` (the thin
`getCurrentUser()` wrapper every route/page actually calls) and by
`app/api/auth/[...nextauth]/route.ts` (Auth.js's own route handler).

**CALLED BY:** `lib/auth.ts`, `app/api/auth/[...nextauth]/route.ts`, and (per the
Azure auth-migration design doc) 13 call sites across Server Component redirect
gates, API-route 401 checks, and client-side session hooks — all mediated through
`lib/auth.ts`, not this file directly.

**CALLS:** `next-auth`, `next-auth/providers/microsoft-entra-id`. Reads
`AUTH_MICROSOFT_ENTRA_ID_ID`/`_SECRET`/`_ISSUER` from the environment.

**KEY SYMBOLS:** `handlers`, `auth`, `signIn`, `signOut` (Auth.js's standard exports),
the `jwt`/`session` callbacks that override `token.sub`.

**DATA:** Input: an Entra OIDC redirect callback. Output: a JWT-strategy session
(`session.user.id` set to a UUID). No database session table.

**CONTROL FLOW:** On sign-in, Auth.js's standard OIDC flow runs against Entra; this
file's `jwt` callback then overrides the default `token.sub` (which Auth.js would
otherwise set to `account.providerAccountId`, an opaque non-UUID pairwise identifier
for Entra External ID) with `profile.oid` — Entra's actual per-tenant Object ID,
which *is* a UUID matching what every Postgres table's `user_id` column expects.
The `session` callback then copies `token.sub` onto `session.user.id`, which is what
`lib/auth.ts`'s `getCurrentUser()` reads.

**DESIGN:** A one-line-looking override (`token.sub = profile?.oid ?? account.providerAccountId`)
that is actually load-bearing infrastructure — every DB query filtered by `user_id`
depends on this exact claim mapping being correct.

**WHY:** The system's UUID-typed `user_id` columns predate this Entra migration
(they were sized for Supabase's UUID `auth.users.id`) and were kept unchanged (per
the Azure Data+Storage migration's explicit invariant list) — so the *auth* layer had
to be bent to keep emitting UUID-shaped identifiers, rather than every downstream
table being re-typed to accept Entra's opaque `sub` format.

**TRADEOFF:** Re-type every `user_id` column to accept an opaque string vs. force
Entra's claims to look like a UUID at the auth boundary — chosen: the latter,
because it's a one-file, one-callback fix vs. an 11-repository schema migration; the
cost is a fragile, undocumented-outside-a-code-comment coupling between "how Entra
happens to shape its `oid` claim" and "what every table in this database assumes a
user id looks like."

**FAILURE:** This exact bug already happened once in production — the code comment
states plainly: "broke every credits/analysis query with 'invalid input syntax for
type uuid'... found by testing the real deployment, not caught by type-checking."
TypeScript's type system cannot catch a runtime claim-shape mismatch like this; only
an end-to-end login-and-query smoke test can.

**PRODUCTION:** Add a startup or CI assertion that `profile.oid` is present and
UUID-shaped for at least one known test identity, so a future Entra tenant
misconfiguration (or Microsoft changing what it puts in `oid`) fails loudly instead
of as a runtime SQL error surfaced to a real user.

**JD:** Identity/auth migration ownership under a real production constraint
(existing UUID schema); debugging a claims-mapping bug that only manifests at
runtime — directly maps to "own auth and identity" work in a senior cloud-platform
JD.

**INTERVIEW:**
1. "Why override `token.sub` here instead of just accepting Entra's default
   `providerAccountId`?"
2. "This bug 'was found by testing the real deployment, not caught by
   type-checking' — what test would have caught it *before* deployment?"
3. "If Quantalyze onboarded a second identity provider tomorrow (say, Google
   Workspace SSO for an enterprise customer), what has to change here, and what
   doesn't?"

**TRANSFERABLE SKILL:** Bridging an external identity provider's claim shape to an
existing, schema-committed internal identifier format — a near-universal problem
whenever an auth provider changes underneath a live schema.

---

### FILE: middleware.ts
**ROLE:** The gate for the entire external Public API surface (`/api/public/:path*`)
— API-key authentication, product entitlement, and daily rate limiting, all running
at the Edge before any route handler executes.

**SYSTEM POSITION:** Next.js Middleware — the one file in this repo confirmed
Edge-runtime-compatible (per the Azure hosting migration design doc's runtime
audit). Sits in front of every route under `app/api/public/v1/**`.

**CALLED BY:** The Next.js routing layer itself, automatically, for any request
matching `config.matcher`.

**CALLS:** `apiAccessRepo` (`lib/repositories`, `PostgresApiAccessRepository`),
`resolveProductName()` (`lib/public-api/product-routes.ts`), the Web Crypto
`crypto.subtle.digest` API (Edge-compatible SHA-256, not Node's `crypto` module).

**KEY SYMBOLS:** `middleware()`, `sha256Hex()`, `jsonError()`, `log()` (structured
JSON access log to stdout — the only per-request audit trail this API has).

**DATA:** Input: `Authorization: Bearer <api-key>` header. Output: either a 401/403/
404/429 JSON error, or `NextResponse.next()` with `x-api-key-id`/`x-api-partner-id`
headers injected for the downstream route handler to read.

**CONTROL FLOW:** Resolve the request's product name from its path via
`resolveProductName()` — 404 immediately if the path doesn't match any registered
public-API pattern (this happens *before* auth, so an unknown path never leaks
whether a valid key was presented). Extract and regex-match the Bearer token — 401
if missing/malformed. Hash the raw key with SHA-256 and look it up via
`apiAccessRepo.getKeyByHash()` — the raw key is never stored, only its hash — 401 if
not found or inactive. Check `keyInfo.entitledProducts.includes(product)` — 403 if
the key exists but isn't entitled to this specific product (a key can be scoped to
a subset of products). Rate limit: `getUsageToday()` then, if under quota,
`incrementUsage()` — two separate calls, explicitly commented as a known
non-atomic read-then-write race, accepted at current partner volume. On success,
forward the request with partner-identifying headers injected, and log every branch
(success and every rejection) as one structured JSON line with `requestId`,
`latencyMs`, `keyId`, `partnerId`.

**DESIGN:** API Gateway pattern implemented as Edge middleware rather than a
separate service — auth, entitlement, and rate-limiting are all cross-cutting
concerns handled once, centrally, rather than duplicated in three route handlers
(`app/api/public/v1/data/companies/[ticker]/route.ts`, `.../sectors/[sector]/route.ts`,
`.../products/sector-thesis/route.ts`). Hashed-key-at-rest is a standard credential
hygiene pattern (compare to how GitHub/Stripe store API key hashes, not raw keys).

**WHY:** Centralizing this in middleware means every future public-API route
automatically inherits auth/entitlement/rate-limiting for free just by being
registered in `PRODUCT_ROUTES` — a route handler author cannot forget to add auth,
because there is no code path to the handler without passing through here first.

**TRADEOFF:** Read-then-write rate limiting (this file, self-acknowledged) vs. an
atomic SQL increment (`UPDATE ... SET count = count + 1 ... RETURNING count`) —
chosen: the simpler, race-prone version, explicitly justified in-code as
"acceptable at v1's scale (manually-provisioned, low-volume partners)" with a named
follow-up ("an atomic SQL increment... if a partner's volume makes the race
actually matter") — a textbook example of consciously deferred correctness with a
documented trigger for revisiting it, not an oversight.

**FAILURE:** The acknowledged race means two concurrent requests from the same key
in the same second can both read `usedToday < dailyQuota` and both pass, over-
admitting by up to (concurrency - 1) requests in the worst case — a soft cap, not a
hard one. Any unexpected exception (a DB blip on `getKeyByHash`) is caught and
returns a generic 500 without leaking internals, but also without distinguishing
"your key is fine, we had an infra blip" from any other failure to the partner.

**PRODUCTION:** Replace the two-call rate limit with one atomic UPSERT-and-increment
SQL statement. Consider a sliding-window or token-bucket limiter instead of a
calendar-day reset (a partner exhausting their quota at 23:59 waits only 1 minute
for a full refill, while one exhausting it at 00:01 waits nearly 24 hours) —
plausible fairness issue at real partner volume.

**JD:** API product security (hashed credentials, scoped entitlements, rate
limiting) — directly the "ship a metered external AI product" muscle in the Oneleet
Full-Stack AI Product Engineer JD.

**INTERVIEW:**
1. "Why hash the API key before storing/looking it up instead of storing it raw?"
2. "You've acknowledged a rate-limit race condition in a code comment instead of
   fixing it. Defend that decision, and tell me the exact metric you'd watch to know
   when it's time to fix it."
3. "Why does the 404-for-unknown-path check happen before the 401-for-missing-auth
   check?"

**TRANSFERABLE SKILL:** Building a minimal, correct-enough API gateway (auth,
entitlement, rate limiting, structured logging) as Edge middleware rather than
reaching for a dedicated API-gateway product on day one.

---

### FILE: supabase/migrations/001_initial.sql
**ROLE:** The origin schema — `user_connections` (OAuth token storage for a
Gmail/Slack integration that's since been superseded/legacy) and `analysis_results`
(the Delta Analysis cache table, still central to the live product).

**SYSTEM POSITION:** First of eleven migration files (`001` through `011`), the
seed of everything `lib/repositories/analysis.ts` and friends query today. Despite
now running (with `auth.users` foreign keys mechanically stripped at apply time,
per the Azure Data+Storage migration's adapter script) against **Azure Postgres**,
not Supabase, this file — and the whole directory — is still named and pathed as if
Supabase is the target, and its own header comment still reads "NotionWealth
Intelligence Engine schema."

**CALLED BY:** Applied via the Supabase SQL editor historically; per the Azure
migration design doc, now applied via `scripts/migrate-schema-to-azure.ts`'s FK-
stripping adapter, reading these same `.sql` files as the single source of truth
(deliberately not forked into a second Azure-specific copy).

**CALLS:** N/A (DDL).

**KEY SYMBOLS:** `user_connections`, `analysis_results`, `update_updated_at()`
trigger function, two `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY "own rows"`
pairs.

**DATA:** `analysis_results(id UUID PK, user_id UUID FK→auth.users, company_ticker
TEXT, q_prev TEXT, q_curr TEXT, payload JSONB, created_at TIMESTAMPTZ)`.

**CONTROL FLOW:** N/A — schema definition, not runtime logic. Worth understanding
as the concrete shape every `AnalysisRepository` method's SQL targets.

**DESIGN:** Row-Level Security via Postgres native policies (`auth.uid() = user_id`)
was the *original* per-row authorization mechanism — a Supabase-idiomatic pattern
that has zero equivalent once the app talks to raw Postgres via a service-role-style
`pg.Pool` with no per-request JWT-to-RLS wiring (this is explicitly called out and
resolved in the Azure Data+Storage migration design doc's "Watchlist security
model" section — RLS is replaced by explicit `WHERE user_id = $1` application-level
filtering for the one repository, `WatchlistRepository`, that still relied on it;
every other repository, including this one's `analysis_results`, was *already*
bypassing RLS via the service-role `supabaseAdmin()` client even on Supabase, so
this migration changed nothing about their authorization model).

**WHY:** RLS made sense when the app used per-request, JWT-scoped Supabase clients;
almost everywhere except `WatchlistRepository`, the app actually used the
RLS-bypassing service-role client from day one, meaning these `CREATE POLICY`
statements were largely inert for `analysis_results`/`user_connections` even
pre-migration — a security-theater layer of authorization that the application layer
never actually depended on.

**TRADEOFF:** Declaring RLS policies that most of the app's own access pattern
bypasses vs. not declaring them at all — INFERRED: declared for defense-in-depth
and because they cost nothing to write, even though the service-role client used by
`supabaseAdmin()`/most repositories never benefits from them.

**FAILURE:** If a future engineer, unaware the app already uses a service-role
client everywhere, assumes these RLS policies are the operative access control and
skips writing an application-level `user_id` filter somewhere it's actually needed,
that's a real cross-tenant data leak risk — this is exactly the trap the Azure
migration spec explicitly had to reason through for `WatchlistRepository`.

**PRODUCTION:** Either remove the now-largely-inert RLS policies (Postgres on Azure
has no `auth.uid()` equivalent, so they're fully dead there, not just bypassed) or
document, prominently, that authorization is application-level everywhere in this
codebase, full stop — no table should be assumed protected by RLS anymore.

**JD:** Understanding when a database-native security feature is real vs. vestigial
— a subtle but real production-security judgment call.

**INTERVIEW:**
1. "This table has an RLS policy referencing `auth.uid()`. Does it protect
   anything in production today? Why or why not?"
2. "The file header still says 'NotionWealth Intelligence Engine schema' and lives
   under `supabase/migrations/`. What does that tell you about how this migration
   got here, and would you rename anything?"

**TRANSFERABLE SKILL:** Reading a schema file skeptically — distinguishing declared
security controls from the controls actually enforced by the application code that
queries against them.

---

### FILE: lib/public-api/product-routes.ts
**ROLE:** An 18-line routing table mapping public-API URL patterns to product
names — the single source of truth `middleware.ts` uses for both "does this path
exist" (404) and "is this key entitled to it" (403).

**SYSTEM POSITION:** A pure, dependency-free data/logic module sitting directly
below `middleware.ts` — small by design (Edge middleware bundle size matters).

**CALLED BY:** `middleware.ts` (`resolveProductName`). Implicitly, every public API
route handler's own product identity is defined here rather than in the route file
itself.

**CALLS:** Nothing — pure regex matching over `PRODUCT_ROUTES`.

**KEY SYMBOLS:** `ProductRoute`, `PRODUCT_ROUTES` (currently 3 entries:
`data:companies`, `data:sectors`, `products:sector-thesis`), `resolveProductName()`.

**DATA:** Input: a pathname string. Output: a product-name string or `null`.

**CONTROL FLOW:** Linear `Array.find()` over `PRODUCT_ROUTES`, testing each regex
in order; the file's own comment asserts order doesn't matter because "patterns are
mutually exclusive by construction" — true today, but not enforced by any type or
runtime check, only by developer discipline when adding a fourth product.

**DESIGN:** A registry/lookup-table pattern deliberately kept as one small,
easily-scannable file rather than scattering "what product is this route" logic
across each route handler — every future public product is a one-line addition
here, visible in a single diff.

**WHY:** Keeping this separate from `middleware.ts` (rather than inlining the array
there) lets a reviewer audit the entire public product catalog — everything a
partner *could* be entitled to — without reading any auth logic at all.

**TRADEOFF:** A flat array of regexes vs. a more structured router (e.g. matching
on a parsed URL tree, or generating this table from the route handlers themselves
via a build step) — chosen: the flat array, appropriate at 3 routes; the "mutually
exclusive by construction" assumption becomes a real risk only once routes are
numerous or dynamically generated enough that two patterns could plausibly overlap
without a human noticing.

**FAILURE:** If someone adds a route pattern that overlaps an existing one (e.g. a
broader `/^\/api\/public\/v1\/data\//` alongside the existing `.../companies/` and
`.../sectors/` patterns), `Array.find()`'s first-match-wins semantics would silently
route to whichever entry appears first in the array — a correctness bug that would
only surface as a mysterious wrong-product entitlement check, not a crash.

**PRODUCTION:** Add a startup-time assertion (or a unit test, once a test runner
exists) that no two `PRODUCT_ROUTES` patterns can both match the same synthetic
path — cheap insurance against the exact silent-failure mode above.

**JD:** API product surface design — the discipline of keeping "what can a partner
buy" as a single, auditable list, which matters directly for a metered external
product.

**INTERVIEW:**
1. "Why is this 18-line file separate from `middleware.ts` instead of inlined?"
2. "What happens if two entries in `PRODUCT_ROUTES` both match the same path — and
   how would you prevent that from being a silent bug?"

**TRANSFERABLE SKILL:** Keeping a product/entitlement catalog as one small,
declarative, reviewable table instead of letting "what's a paid feature" logic leak
into every handler that needs to check it.

---

### FILE: lib/api-contracts/v1/company.ts
**ROLE:** The Anti-Corruption Layer between the internal `Analysis` domain entity
and the external, partner-facing `CompanyResponseV1` wire contract — 39 lines that
are the entire promise Quantalyze makes to a paying API partner about what
`/api/public/v1/data/companies/{ticker}` returns.

**SYSTEM POSITION:** Sits between `lib/repositories/analysis.ts` (internal domain
entity) and `app/api/public/v1/data/companies/[ticker]/route.ts` (the actual route
handler, which calls `toCompanyResponseV1()`).

**CALLED BY:** `app/api/public/v1/data/companies/[ticker]/route.ts`.

**CALLS:** Nothing beyond its own type imports (`Analysis` from
`lib/repositories/analysis.ts`).

**KEY SYMBOLS:** `CompanyResponseV1` (the frozen external contract), `toCompanyResponseV1()`.

**DATA:** Input: `Analysis` (the full internal domain entity — includes every
section, every metric, evasiveness score, validation internals). Output:
`CompanyResponseV1` — a deliberately narrow subset: ticker, quarters, overall
signal/score, summary, 4 key metrics (revenue, revenue growth, EBITDA margin, PAT
growth — not all 7 fields `KeyMetrics` can hold), `earningsDelta`, and
`generatedAt`. Notably absent from the external contract: the full `sections`
array, `validationScore`, `flaggedCount`, `marketAlignmentPct`, `stockPriceChange`,
`marketSources`, `fcfImplications`, and `evasivenessScore` — none of the internal
scoring/validation machinery, prompt-adjacent detail, or the granular per-metric
quote data leaves this boundary.

**CONTROL FLOW:** `toCompanyResponseV1(analysis, generatedAt)` is a pure,
single-pass field-selection/rename function — no branching beyond the
optional-`keyMetrics` null check.

**DESIGN:** Anti-Corruption Layer (Evans, DDD), applied at the *external* boundary
this time (the architecture spec names this pattern applied twice — once inside
repositories for storage, once here for the public API) — explicitly named in
`docs/superpowers/specs/2026-07-09-data-wrapper-and-public-api-design.md`'s
principle 6: "External API contracts never expose internal models."

**WHY:** This is the mechanism that lets the internal pipeline's schema evolve
freely (add a field to `DashboardPayload`, change `Analysis`'s shape) without ever
silently changing what a paying partner's integration receives — and, just as
importantly, it's what prevents a partner from ever seeing the internal-only
scoring/validation fields (`validationScore`, `flaggedCount`) that reveal how the
product's confidence-scoring actually works.

**TRADEOFF:** A dedicated `CompanyResponseV1` type + explicit mapper vs. just
`JSON.stringify`-ing a subset of `Analysis` inline in the route handler — chosen:
the dedicated contract type, at the cost of one more file and one more mapping
function to maintain per product, in exchange for a compiler-enforced guarantee
that the external shape can't silently drift when the internal one changes (a
missing field in `toCompanyResponseV1` is a visible, deliberate omission in a
diff, not an accidental side effect of refactoring `Analysis`).

**FAILURE:** None structural — this is a pure mapping function with no I/O, so its
only "failure mode" is a *design* failure: if a future engineer adds a sensitive
field to `Analysis` and forgets this file exists, TypeScript won't stop them from
also widening `CompanyResponseV1` carelessly, or from bypassing this file entirely
in a new route.

**PRODUCTION:** A lint rule or code-review checklist item ("does `app/api/public/**`
import anything from `lib/repositories/*` directly, instead of only through
`lib/api-contracts/v1/*`?") would make the boundary this file represents
structurally enforced rather than convention-enforced.

**JD:** API product design discipline — versioned, intentionally-narrow external
contracts, the exact skill of "productize an internal AI pipeline for external
sale" the Oneleet JD's product-engineering half asks for.

**INTERVIEW:**
1. "What internal fields does `Analysis` have that never reach a partner, and why
   specifically those?"
2. "If Quantalyze needs a `CompanyResponseV2` with a different shape someday, what
   changes and what doesn't?"

**TRANSFERABLE SKILL:** Drawing and enforcing a hard line between "what we compute
internally" and "what we promise externally" — the single most important discipline
in productizing an internal AI system as a paid API.

---

### FILE: lib/credits.ts
**ROLE:** The per-user monthly credit/metering system gating the three billable
pipeline actions (`delta`: 3 credits, `solo`: 1 credit, `insights`: 4 credits).

**SYSTEM POSITION:** Thin domain-logic layer directly above `creditsRepo`
(`lib/repositories/credits.ts`), called from each pipeline's route handler.

**CALLED BY:** `app/api/v1/analyze/route.ts`, `app/api/v1/analyze/solo/route.ts`
(inferred from the same pattern), `app/api/v1/insights/route.ts` (inferred), and
`app/api/v1/credits/route.ts` for status display.

**CALLS:** `creditsRepo` (`lib/repositories`, concretely `PostgresCreditsRepository`).

**KEY SYMBOLS:** `ACTION_COSTS` (`{delta: 3, solo: 1, insights: 4}`),
`DEFAULT_QUOTA = 2_500`, `getCreditStatus()`, `checkAndDeduct()`,
`currentMonth()` (YYYY-MM key).

**DATA:** Input: `userId`, action name. Output: `{allowed, remaining, cost}`.

**CONTROL FLOW:** `checkAndDeduct(userId, action)` looks up `ACTION_COSTS[action]`
(0 for unknown actions — a fail-open default, not fail-closed). If cost is 0,
short-circuit `allowed: true` immediately (used for free, read-only actions like
Screener). Otherwise `getCreditStatus()` calls `creditsRepo.getOrCreateStatus(userId,
currentMonth(), DEFAULT_QUOTA)` — lazily creates a credit row for the current month
if one doesn't exist. If `status.remaining < cost`, return `allowed: false`.
Otherwise call `creditsRepo.setUsed(userId, status.month, status.used + cost)` — a
read-then-write, not an atomic increment.

**DESIGN:** A minimal metering module — no separate ledger of individual
transactions, just a running `used` counter per `(userId, month)`. The file's own
header comment documents the whole pricing model in one place (1 credit = $0.01,
per-action costs) — a rare instance of business logic and its business
justification living in the same six lines.

**WHY:** Monthly-bucket, running-counter credits are the simplest model that
supports the product's actual need (a soft monthly cap, not fine-grained
transaction history/audit) — appropriate for a pre-launch, low-volume, manually-
provisioned-partner stage product, per the same "don't over-build for a scale you
don't have yet" posture visible across this codebase's Azure migration docs.

**TRADEOFF:** A running counter vs. an append-only ledger of individual debit
events — chosen: the counter, at the cost of no per-action audit trail (you can see
a user used 47 credits this month, but not which 15 actions produced that number,
without cross-referencing `analysis_results`/`solo_analysis_cache`/`insights_cache`
timestamps by hand).

**FAILURE:** This file's own docstring (`* Default monthly quota = 600 ($6)`) is
**wrong** — `DEFAULT_QUOTA` is actually `2_500` ($25), a 4x discrepancy between the
comment and the code, a real stale-documentation bug a reader would trust at their
peril. Separately, and more seriously: `checkAndDeduct()`'s read-then-write
(`getCreditStatus()` then `setUsed(..., status.used + cost)`) is a genuine race —
two concurrent requests from the same user (e.g. two browser tabs both firing Delta
Analysis) can both read the same `status.used`, both compute `allowed: true`, and
both call `setUsed()` with the same stale base, silently under-charging the user by
one action's worth of credits (a lost-update anomaly) rather than over-blocking
them — the opposite failure direction from `middleware.ts`'s acknowledged rate-limit
race, and, unlike that one, not documented anywhere in this file as a known,
accepted risk.

**PRODUCTION:** Fix the stale docstring. Replace the read-then-write with a single
atomic `UPDATE credits SET used = used + $1 WHERE user_id = $2 AND month = $3
RETURNING used` (or a Postgres advisory lock / `SELECT ... FOR UPDATE` around the
check-and-deduct), matching the fix already named (but not yet applied) for the
structurally identical rate-limit race in `middleware.ts`.

**FAILURE (severity note):** Because this bug leaks credits rather than denying
service, it is easy to miss in normal QA (nothing breaks visibly) and would only
show up as a slow, hard-to-attribute revenue leak at real concurrent usage.

**JD:** Metering/billing logic for an AI product — the concrete "credits =
Gemini cost + margin" mechanism that turns an internal pipeline into priced usage,
core to the Oneleet Full-Stack AI Product Engineer JD.

**INTERVIEW:**
1. "This file's own comment says the default quota is 600. The code says 2,500.
   Which do you trust, and how would you have caught this before it shipped?"
2. "Design a fix for the race condition in `checkAndDeduct` — what SQL, and why
   does it need to be one statement instead of two?"
3. "Why is `ACTION_COSTS[action] ?? 0` — an unknown action costs nothing — a
   defensible default here, and where would it be dangerous?"

**TRANSFERABLE SKILL:** Recognizing that "simple" metering code (a counter, a
threshold check) is exactly where classic read-then-write concurrency bugs hide,
and knowing the one-line atomic-SQL fix for them.

---

### FILE: components/AgentPanel.tsx
**ROLE:** The live, per-agent progress visualization for Delta Analysis — the UI
translation of `lib/pipeline.ts`'s NDJSON progress events into a grid of status
cards, and one of the product's clearest visual differentiators ("watch 5 analysts
work in real time").

**SYSTEM POSITION:** Presentational Client Component, rendered by
`app/dashboard/DashboardClient.tsx` only while a Delta Analysis run is in flight.

**CALLED BY:** `app/dashboard/DashboardClient.tsx` (`<AgentPanel state={agentState}
.../>`, gated on `agentState !== null`).

**CALLS:** `clsx` (conditional className composition), `lucide-react` icons
(`CheckCircle2`, `Circle`, `Loader2`, `XCircle`), `quarterLabel()` from
`lib/nifty50.ts`.

**KEY SYMBOLS:** `AgentStatus` (`"idle" | "running" | "done" | "error"`),
`AgentPanelState` (the full UI state shape — per-section `prevStatus`/`currStatus`/
`deltaStatus` maps, evasiveness/stock sub-states, a `phase` enum), `makeInitialAgentState()`
(exported, called by the parent to seed state on `start`), `SECTION_ICONS` (emoji
per section name).

**DATA:** Input: `AgentPanelState` (owned and mutated by the parent, not this
component — `AgentPanel` itself holds no state). Output: none (pure render).

**CONTROL FLOW:** Pure functional render — derives `allThematicDone`/`allDeltaDone`
from `state` on every render (no memoization; cheap enough at 5 sections not to
matter), renders a 3-column grid of section cards (each showing prev-quarter-read /
curr-quarter-read / QoQ-delta status rows, dimmed via `opacity-40` until its
prerequisite is done), then a 2-column bottom bar for the Evasiveness and Market
Data agents, similarly gated on `allDeltaDone` for the stock card. All actual state
transitions happen in the *parent* (`DashboardClient.tsx`'s `handleAnalyze`, which
reduces each NDJSON event into a new `AgentPanelState`) — this file only reads.

**DESIGN:** Fully controlled/presentational component — no local state, no
side effects, `makeInitialAgentState()` as the one piece of "logic" it exports for
its parent's convenience. A hardcoded `grid-cols-3` "so 5 fit cleanly" (the file's
own comment) — the layout is coupled to the current section count, not derived from
`state.sections.length`.

**WHY:** Streaming granular progress (not just a spinner) for a multi-minute
operation is a real UX necessity given the pipeline can take 15-60+ seconds even in
the best case — this component is what makes that wait feel like visible progress
rather than a black box, directly leveraging the NDJSON event stream
`app/api/v1/analyze/route.ts` forwards.

**TRADEOFF:** Fully controlled (state lives in the parent) vs. self-managed (this
component subscribes to the stream itself) — chosen: controlled, keeping this
component trivially testable/storybook-able with a static `AgentPanelState` prop,
at the cost of the parent (`DashboardClient.tsx`) carrying a non-trivial reducer
(the nested `switch` in `handleAnalyze`) that arguably belongs in a `useReducer` or
a dedicated hook rather than inline in a 969-line component.

**FAILURE:** The hardcoded `grid-cols-3` / "so 5 fit cleanly" comment is a silent
trap: if `AGENT_PROMPTS` in `lib/pipeline.ts` ever grows to 6 or shrinks to 4
sections, this file's layout doesn't adapt — nothing breaks, but the grid becomes
visually unbalanced (an odd trailing card, or wasted space) with no compile-time or
runtime signal that the two files have drifted out of sync.

**PRODUCTION:** Derive the grid column count from `state.sections.length`
(e.g. a small lookup or a CSS `auto-fit`/`minmax` grid) so this component and
`lib/pipeline.ts`'s agent count can't silently desync.

**JD:** Real-time UX for long-running AI operations — translating a streaming
backend into a legible, trustworthy live-progress UI, a differentiator skill for
"AI product engineer" roles specifically (not just "can call an LLM API").

**INTERVIEW:**
1. "This component holds no state of its own. What's the tradeoff versus letting
   it own its own subscription to the event stream?"
2. "The grid is hardcoded to 3 columns for 5 sections. What's the smallest change
   that makes this component agent-count-agnostic?"

**TRANSFERABLE SKILL:** Designing a controlled, stateless progress-visualization
component that faithfully reflects a backend streaming protocol without owning any
of the plumbing itself — reusable for any multi-step async operation, not just this
one.

---

### FILE: app/dashboard/DashboardClient.tsx
**ROLE:** The single largest client-side file in the app (969 lines) — the entire
Delta Analysis / Deep Dive dashboard screen: company search, watchlist, transcript
availability/fetching, CSV import, both pipelines' triggering and live-progress
rendering, and PDF export triggering, all in one component.

**SYSTEM POSITION:** The Client Component half of `app/dashboard/page.tsx`'s
Server/Client split (the Server Component does the auth redirect gate; this file
does everything interactive). The most complex single UI surface in the product.

**CALLED BY:** `app/dashboard/page.tsx`.

**CALLS:** `lib/api.ts` (`runAnalysisStream`, `runSoloAnalysisStream`,
`getTranscriptDownloadUrl`), `components/Nav.tsx`, `components/EarningsReport.tsx`,
`components/AgentPanel.tsx` (+ its exported `makeInitialAgentState`/types),
`lib/nifty50.ts`, `lib/nifty200.ts`, `next/navigation`'s `useSearchParams`.

**KEY SYMBOLS:** An inline `CompanySearch` sub-component (fuzzy-filtered ticker
autocomplete with keyboard navigation, defined *inside* this file rather than
extracted); 19 `useState` hooks and 9 `useEffect` hooks covering: company search
query/open/highlighted state, `watchlist` (+ `localStorage` sync under the
`quantalyze_watchlist` key), `userTickers` (server-backed custom tickers),
`available` transcripts map, `ticker`/`csvMsg` (CSV bulk-import), `fetchingTranscripts`/
`coverageMsg` (auto-fetch-on-select), and finally `loading`/`error`/`result`/
`agentState`/`soloResult`/`soloLoading`/`soloPhase` for the two pipelines
themselves; `handleAnalyze()`, `handleSoloAnalyze()`, `handleCsvUpload()`,
`handleTickerChange()`.

**DATA:** Consumes: `DashboardPayload`-shaped `result` (from the delta stream),
`SoloPayload`-shaped `soloResult`. Produces: `runAnalysisStream`/`runSoloAnalysisStream`
POST bodies (`{ticker, q_prev, q_curr, force?}` / `{ticker, quarter, force?}`).

**CONTROL FLOW:** `handleAnalyze(e, force)` prevents default form submission,
resets `error`/`result`/`soloResult`/`agentState`, sets `loading`, then calls
`runAnalysisStream()` with an inline callback that reduces every incoming NDJSON
event into a new `AgentPanelState` via `setAgentState((prev) => ...)` — a hand-rolled
reducer switching on `event.type` (`start` seeds a fresh state with all sections
`running`; `thematic_done` flips the relevant `prevStatus`/`currStatus` cell to
`done` and, once both sides of a section are done, flips that section's
`deltaStatus` to `running` and — once *all* sections are thematically done — advances
`phase` to `"delta"`; `delta_done` similarly cascades to `"finalizing"` once every
section's delta is done; `stock_done` sets the final market-data cell). On stream
completion, `setResult(res.payload)`; on any thrown error, `setError()`; `finally`
clears `loading` and `agentState`. `handleSoloAnalyze()` mirrors this at a coarser
grain (`start`/`extracting`/`analyzing`/`done`/`error` phases only, no per-section
tracking, matching `lib/solo-pipeline.ts`'s thinner progress-event set).

**DESIGN:** A "God component" — every screen concern (search, watchlist, transcript
availability, CSV import, both pipelines' full lifecycle, agent-progress reduction)
lives in one file with `useState`/`useEffect` rather than being decomposed into
custom hooks (`useWatchlist()`, `useAnalysisStream()`, etc.) or a reducer
(`useReducer` for the agent-progress state machine specifically). Per
`TECHNICAL_ARCHITECTURE.md` §8, this is a deliberate, stated choice for the whole
app ("React `useState`/`useEffect` — no external state library"), not an accident —
but the *scale* of concerns concentrated in this one file goes beyond what that
architectural note implies.

**WHY:** For a pre-launch product with one primary screen and no team-scale
ownership-boundary pressure yet, keeping everything co-located is genuinely faster
to build and easier to trace top-to-bottom for a single author — the cost of
decomposition (more files, more prop-drilling or context) isn't yet worth paying.

**TRADEOFF:** One large co-located component vs. decomposed hooks/sub-components —
chosen: co-located, at the cost of testability (there is no way to unit-test the
agent-progress reducer without mounting the whole 969-line component — no test
runner exists in this repo anyway, per every migration doc's Testing section, so
this cost is currently unrealized but would bite immediately if tests were ever
added) and of onboarding cost (a new engineer must read the whole file to safely
change any one concern, since state closures aren't obviously partitioned).

**FAILURE:** The inline agent-progress reducer duplicates logic that's arguably
`AgentPanel`'s concern (or a dedicated hook's) — a bug in the `thematic_done`
handler's "are both sides done, so cascade to `deltaStatus: running`" logic would be
invisible without manually tracing this switch statement, since nothing here is
unit-testable in isolation. More generally, 19 pieces of independently-mutable state
in one component is a well-known source of update-ordering bugs (a `setX` inside an
effect that depends on stale closure state from before another `setY` landed) —
none confirmed here, but the structure is exactly the shape that produces them.

**PRODUCTION:** Extract `useWatchlist()`, `useTranscriptAvailability()`, and a
`useReducer`-based `useAgentProgress()` hook (mirroring the switch-statement logic
already here) as a first decomposition pass — each is independently testable and
independently reviewable, without touching the others. Move `CompanySearch` to its
own file (`components/CompanySearch.tsx`) — it has zero remaining coupling to
`DashboardClient`'s other state once its props are already fully explicit.

**JD:** Building the actual product surface around an AI pipeline — the "full
stack" half of the Oneleet JD; also a clean interview prompt for "how would you
refactor this" system-design-style questions.

**INTERVIEW:**
1. "This file has 19 `useState` hooks. Pick three that could become one
   `useReducer`, and justify the boundary."
2. "Walk through exactly what `AgentPanelState` looks like the instant the last
   thematic agent finishes but before the first delta agent starts."
3. "What's the smallest refactor that would make the agent-progress reducer
   unit-testable without mounting this component?"

**TRANSFERABLE SKILL:** Recognizing when a single component has outgrown
co-location — and having a concrete, incremental extraction plan (hooks first, not
a rewrite) rather than either living with an unmanageable file or over-architecting
a premature framework.

---

## TIER 2 — Should Understand

Grouped by subsystem, with the one-line reason each earns Tier 2 rather than Tier 1:

**The other two pipelines' supporting cast:**
- `lib/insights-pipeline.ts` — multi-quarter synthesis (N+1 Gemini calls: N
  per-quarter briefs + 1 cross-quarter synthesis); same `getGenAI()` duplication and
  schema-driven-JSON pattern as the Tier 1 pipelines, read once and the third one is
  self-explanatory.
- `lib/sector-narrative.ts`, `lib/kpi-extractor.ts` — smaller, single-purpose Gemini
  callers (sector thesis generation, KPI extraction) following the same
  `invokeStructured`-style pattern without the orchestration complexity.
- `app/api/v1/analyze/solo/route.ts`, `app/api/v1/insights/route.ts` — the other two
  pipelines' route handlers, structurally near-identical to
  `app/api/v1/analyze/route.ts` (auth → cache check → credit deduct → stream → save).

**Composition roots and the rest of the repository layer:**
- `lib/repositories/index.ts` — the single file that decides which concrete
  repository class backs every exported singleton; read once, and every other
  repository file's role is implied.
- `lib/postgres/client.ts` — the Azure Postgres connection module (lazy-singleton
  `pg.Pool`, keepalive tuning, one-retry-on-connection-error) — worth reading for
  its concrete, hard-won reliability comments about Azure VNet connection drops.
- `lib/repositories/storage.ts` (`AzureBlobStorageRepository`), `credits.ts`,
  `apiAccess.ts`, `soloAnalysis.ts`, `insights.ts`, `sectors.ts`, `kpis.ts`,
  `calendar.ts`, `concalls.ts`, `promoterActivity.ts`, `watchlist.ts` — each follows
  `lib/repositories/analysis.ts`'s exact pattern (interface + dormant
  `SupabaseXRepository` + active `PostgresXRepository`); understanding one deeply
  (Tier 1) makes the rest legible in minutes each.
- `lib/supabase/admin.ts` — the still-present, still-imported (by the dormant
  Supabase repository classes) lazy-singleton Supabase client.

**Service layer (partially adopted):**
- `lib/services/index.ts`, `lib/services/sectorThesisService.ts`, `lib/services/errors.ts`
  — the Service Layer the architecture spec designed for the whole app, but which in
  practice only the three public-API routes actually use; worth understanding as the
  concrete evidence for the "layered architecture partially realized" finding in the
  tech-debt log.

**Public API surface:**
- `app/api/public/v1/data/companies/[ticker]/route.ts`, `.../sectors/[sector]/route.ts`,
  `.../products/sector-thesis/route.ts` — the three route handlers `middleware.ts`
  guards; each is a thin `repository → service → api-contract` chain.
- `lib/api-contracts/v1/sector.ts`, `sectorThesis.ts` — siblings of the Tier 1
  `company.ts`, same Anti-Corruption pattern applied to two more products.
- `scripts/provision-api-key.ts` — the (manual, non-self-serve) partner-onboarding
  script; explains how a `keyHash` actually gets into the `apiAccess` table in the
  first place.

**External data sourcing:**
- `lib/transcript-fetcher.ts` — Screener.in/BSE scraping for automatic transcript
  acquisition, the unglamorous but essential data-ingestion layer feeding every
  pipeline.
- `lib/promoter-activity-fetcher.ts`, `lib/divergence-score.ts` — the BSE SAST-filing
  scraper and the promoter-pledge scoring logic behind the Divergence/Watchtower
  feature described at length in `PRODUCT_NOTES.md`.

**Frontend supporting cast:**
- `components/EarningsReport.tsx` (780 lines) — the Delta Analysis result renderer
  and `html2canvas`→`jsPDF` export trigger; large but single-purpose (render one
  payload shape), unlike `DashboardClient.tsx`'s many-concerns sprawl.
- `components/Nav.tsx` — session-aware navigation, the other place Auth.js's
  client-side session hook is consumed.
- `lib/api.ts` — the client-side NDJSON stream reader every pipeline-triggering
  component calls into; short, but worth reading once to understand the
  buffer-split-on-newline parsing `TECHNICAL_ARCHITECTURE.md` §6 describes.

**Deploy/infra evidence files (small, but load-bearing for the ADR log):**
- `next.config.mjs` — `output: "standalone"`, `outputFileTracingIncludes` for the
  bundled PDF assets, and the `www.` → apex-domain redirect with its Entra-OAuth-host
  comment.
- `Dockerfile`, `.github/workflows/deploy-azure.yml` — the *actual* live deploy path
  (Azure Container Apps via ACR + Docker), which contradicts the checked-in Azure
  Hosting Migration design doc's "no Dockerfile / containerization" scope — read
  both together, not either alone.
- `supabase/migrations/010_user_credits.sql`, `011_api_access.sql` — the schema
  backing `lib/credits.ts` and the public API's `apiAccess` repository.

---

## TIER 3 — Nice to Understand

- **Static data registries:** `lib/nifty50.ts`, `nifty200.ts`, `nifty500.ts`,
  `listed-companies.ts`, `sub-sectors.ts`, `nifty200-sampler.ts` — large
  hand-maintained/generated lookup tables (ticker → name/sector/NSE symbol); the
  pattern (a big object literal) is obvious on sight, no deep read needed.
- **Build/tooling config:** `tailwind.config.ts`, `postcss.config.js`, `tsconfig.json`,
  `next-env.d.ts`, `package.json`, `package-lock.json`, `vercel.json`,
  `.dockerignore`, `.gitignore` — standard framework config; worth a glance for the
  `notionwealth-frontend` package name (see tech-debt log) but not study.
- **One-off ops scripts:** `scripts/migrate-postgres-data.ts`, `copy-blobs-to-azure.ts`,
  `migrate-schema-to-azure.ts`, `verify-migration.ts`, `_run.sh`,
  `_run-install-pg17-client.sh` — single-use migration tooling, useful as historical
  evidence for the ADR log but not something a new engineer needs to operate.
- **Remaining schema migrations:** `supabase/migrations/002` through `009` — each
  adds one table (`kpi_snapshots`, `sector_intelligence`, `earnings_calendar`,
  `concall_links`, `user_tickers`, `insights_cache`, `promoter_activity`,
  `solo_analysis_cache`) following `001`'s conventions exactly; skim once `001` and
  `010`/`011` are understood.
- **Secondary pages:** `app/login/LoginClient.tsx`, `app/privacy/page.tsx`,
  `app/request/page.tsx` and its client — standard CRUD-adjacent screens, no novel
  architecture.
- **Public assets, types:** `public/*`, `types/*.d.ts` — ambient type declarations
  and static assets, read only if a specific type error sends you there.
- **The archived prototype's leaf files** (`finance-agent/agents/*.py`,
  `finance-agent/tools/*.py`, individual UI screens under `finance-agent/ui/`) —
  useful as ADR-log evidence in aggregate (see `19_ARCHITECTURE_DECISION_LOG.md`
  item 1) but not worth file-by-file study now that the pattern (an ambitious,
  frozen-since-Feb-2026 Python multi-agent platform) is understood from its
  directory structure and `README_ARCHIVE.md`.
