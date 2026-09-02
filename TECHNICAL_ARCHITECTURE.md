# Quantalyze — Technical Architecture

Complete system design, API topology, database schema, AI pipeline architecture, and engineering decisions — reflecting the **live, Azure-native** system as of this update. Earlier versions of this document described a Supabase + Vercel stack; that stack has since been fully migrated away from (see §0 and §10). For a deeper, code-cited audit of everything in this document (including known gaps this doc doesn't sugar-coat but also doesn't dwell on), see `discussions/` — start with `discussions/QUANTALYZE_ENGINEERING_MASTER_MAP.md`.

---

## 0. What changed since the last version of this document

| | Was (Supabase/Vercel era) | Is now |
|---|---|---|
| Auth | Supabase Auth (JWT, email/password + Google OAuth) | NextAuth (Auth.js v5) + Microsoft Entra External ID, JWT session strategy (`auth.ts`) |
| Database | Supabase PostgreSQL, accessed via `supabaseAdmin()` | Azure Database for PostgreSQL (Flexible Server, private VNet), raw `pg.Pool` (`lib/postgres/client.ts`) |
| Object storage | Supabase Storage | Azure Blob Storage (`lib/repositories/storage.ts` → `AzureBlobStorageRepository`) |
| Hosting | Vercel (serverless functions, 300s max duration) | Azure Container Apps (Docker, `Dockerfile` + `.github/workflows/deploy-azure.yml`) — this itself was a second hop; the hosting migration was originally executed to Azure App Service (`docs/superpowers/plans/2026-07-10-azure-hosting-migration.md`), then moved again to Container Apps without a corresponding design doc |
| Row-level security | Enforced via Supabase's `auth.uid()` | **Not enforced at the database level.** The RLS statements still exist in `supabase/migrations/001_initial.sql`/`006_user_tickers.sql`/`010_user_credits.sql`, but `scripts/migrate-schema-to-azure.ts` strips every `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY` statement before applying them to Azure Postgres, since plain Postgres has no `auth.uid()`. Per-user data isolation today is 100% hand-written `WHERE user_id = $1` clauses in each repository method — real, but with no database-level backstop if one is ever missed. |

Every repository file (`lib/repositories/*.ts`) still contains an unused `Supabase*Repository` class next to the live `Postgres*Repository`/`AzureBlobStorageRepository` one — `lib/repositories/index.ts` is the ground truth for which class is actually wired up (all Postgres/Azure). These are dead code from the migration, not a second live path.

The migration itself is a genuinely well-documented, disciplined piece of engineering: three dated plan+spec document pairs in `docs/superpowers/` (hosting → Azure App Service, Jul 10 2026; data+storage → Azure Postgres/Blob, Jul 10 2026; auth → Entra ID, Jul 13 2026), each following a "Strangler Fig" approach — old and new paths coexist behind a flag or parallel class during a safety window, with an explicit rollback plan and a documented deletion date for the old path. The one exception is the later App Service → Container Apps jump, which has no equivalent design document — see `discussions/14_DEVOPS_CLOUD.md` §7 for the full account.

---

## 1. System Overview

