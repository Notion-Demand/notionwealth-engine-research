# Quantalyze → Oneleet Full-Stack AI Product Engineer JD Mapping

**Method note:** every claim is backed by an exact file path. Where the repo shows nothing, it says "None found" — this JD is squarely in Quantalyze's actual wheelhouse (consumer-facing AI product engineering), so most ratings here are genuinely stronger than in the Azure mapping, which makes the honest gaps more important to call out precisely rather than paper over.

---

## Responsibilities

### Integrate AI service endpoints into the platform

**Evidence:** Five independent Gemini integration points: `lib/pipeline.ts`, `lib/solo-pipeline.ts`, `lib/insights-pipeline.ts`, `lib/sector-narrative.ts`, `lib/kpi-extractor.ts`. Each wraps `@google/generative-ai`'s `GoogleGenerativeAI.getGenerativeModel()` with a JSON schema (`responseSchema`), a hard timeout via `Promise.race`, and structured error propagation.

**Files:** `lib/pipeline.ts:183-212`, `lib/solo-pipeline.ts:39-183`, `lib/insights-pipeline.ts:75-98`.

**Strength: Strong.**

---

### Handle auth/error states/response processing for AI calls

**Evidence:** Per-agent try/catch returning `null` on failure, filtered out downstream rather than crashing the whole pipeline — `lib/pipeline.ts:451-473` (`return null` in catch), then `lib/pipeline.ts:809-813` (`.filter((s): s is QuarterSnapshot => s !== null)`). Route-level auth check before any AI call: `app/api/v1/analyze/route.ts:13-14` (`getCurrentUser()`, 401 if absent). Pipeline-level timeout sends a distinct error event to the client before Vercel/the container would silently kill the request: `TECHNICAL_ARCHITECTURE.md` §10 ("Vercel kills functions silently at maxDuration — no error event sent to client... 270s timeout fires 30s before... sends proper error event").

**Files:** `lib/pipeline.ts`, `app/api/v1/analyze/route.ts:1-100`, `lib/services/errors.ts` (typed domain errors: `NotFoundError`, `UnauthorizedError`, `EntitlementError`, `QuotaExceededError`, each with an HTTP status attached).

**Strength: Strong.**

---

### Design context-gathering systems pulling relevant data across the platform

**Evidence:** `lib/nifty200-sampler.ts` — `sampleNifty200Signals()` pulls up to 6 additional companies' cached analyses from `analysis_results` (beyond the sector's primary tickers) and appends them to the sector-narrative prompt as extended context, explicitly to give the LLM broader signal coverage without polluting the primary quantitative scoring (`PRODUCT_NOTES.md`, 2026-05-27 entry). `lib/insights-pipeline.ts` gathers up to 8 quarters of transcripts per ticker and concatenates per-quarter briefs before a cross-quarter synthesis call. `lib/divergence-score.ts` cross-references two unrelated data sources (BSE promoter-pledge filings + cached concall sentiment) into one signal.

**Files:** `lib/nifty200-sampler.ts`, `lib/insights-pipeline.ts:194-212` (per `TECHNICAL_ARCHITECTURE.md` §4c), `lib/divergence-score.ts`.

**Strength: Strong** — this is a real, non-trivial pattern (cross-source context assembly feeding a single LLM call), directly relevant to what this responsibility is testing for.

---

### Build intuitive React/JS UI for AI-generated insights

**Evidence:** `components/EarningsReport.tsx` (780 lines) renders the delta-analysis payload — signal badges, metric cards, quote expanders — driven by the `ui_component_type` field the LLM itself outputs (`lib/pipeline.ts`'s `METRIC_DELTA_SCHEMA` includes `ui_component_type: "metric_card" | "status_warning" | "quote_expander"` as an enum the model must choose, letting the AI's structured output directly drive which UI component renders each insight). `components/AgentPanel.tsx` (215 lines) shows live per-agent progress during the ~20-call pipeline run, consuming the NDJSON stream events in real time.

**Files:** `components/EarningsReport.tsx`, `components/AgentPanel.tsx`, `lib/pipeline.ts` (schema definitions of `ui_component_type`).

**Assessment:** No component library beyond hand-rolled Tailwind (no shadcn/ui, no Radix, no Headless UI in `package.json`). All UI is bespoke JSX + Tailwind utility classes. This is real, functioning, and by the product notes reasonably polished (color-coded narrative cards, collapsible sections, TradingView-style watchlist cycling — `PRODUCT_NOTES.md` 2026-05-27 entries) but is not evidence of using/customizing a design system, which some interviewers will specifically probe for.

