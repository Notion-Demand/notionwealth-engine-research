# Quantalyze → Azure Senior AI Engineer JD Mapping

**Method note:** every claim below is backed by an exact file path in this repo. Where I found nothing, I say "None found" rather than stretch. Two source layers exist:
- **Live production app** (repo root — `app/`, `lib/`, `components/`, `supabase/migrations/`, `.github/workflows/`, `Dockerfile`): this is what's actually deployed and serving users at quantalyze.me.
- **Archived prototype** (`finance-agent/`, `disclosure-analysis-pipeline/`): an earlier, more ambitious agent/RAG architecture ("NotionWealth Intelligence"), verified to have **zero cross-references** from `app/` or `lib/` (`grep -rln "finance-agent" app lib components` returns nothing except one incidental string match in `lib/nifty50.ts`). Only ~15 commits touched it vs. 159/89 for `app/`/`lib/`, frozen since a Feb 2026 pivot. Cited only where explicitly flagged as prototype work — never as production experience.

**The single most important framing fact for this JD:** Quantalyze's AI provider is **Google Gemini** (`@google/generative-ai`, model `gemini-2.5-flash-lite`), not Azure OpenAI or Azure AI Foundry. The candidate has **zero hands-on experience with any Azure AI service** (Azure OpenAI, AI Foundry, AI Search, Document Intelligence, Copilot Studio). What the candidate *does* have — and this is substantial, not a consolation prize — is real, hands-on **Azure platform engineering**: a live production app running on Azure Container Apps, backed by Azure Database for PostgreSQL Flexible Server on a private VNet, Azure Blob Storage, Microsoft Entra External ID for auth, and a GitHub Actions OIDC deployment pipeline to Azure Container Registry. This is genuine cloud infrastructure experience on Azure; it is just not *Azure AI* experience. Every row below keeps that line sharp.

---

## 1. "Design, build, and operate an Azure AI platform and AI Lab environment"

**Quantalyze evidence:** None, in the "AI Lab environment" sense (a managed workspace like Azure AI Foundry Hub/Project, prompt flow, model catalog). What exists is a *self-built* AI pipeline platform, hand-rolled rather than assembled from Azure's AI tooling:
- `lib/pipeline.ts`, `lib/solo-pipeline.ts`, `lib/insights-pipeline.ts`, `lib/sector-narrative.ts`, `lib/kpi-extractor.ts` — five independent Gemini-backed pipelines, each with its own model client, JSON schema (`SchemaType.OBJECT` via `@google/generative-ai`), and timeout/retry logic.
- `TECHNICAL_ARCHITECTURE.md` §4 documents the full pipeline topology (multi-agent, parallel fan-out, temporal delta comparison, validation layer) — this is real system design, just not on Azure's AI platform.

**Capability demonstrated:** Designing and operating a multi-stage, multi-model AI inference system end-to-end (orchestration, schemas, caching, cost control, timeouts) — the *transferable* skill this requirement is testing for. Azure AI Foundry's Hub/Project/prompt-flow concepts map onto real experience the candidate already has (agent orchestration, structured-output contracts, model-call cost tracking in `TECHNICAL_ARCHITECTURE.md` §9).

**Missing capability:** Azure AI Foundry itself — provisioning a Hub/Project, using its model catalog, prompt flow, evaluation harness, or connections to Azure OpenAI/AI Search from within it.

**What to build to close the gap:** Stand up an Azure AI Foundry project, wire Azure OpenAI (even GPT-4o-mini) behind one of Quantalyze's existing pipelines (e.g., swap `sector-narrative.ts`'s Gemini call for an Azure OpenAI call behind a feature flag) purely as a learning exercise — this directly demonstrates "I know exactly what I built without Azure's tooling, and I've now done the equivalent with it."

**Likely interview question:** "Walk me through how you'd port one of your Gemini pipelines to Azure AI Foundry — what changes, what stays the same?"

**Strength rating: Weak** (strong adjacent engineering, zero direct Azure AI Foundry/Lab experience).

---

## 2. "Identify, design, build, and deploy AI solutions that create measurable business value"

