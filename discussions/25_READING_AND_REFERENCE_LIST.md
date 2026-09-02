# 25 — Reading & Reference List: Zero to Hero to AI Engineering Lead

*A companion volume to the engineering case study in this folder. Start at `QUANTALYZE_ENGINEERING_MASTER_MAP.md` if you haven't yet — this file assumes you're working through (or plan to work through) `discussions/00` through `discussions/24` and gives you real material to read alongside each one.*

## What this is

This list mirrors the 25 topic sections of the case study exactly — `00_EXECUTIVE_SUMMARY.md` through `24_90_DAY_ENGINEERING_LEARNING_PLAN.md` — one reading block per section. Every recommendation is tied to a *specific, cited finding* in that section's file (a real bug, a real pattern, a real gap), not a generic "learn X" reading list. The goal is that by the time you've worked through a section's reading, you can explain *why* the case study's verdict about that part of Quantalyze is correct — and what you'd need to know to fix, extend, or defend it yourself.

**Sourcing:** every item is a real result pulled live from either the O'Reilly Learning platform catalog or the public web — no invented titles, authors, or URLs. Across all 25 sections the split lands at roughly **81% O'Reilly (books, courses, videos) / 19% public references** (engineering blogs, official docs, individually-authored posts from recognized practitioners) — close to the requested 80/20. A handful of sections note thin catalog coverage on a narrow sub-topic (e.g. Vitest-specific material, Azure Service Bus queue-worker patterns) rather than padding with a loosely-related title; those notes are left in place.

**Reading tiers:** each section's reading is broken into **Junior**, **Mid-level**, **Senior**, and — where genuinely relevant — **Aspiring Lead**. These aren't strict gates; they're a rough map of *when* a piece of reading starts to pay off. A junior engineer can and should read ahead when curious. A section without a "Lead" tier simply didn't have a leadership-specific angle worth forcing — that's noted inline rather than invented.

## How to use this, as a path (not just a per-section index)

The 25 sections don't carry equal weight for someone starting from zero. A suggested order, in three overlapping stages:

**Stage 1 — Orientation (roughly your first month).** Read section **00** first — it's the 5-minute version of the whole codebase and the one story you should have ready. Then work through the **Junior** tier of **01, 02, 03, 09** (repo map, product architecture, system architecture, frontend) to build a mental model of what the app actually is and how it's laid out, followed by **05** and **06** (AI architecture, agent architecture) — the two sections that most directly correct the "5 AI agents" framing you'll hear informally, with the load-bearing distinction (workflows vs. agents) that shows up in nearly every other section's reading list too.

**Stage 2 — Depth (roughly months 2–6, the "Hero" stretch).** This is where most of the actual skill-building happens. Work the **Mid-level** and **Senior** tiers of **04, 07, 08, 10, 11, 12, 13, 14** — runtime flows, data architecture, backend/API design, AI product integration, production engineering, AI evaluation, testing, and DevOps/cloud. These eight sections cover the full stack of what it takes to run this kind of AI product in production, each anchored to a real, specific gap (unauthenticated routes, non-atomic caching, zero prompt-injection mitigation, zero automated tests, no staging environment) rather than an abstract topic. Treat **24** (the 90-Day Learning Plan) as the operating plan for this stage — it's not more reading, it's the week-by-week exercise list this reading supports.

**Stage 3 — Judgment and leadership (ongoing, from roughly month 6 on).** Sections **17–23** — the cross-JD competency matrix, the file-level teaching guide, the architecture decision log, the technical debt catalog, the rebuild-from-scratch design exercise, interview preparation, and project defense — are where technical depth turns into the ability to *prioritize, decide, and communicate* like the person leading this function. Read the **Aspiring Lead** tier across every earlier section alongside these; that tier is deliberately distributed throughout rather than concentrated in one place, because leadership judgment gets built by seeing it applied section by section, not read as a separate topic. Sections **15** and **16** (the two named-JD mappings) sit alongside this stage as a concrete, external calibration of where you stand.

None of this replaces reading the actual case study files themselves, or the actual code they cite — the reading list is scaffolding for understanding both, not a substitute for either.

---

## 00 — EXECUTIVE SUMMARY
*Case study source: `discussions/00_EXECUTIVE_SUMMARY.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** This is the 5-minute version of the whole case study: the headline finding that `README.md`/`TECHNICAL_ARCHITECTURE.md` describe a Supabase+Vercel stack that production abandoned months ago for Azure Postgres/Blob/Entra ID/Container Apps, and the "one story to have ready" — an ambitious Python multi-agent prototype (`finance-agent/`) was cut down to a much leaner Next.js app in three weeks once it became clear the original scope wouldn't ship. Understanding *why* that trade-off was the right call, and how to keep documentation honest through a real infrastructure migration, is the single most important judgment call in the repo.

**Reading path by level:**

**Junior — build the fundamentals**
- [The Software Engineer's Guidebook](https://learning.oreilly.com/library/view/-/9789083381831/?orm_source=mcp) — Gergely Orosz — A practical map of what the day-to-day job actually involves beyond tutorials — the right first read before diving into a real, messy production codebase like this one.

**Mid-level — go deeper / production concerns**
- [Documenting Software Architectures: Views and Beyond, 2nd Edition](https://learning.oreilly.com/library/view/-/9780132488617/?orm_source=mcp) — Paul Clements et al. — Quantalyze's #1 finding is that its own architecture docs went stale mid-migration; read what disciplined architecture documentation is supposed to look like so you can recognize the gap.

**Senior — tradeoffs, failure modes, design judgment**
- [Managing Trade-offs in Adaptable Software Architectures](https://learning.oreilly.com/library/view/-/9780128028919/?orm_source=mcp) — Ivan Mistrik, Nour Ali, Rick Kazman, John Grundy, Bradley Schmerl — The deepest available treatment of trade-off analysis in architecture — directly applicable to the "over-scope, recognize it, cut to what ships" decision that defines this codebase's history.

**Aspiring Lead — systems thinking, org/technical leadership**
- [The Staff Engineer's Path](https://learning.oreilly.com/library/view/-/9781098118723/?orm_source=mcp) — Tanya Reilly — The executive summary's central judgment call (deferring evaluation and tests while hardening auth, data residency, and billing) is exactly the kind of prioritization call this book is about.
- [Engineering Leadership: The Hard Parts](https://learning.oreilly.com/library/view/-/9781098175627/?orm_source=mcp) — Juan Pablo Buriticá, James Turnbull — For the leadership side of the same story: deciding, under real constraints, what a small team ships now versus what it consciously leaves undone.

**Public references**
- [Strangler Fig Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig) — Azure Architecture Center, Microsoft Learn — Quantalyze's own migration code explicitly invokes "Strangler Fig discipline" (dead Supabase repository classes kept alongside live Postgres ones); this is the canonical description of the pattern it actually used.

---

## 01 — REPOSITORY MAP
*Case study source: `discussions/01_REPOSITORY_MAP.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** A flat, scannable inventory of the repo — what's live (`app/`, `lib/`) versus archived (`finance-agent/`, 101 files but only 15 commits ever), the real tech stack versus what `package.json`'s leftover name (`notionwealth-frontend`) suggests, and where dead code (unused Supabase repository classes, a stale `.env.local.example`) still sits in the tree. The core skill this file teaches is reading an unfamiliar, historically-layered codebase and telling what's actually running from what's just still there.

**Reading path by level:**