**Strength: Strong** on building UI for AI output specifically (the `ui_component_type`-driven rendering is a genuinely clever, gradeable pattern); **Moderate** on general component-library/design-system fluency.

---

### Map AI service responses to actionable UI elements

**Evidence:** Same `ui_component_type` enum as above — this is literally what this responsibility describes, and Quantalyze has it built directly into the AI response schema rather than inferred client-side. Also: `lib/api-contracts/v1/company.ts` — a dedicated wire-contract layer (`toCompanyResponseV1()`) that maps the internal `Analysis` domain entity to a versioned public API shape, decoupling internal pipeline output from what's exposed externally.

**Files:** `lib/pipeline.ts` (`METRIC_DELTA_SCHEMA`), `components/EarningsReport.tsx`, `lib/api-contracts/v1/company.ts`, `lib/api-contracts/v1/sector.ts`, `lib/api-contracts/v1/sectorThesis.ts`.

**Strength: Strong.**

---

### Ensure complex outputs are presented clearly and drive user action

**Evidence:** `PRODUCT_NOTES.md` (2026-05-26, Screener v2 entry) — the "Dual Strength Bar" pattern (raw score rendered behind, confidence-adjusted score rendered in front, in the same bar) specifically designed so "the gap between them is immediately visible — a wide gap signals a narrative trap," a direct design response to a real failure case (HCLTech's misleading top ranking). `PRODUCT_NOTES.md` (2026-05-27, Sector Narrative entry) — color-coded quadrant layout ("PMs scan, they don't read... Color-coded grids allow eyes to jump directly to the relevant quadrant") chosen explicitly over a prose block.

**Files:** `PRODUCT_NOTES.md`, `app/screener/ScreenerClient.tsx`, `app/sectors/SectorsClient.tsx`.

**Strength: Strong** — this is well-reasoned UX design driven by a documented real failure case, not generic "make it look nice."

---

### Robust error handling and fallback behaviors

**Evidence:** `components/EarningsReport.tsx:115-123` — `PromoterActivityBadge` self-fetches and **fails closed** (`.catch(() => {})`), rendering nothing on error rather than breaking the dashboard, explicitly documented in `PRODUCT_NOTES.md` (2026-06-15): "Fails closed (renders nothing) on API error, so the dashboard never breaks — even before migration 008 is applied." Pipeline-level: individual agent failures return `null` and are filtered, not thrown (`lib/pipeline.ts`). Cache-write failures are non-blocking: `PRODUCT_NOTES.md` (2026-05-27, Insights caching entry) — "Result written to cache non-blocking (errors are warned, not thrown — never fails the user response)."

**Files:** `components/EarningsReport.tsx`, `lib/pipeline.ts`, `PRODUCT_NOTES.md`.

**Strength: Strong** — this is a consistent, repeated *pattern* across the codebase (fail-closed, filter-nulls, non-blocking side-effects), not a one-off.

---

### Feedback loops capturing user interaction with AI features

**Checked specifically, as instructed.** `grep -rln "track(\|analytics\.\|logEvent\|gtag(" app lib components` returns **zero matches**. No analytics SDK (`posthog`, `mixpanel`, `amplitude`, `@vercel/analytics`) appears in `package.json`. `app/privacy/page.tsx` states outright: "We do not use third-party analytics trackers." The only usage-adjacent tracking in the whole app is `lib/credits.ts` (deducts credits per AI action for billing) and `middleware.ts`'s structured request logging (`requestId`, latency, status — for the *partner API* only, not consumer-facing AI-feature usage). Neither tracks *how users interact with* an AI result — no click tracking on insights, no "was this useful" signal, no re-run-rate tracking, no export-click logging.

**Files checked:** `app/`, `lib/`, `components/` (full grep, zero hits); `package.json` (no analytics deps); `app/privacy/page.tsx:73` ("We do not use third-party analytics trackers").

**Strength: None.** This is a real, clean gap — worth stating plainly rather than stretching the credit-deduction system (which tracks *spend*, not *engagement with the AI output itself*) into something it isn't.

---

### Work directly with customers to understand AI feature usage

**Evidence:** `PRODUCT_NOTES.md` "Go-to-Market" section references real calls with PMS heads shaping feature decisions. **This cannot be verified from the repository** — it is a claim about the person's process, corroborated in spirit by the product notes but not provable from code. Treat as a resume/behavioral talking point, not a code-evidenced capability.

**Strength: N/A (resume/behavioral claim, not code-evidenced).**

---

### Optimize API calls to AI services for performance

**Evidence:** Heavy parallelization — `lib/pipeline.ts`'s Delta Analysis runs "11 (thematic) + 1 (evasiveness) + 5 (delta) + 3 (synthesis) = ~20 calls," with independent calls fanned out via `Promise.all`/`Promise.race` per phase rather than sequential (`TECHNICAL_ARCHITECTURE.md` §4a — "Phase 2 ... 10 parallel Gemini calls"). Deliberate model/scope tradeoffs: `lib/sector-narrative.ts` uses a 22s timeout specifically because "Flash Pro would push this to ~15s and risk timeouts" (`PRODUCT_NOTES.md`, 2026-05-27). Deep Dive collapses to a single comprehensive call instead of the 5-agent decomposition specifically to stay within a tighter 120s function budget (`TECHNICAL_ARCHITECTURE.md` §4b).

**Files:** `lib/pipeline.ts`, `lib/solo-pipeline.ts`, `lib/sector-narrative.ts`, `TECHNICAL_ARCHITECTURE.md` §4, §9.

**Strength: Strong** on latency/parallelism optimization and cost-aware model/scope choices; **no evidence** of lower-level API optimization (no request batching beyond what the Gemini SDK does natively, no connection pooling for the Gemini client specifically — `getGenAI()` is called fresh per pipeline invocation in each file rather than reused as a singleton, which is itself a minor missed optimization worth naming honestly).

---

### Caching while maintaining data freshness

**Checked thoroughly, as instructed.** `TECHNICAL_ARCHITECTURE.md` §7 lists 7 distinct caches, each with a *different*, deliberately-chosen freshness policy — this is the strongest, most precise evidence of real caching maturity in the repo:

| Cache | Table | TTL | Invalidation mechanism |
|---|---|---|---|
| Delta Analysis | `analysis_results` | **Permanent** | Manual "Clear cache & re-analyze" button only |
| Deep Dive | `solo_analysis_cache` | **Permanent** | Manual re-analyse only |
| Multi-Quarter Insights | `insights_cache` | **30 days**, app-enforced | **Also** auto-invalidates on new data: cache key is `(ticker, sorted-quarters-list)`, so a newly-uploaded transcript changes the key itself, not just a timestamp check — `PRODUCT_NOTES.md` (2026-05-27): "adding a new transcript automatically invalidates the cache — the key changes when a new quarter appears in storage" |
| YouTube Videos | `concall_links` | **Permanent** | Explicit `?retry=true` param bypass only |
| Promoter Pledge Data | `promoter_activity` | **24h fetch-log TTL** | Per-ticker, even for zero-event tickers |
| Earnings Calendar | `earnings_calendar` | **Permanent** | Manual "Refresh" button |
| Storage blob listing | (in-memory) | **60s** | `lib/repositories/storage.ts` — `LIST_CACHE_TTL_MS = 60_000`, added specifically to fix "~200 parallel per-ticker searches on one page load" hammering Azure Blob's non-searchable list API |

**Honest assessment of freshness strategy:** Most caches are **permanent-until-manual-refresh**, which is a defensible choice for this domain (an earnings-call transcript's content never changes after the call happens — the AI's extraction of it is deterministic-enough at temperature 0 that re-running adds cost with no freshness benefit) but is **not** a sophisticated freshness strategy in the general sense (no stale-while-revalidate, no background refresh, no ETags/conditional requests). The one genuinely clever invalidation mechanism is the Insights cache's data-derived key (new data changes the key, not a timer) — that's worth citing specifically as the strongest single example. The Storage list cache is a straightforward fixed-TTL cache addressing a real, measured performance problem.

**Files:** `TECHNICAL_ARCHITECTURE.md` §7, `lib/repositories/storage.ts`, `PRODUCT_NOTES.md` (2026-05-27 entries).

**Strength: Strong** on breadth and deliberateness of caching strategy across 7 distinct caches with 3 different invalidation *mechanisms* (manual, key-derived, TTL); **Moderate** on freshness sophistication specifically (mostly permanent-cache-until-manual-clear, which is domain-appropriate but not a generalizable "cache freshness" skill demonstration beyond this specific data-immutability assumption).

---

### Build monitoring/analytics for AI feature usage, success rates, user engagement

**Checked thoroughly, as instructed.** Same finding as "feedback loops" above: `grep -rli "sentry\|datadog\|posthog\|mixpanel\|amplitude\|logrocket\|opentelemetry\|application insights"` across `package.json`, `app/`, `lib/` returns **zero matches** in the live app. `console.log`/`console.error` is the only logging mechanism (`lib/pipeline.ts`, `middleware.ts`, `lib/postgres/client.ts`). `middleware.ts:80-97` does structured JSON request logging, but only for the partner-facing public API — not for consumer-facing AI feature usage, success/failure rates, or engagement.

One partial exception: `docs/superpowers/specs/2026-07-10-azure-hosting-migration-design.md` §Observability specifies adding **Application Insights** for "exceptions, response times, failed requests, availability" during the Azure hosting migration — but this is Azure App Service's auto-instrumentation (configured via a connection string in Application Settings, no SDK/code required per the spec), so its presence **cannot be confirmed from the source tree** — no `APPINSIGHTS_CONNECTION_STRING` appears in `.env.local.example`, and no Application Insights SDK appears in `package.json`. Even if enabled, the same spec explicitly scopes it to request-level telemetry only: "custom business metrics (e.g. instrumenting the analysis pipeline's own stages) are future work, not built here."

