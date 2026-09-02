# 00 — Executive Summary

*The 5-minute version of this whole case study. Read this after the master map, before picking which numbered file to dive into.*

---

## 1. What Quantalyze is

Quantalyze is a live Next.js 14 TypeScript web app (quantalyze.demandion.ai) that turns Indian-listed-company earnings-call PDF transcripts into structured investment intelligence — a single-quarter "Deep Dive," a quarter-over-quarter "Delta Analysis," and a multi-quarter "Insights" synthesis — for equity-research analysts and portfolio managers who otherwise hand-build an "earnings pointer sheet" every quarter across a 200+ company coverage universe. It runs the transcript through several parallel, schema-constrained Google Gemini 2.5 Flash Lite calls, caches the structured JSON in Azure-hosted Postgres, and streams pipeline progress to the browser over NDJSON. It also sells the same intelligence as a metered, API-key-gated public API (`lib/public-api/`, `app/api/public/v1/**`) — this is a monetized product with real unit economics (credit-based quotas, `lib/credits.ts`), not a demo.

## 2. The engineering story, in one paragraph

Quantalyze started on Jan 15 2026 as an ambitious Python multi-agent/RAG/memory platform — "NotionWealth Intelligence" (`finance-agent/`, `disclosure-analysis-pipeline/`): FAISS vector search, a "control plane," a research-replay engine, Slack/Gmail integrations, an MCP tool server. By late February it hadn't shipped anything a user could touch, so the founder rebuilt it in three weeks as a much narrower Next.js app — five parallel structured-output LLM calls instead of an agent framework, a Postgres cache instead of a memory layer. *That* version is what's live today. It has since been migrated twice more under real usage/cost pressure: Supabase (Auth/Postgres/Storage) + Vercel → Azure Database for PostgreSQL + Azure Blob Storage + Microsoft Entra External ID (three documented moves, `docs/superpowers/plans/2026-07-09..13`) → then an undocumented second hop from Azure App Service to Azure Container Apps (`19_ARCHITECTURE_DECISION_LOG.md`, ADR-01; `14_DEVOPS_CLOUD.md` §7). That sequence — over-scope, recognize it, cut to what ships, then keep hardening the parts that matter (auth, data residency, billing) while knowingly deferring the parts that don't yet (evaluation, tests, full auth coverage) — is the single engineering-judgment story to have ready for an interview.

## 3. What's real vs. what the repo's own docs claim — read this before anything else

**This is the finding every reader is surprised by, and it must be understood first.** `README.md` and `TECHNICAL_ARCHITECTURE.md` (dated "v2.0.0 — June 2026") describe a Supabase-native stack: Supabase Auth (JWT), Supabase Postgres (10 tables, RLS on 3), Supabase Storage, deployed to Vercel. **None of this is what's running in production.** The code that actually executes — `lib/repositories/index.ts`, `auth.ts`, `Dockerfile`, `.github/workflows/deploy-azure.yml` — is entirely Azure-native:

| Docs claim | Code actually wires up |
|---|---|
| Supabase Auth (JWT) | **NextAuth v5 + Microsoft Entra External ID** (`auth.ts`) |
| Supabase Postgres, RLS on 3 tables | **Raw `pg.Pool` → Azure Database for PostgreSQL Flexible Server**; RLS enforced on **zero** live tables (Azure Postgres has no `auth.uid()`; `scripts/migrate-schema-to-azure.ts` strips it at deploy) |
| Supabase Storage `transcripts` bucket | **Azure Blob Storage**, container `transcripts` (`AzureBlobStorageRepository`) |
| Vercel deploy | **Azure Container Apps** via Docker + GitHub Actions OIDC (and the docs that *do* exist describe an intermediate Azure App Service stage never updated when it moved again) |
| "10 tables" | **16 tables** (13 `CREATE TABLE` statements across 11 migrations, several dead RLS/FK constructs) |

