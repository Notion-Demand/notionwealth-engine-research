# 01 — Repository Map

*Flat, scannable ground-truth inventory of the Quantalyze repo — where things live, what's live vs. dead vs. archived, and how big each part is. Complements `03_SYSTEM_ARCHITECTURE.md` Part A, which reads as narrative pattern-analysis (dependency direction, architectural role of each layer); this file is the checklist you scan in two minutes to find where something lives. All facts verified directly against `/tmp/quantalyze` (`find`, `Glob`, direct file reads) as of this snapshot (2026-09-01/02).*

---

## A. Full directory tree, with one-line purpose per directory

```
/tmp/quantalyze/
├── app/                          Next.js 14 App Router — pages, client components, ALL API routes
│   ├── api/
│   │   ├── v1/                   Internal API — 21 route.ts files, session-cookie auth (opt-in per route)
│   │   ├── public/v1/            External partner API — 3 route.ts files, API-key auth (middleware-enforced)
│   │   ├── auth/[...nextauth]/   NextAuth.js handler mount point
│   │   ├── health/                Liveness check (`{status:"ok"}`, no dependency checks)
│   │   └── og/                   OG image generation
│   ├── dashboard/, insights/, screener/, sectors/, calendar/, videos/,
│   │   request/, kpis/, developers/, login/, why-quantalyze/,
│   │   privacy/, terms/          One directory per user-facing route (Server page.tsx + Client component)
│   └── layout.tsx, page.tsx, globals.css   Root render tree
├── lib/                          Domain logic, pipelines, repositories, auth/service helpers — 39 files
│   ├── pipeline.ts, solo-pipeline.ts,
│   │   insights-pipeline.ts, sector-narrative.ts,
│   │   kpi-extractor.ts          The 5 AI pipelines — prompts, Gemini schemas, orchestration
│   ├── divergence-score.ts       Promoter-pledge frequency scoring (pure computation, no LLM)
│   ├── transcript-fetcher.ts     Screener.in/BSE/NSE scraping + quarter inference
│   ├── promoter-activity-fetcher.ts   BSE SAST/insider-trading feed polling
│   ├── credits.ts                Monthly per-user credit quota + action pricing
│   ├── auth.ts                   getCurrentUser() — thin wrapper over NextAuth's auth()
│   ├── nifty50.ts, nifty200.ts, nifty500.ts,
│   │   nifty200-sampler.ts, listed-companies.ts,
│   │   sub-sectors.ts            Static hardcoded ticker/sector/company registries — not DB-backed
│   ├── api.ts                    Frontend fetch wrapper (NDJSON stream reader)
│   ├── repositories/             One file per aggregate; interface + Postgres*/Supabase* impl pair
│   ├── postgres/client.ts        Lazy-singleton pg.Pool → Azure Postgres Flexible Server
│   ├── supabase/admin.ts         DEAD — legacy Supabase service-role client, unused in prod
│   ├── services/                 sectorThesisService.ts + errors.ts — the one real service-layer instance
│   ├── api-contracts/v1/         DTO/mapper layer for the public API (company, sector, sectorThesis)
│   └── public-api/product-routes.ts   URL → product-name resolver for entitlement checks
├── components/                   3 files: EarningsReport.tsx, AgentPanel.tsx, Nav.tsx (presentation only)
├── types/next-auth.d.ts          Module augmentation for NextAuth Session/JWT types
├── supabase/migrations/          11 .sql files — schema history, run against AZURE Postgres today, not Supabase
├── scripts/                      One-shot Azure migration toolkit (not app runtime code) — 7 files
├── docs/superpowers/plans/       8 dated engineering plans — the real, up-to-date migration history
├── docs/superpowers/specs/       7 dated design specs, paired with the plans above
├── public/                       Static assets (favicons, OG images)
├── finance-agent/                ARCHIVED prototype — Python/FastAPI "NotionWealth Intelligence" (101 files)
│   ├── agents/                   6 single-shot RAG+LLM "agent" modules (financial, risk, competitive, ...)
│   ├── core/                     vector.py/embeddings.py (FAISS), financial_memory.py (JSON fact store)
│   ├── control/                  control_plane.py (heuristic "VerificationAgent"), research_replay.py
│   ├── api/                      FastAPI routers: analyze, auth, connections, gmail, slack_webhook
│   ├── integrations/             slack_bot.py, email_handler.py — absent from production entirely
│   ├── mcp_server.py             Real MCP server, 12 registered tools — genuine but archived
│   ├── ui/                       Streamlit UI, fully replaced by the Next.js frontend
│   ├── disclosure_pipeline/      Near-duplicate, more-evolved fork of disclosure-analysis-pipeline/
│   ├── multiagent_analysis/      Sample PDFs still bundled into 3 production Next.js function traces
│   ├── scripts/                  10 test_*.py files — manual smoke scripts, not pytest (see 13_TESTING.md)
│   └── main.py, server.py        Two separate, non-unified entry points (neither wired to production)
├── disclosure-analysis-pipeline/ ARCHIVED prototype — standalone disclosure parser (44 files)
│   ├── src/                      parser.py, analyzer.py, semantic_extraction.py, pipeline.py, models.py
│   └── all-pdfs/                 30 real sample transcripts (SBI, Bajaj Finance, HDFC, Infosys, ...)
├── bank/, wealth/, xl/           Repo-hygiene clutter — 1 file each (broker PDF, SEBI PDF, Excel template);
│                                  not read by any application code; excluded from Docker build context
├── .claude/                      Claude Code session config — not app code, not in .gitignore (debt item)
├── .github/workflows/            Exactly 1 file: deploy-azure.yml
├── Dockerfile                    3-stage build (deps → builder → runner)
├── auth.ts, middleware.ts        Root-level NextAuth config + edge middleware (public-API gate only)
├── README.md, TECHNICAL_ARCHITECTURE.md   STALE — describe the pre-migration Supabase/Vercel stack
├── README_ARCHIVE.md             The original "NotionWealth Intelligence" vision document
├── PRODUCT_NOTES.md              Dated, first-person product-decision log — real and current
└── package.json, next.config.mjs, vercel.json, .env.local.example   Config (several stale — see §L)
```