**Quantalyze evidence:**
- `PRODUCT_NOTES.md` (2026-06-15 entry) — a documented 5-area evaluation framework (Pain, Innovation, Convenience, Cost, Functional Gap) used to choose which AI feature to build next (Portfolio Watchtower / promoter pledge divergence scoring), including explicitly rejecting three other candidate surfaces with stated reasoning.
- `TECHNICAL_ARCHITECTURE.md` §9 — real unit economics: Gemini cost per analysis type (~$0.03/delta run), infra cost tiers by user count, and a stated 95% gross margin target at 50 users against a ₹35K/year price point.
- `PRODUCT_NOTES.md` "Go-to-Market" section — buyer segmentation (Tier 1–5) tied directly to which AI feature ships next.

**Capability demonstrated:** Genuine product-engineering judgment — tying AI feature scope to unit economics and a specific buyer, not just building for its own sake. This is one of the strongest, most concretely-evidenced items in the whole repo.

**Missing capability:** No evidence of doing this at *enterprise* scale — no stakeholder sign-off process, no ROI tracked post-launch against a business case (the pilot referenced in `PRODUCT_NOTES.md` is "zero paying customers" as of that entry).

**What to build:** Nothing code-side; this is a narrative asset — practice quantifying it out loud (cost-per-analysis, margin math, feature-prioritization framework) since it's already on paper.