Every `Postgres*Repository`/`Supabase*Repository` pair in `lib/repositories/*.ts` still carries the dead Supabase implementation side by side with the live one — proof this was a completed, deliberate Strangler Fig migration (dated specs exist for each leg in `docs/superpowers/plans/` and `specs/`), not sloppiness — but the top-level docs were simply never updated after it, and would misdirect an onboarding engineer, an incident responder, or a security auditor who trusted them (`20_TECHNICAL_DEBT_AND_GAPS.md` #1, #2). Full trace: `03_SYSTEM_ARCHITECTURE.md` Part C, `07_DATA_ARCHITECTURE.md` §0.

## 4. The 7 findings that matter most

| # | Finding | Cite | Detail in |
|---|---|---|---|
| 1 | **Docs describe Supabase+Vercel; production is fully Azure** (Postgres Flexible Server, Blob, Entra ID, Container Apps) — a real, completed migration the docs never caught up to. | `lib/repositories/index.ts`; `docs/superpowers/plans/2026-07-*` | 03, 07, 20 (#1) |
| 2 | **The "5 parallel agents" are LLM-powered functions, not agents.** Every call is one fixed-prompt, fixed-`responseSchema` `generateContent()` invocation — zero tool-calling, zero autonomy, zero LangGraph/CrewAI. Real agent/RAG/memory work exists only in the archived, unwired `finance-agent/` prototype. | `lib/pipeline.ts` (`invokeStructured`); `package.json` (no agent framework) | 06 |
| 3 | **14 of 24 internal API routes have zero authentication** — including four `*seed*` routes that trigger unbounded Gemini spend against the project's own API key, and a `DELETE /api/v1/kpis` that wipes the whole cache table, all reachable by anyone with the URL. | `app/api/v1/seed-analysis/route.ts`, `kpis/route.ts`; `middleware.ts` only covers `/api/public/*` | 08 §9, 20 |
| 4 | **Zero automated tests, zero AI evaluation, in production.** No Jest/Vitest/Playwright, no `*.test.ts` anywhere; verification is `tsc --noEmit` + manual browser QA. A real 4-stage LLM-as-judge evaluator exists only in the archived prototype, never wired to the live app. | `package.json` (no test deps); `finance-agent/disclosure_pipeline/src/judge_evaluator.py` | 12, 13 |
| 5 | **No retries on any Gemini call**, anywhere — a `Promise.race` timeout just stops *awaiting*; the request keeps running server-side, wasting spend. The archived prototype's Python code (`finance-agent/vertex.py`) had 3x exponential-backoff retry logic the production TypeScript never carried forward — resilience regressed on the rewrite. | `lib/pipeline.ts:189-214` et al. | 11, 20 |
| 6 | **Two real, self-documented concurrency/financial bugs**: `lib/credits.ts`'s `checkAndDeduct()` is a non-atomic read-then-write that can silently under-charge users under concurrent requests (unlike its sibling `apiAccess.ts`, which got the atomic-`ON CONFLICT` fix); and `lib/divergence-score.ts` reads fields off `insights_cache` that the pipeline that populates it never writes — flagged in-code as "preserved per Strangler Fig discipline," not silently patched. | `lib/credits.ts:33-49`; `lib/divergence-score.ts:60-67` | 07, 20 (#3) |
| 7 | **No prompt-injection mitigation** — raw, unsanitized transcript text (scraped from Screener.in/BSE, third-party and not adversarially vetted) is interpolated directly into every Gemini prompt, with no delimiter framing, no "treat as data" instruction, no output-side check. Blast radius is bounded by `responseSchema` (still valid JSON) but not eliminated — a crafted transcript could skew `signal_classification` undetected. | `lib/pipeline.ts:461`, `lib/solo-pipeline.ts:178` | 11 (SECURITY), 20 (#5) |
| 8 (bonus, impressive) | **Genuinely solid Azure incident engineering**: `lib/postgres/client.ts`'s retry-once-on-connection-reset logic, keyed to a real Azure VNet TCP-idle-reaping failure mode, paired with tuned keepalive — the single best-engineered reliability mechanism in the codebase. Plus OIDC-federated (no stored credentials) CI/CD, SHA-256-hashed API keys, private-VNet-only Postgres. | `lib/postgres/client.ts:26-72` | 11 (RELIABILITY), 15 |

## 5. How to use this folder

1. **Start with `QUANTALYZE_ENGINEERING_MASTER_MAP.md`** — the spine; every other file is a deep-dive into one node of its diagram.
2. **Then this file (`00_EXECUTIVE_SUMMARY.md`)** — you're here.
3. **Then pick sections by what you're prepping for:**
   - *"What is this system, end to end?"* → `01_REPOSITORY_MAP.md`, `02_PRODUCT_ARCHITECTURE.md`, `03_SYSTEM_ARCHITECTURE.md`, `04_RUNTIME_FLOWS.md`
   - *"How does the AI actually work?"* → `05_AI_ARCHITECTURE.md`, `06_AGENT_ARCHITECTURE.md`, `10_AI_PRODUCT_INTEGRATION.md`, `12_AI_EVALUATION.md`
   - *"Prove you can do backend/data/infra engineering"* → `07_DATA_ARCHITECTURE.md`, `08_BACKEND_ARCHITECTURE.md`, `11_PRODUCTION_ENGINEERING.md`, `14_DEVOPS_CLOUD.md`
   - *"Prepping for the Azure Senior AI Engineer interview specifically"* → `15_AZURE_JD_MAPPING.md`, then `17_CROSS_JD_COMPETENCY_MATRIX.md`
   - *"Prepping for the Oneleet Full-Stack AI Product Engineer interview specifically"* → `16_ONELEET_JD_MAPPING.md`, then `17`
   - *"I need to defend a specific file line-by-line in a live-coding/walkthrough round"* → `18_FILE_LEVEL_TEACHING_GUIDE.md`
   - *"Why did you build it this way / what would you change"* → `19_ARCHITECTURE_DECISION_LOG.md`, `20_TECHNICAL_DEBT_AND_GAPS.md`, `21_REBUILD_FROM_SCRATCH.md`
   - *"Give me the actual question bank"* → `22_INTERVIEW_PREPARATION.md`, `23_PROJECT_DEFENSE.md`
   - *"What do I build next to close gaps"* → `24_90_DAY_ENGINEERING_LEARNING_PLAN.md`

## 6. Interview-readiness verdict

**Azure Senior AI Engineer** (per `15_AZURE_JD_MAPPING.md`'s Overall Verdict): mixed, with a clear shape — **strong-to-excellent on the Azure platform/infrastructure half of the JD, essentially zero on the Azure AI services half.** The candidate has real, incident-tested Azure engineering: Container Apps, Postgres Flexible Server on a private VNet, Blob Storage, Entra External ID, OIDC-federated CI/CD, executed as a deliberate multi-phase migration with specs and cutover procedures, and credible "learned it by breaking it in prod" detail (the Entra `oid`/`sub` bug, the App Service host-trust issue, the VNet TCP-idle-reaping bug). That is not junior cloud work. Against that, the AI provider throughout is Google Gemini, not any Azure AI service — zero hands-on Azure OpenAI, AI Foundry, AI Search, Document Intelligence, or Copilot Studio experience, and this must never be blurred with the archived prototype's Vertex-branded-but-not-Vertex-API Python code. Highest-leverage fix before interviewing: port one low-risk pipeline (`lib/sector-narrative.ts`) to call Azure OpenAI behind a flag, converting "zero Azure AI experience" into one honest, specific, comparable data point.

**Oneleet Full-Stack AI Product Engineer** (per `16_ONELEET_JD_MAPPING.md`'s Summary Assessment): a strong evidentiary match for the *core* of this JD — integrating an AI service into a real product, schemas that drive UI directly (`ui_component_type` field-driven rendering), fail-closed error handling, and a deliberate multi-cache strategy with three distinct invalidation mechanisms — because this is, functionally, exactly the kind of product Quantalyze *is*. The honest, specific gaps: **zero feedback-loop/usage-analytics instrumentation on AI features** (checked precisely — no PostHog/Mixpanel/gtag, `app/privacy/page.tsx` states outright "we do not use third-party analytics trackers"), **no shared reusable AI-call abstraction** despite five near-identical `getGenAI()`/timeout-wrapper call sites (duplication, not a pattern — and the duplication has already caused a real behavioral inconsistency in missing-API-key handling), **no production monitoring/observability SDK** beyond `console.log`, **no data-visualization library** (CSS-bar-as-metaphor only), and **no WebSockets** (NDJSON streaming is real and defensible but is one-shot HTTP response streaming, not persistent bidirectional — state this precisely, not as "real-time WebSocket features"). None of these are disqualifying for a role fundamentally about *building* AI product surfaces well, which this repo demonstrates repeatedly — but each is a specific, checkable thing an interviewer can probe, and the honest answer to each is more credible in the room than a stretched one.