| Layer | Technology | Detail |
|-------|-----------|--------|
| Frontend | Next.js 14 (App Router) | Server Components handle only auth-gating/redirect; all real data-fetching happens client-side in paired `*Client.tsx` components |
| Styling | Tailwind CSS | Custom `brand-*` color palette |
| AI Model | Gemini 2.5 Flash Lite, via `@google/generative-ai` | Direct Gemini Developer API (API key), **not** Vertex AI — no `google-cloud-aiplatform`/`vertexai` import anywhere in the live app |
| Auth | NextAuth (Auth.js v5) + Microsoft Entra External ID | JWT session strategy; `account.providerAccountId`/OIDC `sub` is a non-UUID pairwise identifier for Entra External ID, so the Entra `oid` claim is used instead to match existing UUID `user_id` columns (`auth.ts`) |
| Database | Azure Database for PostgreSQL (Flexible Server) | Private VNet-only networking; 16 tables, JSONB payloads for AI output; RLS *declared* in SQL history but *not enforced* at runtime (see §0) |
| Object Storage | Azure Blob Storage | `transcripts` container, PDF files |
| Deployment | Azure Container Apps | Docker multi-stage build, Consumption plan, GitHub Actions CI/CD via OIDC federated identity (no stored Azure credentials) |
| Streaming | NDJSON over `ReadableStream` | Real-time pipeline progress, genuinely incremental (verified byte-for-byte — see `discussions/09_FRONTEND_ARCHITECTURE.md`) |
| PDF Export | jsPDF (+ html2canvas for the Delta report) | Client-side, two independent code paths (not unified into one shared utility) |
| PDF Parsing | pdf-parse | Server-side transcript extraction |
| Public API | `app/api/public/v1/**` | API-key-authenticated, per-key product entitlements + daily quota, metered via `api_usage` |

---

## 2. Database Schema (16 Tables)

### Core Tables

| Table | Migration | Key | Purpose | RLS in SQL history | Enforced in production? |
|-------|-----------|-----|---------|---------------------|--------------------------|
| `analysis_results` | 001 | `(company_ticker, q_prev, q_curr)` — **no DB unique constraint on this key** | Delta analysis cache | Yes (`auth.uid() = user_id`) | **No** — stripped by `scripts/migrate-schema-to-azure.ts` |
| `user_connections` | 001 | `(user_id, provider)` | Legacy OAuth connections (unused) | Yes | **No** |
| `kpi_snapshots` | 002 | `UNIQUE(company_ticker, quarter)` | KPI extractions | No | — |
| `sector_intelligence` | 003 | `UNIQUE(sector, quarter)` | Sector narrative + scores | No | — |
| `earnings_calendar` | 004 | `UNIQUE(ticker, quarter)` | Board meeting dates | No | — |
| `concall_links` | 005 | `UNIQUE(ticker, quarter)` | YouTube video ID cache | No | — |
| `user_tickers` | 006 | `UNIQUE(user_id, ticker)` | Per-user custom stocks | Yes | **No** |
| `insights_cache` | 007 | `UNIQUE(ticker, quarters_key)` | Multi-quarter insights cache, 30-day app-enforced TTL | No | — |
| `promoter_activity` | 008 | `UNIQUE(ticker, news_id)` | BSE pledge/SAST filings | No | — |
| `promoter_activity_fetch_log` | 008 | PK `ticker` | Per-ticker 24h refetch cooldown tracking | No | — |
| `solo_analysis_cache` | 009 | `(ticker, quarter)` — **no DB unique constraint on this key** | Deep Dive cache | No | — |
| `user_credits` | 010 | `UNIQUE(user_id, month)` | Monthly credit metering for AI-triggering actions | Comment says "no RLS — managed by backend" despite a `user_id` FK to `auth.users` | — |
| `api_partners` | 011 | PK `id` | Public API partner accounts | No | — |
| `api_keys` | 011 | PK `id`, `key_hash` unique | Hashed API keys, per-key `daily_quota`, active flag | No | — |
| `api_key_products` | 011 | `(key_id, product_name)` | Per-key product entitlements | No | — |
| `api_usage` | 011 | `(key_id, window_start)` | Daily request counters for the public API | No | — |

`analysis_results` and `solo_analysis_cache` have no unique constraint on their natural cache key — de-duplication relies entirely on the application performing a `DELETE` then a separate `INSERT` (not wrapped in a transaction), which is a real, if narrow, race window under concurrent requests for the same (ticker, quarter[s]). Tables with a genuine `UNIQUE` constraint (`kpi_snapshots`, `sector_intelligence`, `concall_links`, `insights_cache`, `promoter_activity`, `user_credits`, `earnings_calendar`) use real, atomic `ON CONFLICT ... DO UPDATE` upserts instead. See `discussions/07_DATA_ARCHITECTURE.md` for the full concurrency analysis.