**Likely interview question:** "Tell me about a time you decided *not* to build an AI feature. What made you say no?" (Answer is already written in `PRODUCT_NOTES.md`'s rejected surfaces #2–#4.)

**Strength rating: Strong** (for a solo/pre-revenue context; explicitly not enterprise-scale).

---

## 3. "Develop and maintain AI applications using Azure AI services"

**Quantalyze evidence:** None. Every AI call in the live app goes to Google's Gemini API (`lib/pipeline.ts:6`, `lib/solo-pipeline.ts:6`, `lib/insights-pipeline.ts:10`, `lib/sector-narrative.ts:14`, `lib/kpi-extractor.ts:5` — all `import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai"`). No Azure AI SDK (`@azure/ai-*`, `@azure/openai`) appears anywhere in `package.json`.

**Capability demonstrated:** "Develop and maintain AI applications" generically — yes, extensively (5 pipelines, structured outputs, streaming, caching, 300s function budgets). "Using Azure AI services" specifically — no.

**Missing capability:** Any Azure AI SDK experience at all.

**What to build:** The single highest-leverage exercise for this whole JD: pick one low-risk pipeline (e.g. `lib/sector-narrative.ts` — smallest, single-call, non-critical-path) and add an Azure OpenAI-backed variant behind an env flag, reusing the exact same `SchemaType`-equivalent structured-output contract. This is a weekend of work that converts "I've never touched Azure AI services" into "I ported a production JSON-schema pipeline from Gemini to Azure OpenAI and can speak to the API differences."

**Likely interview question:** "What's different about calling Azure OpenAI vs. the Gemini API you used at Quantalyze?" (Be ready to answer honestly: "I haven't yet, but here's what I understand the differences to be based on docs, and here's how my Gemini schema contracts would map." Do not claim you have.)

**Strength rating: None** (be exact about this in interview — overclaiming here is the single easiest thing to get caught on).

---

## 4–8. Azure OpenAI / Azure AI Foundry / Azure AI Search / Document Intelligence / Azure Functions

**Quantalyze evidence:** None found for any of these five, in `app/`, `lib/`, `package.json`, `.github/workflows/`, or `docs/superpowers/**`. Confirmed via `grep -rli "azure.openai\|ai-foundry\|azure.*search\|document.intelligence\|azure.functions"` across the repo — zero hits.

**What Quantalyze does have that's adjacent but must not be conflated with these:**
- **PDF document extraction** — but via `pdf-parse` (`lib/pipeline.ts`, `lib/solo-pipeline.ts`), a plain Node.js library, not Azure Document Intelligence's layout/form-recognition models. `lib/pipeline.ts` extracts raw transcript text and caps it at 120,000 characters — no structured form/table extraction, no OCR, no confidence scores. This is meaningfully less sophisticated than Document Intelligence and should be described as such.
- **Search-like features** — `app/api/v1/screener/route.ts` and `lib/nifty200-sampler.ts` do in-app filtering/ranking over Postgres rows, not a vector/semantic search service. This is SQL filtering, not Azure AI Search.
- **Serverless functions** — the app *did* run on Vercel serverless functions (`TECHNICAL_ARCHITECTURE.md` — "300s max duration") and now runs as a long-lived container on Azure Container Apps (`Dockerfile`, `.github/workflows/deploy-azure.yml`), not Azure Functions specifically. Genuinely different execution model (always-on container vs. event-triggered function).

**Capability demonstrated:** Transferable pattern-recognition (candidate clearly understands what document extraction, search/ranking, and serverless deployment *are* — has built the equivalent from scratch with different tools) but zero hands-on time in any of these five specific products.

**Missing capability:** All five, directly.

**What to build:** If interviewing for a role this Document-Intelligence/AI-Search-heavy, the highest-leverage single exercise is running one earnings-transcript PDF through Azure Document Intelligence's prebuilt layout model and comparing its structured output to what `pdf-parse` + a Gemini call currently extracts in `lib/pipeline.ts` — concrete, comparable, and directly relevant to this product's actual document type.

**Likely interview question:** "How would Document Intelligence change your transcript-extraction pipeline versus what you built with pdf-parse + an LLM call?"

**Strength rating: None** across all five.

---

## 9. Python / .NET

**Quantalyze evidence:**
- **Python — real, but confined to the archived prototype**: `finance-agent/` is FastAPI + Python throughout — `finance-agent/api/auth.py` (JWT verification, `python-jose`), `finance-agent/agents/*.py` (5 agent modules: financial, risk, competitive, capital allocation, portfolio), `finance-agent/core/vector.py` (FAISS), `finance-agent/mcp_server.py` (MCP tool server). This is real Python engineering — FastAPI dependency injection, async patterns, Pydantic — but it is **frozen prototype code, not production**, per the context above.
- **.NET — None found.** No `.csproj`, `.sln`, or C# file anywhere in the repo.
- **Production Python: effectively none.** The live app (`app/`, `lib/`) is 100% TypeScript.

**Capability demonstrated:** Real Python fluency (FastAPI, async, Pydantic, JWT, vector search) — just not in the shipped product.

**Missing capability:** .NET entirely; Python *in a production/enterprise Azure context* specifically.

**What to build:** Nothing new needed — the Python skill is real. The framing for interview is: "My production stack is TypeScript; my Python experience is from a prototype I built and later archived when I pivoted architectures — here's what that Python code does." Don't imply the FastAPI backend is live.

**Likely interview question:** "I see mostly TypeScript in your recent work — how comfortable are you picking Python back up for an Azure AI role?"

**Strength rating: Moderate** (Python: real but prototype-only and stale since Feb 2026; .NET: None).

---

## 10. Microsoft Copilot Studio

**Quantalyze evidence:** None found anywhere in the repo (`grep -rli "copilot studio\|power virtual agents"` — zero hits).

**Capability demonstrated:** None directly. Adjacent: the candidate has built conversational-adjacent AI surfaces (structured Q&A extraction from earnings-call transcripts, `lib/pipeline.ts`'s evasiveness-scoring agent analyzing Q&A dynamics) but nothing resembling a low-code conversational-bot builder.

**Missing capability:** All of it — Copilot Studio is a fundamentally different (low-code, Power Platform-integrated) tool than anything in this codebase.

**What to build:** A minimal Copilot Studio bot (even a toy FAQ bot over the Quantalyze product docs) would be the fastest way to have *something* concrete to say.

**Likely interview question:** "Have you built anything in Copilot Studio or Power Virtual Agents?" — answer honestly: no, but here's adjacent conversational/agent-orchestration work.

**Strength rating: None.**

---

## 11. AI assistants

**Quantalyze evidence:** Quantalyze is not an assistant/chat product — it's a structured-extraction and dashboard product. The closest analog is the multi-agent pipeline itself (`lib/pipeline.ts` — 5 "specialist agents": Revenue & Growth, Margins & Profitability, Cost Structure, CapEx & Balance Sheet, Macro & Risk, each with its own system prompt and schema) and, in the archived prototype, `finance-agent/agents/*.py` (financial, risk, competitive, capital-allocation, portfolio agents) plus `finance-agent/control/control_plane.py` for task routing (prototype only — verify path before citing further).

**Capability demonstrated:** Multi-agent *pipeline* design (parallel specialist agents feeding a synthesis stage) — genuinely relevant background for assistant-style orchestration, even though the end-user product isn't conversational.

**Missing capability:** No conversational/turn-based assistant UX, no memory/context management across a dialogue, no tool-use loop in the production app.

**What to build:** If "AI assistants" in this JD means a chat-based product surface, the fastest credible bridge is adding a lightweight Q&A chat UI over an already-analyzed transcript in Quantalyze (RAG over the cached `insights_cache`/`analysis_results` payloads) — small, concrete, and directly demoable.

**Likely interview question:** "Your product is a dashboard, not a chatbot — how would you turn it into a conversational assistant, and what would you keep from the current pipeline architecture?"

**Strength rating: Weak-to-Moderate** (strong on agent orchestration internals, weak on assistant-facing UX).

---

## 12. Data management

**Quantalyze evidence:**
- `TECHNICAL_ARCHITECTURE.md` §2 — 10 (now 12, post-migration) Postgres tables with defined cache keys, JSONB payloads, and per-table RLS/access documentation.
- `supabase/migrations/001_initial.sql` through `011_api_access.sql` — 11 sequential, reviewable schema migrations.
- `docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md` — a full data migration plan: schema replay with FK adaptation (dropping `REFERENCES auth.users(id)` since auth moved to a separate identity provider), `pg_dump`/`psql` data migration, and **two-layer verification** — row-count parity *and* random-sample content hashing (not just counts) for the largest-payload tables, explicitly because "row counts alone can miss corruption... a JSON payload column truncated or mis-encoded during dump/restore."
- `lib/postgres/client.ts` — connection pooling with retry-on-transient-error logic, keepalive tuning against a documented real production incident ("dead connections hung 20-74s... Azure's outbound network path... silently reaps TCP flows that appear idle").

**Capability demonstrated:** This is genuinely strong, production-grade data management: schema evolution discipline, a real zero-data-loss migration with verification and rollback, and debugging real connection-pool failure modes against Azure's networking behavior (not textbook — a specific, cited production incident).

**Missing capability:** No evidence of data governance frameworks (data classification, retention policy enforcement, lineage tracking) at an enterprise scale.

**What to build:** Nothing — this is already one of the strongest items in the whole repo, cite it directly.

**Likely interview question:** "Walk me through your database migration — how did you verify no data was lost or corrupted?" (Answer is in `docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md` §Verification — the row-count + content-hash two-layer approach is a genuinely good answer.)

**Strength rating: Strong.**

---

## 13. NoSQL databases

**Quantalyze evidence:** None. Every persistence layer in this codebase — Supabase-era and current Azure-era alike — is Postgres. `supabase/migrations/001_initial.sql:43` uses `JSONB NOT NULL` for the `payload` column on `analysis_results`; this is **semi-structured data stored inside a relational database**, not a NoSQL database. No Cosmos DB, MongoDB, DynamoDB, or Redis appears anywhere in `package.json`, `lib/`, or the migration specs.

**Precision required here:** JSONB gives flexible, schema-light payload storage with the ability to still run relational joins, indexes, and ACID transactions across it and structured columns in the same table (e.g. `analysis_results(company_ticker, q_prev, q_curr, payload JSONB)`). That is a genuinely useful pattern and worth describing accurately — but it does **not** demonstrate NoSQL database experience (no eventual-consistency tradeoffs faced, no partition-key design, no document/key-value data-modeling decisions, no Cosmos DB RU/throughput tuning).

**Missing capability:** Any actual NoSQL database — Cosmos DB specifically, given this is an Azure JD.

**What to build:** Model one of the existing JSONB payloads (e.g. `analysis_results.payload`) as a Cosmos DB document instead, and reason through the partition-key choice (ticker? ticker+quarter?) — a short, honest exercise that also clarifies for interview *why* Postgres+JSONB was actually the right call here (relational joins against `q_prev`/`q_curr`, ACID guarantees for the credit-deduction path in `lib/credits.ts`).

**Likely interview question:** "You used Postgres JSONB — when would you have reached for Cosmos DB instead, and why didn't you here?" (Good answer available: transactional guarantees for the credit system, relational joins across ticker/quarter, no need for global multi-region writes at this scale.)

**Strength rating: None** (be precise: JSONB experience is real and worth mentioning, but it is not NoSQL experience — say this explicitly if asked).

---

## 14. CI/CD

**Quantalyze evidence:**
- `.github/workflows/deploy-azure.yml` — real, working GitHub Actions pipeline: OIDC federated identity login (`azure/login@v2` with `client-id`/`tenant-id`/`subscription-id` secrets, no stored publish credentials), `az acr login`, `docker build`/`push` (tagged both by commit SHA and `latest`), then `az containerapp update` to roll the new image onto Azure Container Apps. Triggers on push to `main` and manual `workflow_dispatch`.
- `docs/superpowers/specs/2026-07-10-azure-hosting-migration-design.md` — documents an *earlier* CI/CD iteration (App Service + `azure/webapps-deploy`, also OIDC) before the app moved to Container Apps, showing the pipeline itself was evolved, not just written once.

**Capability demonstrated:** Real, working, OIDC-authenticated (not secret-based) container CI/CD to Azure. This is directly and fully relevant to the JD's "cloud-based application development" and general Azure operational maturity.

**Missing capability:** No automated test gate in the pipeline (explicitly acknowledged in the migration specs: "No automated test runner exists in this repo" — `docs/superpowers/specs/2026-07-10-azure-hosting-migration-design.md` §Testing) — verification is `npx tsc --noEmit` plus manual smoke tests, not CI-run tests. No staged rollout/canary — `az containerapp update` is a direct full-traffic swap.

**What to build:** Add a `npm run build`/`tsc --noEmit` gate as an actual CI step before `docker build` (currently done manually per the migration docs, not enforced by the workflow file itself) — small, concrete, closes a real gap.

**Likely interview question:** "Your deploy workflow builds and pushes on every merge to main with no test gate — how do you catch regressions before they're live?"

**Strength rating: Strong** (real OIDC-based container CI/CD; missing automated test gating is an honest, statable gap).

---

## 15. Git

**Quantalyze evidence:** Per the case-study context, heavy real usage — 159 commits touching `app/`, 89 touching `lib/`, 343+ total across the project's lifetime, including a full architectural pivot (`finance-agent` → Next.js) captured in the diverging commit histories of `finance-agent/` (only ~15 commits, frozen) vs. the live app. (No `.git` directory is present in this extracted archive to inspect directly — this is stated per the case-study's own framing, not independently re-verified here.)

**Capability demonstrated:** Sustained, incremental, real-world git usage across a genuine architecture pivot — not a single green-field commit dump.

**Strength rating: Strong** (per stated commit history; not independently re-verifiable from this file tree since `.git` isn't present in the extract).

---

## 16. Cloud-based application development

**Quantalyze evidence:** The single strongest cluster of evidence in the whole repo:
- `Dockerfile` — real multi-stage build (deps → builder → runner), non-root user, Next.js `standalone` output.
- `.github/workflows/deploy-azure.yml` — OIDC → ACR → Azure Container Apps.
- `lib/postgres/client.ts` — Azure Database for PostgreSQL Flexible Server, private VNet-only access, TLS enforced, connection retry/keepalive tuned against real Azure networking behavior.
- `lib/repositories/storage.ts` (`AzureBlobStorageRepository`) — Azure Blob Storage with SAS-token signed URLs, an in-memory list cache added specifically to fix a real perf problem ("~200 parallel per-ticker searches on one page load... ~200 full-container enumerations per request").
- `auth.ts` — Microsoft Entra ID via NextAuth, with two real production bugs fixed and documented inline: (1) `trustHost: true` needed because "Azure App Service isn't recognized [by Auth.js's auto-trust], found by testing the real deployment, not caught by type-checking"; (2) mapping Entra's `oid` claim instead of the OIDC `sub` claim because the pairwise `sub` "broke every credits/analysis query with 'invalid input syntax for type uuid', found by testing the real deployment."
- `docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md` and `2026-07-10-azure-hosting-migration-design.md` — two fully worked migration specs (Vercel→App Service→Container Apps; Supabase→Azure Postgres/Blob) with explicit scope, non-goals, cutover procedures, and rollback plans.
- `docs/superpowers/specs/2026-07-13-azure-auth-migration-design.md` — Supabase Auth → Microsoft Entra External ID, including re-pointing the FastAPI backend's JWT verification from HS256/shared-secret to RS256/JWKS.

**Capability demonstrated:** This is real, substantial, multi-service Azure platform engineering — compute (Container Apps, and previously App Service), data (Postgres Flexible Server on private VNet), storage (Blob), identity (Entra External ID), networking (VNet/subnet delegation, private DNS zones), and CI/CD (OIDC federated GitHub Actions) — executed as a deliberate, staged, documented migration off a different platform (Supabase+Vercel), not just a first deploy. The debugged production incidents (Entra `oid` vs `sub`, App Service host-trust, Azure VNet TCP-idle-reaping) are exactly the kind of "learned it by breaking it in prod" detail that reads as credible in an interview, not rehearsed.

**Missing capability:** No Infrastructure-as-code (Bicep/Terraform) — explicitly named as a non-goal in the migration specs ("one-time manual/CLI provisioning is proportionate for a single environment at this stage"). No multi-region/HA configuration, no deployment slots, no Key Vault (App Service Application Settings used instead, also an explicit, reasoned non-goal).

**What to build:** Bicep or Terraform for the current manually-provisioned Azure resources (VNet, subnets, Postgres Flexible Server, Storage account, Container App) — the highest-leverage single artifact to build before an Azure-heavy interview, since IaC is the most obvious, easily-tested gap in an otherwise strong story.

**Likely interview question:** "Walk me through your Azure architecture end-to-end — what talks to what, and what's on a private network vs. public?" (This is answerable in detail and well-documented — genuinely one of the strongest things to lead with in this interview.)

**Strength rating: Strong.**

---

## 17. AI governance

**Quantalyze evidence:** None found. No model card, no documented evaluation harness, no bias/fairness testing, no approval workflow for prompt/schema changes. The closest adjacent artifact is the **local, non-LLM validation layer**: `TECHNICAL_ARCHITECTURE.md` §4a "Phase 5 — Local Validation (no LLM)" — `localValidation()` (signal/score consistency check) and `computeMarketAlignment()` (cross-checking the AI's directional signal against actual stock price movement) — and the Screener's "confidence multiplier" system (`PRODUCT_NOTES.md`, 2026-05-26 entry) that discounts AI-generated signals based on `validation_score`, flag counts, and evasiveness scores, explicitly designed to catch and downweight a documented failure case (the "HCLTech narrative trap").

**Capability demonstrated:** Real, self-motivated output-quality control for an AI pipeline — deterministic, non-LLM checks gating what reaches the user, plus a documented postmortem-driven fix (the narrative-trap confidence multiplier was built *because* a bad signal shipped and was caught). This is adjacent to AI governance in spirit (reliability engineering around AI outputs) but is not governance in the compliance/policy sense.

**Missing capability:** No formal AI governance framework — no documented model risk assessment, no human-in-the-loop approval gate before an AI output reaches a paying customer, no audit trail of prompt/schema versions over time, no red-teaming process.

**What to build:** A lightweight "AI output changelog" — version-stamping the JSON schemas and system prompts in `lib/pipeline.ts` etc. and logging which version produced each cached `analysis_results` row — would convert "we have a validation layer" into a defensible, auditable governance story.

**Likely interview question:** "How do you know when your AI pipeline's output quality has regressed?" (Real, honest answer: the market-alignment/validation-score checks catch some cases; there's no formal eval harness or regression suite.)

**Strength rating: Weak.**

---

## 18. Security

**Quantalyze evidence:**
- Row-Level Security on user-scoped tables: `TECHNICAL_ARCHITECTURE.md` §2 documents RLS on `analysis_results`, `user_tickers`, `user_connections`; `docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md` "Watchlist security model" section shows a deliberate, explicitly-reasoned decision when RLS had no direct equivalent on raw Postgres (adding explicit `WHERE user_id = $1` filtering application-side, consciously chosen over rebuilding session-scoped Postgres RLS with GUCs).
- `middleware.ts` — the public partner API is gated by Bearer-token auth with **SHA-256-hashed API keys** (never stored/compared in plaintext), per-partner product entitlement checks, and daily quota enforcement, with every request logged (`requestId`, latency, status) as structured JSON.
- `middleware.ts:51-56` — an explicitly documented, honestly-acknowledged race condition in the rate limiter ("read-then-write, not an atomic increment... concurrent requests... can both pass. Acceptable at v1's scale... revisit with an atomic SQL increment... if a partner's volume makes the race actually matter") — this kind of documented, reasoned tradeoff is itself a security-maturity signal.
- Private networking: Postgres Flexible Server on a VNet-delegated subnet with **no public endpoint at all** (`docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md` §Networking).
- Auth: Microsoft Entra External ID, sign-in-only user flow (no self-registration — `docs/superpowers/specs/2026-07-13-azure-auth-migration-design.md`), RS256/JWKS token verification replacing an HS256 shared-secret scheme.

**Capability demonstrated:** Real, considered application and infrastructure security — least-privilege networking, hashed credentials, RLS/row-scoping discipline, and (notably) honest acknowledgment of a known-acceptable tradeoff rather than either ignoring it or over-engineering a fix prematurely.

**Missing capability:** No penetration testing, no dependency/vulnerability scanning in CI, no secrets manager (Key Vault explicitly deferred), no WAF/DDoS protection layer documented, no security incident response process.

**What to build:** Add `npm audit`/Dependabot (or equivalent) as an actual CI step — currently absent from `.github/workflows/deploy-azure.yml`.

**Likely interview question:** "Where's your biggest unaddressed security gap right now?" (Honest, available answer: the rate-limiter race condition, explicitly documented as an accepted tradeoff, plus no CI-level dependency scanning.)

**Strength rating: Moderate.**

---

## 19. Responsible AI

**Quantalyze evidence:** None found as a formal practice. Adjacent, real evidence: the same validation/confidence-multiplier system cited under "AI governance" above functions as a practical (if informal) responsible-AI control — it exists specifically to prevent the product from surfacing a confidently-wrong AI signal to a paying user making investment decisions, which is a real-stakes domain. `PRODUCT_NOTES.md` (2026-05-26) documents catching and fixing exactly this failure mode.

**Missing capability:** No fairness/bias evaluation (arguably lower-relevance for this specific domain — financial narrative extraction, not a protected-class-adjacent decision), no transparency documentation for end users about how AI-derived scores are produced, no explicit uncertainty communication in the UI beyond the validation/confidence scores.

**What to build:** Surface the existing `validation_score`/confidence multiplier more explicitly in the UI as an uncertainty indicator (it currently exists mostly for internal ranking, per `PRODUCT_NOTES.md`) — this is a small UI change with a real responsible-AI narrative behind it.

**Likely interview question:** "Your product gives investment-relevant signals from an LLM — how do you make sure users don't over-trust a wrong one?" (Real, available answer: the validation layer + confidence multiplier + narrative-trap detection.)

**Strength rating: Weak.**

---

## 20. GDPR

**Quantalyze evidence:** `app/privacy/page.tsx` — a real privacy policy with a "right to... request deletion of your account and associated data" clause and a stated data-collection scope. This is consumer-facing privacy-policy boilerplate, not a GDPR compliance program: no explicit lawful-basis analysis, no Data Protection Officer, no documented cross-border transfer mechanism (SCCs), no cookie-consent banner, no data retention schedule, no DSAR (data subject access request) process beyond "contact us." The product targets Indian capital-markets users (`README.md` — Nifty 200, SEBI disclosures); GDPR (EU-specific) applicability isn't even clearly triggered by the current user base.

**Capability demonstrated:** Baseline privacy-conscious product thinking (a real, though thin, privacy policy exists unprompted).

**Missing capability:** Everything that makes GDPR compliance actually GDPR compliance, as listed above.

**What to build:** Nothing product-side is obviously warranted (the product isn't EU-facing) — this is genuinely a "None/Weak, and honestly so" item; don't try to manufacture GDPR work that doesn't fit the product.

**Likely interview question:** "How would you make this GDPR-compliant if you onboarded an EU customer tomorrow?" — be ready to reason through it live rather than claim prior experience.

**Strength rating: Weak-to-None.**

---

## 21. Enterprise data protection

**Quantalyze evidence:** Same infrastructure evidence as "Security" above (private VNet, hashed API keys, RLS/row-scoping) plus the data-migration verification rigor (`docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md` §Verification — row-count + content-hash validation, explicit rollback plan). No encryption-at-rest documentation beyond what's default on Azure Postgres/Blob (not custom-configured), no customer-managed keys, no data classification scheme, no DLP tooling.

**Capability demonstrated:** Real infrastructure-level data protection discipline for a solo/small-team product; not enterprise-grade data governance.

**Strength rating: Weak-to-Moderate.**

---

## 22. Business stakeholder engagement

**Quantalyze evidence:** `PRODUCT_NOTES.md` "Go-to-Market" section — "Several back-to-back calls with PMS heads have produced warm leads," a tiered buyer landscape (Tier 1–5: PMS/family offices → AIFs/AMCs/wealth RMs → hedge funds/governance firms → broking platforms → lending/audit firms), and product decisions explicitly driven by what those calls surfaced (e.g., "PMS heads explicitly asked for exactly this combination" motivating the divergence-score feature).

**Capability demonstrated:** Real customer-discovery-driven product development — but this is evidence *about the person's process*, not something the repo can independently verify (no call transcripts, no CRM data in the repo). Treat as a resume/behavioral claim the product notes corroborate in spirit, not hard proof.

**Missing capability:** No evidence of engaging *internal* enterprise stakeholders (a security review board, a legal/compliance team, a large buying committee) — the described engagement is direct-to-buyer sales conversations at small/boutique firms, not enterprise procurement.

**Likely interview question:** "Tell me about a specific customer conversation that changed your product roadmap." (Real, specific answer available: the pledge-activity divergence feature, per `PRODUCT_NOTES.md`.)

**Strength rating: Moderate** (real and specific, but small-firm/founder-led sales conversations, not enterprise stakeholder management at scale).

---

## 23. Logistics / supply chain / freight / project logistics

**Quantalyze evidence:** None. Quantalyze is a capital-markets / equity-research intelligence product (earnings call transcript analysis for Indian-listed companies) with zero domain overlap with logistics, freight, supply chain, or project logistics. `README.md`, `PRODUCT_NOTES.md`, and every route/table in the schema are equity-research-specific (tickers, sectors, promoter pledges, earnings calendars).

**Strength rating: None.** Don't stretch this — if this JD genuinely requires logistics-domain knowledge, that's a real gap this project does not close, and pretending otherwise in an interview would be immediately detectable.

---

## Overall Verdict

**How strong is this candidate for this specific Azure Senior AI Engineer JD, based on Quantalyze alone?**

Mixed, and the mix has a clear shape: **strong-to-excellent on the Azure *platform/infrastructure* half of this JD, and essentially zero on the Azure *AI services* half.** The candidate has done real, substantial, well-documented, incident-tested Azure engineering — Container Apps, Postgres Flexible Server on private VNets, Blob Storage, Entra External ID, OIDC-federated CI/CD — executed as a deliberate multi-phase migration with specs, cutover procedures, and rollback plans, and with credible "learned it by breaking it in prod" detail (the Entra `oid`/`sub` bug, the App Service host-trust issue, the Azure VNet TCP-idle-reaping bug). That is not junior-level cloud work; it reads as someone who has actually operated production infrastructure on Azure, not just followed a tutorial.

Against that, the AI provider throughout is Google Gemini, not any Azure AI service, and the archived `finance-agent/` prototype's Vertex AI/FAISS/agent work — while real hands-on RAG and multi-agent experience — is explicitly frozen, unwired into production, and must never be described as live or as Azure-native (it uses Google's Vertex AI product family, not Azure's). A JD this Azure-AI-services-heavy (Azure OpenAI, AI Foundry, AI Search, Document Intelligence, Copilot Studio) is testing for exactly the experience this repo does not contain.

**The single highest-leverage thing to build/learn before interviewing:** Port one real Quantalyze pipeline — `lib/sector-narrative.ts` is the smallest, lowest-risk candidate — to call Azure OpenAI instead of Gemini, keeping the exact same structured-output contract shape. This does two things at once: (1) it converts "zero Azure AI experience" into "I've made one real call to Azure OpenAI and can compare it directly to what I built on Gemini," which is a small but genuine and honestly-describable claim; and (2) it forces hands-on time with an Azure AI Foundry project/resource, which is the platform this JD is actually about. Paired with the existing Azure infrastructure story (which needs no more building, only clear articulation), this closes the single largest gap with the least wasted effort.