**Junior — build the fundamentals**
- [Working Effectively with Legacy Code](https://learning.oreilly.com/library/view/-/0131177052/?orm_source=mcp) — Michael Feathers — The foundational skill this file requires: orienting yourself in an unfamiliar tree and distinguishing what's safe to touch, what's dead, and what's load-bearing, without being told.

**Mid-level — go deeper / production concerns**
- [Refactoring: Improving the Design of Existing Code, 2nd Edition](https://learning.oreilly.com/library/view/-/9780134757681/?orm_source=mcp) — Martin Fowler — Once you can tell live from dead code, this is what comes next — e.g. Quantalyze's own `lib/transcript-fetcher.ts` and `app/api/v1/request/route.ts` are two drifted, duplicated copies of the same scraping logic that should have been consolidated.

**Senior — tradeoffs, failure modes, design judgment**
- [Fundamentals of Software Architecture, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098175504/?orm_source=mcp) — Mark Richards, Neal Ford — Auditing a technology-stack table like this file's §C (TypeScript/Next.js vs. Python/FastAPI, direct SDK calls vs. framework) requires the architectural-characteristics vocabulary this book builds — the ability to judge *why* a stack choice holds up, not just list what it is.

**Public references**
- *Thin coverage, noted rather than padded*: no reputable public article was found specifically on "reading commit-activity/file-count divergence as an architecture signal" (e.g. this repo's 159 commits on `app/` vs. 15 on the larger-by-file-count `finance-agent/`) — the O'Reilly items above cover the underlying skill well without a dedicated public piece.

---

## 02 — PRODUCT ARCHITECTURE
*Case study source: `discussions/02_PRODUCT_ARCHITECTURE.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** This file's core finding is that roughly half of Quantalyze's perceived "intelligence" — validation scoring, market-alignment, divergence flags, screener ranking — is deterministic post-processing over LLM output, not further AI calls, and that this split is a deliberate, auditable product decision, not an accident. It also traces the real monetization model (credit-based quotas, a metered partner API) and the concrete "why this beats pasting into ChatGPT" argument, which is the product-thinking core of the whole case study.

**Reading path by level:**

**Junior — build the fundamentals**
- [Building AI-Powered Products](https://learning.oreilly.com/library/view/-/9781098152697/?orm_source=mcp) — Marily Nika — A foundational treatment of deciding *what* in a product should be AI versus plain deterministic software — exactly the distinction this file's §4 table draws out line by line.

**Mid-level — go deeper / production concerns**
- [Software Requirements, 3rd Edition](https://learning.oreilly.com/library/view/-/9780735679658/?orm_source=mcp) — Karl Wiegers, Joy Beatty — Quantalyze's product is modeled directly on a real analyst artifact (the hand-built "earnings pointer sheet," `xl/`); this is the standard text on turning a real workflow into a shippable spec.

**Senior — tradeoffs, failure modes, design judgment**
- [AI Engineering](https://learning.oreilly.com/library/view/-/9781098166298/?orm_source=mcp) — Chip Huyen — The deepest available treatment of deciding, end-to-end in a real product, where structured-output LLM calls belong and where cheaper deterministic code should do the work instead — the exact judgment call behind this file's AI-vs-not table.

**Aspiring Lead — systems thinking, org/technical leadership**
- [Software Architecture and Decision-Making: Leveraging Leadership, Technology, and Product Management to Build Great Products](https://learning.oreilly.com/library/view/-/9780138249694/?orm_source=mcp) — Srinath Perera — Directly matches the founder-level calls traced in this file: credit pricing, a monetized partner API, and deciding what to build first — leadership, product, and technology as one balancing act.

**Public references**
- [Emerging Architectures for LLM Applications](https://a16z.com/emerging-architectures-for-llm-applications/) — Andreessen Horowitz — The widely-cited public reference for exactly the category of system Quantalyze is: a schema-constrained LLM pipeline wrapped in a real product with caching and orchestration, not a chat interface.

---

## 03 — SYSTEM ARCHITECTURE
*Case study source: `discussions/03_SYSTEM_ARCHITECTURE.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** A pattern-by-pattern audit with evidence for each: Repository pattern is genuinely present (dual `Supabase*`/`Postgres*` implementations behind one interface), Service Layer is real but narrow (one instance, `SectorThesisService`), Dependency Injection is manual and only partially applied, and — the most consequential absence — there is **no provider abstraction for the LLM layer** even though one exists for storage, meaning swapping Gemini for another model would require editing five files' worth of duplicated code.

**Reading path by level:**

**Junior — build the fundamentals**
- [Head First Design Patterns, 2nd Edition](https://learning.oreilly.com/library/view/-/9781492077992/?orm_source=mcp) — Eric Freeman, Elisabeth Robson — Learn what Adapter, Facade, and Strategy actually are, with worked examples, before you can recognize which ones this codebase genuinely uses (Adapter, Facade) and which it doesn't (Strategy, Factory in the GoF sense).

**Mid-level — go deeper / production concerns**
- [Dependency Injection: Principles, Practices, and Patterns](https://learning.oreilly.com/library/view/-/9781617294730/?orm_source=mcp) — Steven van Deursen, Mark Seemann — Quantalyze's DI is "manual constructor injection in one place (`SectorThesisService`), singleton imports everywhere else" — this is the full treatment of what a consistently-applied version of that same idea looks like, and why the inconsistency is a real risk (untestable code without module mocking).

**Senior — tradeoffs, failure modes, design judgment**
- [Building Microservices, 2nd Edition](https://learning.oreilly.com/library/view/-/9781492034018/?orm_source=mcp) — Sam Newman — Even though Quantalyze isn't a microservices system, this book's treatment of service boundaries, facades, and where abstraction pays for itself versus where it's premature is the right lens for judging why the Repository abstraction was worth building here and the LLM-provider abstraction wasn't (yet).

**Public references**
- [Catalog of Patterns of Enterprise Application Architecture](https://martinfowler.com/eaaCatalog/) — Martin Fowler — The original, still-canonical public reference for the Repository, Service Layer, and Data Mapper patterns this file audits — read the source definitions this codebase's own patterns are measured against.

---

## 04 — RUNTIME FLOWS
*Case study source: `discussions/04_RUNTIME_FLOWS.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** File-by-file, function-by-function traces of every real request path — dashboard load, transcript ingestion, the three AI pipelines, and the NDJSON streaming mechanism that drives the live "watching 5 agents work" UI. It also surfaces a precise, real inconsistency: `/api/v1/insights` is missing the `closed`-flag guard and pipeline-timeout race that `/api/v1/analyze` and `/api/v1/analyze/solo` both have, a genuine gap between three routes that look identical from the outside.

**Reading path by level:**

**Junior — build the fundamentals**
- [Real-World Next.js, 2nd Edition](https://learning.oreilly.com/library/view/-/9781807424459/?orm_source=mcp) — Dan Neciu, Faris Aziz, Michele Riva — Learn the App Router request lifecycle (Server Component → Client Component → Route Handler) this file traces in every single flow before trying to follow the traces themselves.

**Mid-level — go deeper / production concerns**
- [Distributed Tracing in Practice](https://learning.oreilly.com/library/view/-/9781492056621/?orm_source=mcp) — Austin Parker, Daniel Spoonhower, Jonathan Mace, Ben Sigelman, Rebecca Isaacs — This file *is* a hand-written trace of every request through the stack; this book teaches the discipline of doing that systematically and automatically, which Quantalyze itself only does for one narrow surface (`middleware.ts`'s structured request log).

**Senior — tradeoffs, failure modes, design judgment**
- [Mastering Distributed Tracing](https://learning.oreilly.com/library/view/-/9781788628464/?orm_source=mcp) — Yuri Shkuro — Goes deeper into exactly the kind of inconsistency this file surfaces (one streaming route missing a safety mechanism the other two have) — the failure-mode-level thinking needed to catch that class of bug by design, not by luck.

**Aspiring Lead — systems thinking, org/technical leadership**
- [Designing Distributed Systems, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098156343/?orm_source=mcp) — Brendan Burns — For deciding, at a system level, which safety mechanisms (timeouts, closed-flag guards) should be a shared, enforced pattern across every streaming route rather than something each author reimplements — the organizational fix for the gap this file finds.

**Public references**
- [Using Server-Sent Events (SSE) to stream LLM responses in Next.js](https://upstash.com/blog/sse-streaming-llm-responses) — Upstash Engineering Blog — A concrete, practitioner-written walkthrough of the exact streaming pattern (`ReadableStream` + NDJSON-style chunked responses) this file traces through `app/api/v1/analyze/route.ts`.

---

## 05 — AI ARCHITECTURE
*Case study source: `discussions/05_AI_ARCHITECTURE.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** The deepest AI-mechanics file in the case study: every prompt, every `responseSchema`, and a precise account of what's genuinely implemented (structured-output extraction, cache-before-call cost savings) versus what's missing (no secondary schema validation like Zod, no safety-settings tuning, no token/cost accounting, and — most concretely — raw unsanitized transcript text interpolated directly into every prompt with zero prompt-injection mitigation).

**Reading path by level:**

**Junior — build the fundamentals**
- [Prompt Engineering for LLMs](https://learning.oreilly.com/library/view/-/9781098156145/?orm_source=mcp) — John Berryman, Albert Ziegler — Start here: this file catalogs 9 distinct hand-written system prompts in `lib/pipeline.ts` alone, each role-primed and closed with an anti-fabrication instruction — learn the underlying craft before evaluating whether it's well done.

**Mid-level — go deeper / production concerns**
- [A Simple Guide to Retrieval Augmented Generation](https://learning.oreilly.com/library/view/-/9781633435858/?orm_source=mcp) — Abhinav Kimothi — Production Quantalyze has **zero** retrieval — every pipeline re-reads and re-truncates the raw transcript on every run; the archived prototype's FAISS-backed pipeline is genuine RAG. Read this to understand precisely what retrieval-augmented generation is supposed to buy you, so you can articulate exactly what production is trading away by not having it.

**Senior — tradeoffs, failure modes, design judgment**
- [Designing Large Language Model Applications](https://learning.oreilly.com/library/view/-/9781098150495/?orm_source=mcp) — Suhas Pai — Covers the structured-output/schema-enforcement pattern Quantalyze relies on throughout, and the gap this file identifies precisely: Gemini's `responseSchema` is a soft guarantee, and nothing (no Zod, no runtime check) validates the JSON that comes back before it's persisted.
- [AI-Native LLM Security](https://learning.oreilly.com/library/view/-/9781836203759/?orm_source=mcp) — Vaibhav Malik, Ken Huang, Ads Dawson — Directly addresses this file's flagged security gap: raw, third-party-scraped transcript text is interpolated into every prompt with no delimiter framing and no "treat as data" instruction, bounded only (not eliminated) by schema enforcement.
- [Evals for AI Engineers](https://learning.oreilly.com/library/view/-/9798341660717/?orm_source=mcp) — Shreya Shankar, Hamel Husain — Production has exactly two automated checks on LLM output (an internal score-consistency check and a stock-price cross-check) and no factuality check against the source PDF; this is the standard current text on building the evaluation harness that gap calls for.

**Public references**
- [Prompt injection explained](https://simonwillison.net/2023/Nov/27/prompt-injection-explained/) — Simon Willison — The most widely cited public explanation of exactly the vulnerability class this file flags as unmitigated in every one of Quantalyze's ~19 Gemini calls per pipeline run.

---

## 06 — AGENT ARCHITECTURE
*Case study source: `discussions/06_AGENT_ARCHITECTURE.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** The load-bearing verdict of the whole case study: Quantalyze's "5 specialist agents" are five differently-prompted, fixed-schema `generateContent()` calls dispatched by hard-coded `Promise.all` fan-out — zero tool-calling, zero autonomy, zero dynamic branching on model output. This section draws the precise line between that pattern (legitimate, cost-effective **parallel LLM-function composition**) and what a genuine agent requires: the ability to choose a tool, loop on its own output, or plan a sequence of steps not fixed in advance by the calling code. The one place real tool-use autonomy appears in the whole repo — Gemini + Google Search grounding in the archived prototype's `market_validation.py` — was never ported to production.

**Reading path by level:**

**Junior — build the fundamentals**
- [Building Applications with AI Agents](https://learning.oreilly.com/library/view/-/9781098176495/?orm_source=mcp) — Michael Albada — Start here to build a working definition of what an agent actually does (tool selection, looping, planning) so that Quantalyze's own "agent" terminology can be checked against a real standard rather than taken at face value.

**Mid-level — go deeper / production concerns**
- [Building Generative AI Agents: Using LangGraph, AutoGen, and CrewAI](https://learning.oreilly.com/library/view/-/9798868811340/?orm_source=mcp) — Tom Taulli, Gaurav Deshmukh — Quantalyze's `package.json` has zero agent-framework dependencies (no LangGraph, no CrewAI, no AutoGen); working through what these frameworks actually provide — dynamic branching, tool registries, stateful graphs — makes concrete exactly what production chose not to build, and why that was a defensible cost/complexity call for a fixed-shape quarterly-delta pipeline.

**Senior — tradeoffs, failure modes, design judgment**
- [Agentic Architectural Patterns for Building Multi-Agent Systems](https://learning.oreilly.com/library/view/-/9781806029570/?orm_source=mcp) — Ali Arsanjani, Juan Pablo Bustos — Goes deep on the Planner, Router, and Critic roles this file's role-census table finds structurally absent from Quantalyze (no component decides *what sequence of steps* to run, and no component chooses *which* downstream function to call based on model reasoning) — read this to understand precisely what would need to be added, and where the complexity cost would land.
- [Building AI Agents with LLMs, RAG, and Knowledge Graphs](https://learning.oreilly.com/library/view/-/9781835087060/?orm_source=mcp) — Salvatore Raieli, Gabriele Iuculano — Useful contrast reading: the archived prototype's `agents/validation.py` is a genuine LLM-based fact-checker that re-reads source text (something production's `localValidation()` structurally cannot do) — this book covers the retrieval+agent composition patterns that prototype was reaching for.

**Public references**
- [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) — Anthropic — The authoritative public treatment of exactly this file's central distinction: fixed, code-orchestrated **workflows** (what Quantalyze runs in production) versus genuinely autonomous **agents** that direct their own process and tool use. Read this one first if you only read one thing from this whole list — it is the clearest public explanation of why the case study's verdict is correct.

---

## 07 — DATA ARCHITECTURE
*Case study source: `discussions/07_DATA_ARCHITECTURE.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** The full data lifecycle, reverse-engineered from the actual schema and repository code — not the stale docs. Three findings anchor this section: Row-Level Security is declared correctly in the SQL migrations on 3 tables but is **stripped at deploy time** by `scripts/migrate-schema-to-azure.ts` because Azure Postgres has no `auth.uid()`, meaning per-user isolation today is 100% application-code discipline with no database-level backstop; access is raw `pg.Pool` with hand-written parameterized SQL, no ORM; and the two cache tables central to cost control (`analysis_results`, `solo_analysis_cache`) dedupe via an **unwrapped DELETE-then-INSERT with no unique constraint and no transaction**, a real, non-atomic race — in sharp contrast to every other cache table in the schema, which uses a proper `ON CONFLICT` upsert.

**Reading path by level:**

**Junior — build the fundamentals**
- [PostgreSQL: Up and Running, 4th Edition](https://learning.oreilly.com/library/view/-/9798341660885/?orm_source=mcp) — Regina O. Obe, Leo S. Hsu — Ground yourself in real Postgres fundamentals — indexes, constraints, `JSONB`, `ON CONFLICT` — the exact vocabulary needed to see why `analysis_results` having zero indexes beyond its surrogate key, on the system's highest-traffic read table, is a real problem and not a stylistic choice.

**Mid-level — go deeper / production concerns**
- [High Performance PostgreSQL for Rails](https://learning.oreilly.com/library/view/-/9798888651070/?orm_source=mcp) — Andrew Atkinson — Despite the title, its treatment of connection pooling, indexing strategy, and safe schema migrations generalizes directly to Quantalyze's raw `pg.Pool` singleton (`lib/postgres/client.ts`) and its retry-once-on-connection-reset logic tuned specifically for Azure's VNet TCP-idle-reaping behavior.

**Senior — tradeoffs, failure modes, design judgment**
- [Database Internals](https://learning.oreilly.com/library/view/-/9781492040330/?orm_source=mcp) — Alex Petrov — For understanding, at the storage-engine level, exactly why an unwrapped DELETE-then-INSERT with no unique constraint (as `analysis_results.saveAnalysis()` does) is a real concurrency hazard — two simultaneous cache-miss requests can interleave and leave duplicate rows — versus why the atomic `INSERT ... ON CONFLICT DO UPDATE` used everywhere else in the same schema is safe.
- [Designing Data-Intensive Applications, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098119058/?orm_source=mcp) — Martin Kleppmann, Chris Riccomini — The canonical treatment of atomicity, race conditions, and read-then-write hazards — directly maps onto this file's second finding: `lib/credits.ts`'s non-atomic read-then-deduct pattern can silently under-charge users under concurrent requests, an almost-identical bug to one already found and fixed (with a real atomic `ON CONFLICT` upsert) in the sibling `apiAccess.ts` file, but never ported over.

**Public references**
- [Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys) — Brandur Leach — A widely-read, practitioner-written piece on exactly the class of problem this section's two concurrency findings share: making a write-once-per-logical-action guarantee hold under real concurrent requests, backed by Postgres, not application-code discipline alone.

---

## 08 — BACKEND ARCHITECTURE
*Case study source: `discussions/08_BACKEND_ARCHITECTURE.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** A reverse-engineering of the whole API layer — REST-flavored but not REST (verb-shaped internal routes, no real API versioning behind the `v1` namespace), inconsistent error-response shapes, and the single most consequential finding in the whole case study: **14 of 24 internal API routes have zero authentication**, including a `DELETE /api/v1/kpis` that wipes the entire KPI cache and four `*seed*` routes that can trigger unbounded Gemini spend against the project's own API key — all reachable by anyone with the URL, because `middleware.ts`'s auth enforcement is scoped only to `/api/public/*` and never extended to cover `/api/v1/*`.

**Reading path by level:**

**Junior — build the fundamentals**
- [RESTful Web APIs](https://learning.oreilly.com/library/view/-/9781449359713/?orm_source=mcp) — Leonard Richardson, Mike Amundsen, Sam Ruby — Learn what disciplined REST resource design actually looks like before evaluating why Quantalyze's internal API (`POST /api/v1/seed-analysis`, a bare `DELETE /api/v1/kpis` with no ID) reads as RPC-over-HTTP rather than REST.

**Mid-level — go deeper / production concerns**
- [Designing Web APIs](https://learning.oreilly.com/library/view/-/9781492026914/?orm_source=mcp) — Brenda Jin, Saurabh Sahni, Amir Shevat — Covers exactly the two-surface pattern this file documents working well on one side: the public `/api/public/v1/*` surface has real API-key entitlements, per-key daily quotas, and versioned DTOs — a legitimate metered-product API design the internal surface never adopted.

**Senior — tradeoffs, failure modes, design judgment**
- [Web Application Security, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098143923/?orm_source=mcp) — Andrew Hoffman — The direct read for this file's headline finding: understand exactly why "authentication enforced per-route by convention, not centrally by middleware" is a real vulnerability class, not a style preference, and what centralized enforcement (as the public API surface already does correctly) should look like applied consistently.
- [OAuth 2 in Action](https://learning.oreilly.com/library/view/-/9781617293276/?orm_source=mcp) — Justin Richer, Antonio Sanso — For the authentication half of the same finding: Quantalyze's session-cookie auth (NextAuth + Microsoft Entra External ID OIDC) and its bearer-API-key scheme are two different trust models running side by side — this book is the standard treatment of getting token-based auth right, useful for judging both.

**Public references**
- [API2:2023 Broken Authentication](https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/) — OWASP API Security Top 10 — The industry-standard reference for exactly this file's central finding: unauthenticated endpoints that should require auth are consistently ranked among the highest-severity API risks, and this page catalogs the failure pattern (missing auth on state-changing or resource-intensive endpoints) that describes Quantalyze's 14 unprotected `/api/v1` routes precisely.


---

## 09 — FRONTEND ARCHITECTURE
*Case study source: `discussions/09_FRONTEND_ARCHITECTURE.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** Quantalyze's Next.js 14 App Router usage is real but narrow — Server Components exist almost solely to do the `redirect()` auth check, while every page's actual data-fetching happens client-side in `useEffect`; the app has zero global state library, zero route-level `error.tsx` boundaries, and zero `aria-*`/`alt=`/`role=` attributes anywhere in `app/` or `components/`. At the same time, its NDJSON streaming consumption (`lib/api.ts`'s `reader.read()` loop feeding `AgentPanel.tsx`) is genuinely well-built, byte-for-byte incremental UI. An engineer needs both halves: the App Router mental model this codebase only partially uses, and the accessibility/error-boundary discipline it doesn't use at all.

**Reading path by level:**

**Junior — build the fundamentals**
- [React Key Concepts - Second Edition](https://learning.oreilly.com/library/view/-/9781836202271/?orm_source=mcp) — Maximilian Schwarzmüller, Packt — core React component/hook vocabulary needed before assessing why Quantalyze's three file-local hooks (`useWatchlist`, `useUserTickers`, `useInsightsWatchlist`) were never promoted to a shared `hooks/` directory.
- [Learning JavaScript Design Patterns, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098139865/?orm_source=mcp) — Addy Osmani, O'Reilly Media — foundational container/presentational and observer patterns that explain precisely why `AgentPanel.tsx` is "purely presentational" (a design choice worth being able to name).

**Mid-level — go deeper / production concerns**
- [Real-World Next.js - Second Edition](https://learning.oreilly.com/library/view/-/9781807424459/?orm_source=mcp) — Dan Neciu, Faris Aziz, Michele Riva, Packt — production App Router patterns to compare directly against the finding that Quantalyze's Server Components never prefetch or stream data, only gate routes.
- [Micro State Management with React Hooks](https://learning.oreilly.com/library/view/-/9781801812375/?orm_source=mcp) — Daishi Kato, Packt — directly relevant: Quantalyze has *zero* Redux/Zustand/Context anywhere in the tree, and this book is the right lens for judging whether that local-state-only approach is a real gap or a reasonable choice at this scale.
- [High Performance Browser Networking](https://learning.oreilly.com/library/view/-/9781449344757/?orm_source=mcp) — Ilya Grigorik, O'Reilly Media — chapters on chunked-transfer/streaming HTTP are the foundation under `lib/api.ts`'s `reader.getReader()` NDJSON loop, verified byte-for-byte incremental in the case study.

**Senior — tradeoffs, failure modes, design judgment**
- [React Design Patterns and Best Practices - Fifth Edition](https://learning.oreilly.com/library/view/-/9781806108251/?orm_source=mcp) — Carlos Santana Roldán, Packt — covers error-boundary patterns directly, addressing the finding that Quantalyze has **no `error.tsx` file anywhere** under `app/` — a thrown render error has no route-level fallback today.
- [A11Y Unraveled: Become a Web Accessibility Ninja](https://learning.oreilly.com/library/view/-/9781484290859/?orm_source=mcp) — Dimitris Georgakas, Apress — assigned because the case study's greps for `aria-`, `alt=`, and `role="` across the *entire* `app/`+`components/` tree returned zero matches each — the single most concrete, fixable gap in the whole frontend layer.
- [Inclusive Design for Accessibility](https://learning.oreilly.com/library/view/-/9781835888223/?orm_source=mcp) — Dale Cruse, Denis Boudreau, Packt — pairs the implementation guide above with the design-process question: how should `AgentPanel`'s live status-icon updates have been designed with an `aria-live` region from day one?

**Aspiring Lead — systems thinking, org/technical leadership**
- [Frontend Architecture for Design Systems](https://learning.oreilly.com/library/view/-/9781491926772/?orm_source=mcp) — Micah Godbolt, O'Reilly Media — the right frame for a lead-level call the case study surfaces twice: two unsynced watchlist implementations and two unsynced PDF-export code paths exist side by side — when does that duplication get consolidated into a shared system, and when is it fine to leave alone?

**Public references**
- [Making Sense of React Server Components](https://www.joshwcomeau.com/react/server-components/) — Josh W. Comeau — the clearest independent explainer of the exact Server/Client boundary Quantalyze implements only narrowly (auth-gating, not data-fetching).
- [Guides: Server and Client Boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary) — Next.js official docs — the canonical reference for the pattern this codebase only half-uses; read it, then reread `app/dashboard/page.tsx` and see what's missing.

---

## 10 — AI PRODUCT INTEGRATION
*Case study source: `discussions/10_AI_PRODUCT_INTEGRATION.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** Every AI capability in the live product is schema-constrained generation (`responseSchema` + `responseMimeType: "application/json"`) against one model, `gemini-2.5-flash-lite`, across five independently-coded pipeline files — no fine-tuning, no RAG, no agentic tool-use loop. The integration layer that actually matters is the four-part pattern repeated per capability: schema-constrained generation, wire-shape domain types, the repository layer, and NDJSON stream shaping — plus one real, unmitigated gap: raw scraped transcript text is interpolated directly into every prompt with zero prompt-injection defense.

**Reading path by level:**

**Junior — build the fundamentals**
- [Prompt Engineering for Generative AI](https://learning.oreilly.com/library/view/-/9781098153427/?orm_source=mcp) — James Phoenix, Mike Taylor, O'Reilly Media — practical grounding in structured-output technique before reading `AGENT_PROMPTS` in `lib/pipeline.ts`, the five differently-prompted specialist calls that make up Delta Analysis.
- [Prompt Engineering for LLMs](https://learning.oreilly.com/library/view/-/9781098156145/?orm_source=mcp) — John Berryman, Albert Ziegler, O'Reilly Media — foundational to understanding *why* Quantalyze decomposed one analysis into five specialist prompts rather than one large one.

**Mid-level — go deeper / production concerns**
- [Designing Large Language Model Applications](https://learning.oreilly.com/library/view/-/9781098150495/?orm_source=mcp) — Suhas Pai, O'Reilly Media — the single most directly relevant title here: covers schema-constrained generation and multi-call orchestration matching exactly what the case study calls Quantalyze's AI engineering surface ("almost entirely prompt design + schema design," concentrated in five files).
- [Building LLM Powered Applications](https://learning.oreilly.com/library/view/-/9781835462317/?orm_source=mcp) — Valentina Alto, Packt — wiring an LLM API into a real product's data/service layers, directly comparable to `lib/repositories/analysis.ts`'s `DashboardPayload` → `Analysis` entity converter pair the case study calls "the integration layer in miniature."
- [Hands-On Large Language Models](https://learning.oreilly.com/library/view/-/9781098150952/?orm_source=mcp) — Jay Alammar, Maarten Grootendorst, O'Reilly Media — grounding in how JSON-mode/structured generation works mechanically, useful before judging exactly what Gemini's `responseSchema` guarantees (shape) versus what it doesn't (content correctness).

**Senior — tradeoffs, failure modes, design judgment**
- [The Developer's Playbook for Large Language Model Security](https://learning.oreilly.com/library/view/-/9781098162191/?orm_source=mcp) — Steve Wilson, O'Reilly Media — targets directly: every pipeline interpolates unsanitized transcript text into prompts with no delimiter escaping, no untrusted-content framing, no injection mitigation of any kind — a real, stated, unmitigated risk in the production code.
- [Building Applications with AI Agents](https://learning.oreilly.com/library/view/-/9781098176495/?orm_source=mcp) — Michael Albada, O'Reilly Media — useful precisely for the negative case: reading this against `lib/pipeline.ts` clarifies why the case study insists Quantalyze's "5 specialist agents" are fixed-prompt LLM-powered *functions*, not autonomous agents (zero `tools`/`functionDeclarations` anywhere in the codebase).

**Public references**
- [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output) — Google AI for Developers — the primary source for the exact `responseSchema`/JSON-mode mechanism all five Quantalyze pipeline files depend on; read this before reading `QUARTER_SNAPSHOT_SCHEMA` in `lib/pipeline.ts`.
- [Prompt injection](https://simonwillison.net/series/prompt-injection/) — Simon Willison — the most-cited practitioner series on exactly the mitigation gap `11_PRODUCTION_ENGINEERING.md` and this section both identify as real and unaddressed in the live pipelines.

---

## 11 — PRODUCTION ENGINEERING
*Case study source: `discussions/11_PRODUCTION_ENGINEERING.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** The honest split here is stark — `lib/postgres/client.ts`'s connection-retry/keepalive logic (tuned against a *named* Azure VNet TCP-idle-reaping incident) is "the single best-engineered reliability mechanism in the codebase," while every one of the ~20 Gemini calls in a Delta Analysis run has **zero retry logic and zero circuit breaker**. Layered on top: two documented, self-acknowledged read-modify-write race conditions (the credits system and the API-quota check) that get strictly worse under Azure Container Apps' horizontal scale-out, and an observability story that is `console.log` string interpolation with no metrics, no traces, and no per-call AI telemetry anywhere.

**Reading path by level:**

**Junior — build the fundamentals**
- [Site Reliability Engineering, 2nd Edition](https://learning.oreilly.com/library/view/-/9798341607675/?orm_source=mcp) — Beyer, Jones, Leng, Huska, Petoff, Murphy, O'Reilly Media — the canonical vocabulary (SLOs, timeouts, retries, error budgets) needed to grade precisely why Quantalyze's Gemini calls have timeouts but no retries.
- [Site Reliability Engineering Essentials](https://learning.oreilly.com/videos/-/9780135415016/?orm_source=mcp) — Karun Subramanian, Pearson — a faster on-ramp into the same vocabulary for someone newer to production operations.

**Mid-level — go deeper / production concerns**
- [Release It!, 2nd Edition](https://learning.oreilly.com/library/view/-/9781680504552/?orm_source=mcp) — Michael T. Nygard, Pragmatic Bookshelf — the book that names circuit breakers, bulkheads, and timeouts as a system — maps directly onto the finding that Quantalyze has timeouts everywhere but circuit breakers nowhere.
- [Just Use Postgres!](https://learning.oreilly.com/library/view/-/9781633435698/?orm_source=mcp) — Denis Magda, Manning Publications — practical grounding in exactly the connection-pooling/keepalive territory where `lib/postgres/client.ts` does its best engineering in the entire repo.
- [Designing Distributed Systems, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098156343/?orm_source=mcp) — Brendan Burns, O'Reilly Media — patterns for the exact class of bug the credits race (`lib/credits.ts`) and API-quota race (`middleware.ts`) represent: read-then-write under concurrency, both explicitly self-documented in code comments as accepted-for-now tradeoffs.

**Senior — tradeoffs, failure modes, design judgment**
- [Observability Engineering, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098179915/?orm_source=mcp) — Charity Majors, Liz Fong-Jones, George Miranda, O'Reilly Media — directly targets the finding that Quantalyze has zero metrics, zero traces, and only ad hoc `console.log`/`console.error` — the field's canonical text for closing exactly that gap.
- [Building Resilient Distributed Systems](https://learning.oreilly.com/library/view/-/9781098163532/?orm_source=mcp) — Sam Newman, O'Reilly Media — senior-level fault-tolerance system design, relevant to actually building the circuit-breaker/backpressure layer the case study finds entirely absent (no queue, no worker architecture — every pipeline runs synchronously inside the HTTP request).

**Aspiring Lead — systems thinking, org/technical leadership**
- [Designing Data-Intensive Applications, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098119058/?orm_source=mcp) — Martin Kleppmann, Chris Riccomini, O'Reilly Media — the standard reference for the tradeoffs a lead needs to actually fix the credits race with an atomic SQL increment (rather than the current raw `SET used = $1` overwrite) and to reason about the missing composite index on `analysis_results`, the busiest table in the schema.

**Public references**
- [Your Guide to Connection Management in Postgres](https://www.crunchydata.com/blog/your-guide-to-connection-management-in-postgres) — Crunchy Data engineering blog — practitioner-written, directly on the connection-pooling/idle-connection territory the case study calls out as the codebase's best-engineered reliability mechanism.
- [Resilience Design Patterns: Retry, Fallback, Timeout, Circuit Breaker](https://www.codecentric.de/en/knowledge-hub/blog/resilience-design-patterns-retry-fallback-timeout-circuit-breaker) — codecentric engineering blog — a concise practitioner overview of exactly the patterns the case study finds missing from every single Gemini call site in the live product.

---

## 12 — AI EVALUATION
*Case study source: `discussions/12_AI_EVALUATION.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** The live product has zero automated quality evaluation of Gemini's output — only JSON-shape enforcement (`responseSchema`) plus one deterministic sign-consistency check (`localValidation()`). A real, well-designed four-stage **LLM-as-judge** framework (`finance-agent/disclosure_pipeline/src/judge_evaluator.py`) exists — same-family judge model, parallel evaluation across extraction/change-detection/signal/verdict stages, markdown+JSON reporting — but it lives only in the archived prototype, gated behind an opt-in CLI flag, never wired into production, and with no evidence it was ever run and its output retained. This is the sharpest "how would you actually close this gap" reading list in the set.

**Reading path by level:**

**Junior — build the fundamentals**
- [Evaluating Large Language Models (LLMs)](https://learning.oreilly.com/videos/-/9780135451922/?orm_source=mcp) — Sinan Ozdemir, Pearson — a focused, approachable course on the core methodology (benchmarks, metrics, human evaluation vs. LLM-as-judge) that is entirely absent from Quantalyze's live pipelines today.

**Mid-level — go deeper / production concerns**
- [AI Engineering](https://learning.oreilly.com/library/view/-/9781098166298/?orm_source=mcp) — Chip Huyen, O'Reilly Media — the field's most complete treatment of building evaluation pipelines for LLM applications; directly useful for designing the golden-dataset-plus-regression-suite proposal this section lays out in its own §4.
- [LLM Engineer's Handbook](https://learning.oreilly.com/library/view/-/9781836200079/?orm_source=mcp) — Paul Iusztin, Maxime Labonne, Packt — end-to-end LLM system building including evaluation, useful for reasoning about porting `judge_evaluator.py`'s four-stage taxonomy from LangChain/Python to the `@google/generative-ai` SDK already used in `lib/`.

**Senior — tradeoffs, failure modes, design judgment**
- [A Simple Guide to Retrieval Augmented Generation](https://learning.oreilly.com/library/view/-/9781633435858/?orm_source=mcp) — Abhinav Kimothi, Manning Publications — covers RAG evaluation vocabulary (faithfulness, context precision/recall) that this section explicitly checked for and confirmed absent from Quantalyze — useful precisely because Quantalyze has no RAG at all, and a senior engineer should be able to say *why* that evaluation category doesn't apply here rather than assume it does. *(Thin coverage note: no O'Reilly title was found specifically and only on LLM-as-judge methodology — the two public references below are the stronger source for that exact topic.)*
- [LLM Monitoring & Tracing: AI Observability with Datadog](https://learning.oreilly.com/videos/-/9781807783273/?orm_source=mcp) — Paulo Dichone, Packt — targets the drift/hallucination-monitoring gap named explicitly as absent: nothing in the live pipelines tracks output quality over time or catches a regression before a human notices.

**Public references**
- [Using LLM-as-a-Judge For Evaluation: A Complete Guide](https://hamel.dev/blog/posts/llm-judge/) — Hamel Husain — the most thorough practitioner guide to exactly the pattern `judge_evaluator.py` implements but never ships; read this alongside the archived prototype's code.
- [Evaluating the Effectiveness of LLM-Evaluators (aka LLM-as-Judge)](https://eugeneyan.com/writing/llm-evaluators/) — Eugene Yan — directly addresses the same-family-judge blind-spot problem this section calls out: `judge_evaluator.py`'s judge is Gemini judging Gemini, at `temperature=0.0`, with no independent-model or human-labeled cross-check.

---

## 13 — TESTING
*Case study source: `discussions/13_TESTING.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** The live product has zero automated tests of any kind — no unit, integration, API, database, frontend, or E2E tests — confirmed by an empty `package.json` `devDependencies` for any test runner and by the engineering plans' own admission that verification means `npx tsc --noEmit` plus a human clicking through a browser. The archived prototype's ten `test_*.py` files are a genuine trap for this exact reason: they look like a test suite by name but are manual smoke scripts with `print()` statements, not `assert`s — one of them (`test_replay.py`) even computes a match score and only *prints* `[SUCCESS]`/`[WARNING]`, never failing the run.

**Reading path by level:**

**Junior — build the fundamentals**
- [Fundamentals of Software Testing](https://learning.oreilly.com/videos/-/0636920941996/?orm_source=mcp) — Thayse Onofrio, O'Reilly Media — the basic vocabulary (unit/integration/E2E, coverage, fixtures) needed before evaluating why Quantalyze has none of it.
- [Test-Driven Development for JavaScript](https://learning.oreilly.com/videos/-/9780137864591/?orm_source=mcp) — Andy Olsen, Pearson — a hands-on entry point in the exact language (TypeScript/JavaScript) Quantalyze is written in.

**Mid-level — go deeper / production concerns**
- [Effective Software Testing](https://learning.oreilly.com/library/view/-/9781633439931/?orm_source=mcp) — Mauricio Aniche, Manning Publications — practical, example-driven test-design technique (boundary testing, property-based testing) directly applicable to this section's #2 priority: unit-testing the pure-logic, non-LLM modules first (`lib/divergence-score.ts`, `localValidation()`, `computeConfidence()`).
- [Testing JavaScript Applications](https://learning.oreilly.com/library/view/-/9781617297915/?orm_source=mcp) — Lucas Fernandes da Costa, Manning Publications — modern JS/TS testing patterns (mocking, async testing) for exactly the `Promise.all`-heavy, NDJSON-streaming code Quantalyze would need a test harness for.
- [Unit Testing Principles, Practices, and Patterns](https://learning.oreilly.com/library/view/-/9781617296277/?orm_source=mcp) — Vladimir Khorikov, Manning Publications — a deeper treatment of what makes a unit test *valuable* rather than brittle, directly relevant to the finding that `finance-agent`'s `test_*.py` files look like tests but assert nothing.

**Senior — tradeoffs, failure modes, design judgment**
- [Software Testing Strategies](https://learning.oreilly.com/library/view/-/9781837638024/?orm_source=mcp) — Matthew Heusser, Michael Larsen, Packt — senior-level judgment on where to invest testing effort first in a codebase starting from zero coverage — maps directly onto this section's prioritized seven-item gap list.
- [Build Your Own Test Framework](https://learning.oreilly.com/library/view/-/9781484292471/?orm_source=mcp) — Daniel Irvine, Apress — for understanding what a test runner actually needs to provide (assertions, fixtures, mocking), directly useful for standing up Vitest as the very first test infrastructure this repo has ever had.

**Public references**
- [Write tests. Not too many. Mostly integration.](https://kentcdodds.com/blog/write-tests) — Kent C. Dodds — the single most-cited practical philosophy for exactly the "where do I even start" question a zero-coverage codebase like Quantalyze's poses.

---

## 14 — DEVOPS & CLOUD
*Case study source: `discussions/14_DEVOPS_CLOUD.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** Quantalyze's `deploy-azure.yml` does real, correctly-applied security-best-practice CI/CD — OIDC federated Azure login with no long-lived credentials, a genuinely well-structured multi-stage Dockerfile with a non-root user — but every push to `main` builds and deploys straight to production with **no test step, no staging environment, and no post-deploy health verification**. A second, separate finding: the live deployment target (Azure Container Apps + Docker) doesn't match what the repo's own dated migration documents describe (Azure App Service, explicitly *without* Docker) — a real, undocumented second migration.

**Reading path by level:**

**Junior — build the fundamentals**
- [Docker Fundamentals for Beginners](https://learning.oreilly.com/videos/-/9781803237428/?orm_source=mcp) — Coding Gears | Train Your Brain, Packt — foundational containerization before reading Quantalyze's actual three-stage `deps`/`builder`/`runner` Dockerfile.
- [Learning GitHub Actions for DevOps CI/CD](https://learning.oreilly.com/videos/-/9781837639137/?orm_source=mcp) — Vijay Saini, Packt — foundational CI/CD vocabulary before reading `.github/workflows/deploy-azure.yml`'s five-step pipeline.

**Mid-level — go deeper / production concerns**
- [Hands-on GitHub Actions](https://learning.oreilly.com/library/view/-/9781484264645/?orm_source=mcp) — Chaminda Chandrasekara, Pushpa Herath, Apress — deeper, practical GitHub Actions patterns directly comparable to Quantalyze's real (if test-step-less) deploy workflow.
- [Developing Infrastructure as Code with Terraform](https://learning.oreilly.com/videos/-/9780135379066/?orm_source=mcp) — Robert Jordan, Pearson — targets directly the confirmed-absent IaC gap: every Azure resource in `quantalyze-prod-rg` was provisioned via one-off `az` CLI commands recorded only as prose in markdown plan documents, with no `.tf`/`.bicep` anywhere.
- [Continuous Integration (CI) and Continuous Delivery (CD): A Practical Guide](https://learning.oreilly.com/library/view/-/9781484292280/?orm_source=mcp) — Henry van Merode, Apress — a practical guide to designing the staging environment and test-gated pipeline this section names as the single biggest gap in the current setup.

**Senior — tradeoffs, failure modes, design judgment**
- [Continuous Delivery](https://learning.oreilly.com/library/view/-/9780321670250/?orm_source=mcp) — David Farley, Jez Humble, Addison-Wesley — the canonical text on deployment pipelines, rollback strategy, and release discipline, directly relevant to the finding that `main` pushes straight to prod with no canary, no traffic-splitting, and only "fire-and-forget" health verification (`az containerapp update` reports success the instant the API call returns, not when the new revision is actually healthy).
- [Hashicorp Terraform - Getting Started with Infrastructure as Code](https://learning.oreilly.com/videos/-/9781807301194/?orm_source=mcp) — Bryan Krausen, Packt — a second, more hands-on IaC resource for actually closing the gap this section names as the highest-leverage single artifact to build (turning the App Service → Container Apps undocumented drift into something a diffable IaC change would have caught automatically).

**Public references**
- [Hardening GitHub Actions: Lessons from Recent Attacks](https://www.wiz.io/blog/github-actions-security-guide) — Wiz engineering blog — written by a well-known cloud-security company, directly on the OIDC/secrets patterns Quantalyze's workflow does correctly, and on the gaps (no dependency-scanning step, no required test gate) it doesn't.

---

## 15 — AZURE JD MAPPING
*Case study source: `discussions/15_AZURE_JD_MAPPING.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** This file maps Quantalyze's evidence against a real Azure Senior AI Engineer job description, and the shape of the finding is precise and important: **strong-to-excellent on Azure platform/infrastructure** (Container Apps, Postgres Flexible Server on a private VNet, Blob Storage, Entra External ID, OIDC-federated CI/CD, all incident-tested in production) and **essentially zero on Azure AI services specifically** (Azure OpenAI, AI Foundry, AI Search, Document Intelligence, Copilot Studio — every AI call in the live app goes to Google Gemini). The reading here is deliberately about the underlying competency the JD demands — cloud AI engineering *on Azure specifically* — not a generic "learn cloud" list.

**Reading path by level:**

**Junior — build the fundamentals**
- [Azure Fundamentals (AZ-900) Study Guide](https://learning.oreilly.com/library/view/-/9781098167813/?orm_source=mcp) — Jack Lee, O'Reilly Media — foundational Azure platform vocabulary as a base before layering Azure-*AI*-specific services on top.
- [Learning Microsoft Azure, 2nd Edition](https://learning.oreilly.com/library/view/-/0642572274276/?orm_source=mcp) — Jonah Carrio Andersson, O'Reilly Media — broad platform grounding across compute/data/identity, the categories Quantalyze already has real, deployed experience in.

**Mid-level — go deeper / production concerns**
- [Azure OpenAI Essentials](https://learning.oreilly.com/library/view/-/9781805125068/?orm_source=mcp) — Amit Mukherjee, Adithya Saladi, Packt — directly closes the JD's #3 requirement, rated "None" in the mapping: the candidate has never made a single call to any Azure AI SDK.
- [Azure OpenAI Service for Cloud Native Applications](https://learning.oreilly.com/library/view/-/9781098154981/?orm_source=mcp) — Adrián González Sánchez, O'Reilly Media — a second, more architecture-focused resource for the same gap, pairing well with Quantalyze's existing repository/service-layer patterns (the mapping's suggested exercise: port `lib/sector-narrative.ts` from Gemini to Azure OpenAI behind a flag, keeping the same schema contract).
- [Generative AI on Microsoft Azure](https://learning.oreilly.com/library/view/-/9798341623279/?orm_source=mcp) — González Sánchez, De Mora, García Ximénez, O'Reilly Media — a broader Azure AI service survey covering AI Search and Document Intelligence, the specific services rated "None found" for requirements #4–8 in the mapping.

**Senior — tradeoffs, failure modes, design judgment**
- [Level Up with Azure AI Foundry: Understanding Innovative AI Development on Azure](https://learning.oreilly.com/library/view/-/9798868818684/?orm_source=mcp) — Sagar Lad, Apress — targets the JD's #1 requirement precisely ("design, build, and operate an Azure AI platform and AI Lab environment"), rated "Weak" in the mapping as the single largest gap.
- [Exam Ref AZ-305 Designing Microsoft Azure Infrastructure Solutions](https://learning.oreilly.com/library/view/-/9780137878758/?orm_source=mcp) — Agrawal, Singh, Bhavsar, Sopariwala, Microsoft Press — senior-level Azure architecture judgment, complementary to the genuinely strong Azure platform-engineering evidence already documented (VNet subnet delegation, private Postgres, Container Apps revisions).

**Aspiring Lead — systems thinking, org/technical leadership**
- [Designing Microsoft Azure Infrastructure Solutions (AZ-305)](https://learning.oreilly.com/videos/-/9781836200659/?orm_source=mcp) — ACI Learning, Adam Gordon, Packt — the video-course companion to the exam-ref book above, oriented toward reasoning across a whole Azure estate (compute, identity, network, data together) rather than one service at a time — the scope a lead designing Quantalyze's next Azure phase would actually own.

**Public references**
- [GPT-5 in Azure AI Foundry: The future of AI apps and agents starts here](https://azure.microsoft.com/en-us/blog/gpt-5-in-azure-ai-foundry-the-future-of-ai-apps-and-agents-starts-here/) — Microsoft Azure official blog — a current, primary-source look at exactly the AI Foundry platform this JD requires and the candidate's repo shows zero hands-on time with.
- [Introducing Azure AI Foundry Labs: A hub for the latest AI research and experiments at Microsoft](https://azure.microsoft.com/en-us/blog/introducing-azure-ai-foundry-labs-a-hub-for-the-latest-ai-research-and-experiments-at-microsoft/) — Microsoft Azure official blog — a second official source specifically on the "AI Lab environment" language used in the JD's #1 requirement.

---

## 16 — ONELEET JD MAPPING
*Case study source: `discussions/16_ONELEET_JD_MAPPING.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** This file maps Quantalyze against a real Oneleet Full-Stack AI Product Engineer JD, and unlike the Azure mapping, this one lands mostly "Strong" — Quantalyze *is* functionally the kind of product this JD describes: AI output mapped directly to UI via a model-emitted `ui_component_type` enum, consistent fail-closed error handling, a deliberate seven-cache strategy. The honest, specifically-checked gaps matter more here precisely because they're real and narrow: **zero feedback-loop/usage-analytics instrumentation on any AI feature** (verified by grep, corroborated by the privacy policy's own "we do not use third-party analytics trackers" line), **no shared reusable AI-call helper** despite five near-identical Gemini client instantiations, and **no production monitoring/observability SDK** beyond `console.log`. The reading below targets secure, full-stack AI product delivery — the underlying competency, not generic career advice.

**Reading path by level:**

**Junior — build the fundamentals**
- [Building AI-Powered Products](https://learning.oreilly.com/library/view/-/9781098152697/?orm_source=mcp) — Marily Nika, O'Reilly Media — the foundational text for exactly what this JD tests: not "how do I call an LLM" but "how do I turn a model call into a shipped, usable product feature" — matching Quantalyze's actual demonstrated strength (schema-driven UI, fail-closed error handling).
- [TypeScript: Modern JavaScript Development](https://learning.oreilly.com/library/view/-/9781787289086/?orm_source=mcp) — Remo H. Jansen, Vilic Vane, Ivo Gabe de Wolff, Packt — foundational grounding in the actual stack (100% TypeScript, full-stack, one language end-to-end) this JD is written around.

**Mid-level — go deeper / production concerns**
- [LLM Engineer's Handbook](https://learning.oreilly.com/library/view/-/9781836200079/?orm_source=mcp) — Paul Iusztin, Maxime Labonne, Packt — end-to-end LLM system building, directly relevant to the specifically-checked finding that Quantalyze duplicates its Gemini client + `Promise.race` timeout wrapper across five separate files instead of extracting one shared `callGeminiJson<T>()` helper — exactly the JD's "reusable patterns for AI integration" line item.
- [Web Application Security, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098143923/?orm_source=mcp) — Andrew Hoffman, O'Reilly Media — mid-level grounding for the "secure" half of "secure full-stack AI product delivery," relevant given Quantalyze's public partner API is the one surface with a real external contract and currently the least test/scan coverage of any component in the repo.

**Senior — tradeoffs, failure modes, design judgment**
- [Software Security for Developers](https://learning.oreilly.com/library/view/-/9781617298585/?orm_source=mcp) — Laurentiu Spilca, Adib Saikali, Manning Publications — senior-level secure coding directly relevant to Oneleet's own domain (security/compliance tooling) and to the finding that Quantalyze's CI pipeline has no `npm audit`/Dependabot/SAST step of any kind before shipping to production.
- [Fundamentals of Observability with OpenTelemetry](https://learning.oreilly.com/videos/-/0636920926597/?orm_source=mcp) — Adriana Villela, O'Reilly Media — targets the confirmed, grep-verified gap directly: no APM/error-tracking SDK, `console.log`/`console.error` only, and zero per-call AI-feature telemetry anywhere in the live app.

**Aspiring Lead — systems thinking, org/technical leadership**
- [Building Applications with AI Agents](https://learning.oreilly.com/library/view/-/9781098176495/?orm_source=mcp) — Michael Albada, O'Reilly Media — for the exact build-vs-not-yet decision this section frames as a live interview question: when (if ever) should Quantalyze's fixed-prompt "LLM-powered functions" evolve toward genuine tool-using agent autonomy, and what would justify that cost?

**Public references**
- [The essential tools used by product engineers](https://posthog.com/blog/product-engineer-tools) — PostHog engineering blog — speaks directly to the specifically-checked, confirmed-absent capability: zero product analytics or feature-usage tracking on any AI feature anywhere in Quantalyze.
- [Schema-Driven AI: Better User Experiences with Structured Output](https://thefocus.ai/posts/using-structured-output/) — The Focus AI (engineering blog) — a practitioner writeup of exactly the pattern Quantalyze's `ui_component_type` enum implements (letting the model's structured output choose which UI component renders each insight), useful for seeing the pattern named and generalized outside this one codebase.


---

## 17 — CROSS-JD COMPETENCY MATRIX
*Case study source: `discussions/17_CROSS_JD_COMPETENCY_MATRIX.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** The matrix scores Quantalyze against 47 competencies for two real JDs (Azure Senior AI Engineer, Full-Stack AI Product Engineer) and lands on a precise verdict: strong-to-excellent on AI product engineering and Azure *platform* infra, but a hard **None** on NoSQL/vector databases, Kubernetes, and — critically — any Azure *AI service* (Azure OpenAI/AI Foundry), since every pipeline calls Gemini directly. An engineer using this matrix to plan their own growth needs reading that closes exactly those named gaps, not generic "AI skills" content.

**Reading path by level:**

**Junior — build the fundamentals**
- [AI Engineering](https://learning.oreilly.com/library/view/-/9781098166298/?orm_source=mcp) — Chip Huyen (O'Reilly) — the standard map of what "AI engineer" means end-to-end (data, prompting, evaluation, deployment); read this first to understand which of the matrix's 47 rows are core vs. peripheral to the title.
- [Kubernetes for Developers](https://learning.oreilly.com/library/view/-/9781617297175/?orm_source=mcp) — William Denniss (Manning) — the matrix's row #25 is a flat **None**; this is a developer-focused (not ops-focused) entry point appropriate for someone whose experience is entirely on Container Apps.
- [Vector Databases](https://learning.oreilly.com/library/view/-/9781098177584/?orm_source=mcp) — Nitin Borwankar (O'Reilly) — closes row #19 (Weak/prototype-only) and row #18 (NoSQL: None) by building the conceptual bridge from "JSONB in Postgres" to genuine vector/NoSQL storage.

**Mid-level — go deeper / production concerns**
- [Designing Data-Intensive Applications, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098119058/?orm_source=mcp) — Martin Kleppmann, Chris Riccomini (O'Reilly) — the deepest available treatment of the caching, database, and reliability rows (#16–17, #32–36) the matrix rates Strong — read this to understand *why* those choices were correct, not just that they worked.
- [Observability Engineering, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098179915/?orm_source=mcp) — Charity Majors, Liz Fong-Jones, George Miranda (O'Reilly) — directly closes row #26 (Weak — console-only logging in production).
- [Kubernetes Fundamentals](https://learning.oreilly.com/videos/-/9781492032144/?orm_source=mcp) — Sébastien Goasguen (O'Reilly video) — a faster, video-format second pass on row #25 for someone who needs working K8s vocabulary for an interview, not production K8s experience.

**Senior — tradeoffs, failure modes, design judgment**
- [Azure OpenAI Service for Cloud Native Applications](https://learning.oreilly.com/library/view/-/9781098154981/?orm_source=mcp) — Adrián González Sánchez (O'Reilly) — the single highest-leverage read against this matrix: row #21 names "zero Azure OpenAI/AI Foundry experience" as the one clean gap between deep Azure platform experience and an Azure AI Engineer title.
- [Principles of AI Governance and Model Risk Management](https://learning.oreilly.com/library/view/-/9798868809835/?orm_source=mcp) — James Sayles (Apress) — closes row #29 (AI governance: Weak) and #30 (Responsible AI: Weak) with a framework a solo-built product genuinely lacks.
- [Designing Machine Learning Systems](https://learning.oreilly.com/library/view/-/9781098107956/?orm_source=mcp) — Chip Huyen (O'Reilly) — production ML/AI system design at the level rows #32–36 (performance, scalability, reliability) are being scored against.

**Aspiring Lead — systems thinking, org/technical leadership**
- [Software Engineering at Google](https://learning.oreilly.com/library/view/-/9781492082781/?orm_source=mcp) — Titus Winters, Tom Manshreck, Hyrum Wright (O'Reilly) — speaks directly to row #42 (Technical leadership: Moderate — "solo, no team led") by showing what the *organizational* version of the engineering discipline already visible in Quantalyze's ADRs looks like at scale.
- [The Staff Engineer's Path](https://learning.oreilly.com/library/view/-/9781098118723/?orm_source=mcp) — Tanya Reilly (O'Reilly) — the matrix's own "Single Most Important Takeaway" is a judgment call about which story to tell which interviewer; this book is the standard reference for exercising that kind of judgment at the next level.

**Public references (~20% of this section's list)**
- [Azure Well-Architected Framework](https://learn.microsoft.com/en-us/azure/well-architected/) — Microsoft Learn (official docs) — the matrix rates Azure platform competency Strong across rows #20–22, #26, #28, #32–34; this is Microsoft's own rubric for the same dimensions, useful for checking the matrix's self-assessment against the vendor's own bar.
- [What do Staff Engineers actually do?](https://staffeng.com/guides/what-do-staff-engineers-actually-do/) — Will Larson, StaffEng.com — grounds row #42/#43 (technical leadership, end-to-end ownership) in real staff-engineer accounts, useful for calibrating what "solo ownership" does and doesn't demonstrate toward a leadership track.

---

## 18 — FILE-LEVEL TEACHING GUIDE
*Case study source: `discussions/18_FILE_LEVEL_TEACHING_GUIDE.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** This is the deepest technical file: fan-out/fan-in LLM orchestration (`lib/pipeline.ts`), the Repository + Strangler Fig + Anti-Corruption Layer patterns (`lib/repositories/analysis.ts`, `lib/api-contracts/v1/company.ts`), an Entra ID claims-mapping bug that broke every UUID-typed query (`auth.ts`), and an Edge-middleware API gateway (`middleware.ts`). Reading here should teach the actual named patterns, not "clean code" in the abstract.

**Reading path by level:**

**Junior — build the fundamentals**
- [Architecture Patterns with Python](https://learning.oreilly.com/library/view/-/9781492052197/?orm_source=mcp) — Harry Percival, Bob Gregory (O'Reilly) — the most approachable worked example of the Repository pattern the guide's `lib/repositories/analysis.ts` entry documents in full; language differs from TypeScript but the pattern maps directly.
- [Getting Started with OAuth 2.0](https://learning.oreilly.com/library/view/-/9781449317843/?orm_source=mcp) — Ryan Boyd (O'Reilly) — a short primer before tackling the `auth.ts` entry's `token.sub`/`profile.oid` claims-mapping bug, which requires understanding what an OIDC claim actually is.
- [Learning API Styles](https://learning.oreilly.com/library/view/-/9781098153984/?orm_source=mcp) — Lukasz Dynowski, Marcin Dulak (O'Reilly) — grounding for the internal-vs-public API split documented across the `middleware.ts` and `lib/api-contracts/v1/company.ts` entries.

**Mid-level — go deeper / production concerns**
- [Learning Domain-Driven Design](https://learning.oreilly.com/library/view/-/9781098100124/?orm_source=mcp) — Vlad Khononov (O'Reilly) — the modern, more accessible companion to Evans; covers the Anti-Corruption Layer pattern that `lib/api-contracts/v1/company.ts` is explicitly built on, applied twice in this codebase (storage boundary and public-API boundary).
- [Solving Identity Management in Modern Applications](https://learning.oreilly.com/library/view/-/9781484282618/?orm_source=mcp) — Yvonne Wilson, Abhishek Hingnikar (Apress) — directly relevant to the `auth.ts` teaching entry: OAuth2/OIDC/SAML claim shapes across providers, exactly the "Entra's `oid` vs generic `sub`" problem the file's own comment documents as a real production incident.
- [Mastering API Architecture](https://learning.oreilly.com/library/view/-/9781492090625/?orm_source=mcp) — James Gough, Daniel Bryant, Matthew Auburn (O'Reilly) — covers Edge/API-gateway design (auth, rate limiting, request logging) matching `middleware.ts`'s teaching entry almost line for line.

**Senior — tradeoffs, failure modes, design judgment**
- [Domain-Driven Design: Tackling Complexity in the Heart of Software](https://learning.oreilly.com/library/view/-/0321125215/?orm_source=mcp) — Eric Evans (Addison-Wesley) — the original source for the Anti-Corruption Layer and bounded-context vocabulary the guide cites by name; worth reading after Khononov's more modern treatment, not instead of it.
- [Clean Architecture: A Craftsman's Guide to Software Structure and Design](https://learning.oreilly.com/library/view/-/9780134494272/?orm_source=mcp) — Robert C. Martin (Pearson) — the layering discipline (routes → services → repositories) the guide's own architecture spec cites as its stated principle, and that `20_TECHNICAL_DEBT_AND_GAPS.md` finding #8 shows was only followed for 3 of 24 routes.
- [Database Internals](https://learning.oreilly.com/library/view/-/9781492040330/?orm_source=mcp) — Alex Petrov (O'Reilly) — for reasoning precisely about the `supabase/migrations/001_initial.sql` entry's RLS-vs-application-layer-isolation tradeoff and the non-transactional delete-then-insert pattern in `lib/repositories/analysis.ts`.

**Public references (~20% of this section's list)**
- [Anti-Corruption Layer Pattern — Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer) — Microsoft Learn (official docs) — the exact pattern name and diagram `lib/api-contracts/v1/company.ts`'s teaching entry cites explicitly ("Anti-Corruption Layer, Evans, DDD, applied at the external boundary").
- [Refactoring code that accesses external services](https://martinfowler.com/articles/refactoring-external-service.html) — Martin Fowler — a practitioner's walkthrough of exactly the "wrap a provider SDK behind your own interface" discipline `lib/repositories/index.ts`'s composition root and the (never-extended) `getGenAI()` case both turn on.

---

## 19 — ARCHITECTURE DECISION LOG
*Case study source: `discussions/19_ARCHITECTURE_DECISION_LOG.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** Eleven real ADRs reconstructed from primary evidence — the NotionWealth-to-Quantalyze pivot, the Repository-pattern-as-migration-insurance bet, NDJSON-over-WebSockets, Postgres-as-cache-layer instead of Redis, and a two-stage Azure hosting migration where the second stage (App Service → Container Apps) shipped with zero design doc. This is fundamentally about *how* to make and record architecture decisions under real constraints, not which pattern is "best."

**Reading path by level:**

**Junior — build the fundamentals**
- [Fundamentals of Software Architecture, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098175504/?orm_source=mcp) — Mark Richards, Neal Ford (O'Reilly) — the standard vocabulary (tradeoffs, fitness functions, architectural characteristics) needed to read an ADR table like this one critically rather than as a list of facts.
- [Software Architecture Fundamentals — Diagramming and Documenting Architecture](https://learning.oreilly.com/videos/-/0636920342540/?orm_source=mcp) — Neal Ford, Mark Richards (O'Reilly video) — a short, concrete companion on the actual mechanics of writing decisions down, which is the entire discipline this log demonstrates and ADR #7/#11 show breaking down.

**Mid-level — go deeper / production concerns**
- [Software Architecture and Decision-Making](https://learning.oreilly.com/library/view/-/9780138249694/?orm_source=mcp) — Srinath Perera (Addison-Wesley) — a book-length treatment of exactly this log's format: real decisions, real constraints, real tradeoffs, with leadership/product context folded in — the closest match in the catalog to what this file is doing.
- [Monolith to Microservices](https://learning.oreilly.com/library/view/-/9781492047834/?orm_source=mcp) — Sam Newman (O'Reilly) — the canonical treatment of the Strangler Fig migration pattern ADR #2 and #11 both name explicitly (repository-pattern-as-migration-insurance, then the Supabase→Azure Postgres cutover it enabled).
- [Designing Distributed Systems, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098156343/?orm_source=mcp) — Brendan Burns (O'Reilly) — relevant to ADR #8 (NDJSON streaming vs. WebSockets vs. polling) as a catalog of the actual distributed-communication patterns being chosen between.

**Senior — tradeoffs, failure modes, design judgment**
- [Building Microservices, 2nd Edition](https://learning.oreilly.com/library/view/-/9781492034018/?orm_source=mcp) — Sam Newman (O'Reilly) — Newman's broader treatment of when *not* to decompose, directly relevant to ADR #1's core judgment call (abandoning the multi-agent platform for a leaner monolith) and ADR #9 (no RAG, no vector DB — solving a problem the product doesn't have).
- [Building Resilient Distributed Systems](https://learning.oreilly.com/library/view/-/9781098163532/?orm_source=mcp) — Sam Newman (O'Reilly) — bears directly on ADR #7's real failure mode: a migration (App Service → Container Apps) that shipped without the design-doc discipline every *other* migration in the repo got, and the resulting "wrong rollback commands" risk.
- [Just Use Postgres!](https://learning.oreilly.com/library/view/-/9781633435698/?orm_source=mcp) — Denis Magda (Manning) — directly defends (or lets a reader interrogate) ADR #5's caching-in-Postgres-not-Redis decision from someone who has made the same argument at book length.

**Public references (~20% of this section's list)**
- [Architectural Decision Records (ADRs)](https://adr.github.io/) — adr.github.io (community site preserving Michael Nygard's original ADR template) — the actual format this log's own methodology is built on; read this to see the minimal, honest version of what a good ADR looks like.
- [The Strangler Fig application pattern: incremental modernization to services](https://microservices.io/post/refactoring/2023/06/21/strangler-fig-application-pattern-incremental-modernization-to-services.md.html) — Chris Richardson, microservices.io — a practitioner's detailed walkthrough of the exact pattern ADR #2 and #11 both cite by name, from the person who has written most extensively about it in production contexts.

---

## 20 — TECHNICAL DEBT AND GAPS
*Case study source: `discussions/20_TECHNICAL_DEBT_AND_GAPS.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** Twenty adversarially-found, file-and-line-cited findings — 14/24 unauthenticated `/api/v1` routes (four of which can burn real Gemini spend), two structurally identical read-then-write races (`credits.ts` unacknowledged, `middleware.ts` self-documented-but-unfixed), zero prompt-injection mitigation on scraped transcript text, and doc/code drift severe enough to misdirect an incident responder. This reading set is deliberately about *how a senior engineer would triage and fix exactly this list* — API authorization, LLM cost/rate control, and concurrency fundamentals — not generic best practices.

**Reading path by level:**

**Junior — build the fundamentals**
- [Getting Started with OAuth 2.0](https://learning.oreilly.com/library/view/-/9781449317843/?orm_source=mcp) — Ryan Boyd (O'Reilly) — foundational before reasoning about finding #1 (14/24 routes with zero auth check) and its fix (a matcher-scoped middleware, opt-out to public rather than opt-in to auth).
- [A Detailed Guide to the OWASP Top 10](https://learning.oreilly.com/videos/-/9781837630554/?orm_source=mcp) — Alexander Oni (O'Reilly video) — the general web-security vocabulary (injection, broken access control, security misconfiguration) that findings #1, #5, and #7 are specific instances of.
- [Fundamentals of Technical Debt](https://learning.oreilly.com/videos/-/0636920971436/?orm_source=mcp) — Chelsea Troy (O'Reilly video) — a short, practical primer on identifying and prioritizing debt like this file does, useful before tackling the book-length treatments below.

**Mid-level — go deeper / production concerns**
- [API Security in Action](https://learning.oreilly.com/library/view/-/9781617296024/?orm_source=mcp) — Neil Madden (Manning) — covers hashed-API-key storage, entitlement scoping, and rate limiting at exactly the depth `middleware.ts`'s self-acknowledged read-then-write race (finding #4) needs to be understood and fixed correctly.
- [Web Application Security, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098143923/?orm_source=mcp) — Andrew Hoffman (O'Reilly) — broader coverage of the security posture findings #1, #5, #17, and #18 collectively describe (unauthenticated routes, prompt injection, repo hygiene, secrets handling).
- [Managing Technical Debt: Reducing Friction in Software Development](https://learning.oreilly.com/library/view/-/9780135646052/?orm_source=mcp) — Kruchten, Nord, Ozkaya (Addison-Wesley) — the standard reference for exactly the P0-through-P3 triage and prioritization method this file already applies; read to sanity-check its own prioritization logic, not just to learn the concept.

**Senior — tradeoffs, failure modes, design judgment**
- [AI-Native LLM Security](https://learning.oreilly.com/library/view/-/9781836203759/?orm_source=mcp) — Vaibhav Malik, Ken Huang, Ads Dawson (Packt) — directly addresses finding #5 (zero prompt-injection mitigation on scraped transcript text) with the current threat model for exactly this class of untrusted-third-party-content-into-a-prompt vulnerability.
- [Taming Your Dragon: Addressing Your Technical Debt](https://learning.oreilly.com/library/view/-/9798868802645/?orm_source=mcp) — Andrew Richard Brown (Apress) — a senior-level treatment of the same triage discipline, useful for defending *why* the auth gap and the credit race are P0/P1 while the dead `Supabase*Repository` classes are P1/P2 — a real prioritization argument, not a flat list.
- [Database Internals](https://learning.oreilly.com/library/view/-/9781492040330/?orm_source=mcp) — Alex Petrov (O'Reilly) — the depth needed to correctly design the atomic-`ON CONFLICT`-increment fix findings #3 and #4 both call for, and to understand exactly why the delete-then-insert pattern in finding #15 is unsafe under concurrent writes.

**Public references (~20% of this section's list)**
- [OWASP Top 10 for Large Language Model Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/) — OWASP GenAI Security Project (official) — the industry-standard checklist finding #5's prompt-injection gap maps onto directly (LLM01: Prompt Injection); read the actual entry, not a summary.
- [Prompt injection: What's the worst that can happen?](https://simonwillison.net/2023/Apr/14/worst-that-can-happen/) — Simon Willison — the most-cited individual-author explainer of exactly the risk finding #5 names (a crafted document skewing its own signal classification, invisible because the output stays schema-valid).
- [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — Marc Brooker, AWS Architecture Blog — the original, still-canonical explanation of correct retry/backoff design, directly relevant to the retry-and-cancellation gaps this file documents in `lib/pipeline.ts` (no retries, `Promise.race` doesn't cancel the loser).

---

## 21 — REBUILD FROM SCRATCH
*Case study source: `discussions/21_REBUILD_FROM_SCRATCH.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** A full v2 design document — domain modeling, API versioning, a CI-enforced `WHERE user_id` lint gate replacing dead RLS, `invokeStructured()` with real retries/telemetry, a scoped RAG design (per-run ephemeral embedding index for quote verification, not a persistent corpus), a queue-based worker architecture replacing the 270s in-request timeout stack, and an explicit verdict on which v1 decisions were good judgment vs. real mistakes. This is a systems and AI-product architecture exercise; the reading should be system design and AI-product-architecture texts, read as a design exercise, not a checklist.

**Reading path by level:**

**Junior — build the fundamentals**
- [Acing the System Design Interview](https://learning.oreilly.com/library/view/-/9781633439108/?orm_source=mcp) — zhiyong tan (Manning) — the standard vocabulary (requirements → domain model → boundaries → data model → scaling) this rebuild document's own section headers follow almost exactly.
- [System Design on AWS](https://learning.oreilly.com/library/view/-/9781098146887/?orm_source=mcp) — Jayanth Kumar, Mandeep Singh (O'Reilly) — cloud-native system design at the scale this document is reasoning at (queues, IaC, observability), even though the target cloud differs from Azure.

**Mid-level — go deeper / production concerns**
- [Designing Data-Intensive Applications, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098119058/?orm_source=mcp) — Martin Kleppmann, Chris Riccomini (O'Reilly) — essential for §5's data-model fixes (unique constraints, `ON CONFLICT` upserts, schema versioning for JSONB payloads) and §15's queue/worker redesign.
- [Learning Domain-Driven Design](https://learning.oreilly.com/library/view/-/9781098100124/?orm_source=mcp) — Vlad Khononov (O'Reilly) — directly supports §2's five-aggregate domain model (`Transcript`, `QuarterSnapshot`, `DeltaAnalysis`, `InsightsSynthesis`, `UsageAccount`) as an explicit-types exercise.
- [Building LLM Powered Applications](https://learning.oreilly.com/library/view/-/9781835462317/?orm_source=mcp) — Valentina Alto (Packt) — covers the production LLM-application concerns §7's AI-architecture section addresses (retries, token accounting, prompt injection defenses) in an applied, non-research framing.

**Senior — tradeoffs, failure modes, design judgment**
- [Designing Machine Learning Systems](https://learning.oreilly.com/library/view/-/9781098107956/?orm_source=mcp) — Chip Huyen (O'Reilly) — the best available match for §10's evaluation-harness design (golden set, regression suite, cross-model-family LLM-as-judge, human feedback loop) as a first-class system-design concern, not an afterthought.
- [A Simple Guide to Retrieval Augmented Generation](https://learning.oreilly.com/library/view/-/9781633435858/?orm_source=mcp) — Abhinav Kimothi (Manning) — directly informs §9's scoped, deliberately-narrow RAG design (per-run ephemeral quote-verification index, not a persistent cross-document corpus) — read specifically for when RAG earns its complexity, which is this document's actual argument.
- [Building Resilient Distributed Systems](https://learning.oreilly.com/library/view/-/9781098163532/?orm_source=mcp) — Sam Newman (O'Reilly) — the deepest match for §15's queue-based worker redesign (Azure Service Bus, admission control, client-disconnect-aware workers) replacing v1's synchronous in-request pipeline execution.

**Aspiring Lead — systems thinking, org/technical leadership**
- [Software Architecture and Decision-Making](https://learning.oreilly.com/library/view/-/9780138249694/?orm_source=mcp) — Srinath Perera (Addison-Wesley) — the document's closing section — separating "good judgment given constraints" from "real mistakes" — is itself a leadership skill this book treats explicitly, tying technical and product judgment together.

**Public references (~20% of this section's list)**
- [Azure Well-Architected Framework](https://learn.microsoft.com/en-us/azure/well-architected/) — Microsoft Learn (official docs) — the document's §12–15 (observability, security, deployment, scaling) map cleanly onto the Framework's five pillars; useful as an external checklist against the v2 design's own claims.
- [WebSocket vs Server-Sent Events: how to choose for real-time apps](https://vercel.com/i/websocket-vs-server-sent-events) — Vercel (official engineering guide) — directly relevant to §4/§15's decision to keep NDJSON-over-HTTP rather than move to WebSockets even in the queue-based v2 redesign.

---

## 22 — INTERVIEW PREPARATION
*Case study source: `discussions/22_INTERVIEW_PREPARATION.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** A leveled (L2→L3→Senior→Staff) question bank generated entirely from Quantalyze's real mechanics — the difference between `Promise.race` and `AbortController` cancellation, why there's no runtime Zod validation after a schema-constrained Gemini call, whether the "5 parallel agents" are actually agents. The core skill being trained is precise technical communication under interview pressure: naming exactly what's true, what's not, and why — never overclaiming "RAG" or "agents" where the honest answer is more rigorous and more impressive.

**Reading path by level:**

**Junior — build the fundamentals**
- [Acing the System Design Interview](https://learning.oreilly.com/library/view/-/9781633439108/?orm_source=mcp) — zhiyong tan (Manning) — the mechanics of a system-design interview (the format the A/B/D-category questions in this bank are structured around), worth reading before attempting to answer Staff-level questions like B4 or E4 cold.
- [AI Engineering Interviews](https://learning.oreilly.com/library/view/-/9798341623521/?orm_source=mcp) — Mina Ghashami, Ali Torkamani (O'Reilly) — a direct match for this file's format: real AI-engineering interview questions, at the exact "AI/LLM/RAG/agents" topic split this question bank covers (categories B–E).

**Mid-level — go deeper / production concerns**
- [Evaluating Large Language Models (LLMs)](https://learning.oreilly.com/videos/-/9780135451922/?orm_source=mcp) — Sinan Ozdemir (Pearson video) — directly prepares for category C's questions (C3, C4) on schema validation, runtime trust boundaries, and cost/token accounting design.
- [Solutions Architect's Interview](https://learning.oreilly.com/library/view/-/9781806382972/?orm_source=mcp) — Saurabh Shrivastava et al (Packt) — a cloud-architecture-flavored companion to the system-design questions (A, F, G, H categories) that lean on real Azure/API/database mechanics rather than abstract patterns.
- [Communication Patterns](https://learning.oreilly.com/library/view/-/9781098140533/?orm_source=mcp) — Jacqui Read (O'Reilly) — the "strong answer vs. weak answer" framing this whole question bank uses is fundamentally about *how* to structure a technical answer, not just what to know; this book is about exactly that structuring skill.

**Senior — tradeoffs, failure modes, design judgment**
- [The Staff Engineer's Path](https://learning.oreilly.com/library/view/-/9781098118723/?orm_source=mcp) — Tanya Reilly (O'Reilly) — the Staff-level questions in this bank (B4, C4, E4, H4) all ask the candidate to *design the fix and know its second-order consequences* — exactly the operating mode this book describes for staff-level work.
- [Leading Technical Decision Making for High-Performing Teams](https://learning.oreilly.com/videos/-/9781492030553/?orm_source=mcp) — Kellan Elliott-McCrea (O'Reilly video) — directly useful for the "defend this decision against an alternative" framing that every Senior-level question in this bank (A3, B3, C3, H3) is built around.
- [LLM Design Patterns](https://learning.oreilly.com/library/view/-/9781836207030/?orm_source=mcp) — Ken Huang (Packt) — a pattern-language reference for precisely answering E1/E2/E3's "are these actually agents" line of questioning, which requires a rigorous, not folk, definition of agentic autonomy.

**Public references (~20% of this section's list)**
- [Preparing for the Systems Design and Coding Interview](https://blog.pragmaticengineer.com/preparing-for-the-systems-design-and-coding-interviews/) — Gergely Orosz, The Pragmatic Engineer — one of the most-cited independent guides to exactly this interview format, useful for calibrating pacing and depth against this question bank's L2→Staff progression.
- [What do Staff Engineers actually do?](https://staffeng.com/guides/what-do-staff-engineers-actually-do/) — Will Larson, StaffEng.com — grounds the Staff-tier questions' expectations (design judgment, second-order consequences) in real accounts of what that operating level actually looks like day to day.

---

## 23 — PROJECT DEFENSE
*Case study source: `discussions/23_PROJECT_DEFENSE.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** A dimension-by-dimension verdict (CAN DEFEND / PARTIALLY DEFEND / CANNOT DEFEND) across 18 areas — Cloud and APIs are the strongest, Agents/RAG/Testing/Evaluation/Observability/Customer-feedback are explicit CANNOT DEFEND items — plus explicit interview guidance: lead with the strong dimensions, *name* the gaps before being asked, and never claim Agents or RAG are in production even loosely. This is fundamentally about articulating architectural tradeoffs and honest scope with a real audience (an interviewer evaluating this exact project), not generic self-presentation.

**Reading path by level:**

**Junior — build the fundamentals**
- [Communicative English for Engineers and Professionals](https://learning.oreilly.com/library/view/-/9788131792353/?orm_source=mcp) — Nitin Bhatnagar, Mamta Bhatnagar (Pearson India) — foundational technical-communication skills for structuring a defense narrative like this one's "THE QUANTALYZE ENGINEERING STORY" opening section.
- [Communication Patterns](https://learning.oreilly.com/library/view/-/9781098140533/?orm_source=mcp) — Jacqui Read (O'Reilly) — a more senior-audience treatment of the same skill, directly applicable to writing (and defending) the kind of honest capability table this document is built around.

**Mid-level — go deeper / production concerns**
- [AI Engineering Interviews](https://learning.oreilly.com/library/view/-/9798341623521/?orm_source=mcp) — Mina Ghashami, Ali Torkamani (O'Reilly) — practicing the exact "own the CANNOT DEFEND items before you're asked" move this document recommends, in an AI-specific interview context.
- [Software Architecture and Decision-Making](https://learning.oreilly.com/library/view/-/9780138249694/?orm_source=mcp) — Srinath Perera (Addison-Wesley) — for defending real production tradeoffs (the pivot story, the Container Apps jump) the way this document's "lead with Cloud, APIs, AI..." guidance instructs.

**Senior — tradeoffs, failure modes, design judgment**
- [The Staff Engineer's Path](https://learning.oreilly.com/library/view/-/9781098118723/?orm_source=mcp) — Tanya Reilly (O'Reilly) — this document's central move (naming a real gap, its cause, and its fix path, unprompted) is exactly the credibility-building pattern this book associates with senior/staff-level technical narratives.
- [Leading Technical Decision Making for High-Performing Teams](https://learning.oreilly.com/videos/-/9781492030553/?orm_source=mcp) — Kellan Elliott-McCrea (O'Reilly video) — directly useful for defending the NotionWealth→Quantalyze pivot as "the single best answer to almost any 'tell me about a hard decision' question," which is precisely a technical-decision-making narrative.

**Public references (~20% of this section's list)**
- [The Tech Interview Inside-Out](https://blog.pragmaticengineer.com/the-tech-interview-inside-out/) — Gergely Orosz, The Pragmatic Engineer — a widely-read practitioner's view of what interviewers are actually evaluating for, directly relevant to this document's "how to talk about this in an interview" closing section.
- [What do Staff Engineers actually do?](https://staffeng.com/guides/what-do-staff-engineers-actually-do/) — Will Larson, StaffEng.com — real accounts of engineers defending scoped, honestly-limited work as a credibility signal rather than a weakness, matching this document's core thesis.

---

## 24 — 90-DAY ENGINEERING LEARNING PLAN
*Case study source: `discussions/24_90_DAY_ENGINEERING_LEARNING_PLAN.md`*

**What this section covers, and why it matters for an engineer growing into this codebase:** This file already *is* a specific, week-by-week learning plan for this exact codebase — 20 ranked gaps closed across three 30-day phases (correctness/security/testing → AI reliability/telemetry/evaluation → Azure AI service port/IaC/RAG demo/product maturity). Rather than writing another plan, this section maps real books/courses onto the plan's own weeks, so each phase has actual material to study alongside the "concrete exercise" it already specifies.

**Reading path by level — mapped to the plan's own phases, not to seniority:**

**Phase 1 (Days 1–30): Correctness, security, and a test foundation — gaps #1, #2, #8, #9, #12, #13, #19**
- [API Security in Action](https://learning.oreilly.com/library/view/-/9781617296024/?orm_source=mcp) — Neil Madden (Manning) — for Week 1's auth sweep (gap #1) and Week 2's atomic-SQL credit/rate-limit fixes (gaps #8, #13).
- [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — Marc Brooker, AWS Architecture Blog (public) — read before Week 2's concurrency fixes; the canonical explanation of exactly the atomicity/contention problem gaps #8 and #13 name.
- [Testing JavaScript Applications](https://learning.oreilly.com/library/view/-/9781617297915/?orm_source=mcp) — Lucas Fernandes da Costa (Manning) — for Week 3's Vitest install and pure-function unit tests (gap #2) — modern JS/TS testing practice matching the plan's stated tooling choice.
- [Continuous Integration (CI) and Continuous Delivery (CD)](https://learning.oreilly.com/library/view/-/9781484292280/?orm_source=mcp) — Henry van Merode (Apress) — for Week 4's CI `verify` gate (gap #9): `tsc --noEmit` + `npm test` + `npm audit` before deploy.

**Phase 2 (Days 31–60): AI reliability, telemetry, and evaluation — gaps #3, #4, #6, #10, #14**
- [LLMs in Production](https://learning.oreilly.com/library/view/-/9781633437203/?orm_source=mcp) — Matthew Sharp, Christopher Brousseau (Manning) — for Week 5's shared `lib/llm/client.ts` extraction (gap #14) and retry/backoff wrapper (gap #6), covering exactly this kind of production-hardening work for an LLM call layer.
- [Prompt Engineering for LLMs](https://learning.oreilly.com/library/view/-/9781098156145/?orm_source=mcp) — John Berryman, Albert Ziegler (O'Reilly) — for Week 6's prompt-injection mitigation (gap #10): delimited transcript blocks and instruction-hierarchy framing.
- [Prompt injection explained, with video, slides, and a transcript](https://simonwillison.net/2023/May/2/prompt-injection-explained/) — Simon Willison (public) — a fast, concrete companion to Week 6's heuristic-scan design for gap #10.
- [Evaluating Large Language Models (LLMs)](https://learning.oreilly.com/videos/-/9780135451922/?orm_source=mcp) — Sinan Ozdemir (Pearson video) — for Weeks 7–8's golden-set-plus-LLM-as-judge harness (gap #3), the plan's single most interview-relevant deliverable.
- [Hands-On Large Language Models](https://learning.oreilly.com/library/view/-/9781098150952/?orm_source=mcp) — Jay Alammar, Maarten Grootendorst (O'Reilly) — background for Week 6's token/latency telemetry (gap #4): understanding what `usageMetadata` actually represents.

**Phase 3 (Days 61–90): Azure AI service, cloud maturity, and product feedback — gaps #5, #7, #11, #15–18, #20**
- [Azure OpenAI Service for Cloud Native Applications](https://learning.oreilly.com/library/view/-/9781098154981/?orm_source=mcp) — Adrián González Sánchez (O'Reilly) — the direct text for Week 9's flagship milestone: porting `lib/sector-narrative.ts` to Azure OpenAI/AI Foundry and translating its schema to Azure's structured-output format (gap #5).
- [Azure OpenAI Essentials](https://learning.oreilly.com/library/view/-/9781805125068/?orm_source=mcp) — Amit Mukherjee, Adithya Saladi (Packt) — a second, complementary pass on the same Week 9 milestone with a more hands-on, project-based structure.
- [Infrastructure as Code with Azure Bicep](https://learning.oreilly.com/library/view/-/9781801813747/?orm_source=mcp) — Yaser Adel Mehraban (Packt) — for Week 10's Bicep IaC codifying the currently-manual Azure resources (gap #7).
- [Vector Databases](https://learning.oreilly.com/library/view/-/9781098177584/?orm_source=mcp) — Nitin Borwankar (O'Reilly) — for Week 11's small, honestly-scoped `pgvector` RAG demo over cached `insights_cache` payloads (gap #11) — deliberately not a rebuild of the archived platform's ambition.
- [Web Accessibility Cookbook](https://learning.oreilly.com/library/view/-/9781098145590/?orm_source=mcp) — Manuel Matuzovic (O'Reilly) — for Week 12's scoped accessibility pass (gap #18): `aria-live` on `AgentPanel.tsx` and a real ARIA combobox on `CompanySearch`.

**End-state reading — for after Day 90, closing the remaining CANNOT DEFEND items**
- [Observability Engineering, 2nd Edition](https://learning.oreilly.com/library/view/-/9781098179915/?orm_source=mcp) — Charity Majors, Liz Fong-Jones, George Miranda (O'Reilly) — the natural next step once Phase 2's telemetry work is live, for turning ad hoc logging into a real observability practice.
- [Infrastructure as Code on Azure — Practical Bicep Training for 2025](https://learning.oreilly.com/videos/-/9781806383115/?orm_source=mcp) — Houssem Dellai (Packt video) — a faster, more current companion to Week 10's Bicep work if the book format above moves too slowly.

**Public references (~20% of this section's list, distributed across phases above)**
- [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — Marc Brooker, AWS Architecture Blog (Phase 1/2).
- [Prompt injection explained, with video, slides, and a transcript](https://simonwillison.net/2023/May/2/prompt-injection-explained/) — Simon Willison (Phase 2).

*Note on coverage: O'Reilly's catalog has thin direct coverage of "Vitest" by name (results skewed toward Jest/general JS testing) and no dedicated title on Azure Service Bus queue-worker patterns for the Phase 3 queue redesign referenced in `21_REBUILD_FROM_SCRATCH.md` §15 — general distributed-systems/resilience texts (see section 19/21 above) are the closest substitute.*

---

*Compiled as a companion to the 25-section engineering case study in this folder. Every book, course, video, and article above was retrieved live — via the O'Reilly Learning platform catalog (`mcp__O_Reilly__search_oreilly_content`) or the public web (`WebSearch`) — and grounded in a specific, cited finding from the corresponding `discussions/` file. No title, author, or URL was entered from memory.*