---

## B. File inventory counts by directory

| Directory | File count | Notes |
|---|---|---|
| `app/` | 50 | Pages, client components, 24 `route.ts` handlers |
| `lib/` | 39 | Pipelines, repositories, services, static registries |
| `components/` | 3 | Entire shared presentation layer |
| `finance-agent/` | 101 | Archived — largest single directory in the repo by file count |
| `disclosure-analysis-pipeline/` | 44 | Archived — includes 30 sample PDFs |
| `docs/superpowers/` | 15 | 8 plans + 7 specs, dated 2026-07-09 through 2026-07-20 |
| `scripts/` | 7 | One-shot Azure migration tooling |
| `supabase/migrations/` | 11 | `.sql` files, 001 → 011 |
| `app/api/` route files | 24 | 21 internal (`/api/v1`) + 3 public (`/api/public/v1`) |
| Top-level loose `.md` docs | 4 | `README.md`, `TECHNICAL_ARCHITECTURE.md`, `README_ARCHIVE.md`, `PRODUCT_NOTES.md` |

Commit-activity contrast (from git history, cited throughout `discussions/`): **159 commits touching `app/`, 89 touching `lib/`**, vs. **15 total for `finance-agent/`, 4 for `disclosure-analysis-pipeline/`** — the file-count table above is misleading on its own (the archived prototype has *more files* than the live app) without this activity context: it was frozen early and never iterated on.

---

## C. Technology stack — production vs. archived prototype

