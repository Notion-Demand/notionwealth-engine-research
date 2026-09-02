# QUANTALYZE ENGINEERING MASTER MAP

**Read this file first, and come back to it repeatedly.** Every other file in this folder (`00_...` through `24_...`) is a deep-dive into one slice of this map. This document is the spine that connects them.

> **A correction that supersedes the repo's own docs**: `README.md`, `TECHNICAL_ARCHITECTURE.md`, and `.env.local.example` describe Quantalyze running on **Supabase (Auth/Postgres/Storage) + Vercel**. That was true once. It is not true today. The live code has completed a full migration to **Azure Database for PostgreSQL + Azure Blob Storage + Microsoft Entra External ID + Azure Container Apps**, documented in `docs/superpowers/specs/2026-07-*-azure-*-migration-design.md`, with the Supabase-era classes left in the tree as dead code. Every node below reflects the **live, verified** architecture, not the stale docs. This drift is itself Finding #1 in `20_TECHNICAL_DEBT_AND_GAPS.md`.

---

## 0. What Quantalyze actually is, in one paragraph

Quantalyze is a Next.js 14 TypeScript web app, live at quantalyze.demandion.ai, that turns Indian-listed-company earnings-call PDF transcripts into structured investment intelligence — a single-quarter "Deep Dive" brief, a quarter-over-quarter "Delta" analysis, and a multi-quarter "Insights" synthesis — by running the transcript text through several parallel, schema-constrained calls to Google Gemini 2.5 Flash Lite, caching the structured JSON result in Azure-hosted Postgres, and streaming pipeline progress to the browser over NDJSON. It also sells the same intelligence as a metered, API-key-authenticated public API (`lib/public-api/`). It began life in January 2026 as a much more ambitious Python multi-agent/RAG/memory platform ("NotionWealth Intelligence," `finance-agent/`), which was abandoned in favor of this leaner architecture in late February 2026 — the single most important engineering decision in the repo's history (see §7 and `19_ARCHITECTURE_DECISION_LOG.md`, ADR-01).

---

## 1. The master pipeline diagram

```mermaid
flowchart TD
    U[USER: equity research analyst / PM] -->|selects ticker + quarter| UI[FRONTEND\napp/dashboard/DashboardClient.tsx]
    UI -->|POST fetch, streamed| API[API ROUTE\napp/api/v1/analyze/route.ts]
    API --> SVC[PIPELINE FUNCTION\nlib/pipeline.ts: runPipeline]
    SVC -->|check cache first| REPO[REPOSITORY\nlib/repositories/analysis.ts\nPostgresAnalysisRepository]
    REPO -->|cache miss| PDF[PDF EXTRACTION\npdf-parse, extractPdfText]
    PDF --> CTX[CONTEXT CONSTRUCTION\nprompt = transcript text + fixed system prompt]
    CTX --> AGENTS[5 PARALLEL LLM CALLS\nAGENT_PROMPTS in lib/pipeline.ts\nPromise.all -> invokeStructured]
    AGENTS --> LLM[(Gemini 2.5 Flash Lite\n@google/generative-ai\nresponseSchema JSON mode)]
    LLM --> STRUCT[STRUCTURED OUTPUT\ntyped per lib/api-contracts/v1/company.ts]
    STRUCT --> DELTA[TEMPORAL DELTA + SYNTHESIS\nadditional Gemini calls, ~19 total/run]
    DELTA --> VALID[VALIDATION\nlocalValidation:\nsign/score self-consistency only\nNO source-quote checking]
    VALID --> PERSIST[PERSISTENCE\nPostgresAnalysisRepository.save\nanalysis_results table, JSONB]
    PERSIST --> STREAM[NDJSON STREAM\nReadableStream + controller.enqueue\none line per pipeline step]
    STREAM --> RENDER[FRONTEND RENDER\nreader.getReader() loop\ncomponents/AgentPanel.tsx +\ncomponents/EarningsReport.tsx]
    RENDER --> ACTION[USER ACTION\nread brief / export PDF / re-run\nNO usage analytics captured]
    ACTION -.->|no feedback loop exists| SVC
```

Three production pipelines share this shape with different fan-out:
| Pipeline | Entry route | Core function | Gemini calls/run | Cache table |
|---|---|---|---|---|
| Delta Analysis (QoQ) | `app/api/v1/analyze/route.ts` | `lib/pipeline.ts::runPipeline` | ~19 (5 agents × 2 quarters + deltas + synthesis + validation) | `analysis_results` |
| Deep Dive (single quarter) | `app/api/v1/analyze/solo/route.ts` | `lib/solo-pipeline.ts` | 1 comprehensive call | `solo_analysis_cache` |
| Multi-Quarter Insights | `app/api/v1/insights/route.ts` | `lib/insights-pipeline.ts` | N (per-quarter) + 1 (synthesis) | `insights_cache` |