**Files checked:** `package.json` (no monitoring deps), `app/`, `lib/`, `components/` (grep, zero hits), `.env.local.example` (no App Insights connection string), `docs/superpowers/specs/2026-07-10-azure-hosting-migration-design.md` §Observability.

**Strength: None to Weak.** Be direct about this in interview — it's a real, checkable gap, and claiming otherwise is easily disproven by asking "show me your AI feature's success-rate dashboard."

---

### Collaborate with AI teams to improve underlying services

**N/A** — Quantalyze is solo-built (per the case-study context and the absence of any multi-author signal in the codebase's design-decision documents, which are written in first-person singular judgment throughout `PRODUCT_NOTES.md`). There is no "AI team" to have collaborated with. State this honestly rather than inventing a team narrative — the adjacent, honest framing is "I *was* the AI team," which is a legitimate (if different) form of ownership to describe in interview.

**Strength: N/A.**

---

### Reusable patterns/components for AI integration

**Checked precisely, as instructed — this is a real, gradeable engineering signal.** There is **no shared `callGemini(schema, prompt)` helper**. Each of the five pipeline files independently defines its own `getGenAI()` function and its own `Promise.race`-based timeout wrapper:

```
lib/pipeline.ts:183       function getGenAI(): GoogleGenerativeAI { ... }
lib/solo-pipeline.ts:39   function getGenAI(): GoogleGenerativeAI { ... }
lib/insights-pipeline.ts:75  function getGenAI(): GoogleGenerativeAI { ... }
lib/sector-narrative.ts:118  const genAI = new GoogleGenerativeAI(apiKey);  (inline, not even factored into a function)
lib/kpi-extractor.ts:368     const genAI = new GoogleGenerativeAI(apiKey);  (inline)
```

And the `Promise.race([model.generateContent(...), timeout])` pattern is independently re-written in all four pipeline files (`lib/pipeline.ts:212`, `lib/solo-pipeline.ts:183`, `lib/insights-pipeline.ts:98`, `lib/sector-narrative.ts:182`) rather than factored into one shared timeout-wrapped call function. No `lib/gemini.ts` or equivalent shared client module exists (confirmed via `find lib -iname "*gemini*"` — no results).

**What *is* shared and reused well:** the JSON-schema-typed structured-output *contract* (every pipeline uses `SchemaType.OBJECT`/`SchemaType.ARRAY`/`SchemaType.STRING` from the same `@google/generative-ai` import consistently), and the repository pattern (`lib/repositories/index.ts`) that every pipeline calls into for caching (`analysisRepo`, `soloAnalysisRepo`, `insightsRepo`) — so caching and persistence *are* properly abstracted and reused, even though the AI call itself is not.

**Assessment:** This is a genuine, honest finding — not a fatal flaw (each pipeline has different enough timeout/model/prompt needs that some duplication is defensible), but it is real duplication that a `lib/gemini.ts` with a shared `callGeminiJson<T>(schema, prompt, { timeoutMs, temperature })` helper would have eliminated. This is exactly the kind of finding a good staff engineer flags in code review, and Oneleet's JD explicitly asks about this pattern — expect to be asked, and the honest answer ("no, I didn't extract that, here's why and here's what I'd change") is a better interview answer than claiming a pattern that isn't there.

**Files:** `lib/pipeline.ts`, `lib/solo-pipeline.ts`, `lib/insights-pipeline.ts`, `lib/sector-narrative.ts`, `lib/kpi-extractor.ts`.

**Strength: Weak** on the specific "reusable AI-call helper" pattern (duplicated, not extracted); **Moderate-to-Strong** on the surrounding reusable patterns (schema-typing convention, repository/caching abstraction) that *do* generalize well.

**Likely interview question:** "I see five files each instantiate their own Gemini client and timeout wrapper — why didn't you extract that into one shared helper?" (Be ready with a real answer — likely candidates: it grew organically pipeline-by-pipeline and was never revisited; or each pipeline's timeout/retry needs diverged enough that a shared abstraction felt premature. Either honest answer is fine — inventing a shared module that doesn't exist is not.)

---

### AI features integrating smoothly with existing workflows

**Evidence:** The AI-generated `ui_component_type` field drives rendering directly into the existing dashboard/report components rather than requiring a separate "AI results" surface; the Screener's confidence-multiplier system integrates AI-derived scores into an existing ranking table rather than a bolt-on panel; the Insights cache's auto-invalidation-on-new-transcript means the AI pipeline re-runs itself into the existing UI flow without a manual "refresh AI results" step in the common case.

**Files:** `components/EarningsReport.tsx`, `app/screener/ScreenerClient.tsx`, `PRODUCT_NOTES.md`.

**Strength: Strong.**

---

## Skills List

| Skill | Rating | Evidence |
|---|---|---|
| 5+ years full-stack | N/A | Resume claim, not evidenceable from repo. |
| Go | **None** | No `.go` files anywhere in the repo (confirmed via `find`). |
| JavaScript | **Strong** | Entire live app is TypeScript/React (`app/`, `lib/`, `components/`); 969-line `DashboardClient.tsx`, 926-line `InsightsClient.tsx` show sustained, non-trivial frontend engineering. |
| Production APIs / REST | **Strong** | `app/api/v1/*` (23 route handlers) and a versioned, partner-facing public API (`app/api/public/v1/*`, `middleware.ts` gating it) — genuinely live and deployed. |
| gRPC | **None** | No `.proto` files, no gRPC library anywhere (confirmed via grep). |
| Third-party service integration | **Strong** | Supabase (legacy), Azure (Postgres, Blob, Entra ID), Google Gemini, Yahoo Finance (`lib/pipeline.ts` stock-price fetch), BSE API, NSE API, Screener.in (`lib/transcript-fetcher.ts`), YouTube Data API v3 (`app/api/v1/concall/route.ts`) — a genuinely wide, real integration surface. |
| Data transformation and mapping | **Strong** | `lib/api-contracts/v1/*` — dedicated internal-entity-to-wire-contract mapping layer (`toCompanyResponseV1`, etc.); every repository hand-writes snake_case↔camelCase mapping (`toEntity`/`fromEntity` per `docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md`). |
| Asynchronous programming | **Strong** | `Promise.all`/`Promise.race` used extensively and correctly for fan-out+timeout across every pipeline (`lib/pipeline.ts` phases 1-4), plus NDJSON `ReadableStream` async iteration on both server (`app/api/v1/analyze/route.ts`) and client (`lib/api.ts`'s `reader.read()` loop). |
| API optimization | **Moderate** | Real: parallelization, caching (7 distinct caches), model/timeout tuning by endpoint. Not evidenced: request batching, connection reuse for the Gemini client specifically (`getGenAI()` re-instantiated per call rather than a reused singleton — a real, small, statable gap), CDN/edge caching. |
| Requirements gathering | N/A | Resume/behavioral claim. |
| Debugging across full stack | Not code-evidenceable | The *outcomes* of debugging are visible and real (documented production bugs and fixes in `lib/postgres/client.ts` comments, `auth.ts` comments, `PRODUCT_NOTES.md`'s "Fix:" entries) — but debugging itself is a live-demonstrable interview skill, not something static code proves. Frame it as: "here are three documented production bugs I found and fixed" (the fetch-cache staleness bug, the Entra `oid`/`sub` bug, the pg-pool TCP-idle-reaping bug) rather than a repo-provable rating. |
| Production monitoring/logging/observability | **Weak** | `console.log`/`console.error` only in the live app; structured JSON logging exists but only for the partner API (`middleware.ts`); no APM/error-tracking SDK confirmed wired in (see "monitoring/analytics" above). |
| Communication/customer-facing work | N/A | Resume/behavioral claim; `PRODUCT_NOTES.md`'s GTM section corroborates in spirit but isn't code-evidenceable. |
| Balancing technical excellence with shipping | **Strong** | It shipped and is live (`README.md` — live URL, real GitHub Actions deploy pipeline). The `finance-agent` → Next.js architectural pivot itself is direct, concrete evidence of choosing shipping velocity over an already-substantial prior investment: a multi-agent/RAG/Vertex AI/MCP-server architecture (`README_ARCHIVE.md`) was set aside in favor of a simpler, more shippable Next.js/Gemini/Supabase stack — a real, costly, and honest engineering judgment call, not a hypothetical one. |

---

## Bonus Skills

| Skill | Rating | Evidence |
|---|---|---|
| AI/ML into production | **Strong** | Five live, structured-output Gemini pipelines serving a real product, per the entire analysis above. |
| Cybersecurity/security tools | **None** | No dedicated security tooling (SAST, dependency scanning, WAF) found; see "Security" in the Azure mapping for the adjacent infra-security evidence that does exist (RLS, hashed API keys, private VNet) — real, but not "security tools" in the tooling sense this line item likely means. |
| Real-time data | **Partial** | NDJSON streaming (`app/api/v1/analyze/route.ts`, `lib/api.ts`) gives live progress updates during a multi-minute AI pipeline run — genuinely real-time from the user's perspective, but it is one-directional (server→client) HTTP streaming, not bidirectional real-time data. |
| WebSockets | **None — verified precisely.** `grep -rn "WebSocket\|socket.io\|ws://" app lib components` returns **zero matches**. `TECHNICAL_ARCHITECTURE.md` §10 states the NDJSON-over-fetch choice explicitly *instead of* WebSockets, with reasoning: "Zero infrastructure overhead — works over standard HTTP... Compatible with Vercel serverless (no persistent connections needed)." **This distinction matters and should be stated precisely in interview: NDJSON-over-`ReadableStream` is one-shot HTTP response streaming (the connection closes when the response ends), not a persistent bidirectional WebSocket connection.** Do not describe this as "I've built real-time WebSocket features" — that would be a specific, checkable overclaim. |
| Data visualization | **None found.** `grep -i "chart\|recharts\|d3\|visx\|plotly\|victory" package.json` returns zero matches — no charting library is a dependency anywhere. What exists instead are hand-built Tailwind `<div>`-based bar visualizations (e.g. the Screener's "Dual Strength Bar," `PRODUCT_NOTES.md` 2026-05-26) — simple width-percentage divs, not an actual chart library rendering axes, scales, tooltips, or multi-series data. This is a real, honest gap: if this JD role involves building genuine data-visualization surfaces (time series, multi-metric charts), Quantalyze has no evidence of that specific skill, only CSS-bar-as-metaphor UI. |

---

## Summary Assessment

Quantalyze is a strong evidentiary match for the *core* of this JD — integrating an AI service into a real product, designing schemas that drive UI directly, fail-closed error handling, and a deliberate multi-cache strategy — because this is, functionally, exactly the kind of product Quantalyze *is*. The honest gaps are specific and worth naming precisely rather than glossing: **no feedback-loop/usage-analytics instrumentation on AI features at all** (a real, checkable, currently-true gap), **no shared reusable AI-call abstraction** despite five near-identical call sites (duplication, not a pattern), **no production monitoring/observability SDK** beyond `console.log`, **no data visualization library**, and **no WebSockets** (NDJSON is a different, real, defensible choice — but a different thing). None of these are disqualifying for a role that's fundamentally about *building* AI product surfaces well — which this repo demonstrates repeatedly and specifically — but all four are easy, specific things an interviewer can ask about, and the honest answer to each is more credible than a stretched one.