| Layer | **Production** (`app/`, `lib/` — from `package.json`) | **Archived prototype** (`finance-agent/` — from `requirements.txt`) |
|---|---|---|
| Language | TypeScript 5 | Python |
| Web framework | Next.js 14.2.29 (App Router), React 18.3.1 | FastAPI + `uvicorn[standard]` |
| Styling | Tailwind CSS 3.4.13, `clsx` | Streamlit |
| AI SDK | `@google/generative-ai` ^0.24.1 (Gemini Developer API, direct) | `google-cloud-aiplatform`, `google-genai` (branded Vertex AI, but `vertex.py` never imports `vertexai` — actually also the Gemini Developer API) |
| Model | `gemini-2.5-flash-lite`, hardcoded, temperature 0 | Same underlying API family, called via `call_gemini()` |
| Vector search | **None** | `faiss-cpu` + `numpy` (`core/vector.py`, `core/embeddings.py`) |
| Auth | `next-auth` ^5.0.0-beta.31 + Microsoft Entra External ID (OIDC) | `python-jose[cryptography]`, `google-auth`, `google-auth-oauthlib` (Google OAuth) + `supabase>=2.3.0` (Supabase Auth) |
| Database client | `pg` ^8.22.0 → Azure Database for PostgreSQL Flexible Server | No dedicated DB client — facts persisted as flat JSON (`core/financial_memory.py`) |
| Object storage | `@azure/storage-blob` ^12.33.0 | Local filesystem (`data/processed/`, `all-pdfs/`) |
| PDF parsing | `pdf-parse` ^1.1.1 (server-side) | `pypdf`, `pdfplumber` |
| PDF export | `jspdf` ^4.2.0 + `html2canvas` ^1.4.1 (client-side) | — |
| Legacy DB/storage client | `@supabase/supabase-js` ^2.45.4 (dead code — `lib/supabase/admin.ts` unused in prod) | `supabase>=2.3.0` (`db/supabase.py`) |
| Agent/tool protocol | **None** | MCP (`mcp.server.fastmcp`, `mcp_server.py`, 12 tools) |
| Integrations | YouTube Data API v3, Yahoo Finance (unofficial), BSE/NSE public APIs, Screener.in (scraped) | Slack (`slack-bolt>=1.20`), Gmail (`google-api-python-client`) |
| Deployment artifact | Docker (multi-stage, `output: "standalone"`) | None — never deployed as a product |
| Icons/UI kit | `lucide-react` ^0.446.0; no component library (no shadcn/Radix/Headless UI) | — |
| Dead/vestigial dep | `@vercel/functions` ^3.4.3 (Vercel-era, inert on Container Apps) | — |
| `package.json`/`requirements.txt` name | `"notionwealth-frontend"` (unrenamed legacy artifact) | — |
| Test tooling | **None** (no jest/vitest/playwright/@testing-library) | **None** (no pytest/unittest config; `test_*.py` are manual smoke scripts) |
| ORM/schema validation | **None** (no Prisma/Drizzle/zod — hand-written parameterized SQL, hand-written `!` non-null env reads) | Pydantic (FastAPI-idiomatic) |

---

## D. Entry points

| System | Entry point(s) | Notes |
|---|---|---|
| **Production** | `app/layout.tsx` + `app/page.tsx` | Root Next.js render tree. Every `app/api/**/route.ts` is an independent entry point Next.js dispatches to directly — there is no single `server.ts`. |
| **Production (container)** | `Dockerfile`'s `CMD ["node", "server.js"]` | The `.next/standalone` output's own generated server, not a hand-written Express/Fastify entry. |
| **Archived** | `finance-agent/main.py` (12 lines, ad hoc CLI/quick-test entry) **and** `finance-agent/server.py` (50 lines, FastAPI ASGI app boot) | Two separate, seemingly redundant boot paths — itself evidence the prototype's structure was still in flux when development stopped. Neither is invoked by production (confirmed: no `localhost:8000`/`FINANCE_AGENT` reference anywhere in `app/`/`lib/`). |

---

## E. Application boundaries