### Storage

| Container | Content | Access |
|-----------|---------|--------|
| `transcripts` (Azure Blob) | Earnings call PDFs (`TICKER_Q#_YYYY.pdf`) | App-level only, via `AzureBlobStorageRepository` |

---

## 3. Per-Screen API Topology

### Dashboard (`/dashboard` → `DashboardClient.tsx`)

| Action | Endpoint | Method | Tables | External API | Streaming | Auth required? |
|--------|----------|--------|--------|-------------|-----------|-----------------|
| Load available transcripts | `/api/v1/available` | GET | Blob Storage list | — | No | No |
| Auto-fetch transcripts | `/api/v1/request` | POST | Blob Storage (upload) | Screener.in, BSE API | No | No |
| Delta Analysis | `/api/v1/analyze` | POST | `analysis_results`, Blob | Gemini (~19-20 calls), Yahoo Finance | NDJSON | Yes |
| Deep Dive Analysis | `/api/v1/analyze/solo` | POST | `solo_analysis_cache`, Blob | Gemini (1 call) | NDJSON | Yes |
| Promoter Pledge Badge | `/api/v1/divergence` | GET | `promoter_activity`, `insights_cache` | BSE API | No | No |
| Analysis History | `/api/v1/analyze/history` | GET | `analysis_results` | — | No | Yes |
| Transcript Download | `/api/v1/transcript/download` | GET | Blob Storage | — | No | No |
| User Tickers | `/api/v1/user-tickers` | GET/POST | `user_tickers` | — | No | Yes |

### Multi-Quarter Insights (`/insights` → `InsightsClient.tsx`)

| Action | Endpoint | Method | Tables | External API | Streaming |
|--------|----------|--------|--------|-------------|-----------|
| Run Insights | `/api/v1/insights` | POST | `insights_cache`, Blob | Gemini (N+1 calls: N per-quarter + 1 synthesis) | NDJSON (note: lacks the `closed`-flag guard and pre-Vercel-kill timeout margin that `/api/v1/analyze` has — see `discussions/04_RUNTIME_FLOWS.md`) |

### Screener, Sectors, Calendar, Videos