Full stage-by-stage tracing with line citations: `04_RUNTIME_FLOWS.md`. Full AI-mechanics tracing: `05_AI_ARCHITECTURE.md`.

---

## 2. Layer-by-layer map, with the file that owns each layer

| Layer | Owns it | Real or stubbed? |
|---|---|---|
| **PRODUCT** | README.md (marketing framing — accurate on *what*, stale on *how*) | — |
| **USER WORKFLOW** | `app/dashboard`, `app/insights`, `app/screener`, `app/sectors`, `app/calendar`, `app/videos`, `app/request` | Real, all wired |
| **FRONTEND** | `app/*/page.tsx` (Server Component, auth-gate only) + `app/*/*Client.tsx` (Client Component, all real data-fetching) | Real; SSR data-fetch is NOT used — every page ships empty and hydrates client-side (`09_FRONTEND_ARCHITECTURE.md`) |
| **API** | `app/api/v1/**/route.ts` (internal, frontend-facing) + `app/api/public/v1/**/route.ts` (external, API-key-facing) | Real, but auth is inconsistently applied — 14 of 24 `/api/v1` routes have **no** auth check (`08_BACKEND_ARCHITECTURE.md`) |
| **APPLICATION / SERVICE** | `lib/pipeline.ts`, `lib/solo-pipeline.ts`, `lib/insights-pipeline.ts`, `lib/kpi-extractor.ts`, `lib/sector-narrative.ts`, `lib/divergence-score.ts`, `lib/services/sectorThesisService.ts` | Real; each pipeline file duplicates its own Gemini-call wrapper rather than sharing one (`16_ONELEET_JD_MAPPING.md` finding) |
| **DOMAIN / CONTRACTS** | `lib/api-contracts/v1/*.ts` | Real TypeScript DTOs, enforced at the Gemini `responseSchema` boundary — no separate runtime validator (no zod) |
| **DATA / REPOSITORY** | `lib/repositories/*.ts` → `lib/repositories/index.ts` wires only `Postgres*Repository` + `AzureBlobStorageRepository` | Real; dead `Supabase*Repository` classes still sit alongside each live one |
| **RETRIEVAL** | — | **NOT PRESENT in production.** No vector DB, no embeddings, no semantic search anywhere in the live app. (Existed only in the archived prototype: `finance-agent/core/vector.py`, FAISS.) |
| **AI CONTEXT** | Prompt strings built inline in each pipeline file (e.g. `AGENT_PROMPTS` in `lib/pipeline.ts`) | Real but unsanitized — raw scraped transcript text is interpolated directly into every prompt, no prompt-injection mitigation (`11_PRODUCTION_ENGINEERING.md`) |
| **AGENTS** | `lib/pipeline.ts`'s "5 specialist agents" | **These are LLM-powered functions, not agents** — fixed prompt, fixed schema, no tool-calling, no autonomy. See §4 and `06_AGENT_ARCHITECTURE.md` for the full argument. |
| **ORCHESTRATION** | Hard-coded `Promise.all` fan-out/fan-in across sequential phases inside each pipeline function | Real, but no retries — a `Promise.race` timeout just stops *awaiting* a call; the underlying Gemini request keeps running server-side |
| **LLM** | `@google/generative-ai` SDK, model `gemini-2.5-flash-lite`, temperature `0` | Real. **Not** Vertex AI (despite `finance-agent/vertex.py`'s name, it also just calls the Gemini Developer API). **Not** Azure OpenAI — zero Azure AI service usage anywhere in the repo. |
| **STRUCTURED OUTPUT** | Gemini `responseSchema` / `responseMimeType: application/json` | Real, this is the actual mechanism enforcing shape — not manual regex/parsing |
| **VALIDATION** | `localValidation()` in `lib/pipeline.ts` | **Partial** — checks internal sign/score self-consistency only; never checks a quote against the source PDF. A real LLM-as-judge validator exists but only in the archived prototype (`finance-agent/disclosure_pipeline/src/judge_evaluator.py`) — never wired into production. |
| **PERSISTENCE** | `analysis_results`, `solo_analysis_cache`, `insights_cache`, `sector_intelligence`, `earnings_calendar`, `concall_links`, `kpi_snapshots`, `promoter_activity`, `user_tickers`, `user_credits`, `api_access_keys` — all Azure Postgres, JSONB payloads | Real; two of the busiest cache tables have **no unique constraint / index** on their natural cache key (`07_DATA_ARCHITECTURE.md`) |
| **API RESPONSE** | NDJSON `ReadableStream`, one JSON line per pipeline step | Real and genuinely incremental (verified byte-for-byte in `09_FRONTEND_ARCHITECTURE.md`) — but content-bearing lines only arrive after each full agent call resolves; this is not token-level streaming |
| **FRONTEND (render)** | `components/AgentPanel.tsx` (progress UI), `components/EarningsReport.tsx` (result UI) | Real; `AgentPanel.tsx` is purely presentational — the stream-reading loop actually lives in `lib/api.ts`/`DashboardClient.tsx` |
| **USER ACTION** | PDF export (`jsPDF`/`html2canvas`), watchlist star, re-run | Real but two independent, unsynced PDF-export code paths and two independent, unsynced watchlist systems (`09_FRONTEND_ARCHITECTURE.md`) |
| **FEEDBACK** | — | **NOT IMPLEMENTED.** No click-tracking, no "was this useful," no analytics of any kind — `app/privacy/page.tsx` states outright "we do not use third-party analytics trackers." |
| **EVALUATION** | — | **NOT IMPLEMENTED** in production. Exists only as an archived, never-wired-in prototype (`12_AI_EVALUATION.md`). |
| **IMPROVEMENT** | — | Manual: the founder reads output and edits prompts. No systematic loop. |

---

## 3. The two systems in this one repo — never conflate them

| | **PRODUCTION** (live, real users) | **ARCHIVED PROTOTYPE** ("NotionWealth Intelligence") |
|---|---|---|
| Location | `app/`, `lib/`, `components/`, `supabase/migrations/` (schema history, not the live DB) | `finance-agent/`, `disclosure-analysis-pipeline/` |
| Language/stack | TypeScript, Next.js 14 | Python, FastAPI, Streamlit |
| AI provider | Gemini 2.5 Flash Lite, direct API key | Google Vertex AI *branding* but actually also the Gemini Developer API (`finance-agent/vertex.py` never imports `vertexai`) |
| Retrieval | None | FAISS vector store (`core/vector.py`, `core/embeddings.py`) — genuine RAG |
| Orchestration | Hard-coded parallel function calls | `control/control_plane.py` — a router that in practice hard-codes one downstream call regardless of input |
| Memory | None (each run is stateless, cache is just a KV table) | `core/financial_memory.py`, `control/research_replay.py` — a real attempt at persisted, replayable research sessions |
| Evaluation | None | `disclosure_pipeline/src/judge_evaluator.py` — real 4-stage LLM-as-judge |
| Commit activity | 159 commits (`app/`), 89 commits (`lib/`) | 15 commits total (`finance-agent/`), 4 (`disclosure-analysis-pipeline/`) |
| Status | **This is the product.** | Frozen since Feb 27 2026. Real engineering, real interview material — but never claim it's "in production." |

---

## 4. The load-bearing verdict: is any of this "agentic"?

**No, not in production.** The test applied throughout this case study: an *agent* has autonomy over what to do next — it can choose tools, loop, or branch based on intermediate reasoning. An *LLM-powered function* is a fixed pipeline stage that calls an LLM once with a fixed prompt and returns structured output.

Every one of the ~19 Gemini calls in a full Delta Analysis run is `invokeStructured()` — one `generateContent` call, one fixed system prompt, one fixed `responseSchema`, zero `tools`/`functionDeclarations` (verified absent by grep across the entire `lib/` and `app/` tree). The "5 specialist agents" are five differently-prompted calls to the same function, run in `Promise.all`. This is **parallel LLM-function composition with schema-constrained outputs** — a legitimate, production-proven pattern — but it is not multi-agent autonomy, and claiming otherwise in an interview is the single easiest thing to get caught overstating. Full argument: `06_AGENT_ARCHITECTURE.md`.

The only place anything resembling real agent autonomy exists in the whole repo is the archived prototype's Google-Search-grounded `market_validation.py`, and an external MCP server (`finance-agent/mcp_server.py`) that a separate LLM client could call — neither is part of the live product.

---

## 5. Model boundaries — know these cold for interviews

| Term | Where it applies in Quantalyze |
|---|---|
| **Model** | `gemini-2.5-flash-lite` — a weight, not a product on its own |
| **AI service** | The Gemini Developer API (Google's hosted endpoint) — Quantalyze is a *consumer* of this, never operates a model |
| **AI application** | `lib/pipeline.ts` etc. — code that constructs prompts, calls the service, validates/persists output |
| **AI feature** | "Delta Analysis," "Deep Dive," "Promoter Pledge Monitor" — user-facing capabilities built from one or more AI applications |
| **Product** | Quantalyze itself — AI features + auth + billing + UI + the public API |
| **Platform** | Not really present — there's no multi-tenant extensibility layer, no plugin system; Quantalyze is a product, not a platform, despite `README_ARCHIVE.md`'s original "platform" framing |

And the discipline boundary:
| Discipline | Where it shows up |
|---|---|
| Data science | Effectively absent — no exploratory modeling, no evaluation metrics, no experiment tracking |
| ML engineering | Effectively absent — no model training/fine-tuning/serving; Gemini is used purely as an API |
| **AI engineering** | The core of this repo — prompt construction, structured-output enforcement, multi-call orchestration, caching around LLM calls |
| Software engineering | Repository pattern, service layer, migrations, auth, deployment — real and substantial |
| Full-stack engineering | Next.js App Router spanning both server routes and React UI, one language end-to-end |
| Product engineering | The pivot from `finance-agent/` to the live app, the metered public API, the credits system — decisions driven by what would actually ship and monetize |

---

## 6. Where every other file in this folder fits

| File | What it answers |
|---|---|
| `00_EXECUTIVE_SUMMARY.md` | The 5-minute version of everything below |
| `01_REPOSITORY_MAP.md` | Full directory-by-directory inventory, tech stack, entry points |
| `02_PRODUCT_ARCHITECTURE.md` | What problem it solves, for whom, and the real pipeline diagrams |
| `03_SYSTEM_ARCHITECTURE.md` | Which design patterns are genuinely present vs. absent |
| `04_RUNTIME_FLOWS.md` | Every user journey traced file-by-file, including auth and the public API |
| `05_AI_ARCHITECTURE.md` | The deepest AI-mechanics file — prompts, schemas, streaming, failure handling |
| `06_AGENT_ARCHITECTURE.md` | The agent-vs-function verdict, in full, both systems |
| `07_DATA_ARCHITECTURE.md` | Full schema, the Azure migration, caching, concurrency bugs |
| `08_BACKEND_ARCHITECTURE.md` | API design, auth gaps, error handling, the 14-unauthenticated-routes finding |
| `09_FRONTEND_ARCHITECTURE.md` | Component tree, streaming consumption, accessibility (absent), no charts |
| `10_AI_PRODUCT_INTEGRATION.md` | The exact chain from AI capability to pixel on screen, for every feature |
| `11_PRODUCTION_ENGINEERING.md` | Reliability/performance/scalability/security/observability/cost, graded honestly |
| `12_AI_EVALUATION.md` | Why there is none in production, and what one would look like here |
| `13_TESTING.md` | Why there are effectively zero automated tests |
| `14_DEVOPS_CLOUD.md` | The full CI/CD pipeline and the undocumented App Service → Container Apps jump |
| `15_AZURE_JD_MAPPING.md` | Requirement-by-requirement match against the Azure Senior AI Engineer JD |
| `16_ONELEET_JD_MAPPING.md` | Requirement-by-requirement match against the Oneleet Full-Stack AI Product Engineer JD |
| `17_CROSS_JD_COMPETENCY_MATRIX.md` | One 48-row table across both JDs |
| `18_FILE_LEVEL_TEACHING_GUIDE.md` | Tier-1 files taught in full reproducible depth |
| `19_ARCHITECTURE_DECISION_LOG.md` | Every major pivot, with problem/alternative/tradeoff |
| `20_TECHNICAL_DEBT_AND_GAPS.md` | 20 ranked, cited, real problems |
| `21_REBUILD_FROM_SCRATCH.md` | How to build Quantalyze v2 the right way |
| `22_INTERVIEW_PREPARATION.md` | Question bank generated directly from this codebase |
| `23_PROJECT_DEFENSE.md` | Can you credibly say "I built an end-to-end AI product"? |
| `24_90_DAY_ENGINEERING_LEARNING_PLAN.md` | What to build next, and in what order |
| `25_READING_AND_REFERENCE_LIST.md` | Curated books/courses/articles per section (80% O'Reilly, 20% public), leveled Junior → Mid → Senior → Lead, for anyone going zero to hero to leading AI engineering here |

---

## 7. The one story to have ready

Quantalyze started on Jan 15 2026 as an ambitious Python multi-agent cognition platform with vector memory, a control plane, and a research-replay engine. By late February, that hadn't shipped anything a user could touch. The founder rebuilt it in three weeks as a much narrower Next.js app — five parallel structured-output LLM calls instead of an agent framework, a Postgres cache instead of a memory layer — and *that* version is what's live today, has a monetized public API, and has since been migrated twice more (Vercel → Azure App Service → Azure Container Apps) as real usage and cost pressure demanded. That sequence — over-scope, recognize it, cut to what ships, then keep hardening the parts that matter (auth, data residency, billing) while knowingly deferring the parts that don't yet (evaluation, tests, full auth coverage) — is the actual engineering judgment this repo demonstrates, more than any individual technique in it. See `19_ARCHITECTURE_DECISION_LOG.md` ADR-01 for the full evidence trail, and `23_PROJECT_DEFENSE.md` for how to present it.