- **Two systems, one repo, zero cross-references**: `finance-agent/` and `disclosure-analysis-pipeline/` have no import edges into `app/`/`lib/`/`components/` (grep-verified: `grep -rln "finance-agent" app lib components` returns nothing but one incidental comment in `lib/nifty50.ts:1`). The Next.js build (`next.config.mjs`'s `outputFileTracingIncludes`) does bundle `finance-agent/multiagent_analysis/all-pdfs/*.pdf` into three serverless-function traces as fallback/demo data — the *only* production dependency on the archived directory, and it's data, not code.
- **No separate backend service**: Next.js Route Handlers under `app/api/v1/**` and `app/api/public/v1/**` are the entire server-side surface, running in the same Docker container/process as the SSR'd pages.

## F. Backend / frontend separation

There is no backend/frontend process split. `app/*/page.tsx` (Server Component, auth-gate only) hands off immediately to `app/*/​*Client.tsx` (Client Component, all real data-fetching via `lib/api.ts`) — SSR data-fetch is *not* used; every page ships empty and hydrates client-side (`09_FRONTEND_ARCHITECTURE.md`). `.env.local.example` still lists `NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1` under a "FastAPI Backend" heading — a dead leftover from when `finance-agent/server.py` *was* a separate backend; nothing reads it today.

## G. API boundaries — `/api/v1/**` vs `/api/public/v1/**`

| | `/api/v1/**` (internal) | `/api/public/v1/**` (external) |
|---|---|---|
| Route count | 21 of 24 | 3 of 24 |
| Auth | NextAuth session cookie, via `getCurrentUser()` — **opt-in per route, not centrally enforced** (10 of 24 check it; 14 do not) | Bearer API key, SHA-256 hashed, centrally enforced in `middleware.ts` before any route code runs |
| Consumers | The Next.js frontend only, via `lib/api.ts` | External partners |
| Response shape | Raw internal domain objects (`DashboardPayload`, etc.), unmapped | `lib/api-contracts/v1/*.ts` DTOs (`CompanyResponseV1`, etc.) — versioned, camelCase, curated |
| Entitlements/quota | None beyond the monthly credit balance (`lib/credits.ts`) | Per-key product entitlements + daily quota (`api_key_products`, `api_usage`) |
| Versioning | `v1` is a namespace convention, not real version negotiation — no `v2`, no header negotiation, in either surface |

## H. Data stores

- **Azure Database for PostgreSQL Flexible Server** — the only structured store. **16 tables** across `supabase/migrations/001-011` (11 files, 13 `CREATE TABLE` statements once the migration-011 API-access cluster is unbundled): `user_connections`, `analysis_results`, `kpi_snapshots`, `sector_intelligence`, `earnings_calendar`, `concall_links`, `user_tickers`, `insights_cache`, `promoter_activity`, `promoter_activity_fetch_log`, `solo_analysis_cache`, `user_credits`, `api_partners`, `api_keys`, `api_key_products`, `api_usage`. Accessed exclusively via raw `pg` + parameterized SQL (`lib/postgres/client.ts`), never through Supabase's PostgREST layer.
- **Azure Blob Storage** — container `transcripts`, flat `TICKER_Q#_YYYY.pdf` keys, no folder structure. Account-key writes server-side only; browser downloads go through time-limited SAS-token URLs.
- **NOT present in production**: any vector database, any NoSQL/document store, any Redis/cache-server layer. `pgvector` is referenced nowhere. All "caching" is real Postgres tables with explicit key/TTL/invalidation logic (`07_DATA_ARCHITECTURE.md` §6), not an ephemeral cache tier.
- **Present only in the archived prototype**: FAISS (`finance-agent/core/vector.py`, local index files `data/processed/finance.index`), a flat local JSON fact store (`financial_memory.py`).

## I. AI/LLM components

| Component | File | Calls/run |
|---|---|---|
| Delta Analysis (QoQ) pipeline | `lib/pipeline.ts` | ~19-20 (10 thematic + 1 evasiveness + up to 5 delta + 3 synthesis) |
| Deep Dive (single quarter) pipeline | `lib/solo-pipeline.ts` | 1 comprehensive call |
| Multi-Quarter Insights pipeline | `lib/insights-pipeline.ts` | N+1 (N ≤ 8 per-quarter briefs + 1 synthesis) |
| Sector narrative generation | `lib/sector-narrative.ts` | 1 per sector, per seed run |
| KPI extraction | `lib/kpi-extractor.ts` | 1 per ticker/quarter |

Every one of the five files independently defines its own `getGenAI()` and its own `Promise.race`-based timeout wrapper — **no shared `lib/gemini.ts`/`LLMProvider` abstraction exists** (confirmed absent; `20_TECHNICAL_DEBT_AND_GAPS.md` #9). Single hardcoded model everywhere: `gemini-2.5-flash-lite`, temperature `0`, structured output via `responseSchema`/`SchemaType.OBJECT`. Archived-only AI components: `finance-agent/agents/*.py` (6 single-shot RAG+LLM functions), `finance-agent/vertex.py`'s `call_gemini()` (has retry logic production never got), `disclosure_pipeline/src/judge_evaluator.py` (real LLM-as-judge, never wired to production).

## J. Agent / orchestration components

**No autonomous agents in production.** The orchestration is a fixed DAG hand-written in TypeScript — `Promise.all()` fan-out/fan-in across explicit phases inside each pipeline function — not an LLM-driven planner and not a framework (LangGraph/CrewAI/AutoGen confirmed absent from `package.json`). The "5 specialist agents" in `lib/pipeline.ts` (`AGENT_PROMPTS`: Revenue & Growth, Margins & Profitability, Cost Structure, CapEx & Balance Sheet, Macro & Risk) are five differently-prompted calls to the same `invokeStructured()` function. Full argument: `06_AGENT_ARCHITECTURE.md`. The only real agent/orchestration machinery in the whole repo is archived: `finance-agent/control/control_plane.py` (a router that in practice hard-codes one downstream call), `research_replay.py`, and `mcp_server.py` (a genuine MCP server registering 12 tools — real engineering, but disconnected from the live product).

## K. External integrations

| Integration | Used for | Auth |
|---|---|---|
| Google Gemini (`@google/generative-ai`) | All structured-output AI inference | `GOOGLE_API_KEY` |
| Azure Database for PostgreSQL | Primary structured store | `POSTGRES_CONNECTION_STRING` (private VNet) |
| Azure Blob Storage | Transcript PDF storage | `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER` |
| Microsoft Entra External ID | User auth (NextAuth OIDC provider) | `AUTH_MICROSOFT_ENTRA_ID_ID/SECRET/ISSUER` |
| Screener.in | Company page resolution + Raw Transcript link scraping (undocumented internal search endpoint + HTML scrape) | None (browser-UA spoofed) |
| BSE `AnnSubCategoryGetData/w` | Transcript filings + promoter-pledge (SAST) filings | None (browser-UA spoofed) |
| NSE/BSE archive hosts | Direct PDF download | None |
| Yahoo Finance (`query1.finance.yahoo.com`, unofficial) | Quarter-window stock price change | None |
| YouTube Data API v3 | Concall video lookup | `YOUTUBE_API_KEY` |
| Tickertape | Earnings-calendar seeding (one of several priority-ordered sources) | Not confirmed keyed |

**Zero Azure AI services** (no Azure OpenAI, AI Foundry, AI Search, Document Intelligence, Copilot Studio) anywhere in the repo — confirmed by grep across `app/`, `lib/`, `package.json`, `docs/superpowers/**`.

## L. Configuration / environment management (variable names only)

**No centralized config module** — every file does its own `process.env.X!` read at point of use; a missing var fails at first *use*, not at boot (`20_TECHNICAL_DEBT_AND_GAPS.md`).

**Variables actually read by live code** (`08_BACKEND_ARCHITECTURE.md` §8): `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_ISSUER`, `GOOGLE_API_KEY` (the Gemini key — confusingly named the same as the unused OAuth var below), `YOUTUBE_API_KEY`, `POSTGRES_CONNECTION_STRING`, `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER`, `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (still required at module-load time by the dead `lib/supabase/admin.ts` even though unused downstream), `NEXT_PUBLIC_API_URL` (dead, defaults unused).

**Variables listed in `.env.local.example`** (stale — none of the Azure/Entra/Gemini vars above appear in it at all): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_API_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `NEXT_PUBLIC_SLACK_CLIENT_ID` — every one of these last 6 (Google/Slack OAuth) is referenced nowhere in `app/`/`lib/` outside `finance-agent/`. A new engineer following this file would configure OAuth credentials the app doesn't use and have no idea the app requires `POSTGRES_CONNECTION_STRING`/`AUTH_MICROSOFT_ENTRA_ID_*`/`GOOGLE_API_KEY` to boot.

**CI/CD secrets** (`.github/workflows/deploy-azure.yml`): `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` — all three are non-sensitive OIDC-trust identifiers, not credentials; no application secrets are referenced in the workflow itself.

## M. Testing infrastructure

**None automated, for the live app — stated plainly.** No `jest`/`vitest`/`mocha`/`playwright`/`cypress`/`@testing-library/*` in `package.json`. Zero `*.test.ts`/`*.spec.ts` files anywhere under `app/`, `lib/`, `components/`, `types/`, `scripts/`. The project's own dated engineering docs state this outright as a given constraint (`docs/superpowers/specs/2026-07-10-azure-hosting-migration-design.md:101`: *"No automated test runner exists in this repo. Verification is `npx tsc --noEmit`..."*). Verification today = TypeScript type-checking + manual `npm run dev` + browser/`curl` checks. The archived prototype's 10 `test_*.py` files are manual smoke scripts (no `assert`, no pytest/unittest config, print-and-read pattern) — not automated tests, despite the naming. Full inventory and component-by-component "what actually proves this works" table: `13_TESTING.md`.

## N. Deployment / infrastructure

- **`Dockerfile`**: 3-stage build (`deps` → `builder` → `runner`), `node:22-alpine`, `npm run build` producing Next.js `output: "standalone"`, non-root `nextjs` user, `CMD ["node", "server.js"]`. No `HEALTHCHECK` instruction.
- **Target platform**: **Azure Container Apps** (`quantalyze-app-ca`, resource group `quantalyze-prod-rg`, registry `quantalyzeacr.azurecr.io`) — but the only hosting design docs in the repo (`docs/superpowers/plans/specs/2026-07-10-azure-hosting-migration*`) describe migrating to **Azure App Service**, explicitly *without* Docker, and name Container Apps only as a deferred "not needed now" future option. **No plan/spec document anywhere describes the actual App Service → Container Apps hop** — a real, undocumented second migration (`14_DEVOPS_CLOUD.md` §7).
- **No IaC** (no Terraform/Bicep/ARM) — every Azure resource was provisioned via one-off `az` CLI commands recorded as literal shell snippets inside the markdown plan documents; explicitly named as a deliberate, scoped trade-off ("one-time manual/CLI provisioning is proportionate for a single environment at this stage").
- **No Docker Compose, no Kubernetes manifests.**
- **Database migrations**: 11 plain hand-written `.sql` files (no Prisma/Drizzle), applied manually — `scripts/migrate-schema-to-azure.ts` was the one-time cutover script (not a reusable migration runner); there is no mechanism today, automated or documented-manual, for applying a future `012_*.sql`.
- **`vercel.json`**: `{"framework": "nextjs"}` — dead, harmless, leftover config; Vercel is not the deploy target.

## O. CI/CD

**Exactly one workflow**: `.github/workflows/deploy-azure.yml` ("Deploy to Azure Container Apps"). Trigger: `push` to `main` + manual `workflow_dispatch` — **no PR-gated staging deploy, no branch environment separation**. Steps: Checkout → `azure/login@v2` (OIDC federated identity, no stored long-lived credential — genuine best practice, scoped to `repo:.../ref:refs/heads/main` only) → `az acr login` → `docker build`/`docker push` (tagged by commit SHA and `latest`) → `az containerapp update`. **No test step of any kind** — the only gate is "does `docker build` (which runs `npm ci` + `next build`, including TypeScript compilation) succeed." No post-deploy health verification (`/api/health` is never curled by the workflow), no automated rollback (SHA-tagged images make a *manual* rollback possible, but nothing automates it). Full trace: `14_DEVOPS_CLOUD.md`.

## P. Observability / evaluation

**Minimal to none — stated plainly.** No metrics library (Prometheus/StatsD/Azure Monitor SDK), no `/metrics` endpoint, no distributed tracing (no OpenTelemetry, no Application Insights SDK wired despite being named in a migration spec as a *future* addition), no AI-call telemetry (no latency/token logging — `usageMetadata` on Gemini responses is never read). `app/api/health/route.ts` returns a static `{status:"ok"}` unconditionally — a liveness check in the loosest sense, not a readiness check. Logging is 65 `console.log`/`console.error`/`console.warn` call sites, bracket-tagged (`[Pipeline]`, `[KPI]`, `[Cache]`) but not machine-parseable, across 16 files. The **one genuine exception**: `middleware.ts`'s `log()` helper emits real structured JSON (`requestId`, `partnerId`, `keyId`, `endpoint`, `product`, `status`, `latencyMs`) per public-API request — but scoped to that one low-traffic surface only. **AI evaluation**: none in production; a real 4-stage LLM-as-judge (`finance-agent/disclosure_pipeline/src/judge_evaluator.py`) exists only in the archived prototype. Full detail: `11_PRODUCTION_ENGINEERING.md` (OBSERVABILITY), `12_AI_EVALUATION.md`.

## Q. Documentation inventory

| Doc | Status | What it's for |
|---|---|---|
| `README.md` | **STALE** | Product pitch (accurate) + Tech Stack table (describes dead Supabase/Vercel stack) |
| `TECHNICAL_ARCHITECTURE.md` | **STALE** | "v2.0.0 — June 2026" deep architecture doc — Supabase Auth/Postgres/Storage, Vercel, "10 tables," RLS-on-3-tables — all describing infrastructure the app no longer runs on |
| `PRODUCT_NOTES.md` | **Current, real** | Dated, first-person product-decision log — GTM segmentation, feature rationale (e.g. the "narrative trap" confidence-multiplier fix), real bugs found/fixed with dates |
| `README_ARCHIVE.md` | **Historical, accurate for its era** | The original "NotionWealth Intelligence" vision — multi-agent cognition, multi-layer memory, control plane, research replay — maps directly onto `finance-agent/` |
| `docs/superpowers/plans/*.md` (8 files) | **Current, real** | Dated execution plans for real shipped features/migrations — Azure hosting, Azure data+storage, Azure auth, repositories/migration, public API, company memory, developer docs page, why-quantalyze page |
| `docs/superpowers/specs/*.md` (7 files) | **Current, real** | Paired design specs for the plans above — scope, non-goals, verification approach, cutover procedures |
| `.env.local.example` | **STALE** | Documents dead Google/Slack OAuth vars; omits every var the live app actually needs |
| `discussions/*.md` (this folder) | **Current** | This case study's own 23 files + master map |

**The load-bearing correction**: anyone reading `README.md`/`TECHNICAL_ARCHITECTURE.md` first (as this task's own framing initially did) forms a materially wrong mental model. `docs/superpowers/` is the actually-current, actually-trustworthy source for infrastructure reality — it's just not the first thing a reader opens.

## R. Scripts / utilities (`scripts/*.ts`)

One-shot **Azure migration toolkit**, not app runtime code — never imported by `app/`/`lib/`, run manually via `tsx`/`npx`:

| Script | Purpose |
|---|---|
| `copy-blobs-to-azure.ts` | Supabase Storage → Azure Blob PDF migration |
| `migrate-postgres-data.ts` | `pg_dump --data-only` (excluding `auth.*`/`storage.*` schemas) from Supabase → `psql` load into Azure Postgres |
| `migrate-schema-to-azure.ts` | Reads every `supabase/migrations/*.sql`, strips `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY`/`REFERENCES auth.users(id)` (Azure Postgres has no `auth.uid()`), executes the adapted DDL against Azure |
| `provision-api-key.ts` | Generates `qzk_live_*` partner API keys; stores only the SHA-256 hash |
| `verify-migration.ts` | Row-count + content-hash diff across all migrated tables — the two-layer verification approach cited approvingly in `15_AZURE_JD_MAPPING.md` |
| `_run.sh`, `_run-install-pg17-client.sh` | Shell helpers for running the above against a provisioned `psql` client |

---

*Cross-reference: for the narrative version of this same territory — dependency direction between layers, which design patterns are genuinely present vs. absent (Repository, Service Layer, DI, Adapter, Facade, Strategy, Event-Driven, Feature Flags, etc.) with evidence for each — see `03_SYSTEM_ARCHITECTURE.md` Parts A–C.*