Unchanged in shape from the original design — see the route tables in `discussions/04_RUNTIME_FLOWS.md` for the fully verified, current version, including which of these are unauthenticated (most are — only routes that touch a specific user's data require a session).

### Public API (`/api/public/v1/**`)

| Route | Auth | Purpose |
|-------|------|---------|
| `/api/public/v1/data/companies/[ticker]` | API key (`middleware.ts`) | Company data by ticker, gated by key's product entitlements |
| `/api/public/v1/data/sectors/[sector]` | API key | Sector data |
| `/api/public/v1/products/sector-thesis` | API key | Sector thesis product |

Auth for this surface is enforced centrally in `middleware.ts` (matcher scoped to `/api/public/*`), unlike the internal `/api/v1/**` surface where auth is opt-in per route — see §5.

---

## 4. AI Pipeline Architecture

No provider abstraction exists — every pipeline file imports `GoogleGenerativeAI` directly and constructs its own model object; there is no shared `LLMProvider` interface, and each file re-implements its own timeout-wrapper and JSON-schema-building helper independently (a real duplication, not a stylistic choice — see `discussions/16_ONELEET_JD_MAPPING.md`).

### 4a. Delta Analysis Pipeline (`lib/pipeline.ts`)

**Trigger**: `POST /api/v1/analyze` → `runPipeline()`

**Model**: `gemini-2.5-flash-lite`, temperature `0`, structured JSON output (`responseSchema` + `responseMimeType: "application/json"`)

**Agent timeout**: 25s per call (`Promise.race`, does **not** cancel the underlying Gemini request — no `AbortController` is used anywhere against the Gemini SDK) | **Pipeline timeout**: 270s, races the whole `runPipeline()` call against the route's declared `maxDuration = 300` | **No retries on any call.**

> Note: `export const maxDuration = 300` in `app/api/v1/analyze/route.ts` is a Vercel-specific directive, inherited from the pre-migration codebase. It has no effect on Azure Container Apps, which has no equivalent hard per-request timeout — the 270s pipeline-internal timeout is now the only thing actually bounding a run's duration.

**Phases (sequential)**:

```
Phase 1 — PDF Extraction (parallel)
  ├── extractPdfText(qPrevKey)     ~2-3s
  └── extractPdfText(qCurrKey)     ~2-3s
  Transcript cap: 120,000 chars

Phase 2 — Thematic calls + Evasiveness (parallel, 11 calls)
  ├── Revenue & Growth (prev)      ─┐
  ├── Revenue & Growth (curr)       │
  ├── Margins & Profitability (prev)│
  ├── Margins & Profitability (curr)│
  ├── Cost Structure (prev)         ├── 10 parallel Gemini calls
  ├── Cost Structure (curr)         │   Schema: QUARTER_SNAPSHOT_SCHEMA
  ├── CapEx & Balance Sheet (prev)  │
  ├── CapEx & Balance Sheet (curr)  │
  ├── Macro & Risk (prev)           │
  ├── Macro & Risk (curr)          ─┘
  └── Evasiveness call (curr only) ── 1 Gemini call
                                        Schema: EVASIVENESS_SCHEMA
                                        Input: last 30,000 chars only

Phase 3 — Temporal Delta (parallel, up to 5 calls)
  For each section where both prev+curr succeeded:
  └── runTemporalDelta(section)     Schema: SECTIONAL_INSIGHT_SCHEMA
  (A section with a failed/timed-out prev or curr call is silently
   dropped here — not retried, not surfaced as an explicit error to
   the user beyond a lower implicit signal count.)

Phase 4 — Synthesis + Market Data (parallel, 4 calls)
  ├── runEarningsDeltaAgent()       Schema: BULLETS_SCHEMA ("What Changed")
  ├── runFCFImplicationsAgent()     Schema: BULLETS_SCHEMA ("Financial Impact")
  ├── runKeyMetricsAgent()          Schema: KEY_METRICS_SCHEMA (Rev, EBITDA, PAT)
  └── fetchStockPriceChange()       Yahoo Finance API (no Gemini)

Phase 5 — Local Validation (no LLM)
  ├── localValidation()             Signal/score self-consistency check ONLY —
  │                                  does not verify any quote against the source
  │                                  transcript. A real LLM-as-judge validator that
  │                                  does check quotes exists but only in the archived
  │                                  prototype (finance-agent/disclosure_pipeline/src/
  │                                  judge_evaluator.py) — never wired into production.
  └── computeMarketAlignment()      Stock direction vs signal direction
```

**Total Gemini calls per delta analysis**: 11 (thematic + evasiveness) + up to 5 (delta) + 3 (synthesis) = **~19-20 calls**, all non-streaming (`generateContent`, not `generateContentStream`) — the NDJSON progress the client sees is one line per *completed call*, not token-level streaming.

**Streaming events** (NDJSON to client):
```
{ type: "start", sections: [...] }
{ type: "thematic_done", section: "Revenue & Growth", which: "prev" }
{ type: "evasiveness_done", score: 3.2 }
{ type: "delta_done", section: "Revenue & Growth" }
{ type: "stock_done", stockPriceChange: 5.2 }
{ type: "done", payload: {...}, id: "uuid" }
```

### 4b. Deep Dive Pipeline (`lib/solo-pipeline.ts`)

**Trigger**: `POST /api/v1/analyze/solo` → `runSoloPipeline()` · **Model**: `gemini-2.5-flash-lite`, temperature `0` · **Timeout**: 55s per call

```
Phase 1 — Cache check (solo_analysis_cache)
Phase 2 — PDF extraction (~2-3s)
Phase 3 — Single Gemini call, full transcript (120K char cap) →
           { headline, management_tone, sections: [{ title, bullets }] }
Phase 4 — Cache result
```

**Total Gemini calls**: **1**.

### 4c. Multi-Quarter Insights Pipeline (`lib/insights-pipeline.ts`)

**Trigger**: `POST /api/v1/insights` → `runInsightsPipeline()` · **Model**: `gemini-2.5-flash-lite`, temperature `0` · **Timeout**: 55s per call

```
Phase 1 — Discover quarters (Blob Storage search), up to 8 most recent
Phase 2 — Per-quarter brief extraction (parallel, N calls) → QUARTER_BRIEF_SCHEMA
Phase 3 — Cross-quarter synthesis (1 call) → recurring_themes, guidance_tracks,
           management_credibility_score, new_business_signals, key_watchpoints,
           segment_narrative — SYNTHESIS_SCHEMA
```

**Total Gemini calls**: **N+1** (typically 5-9). Cached with a **30-day TTL enforced in application code** (`CACHE_TTL_DAYS = 30`, `lib/insights-pipeline.ts`), not a DB expiry mechanism.

> **Known bug**: `lib/divergence-score.ts` reads `overall_signal`/`overall_score` off this pipeline's cached output to power the "Promoter Pledge + concall sentiment" cross-reference flag on the Dashboard. This pipeline's `SYNTHESIS_SCHEMA` does not produce fields with those names — the flag is, per the code's own comment, "very likely always null in practice." Left unfixed intentionally, in keeping with the migration's Strangler Fig discipline of not bundling unrelated fixes into infra work. See `discussions/07_DATA_ARCHITECTURE.md`.

### 4d. Sector Narrative (`lib/sector-narrative.ts`) and KPI Extractor (`lib/kpi-extractor.ts`)

Both run at **temperature `0.1`**, not `0` — a deliberate departure from the other three pipelines, trading a small amount of determinism for less repetitive prose in synthesis-flavored output. `lib/kpi-extractor.ts` additionally has no `Promise.race` timeout wrapper at all (the only pipeline file without one).

---

## 5. Authentication & Authorization

```
Browser → NextAuth sign-in → Microsoft Entra External ID (OIDC)
       → JWT session (session.strategy = "jwt")
       → auth.ts's jwt() callback sets token.sub to the Entra `oid` claim
         (not the OIDC `sub`, which for Entra External ID is a non-UUID
         pairwise identifier — every Postgres user_id column is typed UUID)

API Request (protected routes only):
  Server: auth() reads the session server-side; session.user.id is the UUID
  Route handlers that check auth do so individually — there is no blanket
  middleware gate over /api/v1/**

middleware.ts:
  matcher scoped to /api/public/* only — API-key auth for the partner API
  Does NOT cover /api/v1/**
```

**Known gap, stated plainly**: of the 24 route handlers under `app/api/v1/**`, roughly 14 have no authentication check at all — including several `POST` endpoints that trigger real, billed Gemini spend (`seed-analysis`, `seed-transcripts`, `calendar/seed`, `sectors/seed`). `seed-analysis` additionally bypasses the credits system entirely. This is a real, unaddressed security gap, not a design choice — see `discussions/08_BACKEND_ARCHITECTURE.md` and `discussions/20_TECHNICAL_DEBT_AND_GAPS.md` for the full route-by-route audit and a prioritized fix list.

**Credits (paid usage metering)**: `lib/credits.ts` deducts a per-action credit (analysis/deep-dive/insights, flat cost regardless of transcript size or actual token spend) via a read-then-write pattern that is not atomic — a documented, unaddressed race under concurrent requests from the same user. The public API's `apiAccess.ts` implements the equivalent check with a proper atomic `ON CONFLICT` upsert; `credits.ts` does not follow the same pattern despite the fix already existing one file away.

---

## 6. Streaming Architecture (NDJSON)

```
Server (Route Handler):
  new ReadableStream({
    async start(controller) {
      const send = (data) => controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"))
      // Pipeline runs, calls send() for each progress event
      send({ type: "done", payload, id })
      controller.close()
    }
  })
  → Response with Content-Type: application/x-ndjson, X-Accel-Buffering: no

Client (lib/api.ts):
  const reader = response.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop()
    for (const line of lines) processLine(line)  // JSON.parse → onEvent callback → React state update
  }
```

Verified genuinely incremental — `components/AgentPanel.tsx` re-renders per event, not once at the end (`discussions/09_FRONTEND_ARCHITECTURE.md`). `AgentPanel.tsx` itself is purely presentational; the read loop lives in `lib/api.ts`/the page's `Client.tsx`.

**Safety mechanisms — inconsistently applied across the three streaming routes**:
- `/api/v1/analyze`: `closed` flag prevents `enqueue` after a client disconnect, and the 270s pipeline timeout fires before the (now largely vestigial, see §4a) 300s function-duration directive.
- `/api/v1/insights`: **missing** the same `closed`-flag guard and pre-timeout safety margin — a real inconsistency across otherwise near-identical route handlers.

---

## 7. Caching Strategy

| Cache | Table | Key | TTL | Atomicity |
|-------|-------|-----|-----|-----------|
| Delta Analysis | `analysis_results` | `(ticker, q_prev, q_curr)` | Permanent until manual re-run | Non-atomic DELETE-then-INSERT, no unique constraint |
| Deep Dive | `solo_analysis_cache` | `(ticker, quarter)` | Permanent until manual re-run | Same non-atomic pattern |
| Multi-Quarter | `insights_cache` | `(ticker, quarters_key)` | 30 days, app-enforced | Atomic `ON CONFLICT` upsert |
| Sector Intel | `sector_intelligence` | `(sector, quarter)` | Permanent until manual reseed | Atomic upsert |
| YouTube Videos | `concall_links` | `(ticker, quarter)` | Permanent, `?retry=true` bypasses | Atomic upsert |
| Promoter Data | `promoter_activity` | `(ticker, news_id)` | 24h fetch-log cooldown per ticker | Atomic upsert, dedup on BSE's own `news_id` |
| Calendar | `earnings_calendar` | `(ticker, quarter)` | Permanent until manual reseed | Atomic upsert; source-priority (tickertape > bse_notice > nse_calendar > estimated) is enforced only *within* one seed run, in memory — not a persisted invariant across separate reseed runs |

This is response-caching for cost/latency control, not a general-purpose cache layer (no Redis/Memcached anywhere) — every cache is a plain Postgres table read before deciding whether to call Gemini at all.

---

## 8. Frontend Patterns

Unchanged from the original design in substance — see `discussions/09_FRONTEND_ARCHITECTURE.md` for the fully verified account, including: zero accessibility effort anywhere in `app/`/`components/` (no `aria-*`, no `alt`, no `role`); no chart/visualization library (numeric comparisons render as CSS width-percentage bars); two independent, unsynced watchlist implementations (a `localStorage`-only star/chip system and a separate Postgres-backed "add to my list" flow); two independent PDF-export code paths (`html2canvas`-based for the Delta report, native `jsPDF` text layout for the Deep Dive export); no global state library, no Context, no error boundaries.

---

## 9. Cost Model

The Gemini call-count figures in §4 (~19-20 calls for Delta, 1 for Deep Dive, N+1 for Insights) are accurate and code-verified. **Beyond that, treat any specific dollar figure in this section as a rough, unverified estimate** — there is no runtime token accounting anywhere in the codebase (no logging of `usageMetadata`/`promptTokenCount`/`candidatesTokenCount` on any Gemini response), so actual spend cannot currently be reconciled against a pipeline run. `lib/credits.ts`'s per-user metering is a flat per-action charge, decoupled from real token/transcript-size cost — a business-facing quota, not a cost-accounting mechanism.

Azure Container Apps (Consumption plan), Azure Database for PostgreSQL (Flexible Server), and Azure Blob Storage replace the former Vercel/Supabase cost structure; none of their actual billed usage is instrumented in-app. Building real cost observability (Gemini token logging per call site, correlated with Azure billing) is a concrete, scoped improvement — see `discussions/24_90_DAY_ENGINEERING_LEARNING_PLAN.md` for a prioritized version of this exercise.

---

## 10. Key Architectural Decisions

### Why Gemini 2.5 Flash Lite (not GPT-4 / Claude)
- Structured JSON output via `responseSchema` — guarantees valid JSON, no parsing failures
- Materially cheaper than GPT-4-class models for high call-volume, high-fan-out pipelines like Delta Analysis
- Large context window fits full transcripts without chunking
- Temperature 0 (in 3 of 5 pipeline files) for deterministic financial extraction

### Why NDJSON Streaming (not WebSockets)
- Zero infrastructure overhead — works over standard HTTP, no persistent-connection server needed
- Client shows real-time per-call progress across a high-fan-out pipeline
- Graceful degradation: if the connection drops, partial results already streamed are still usable

### Why 5 Parallel LLM Calls (not 1 comprehensive call, and not an agent framework)
- Parallelism: 10+ concurrent calls finish in the time of roughly one (wall-clock ~15-25s vs. what a fully serial equivalent would take)
- Per-domain structured schemas reduce cross-contamination between sections
- A focused system prompt per domain measurably improves extraction quality over one giant prompt
- Individual call failures don't kill the pipeline — a failed call is filtered to `null` and the rest of the `Promise.all` batch is unaffected
- **This is a considered choice, not a stand-in for "real" agents**: nothing here needs dynamic tool selection or multi-step reasoning — a fixed, domain-sharded extraction DAG is the right shape for "read this transcript, extract these known categories of facts." See `discussions/06_AGENT_ARCHITECTURE.md`.

### Why Azure (Postgres + Blob + Entra ID + Container Apps), not Supabase/Vercel
Migrated deliberately, in three dated, documented stages (`docs/superpowers/specs/2026-07-*-azure-*-migration-design.md`), each following a Strangler Fig pattern with an explicit rollback window. The stated rationale across those documents centers on data residency and platform economics as the product scaled past what a single managed BaaS vendor's free/pro tiers comfortably covered, plus wanting first-party control over the Postgres instance (private VNet networking) rather than depending on Supabase's connection-pooling and RLS model. The App Service → Container Apps hop that followed is not equally well-documented — see `discussions/14_DEVOPS_CLOUD.md` for that gap.

### Why Client-Side PDF Export (not Server-Side)
- Zero server cost for export; no headless-browser dependency in the deployed container
- `jsPDF` text rendering is fast; `html2canvas` gives the Delta report pixel-perfect layout fidelity where needed

### Why `localStorage` for the Dashboard Watchlist (not the DB)
- Zero latency, no API call on page load, tiny payload (20-ticker cap)
- Per-user DB storage (`user_tickers`) is reserved for custom stocks outside the Nifty 200 universe, in a separate, unsynced flow — see `discussions/09_FRONTEND_ARCHITECTURE.md` for why these two systems don't currently talk to each other

### Why Pipeline-Level Timeout Inside the Route's Declared Function Timeout
- A hard platform-level function kill (Vercel's old `maxDuration`, or an Azure Container Apps request timeout) delivers no error event to an in-flight NDJSON stream — the client just sees the connection drop mid-stream
- A shorter, pipeline-internal timeout fires first and sends a proper `{ type: "error" }` event before that happens
- This reasoning is why `PIPELINE_TIMEOUT_MS = 270_000` exists inside the still-present (now largely vestigial under Container Apps) `maxDuration = 300` Vercel directive — see §4a

---

## 11. Known Limitations & Technical Debt (summary — see `discussions/` for full detail)

This document intentionally states these plainly rather than omitting them:

- **No automated test suite** for the Next.js app (no jest/vitest/playwright); the only CI gate is `next build`'s TypeScript compilation. → `discussions/13_TESTING.md`
- **No production AI-quality evaluation.** Output validity is enforced structurally (Gemini's `responseSchema`) plus one deterministic sign-consistency check; nothing checks a generated quote against the source transcript. A real LLM-as-judge validator exists only in the archived `finance-agent/disclosure_pipeline/src/judge_evaluator.py`, never wired into production. → `discussions/12_AI_EVALUATION.md`
- **~14 of 24 internal API routes have no authentication**, including some that trigger billed Gemini spend. → `discussions/08_BACKEND_ARCHITECTURE.md`
- **No retries on any LLM call**, and per-call timeouts don't cancel the underlying request. → `discussions/05_AI_ARCHITECTURE.md`
- **No prompt-injection mitigation** — scraped transcript text is interpolated directly into every Gemini prompt. → `discussions/11_PRODUCTION_ENGINEERING.md`
- **No observability**: no structured logging, metrics, or tracing beyond `console.*` calls; no per-call token or latency telemetry. → `discussions/11_PRODUCTION_ENGINEERING.md`
- **No infrastructure-as-code** — every Azure resource was provisioned via one-off `az` CLI commands recorded in the migration plan documents, not in a Terraform/Bicep file. Named as a deliberate, scoped trade-off in the migration spec itself, revisitable once a second environment is needed. → `discussions/14_DEVOPS_CLOUD.md`
- Two self-documented, unfixed concurrency issues: the `divergence-score.ts` dead-field bug (§4c above) and the `credits.ts` non-atomic deduction race (§5 above).

None of these are secret — they're the natural next-priority list for this product, and the reasoning behind each is preserved in `discussions/19_ARCHITECTURE_DECISION_LOG.md` and `discussions/20_TECHNICAL_DEBT_AND_GAPS.md`, along with a ranked plan for closing them in `discussions/24_90_DAY_ENGINEERING_LEARNING_PLAN.md`.

---

## 12. Transcript Sourcing

`lib/transcript-fetcher.ts` + `/api/v1/request`

Sources (tried in order):
1. **Screener.in** — scrapes annual report / concall PDF links
2. **BSE API** — `AnnSubCategoryGetData/w` for corporate announcements, filters for concall PDFs via `AnnPdfOpen` links

PDFs uploaded to Azure Blob Storage as `TICKER_Q#_YYYY.pdf`. `resolvePdfKey()` paginates the container listing to find the exact file, case-insensitive match.

`app/api/v1/request/route.ts` duplicates this fetch logic rather than importing `lib/transcript-fetcher.ts` directly, and the two copies have already drifted in their lookback windows and max-transcript limits — see `discussions/07_DATA_ARCHITECTURE.md`.

---

## 13. Promoter Pledge Scoring

`lib/divergence-score.ts` + `lib/promoter-activity-fetcher.ts`

```
BSE "Insider Trading / SAST" feed
  → Filter: Reg 31 "encumbrance by promoter" (pledge events)
  → Skip: "Closure of Trading Window" (noise)
  → Store in promoter_activity table (dedup on news_id)

Scoring:
  recent = events in last 90 days
  baseline = events in 90-450 day window, normalized to 90-day rate

  quiet: 0 recent events
  normal: recent ≤ baseline × 1.5
  elevated: recent > baseline × 1.5

  flag = elevated AND concall signal is Positive/Mixed
  (promoter pledging while management sounds upbeat = worth investigating)
```

The `elevated`/`quiet`/`normal` classification itself works as designed. The final `flag` condition currently cannot fire correctly in practice — see the known bug noted in §4c.

---

*Last technically verified against the live codebase via `discussions/` (26-file engineering case study), covering the Azure migration, AI pipeline mechanics, and known gaps above.*
