# 22 — Interview Preparation: Question Bank

Every question below is generated directly from Quantalyze's actual, verified mechanics — not
generic AI-engineering trivia with "Quantalyze" bolted on. Each one can only be answered correctly
by someone who has actually read the code (or this case study). Citations point to real files;
where a number appears (25,000ms, 120,000 chars, 3 credits), it is the literal constant in the
codebase, not an approximation.

Progression within each category runs **L2 → L3 → Senior → Staff**: L2 questions ask "what happens,"
L3 asks "why, precisely, and what's the failure mode," Senior asks "defend this decision against an
alternative," and Staff asks "design the fix, and know its second-order consequences."

Format per question: the question itself, what it's testing, how Quantalyze demonstrates it (with
citation), a strong first-person answer, a weak answer to recognize and avoid, and one natural
follow-up an interviewer would actually ask next.

---

## A. System Design

### A1 [L2] — Walk me through what happens when a user clicks "Run Delta Analysis" on the dashboard.

**Testing:** Can you trace a request through every layer of a real system without hand-waving over
any of them — frontend, auth, cache, credits, orchestration, persistence, streaming back to the UI.

**Evidence:** `app/dashboard/DashboardClient.tsx` (`handleAnalyze`) → `lib/api.ts`
(`runAnalysisStream`) → `app/api/v1/analyze/route.ts` → `lib/pipeline.ts` (`runPipeline`) →
`lib/repositories/analysis.ts` (`PostgresAnalysisRepository`).

**Strong answer:** "`DashboardClient.tsx`'s `handleAnalyze` resets loading state and calls
`runAnalysisStream()` in `lib/api.ts`, which POSTs to `/api/v1/analyze`. The route handler first
calls `getCurrentUser()` — 401 if there's no session — then validates the body and resolves both
quarters' PDF keys in storage before opening the stream at all, so a missing transcript 422s
immediately instead of failing mid-stream. It then checks `analysisRepo.getCachedAnalysis()`; on a
hit it streams one `done` line and never touches Gemini or credits. On a miss it deducts 3 credits,
opens a `ReadableStream`, and calls `runPipeline()`, which runs five phases — PDF extraction, 10
parallel thematic calls plus evasiveness, up to 5 temporal-delta calls, 4 synthesis calls, then
pure-function validation — streaming an NDJSON progress line after each phase via a `send()`
callback wired to `controller.enqueue()`. On completion it does a delete-then-insert into
`analysis_results` and sends a final `done` line with the full payload, which `DashboardClient`
swaps in for `EarningsReport`."

**Weak answer:** "It calls an API that runs some AI agents and shows you the results with a
progress bar."

**Follow-up:** "What happens if the user's session cookie is valid but the two PDFs for the
requested quarters don't both exist in storage?"

---

### A2 [L2] — What's the actual difference between the Server Component and Client Component halves of a page like `/dashboard`?

**Testing:** Understanding of Next.js App Router as actually used here, not textbook App Router.

**Evidence:** `app/dashboard/page.tsx` (16 lines) vs. `app/dashboard/DashboardClient.tsx` (969
lines).

**Strong answer:** "The Server Component's entire job is `getCurrentUser()` and `redirect('/login')`
on failure — it passes zero props to `DashboardClient` and does no data fetching. All the real data
fetching — `/api/v1/available`, `/api/v1/user-tickers`, the analysis stream itself — happens
client-side inside `useEffect` hooks in `DashboardClient.tsx`. So this isn't the 'Server Component
prefetches, Client renders' pattern people usually mean by App Router — it's an auth-gated shell
wrapping what's functionally a client-rendered SPA screen. `/insights` and `/calendar` don't even
do the server-side redirect — they render as public empty shells and only 401 when their client-side
fetches hit the API."

**Weak answer:** "Server Components run on the server and Client Components run in the browser."

**Follow-up:** "Given that pattern, what actually stops an unauthenticated user from seeing the
`/insights` page shell?"

---

### A3 [Senior] — Where do the actual architectural boundaries sit in this system — is there a real service layer?

**Testing:** Whether the candidate can recognize partial architecture adoption rather than assuming
consistency across a codebase.

**Evidence:** `lib/services/` (3 files, used only by the 3 public API routes) vs.
`app/api/v1/screener/route.ts` (285 lines of inline business logic) and `app/api/v1/analyze/route.ts`
(inlines cache-check, credit-check, and streaming protocol directly).

**Strong answer:** "There's a real service layer, but it's scoped to exactly the public API:
`SectorThesisService` in `lib/services/sectorThesisService.ts` takes constructor-injected
repositories, does real orchestration, and is the one place in the codebase with genuine dependency
injection. But the internal `/api/v1` surface — the actual bulk of the product — never got this
treatment. `screener/route.ts` defines its own types, a `computeConfidence()` scoring function, and
a two-pass merge algorithm directly in the route file; `analyze/route.ts` inlines the cache-hit
short-circuit and credit-check ordering rather than delegating to a service. So the honest answer is:
the team built the right layering discipline, proved it once on the newest surface, and never
retrofitted it onto the older, larger one — which is architecture debt, not an absence of
architecture."

**Weak answer:** "Yeah there's a service layer, it's in `lib/services`."

**Follow-up:** "If you had to retrofit a service layer onto `/api/v1/analyze`, what would you extract
first, and what would you leave in the route?"

---

## B. AI Architecture

### B1 [L2] — What's the actual shape of a Gemini call in this codebase?

**Testing:** Concrete familiarity with the `invokeStructured()` pattern, not a vague "it calls the
API."

**Evidence:** `lib/pipeline.ts:191-214`.

**Strong answer:** "Every call goes through a near-identical `invokeStructured<T>()` helper —
duplicated in each pipeline file — that builds a `GoogleGenerativeAI` model with a fixed
`systemInstruction`, `responseMimeType: 'application/json'`, a `responseSchema`, and `temperature: 0`
in most files. The actual call is `Promise.race([model.generateContent(userPrompt), timeoutPromise])`
with a per-file timeout constant — 25 seconds in the delta pipeline, 55 seconds in Solo and
Insights. The result is `JSON.parse(result.response.text())` cast directly to a TypeScript type with
no runtime re-validation. It's a synchronous, non-streaming `generateContent` call, never
`generateContentStream`."

**Weak answer:** "It sends a prompt to Gemini and gets JSON back."

**Follow-up:** "Why do you think the timeout is 25 seconds in `lib/pipeline.ts` specifically but 55
seconds in `lib/solo-pipeline.ts` and `lib/insights-pipeline.ts`?"

---

### B2 [L3] — Why does `lib/pipeline.ts` use `Promise.race` for timeouts instead of `AbortController`, and what's the actual consequence?

**Testing:** Whether the candidate understands the real difference between "stop waiting" and "stop
the work" — a genuinely subtle distinction that separates people who've read the SDK docs from
people who've actually debugged this class of bug.

**Evidence:** `lib/pipeline.ts:189,208-212`; confirmed by grep — zero `AbortController`/`signal:`
usage on any Gemini SDK call site anywhere in the codebase (`AbortSignal.timeout` is used, but only
on third-party `fetch()` calls to Screener.in/BSE/NSE, never on `model.generateContent()`).

**Strong answer:** "`Promise.race([model.generateContent(userPrompt), timeout])` only races which
promise the calling code stops *awaiting* first — it doesn't cancel the loser. When the 25-second
timer wins, the pipeline treats that agent as failed and moves on, but the actual
`generateContent()` request keeps running against Google's servers in the background, and Quantalyze
still pays for whatever tokens that call consumes. The `@google/generative-ai` SDK does accept a
`RequestOptions.signal`, so this could have used `AbortController` to actually cancel the in-flight
HTTP request — but nowhere in the codebase does it. The practical consequence is real but probably
small: wasted Gemini spend on every timeout, proportional to how often the 25-second budget is
missed, with no way to reconcile that a 'failed' call might complete seconds later and do nothing
useful with its result."

**Weak answer:** "`Promise.race` is just a way to add a timeout to a promise, it works fine."

**Follow-up:** "If you wired `AbortController` through to `generateContent()`, what else in the
route handler would need to change to propagate the abort when the browser tab closes?"

---

### B3 [Senior] — Why is there no shared LLM client abstraction, given the repository layer has one?

**Testing:** Recognizing an inconsistently-applied architectural principle, and being able to argue
both sides of whether that's actually a problem at this stage.

**Evidence:** `lib/repositories/index.ts` (one composition root, `Postgres*Repository` behind
interfaces) vs. `getGenAI()` duplicated near-verbatim in `lib/pipeline.ts:183-186`,
`lib/solo-pipeline.ts:39-42`, `lib/insights-pipeline.ts:75-78`, `lib/sector-narrative.ts:112,118`,
`lib/kpi-extractor.ts:361,368`.

**Strong answer:** "The repository layer went through a real Supabase-to-Azure-Postgres migration
specifically because the team decided in advance to build a provider seam — the composition root at
`lib/repositories/index.ts` is exactly what let that migration touch only implementation files, not
a single route handler. The Gemini client never got the same treatment: `getGenAI()` is copy-pasted
across five files, each constructing a fresh `GoogleGenerativeAI` instance per call instead of
sharing a singleton the way the Postgres pool does. I'd defend this as reasonable *today* — there's
no announced plan to swap Gemini for another provider, unlike the Postgres migration which was
already decided when the repository pattern was introduced — but it's already causing real drift:
`lib/kpi-extractor.ts` and `lib/sector-narrative.ts` silently `console.warn` and skip on a missing
API key, while `lib/pipeline.ts` throws hard. That's not a hypothetical inconsistency, it's already
shipped."

**Weak answer:** "They probably just didn't get around to it, it's not a big deal since it's all
Gemini anyway."

**Follow-up:** "What's the smallest refactor that would fix the API-key-missing inconsistency without
building a full provider abstraction?"

---

### B4 [Staff] — The pipeline runs five phases strictly sequentially but fans out in parallel within each phase. Why not a single fully async dataflow graph?

**Testing:** Whether the candidate can reason about orchestration design tradeoffs at a systems
level — not just describe what exists, but argue why the simpler shape is actually correct here.

**Evidence:** `lib/pipeline.ts`'s `runPipeline()` — Phase 1 (PDF extraction) → Phase 2 (11 parallel
Gemini calls) → Phase 3 (up to 5 parallel delta calls, gated on Phase 2's output per section) →
Phase 4 (4 parallel synthesis calls, gated on Phase 3) → Phase 5 (pure functions, no LLM).

**Strong answer:** "A fully async dataflow graph — where each of the ~19 calls fires as soon as its
own specific dependencies are ready, independent of any artificial phase boundary — could shave a
few seconds off the critical path, since not every synthesis call strictly needs every delta result.
But the five-phase shape maps directly onto real data dependencies: Phase 3's temporal-delta calls
need *both* quarters' thematic snapshots for a given section, which only exist after Phase 2 fully
resolves, and Phase 4's synthesis calls are built from `buildDeltaSummary()`, which needs
`localValidation()`'s output, which needs all of Phase 3. So the sequential-phase-with-parallel-fan-out
shape isn't a simplification of a 'real' graph, it's an accurate rendering of the actual dependency
structure, just coarsened to phase granularity instead of per-call granularity. Given there's no
retry logic and no per-call telemetry today, I'd rather have five debuggable, loggable phase
boundaries — 'Phase 2 done, 9/10 succeeded' — than a fully async graph that's harder to reason about
for maybe a few seconds of wall-clock gain on a request that already streams progress incrementally,
so the user isn't staring at a blank spinner regardless."

**Weak answer:** "Async graphs are more complex to build so they just kept it simple with phases."

**Follow-up:** "Which specific synthesis call in Phase 4 doesn't actually depend on all of Phase 3's
output, and could theoretically start earlier?"

---

## C. LLM

### C1 [L2] — How is JSON structure enforced on Gemini's output, and what happens when it's malformed?

**Testing:** Understanding native structured-output enforcement vs. the older prompt-and-pray
pattern, plus honest awareness of what's *not* handled.

**Evidence:** `lib/pipeline.ts:146-160` (`invokeStructured`), six `Schema` objects
(`QUARTER_SNAPSHOT_SCHEMA` etc.) built with `SchemaType.OBJECT/ARRAY/STRING/NUMBER`.

**Strong answer:** "Every call passes `responseMimeType: 'application/json'` plus an explicit
`responseSchema` built from Gemini's `SchemaType` enum — this is native structured-output decoding,
not a 'respond only in JSON' instruction followed by manual parsing. It's a real reliability
guarantee: the model is constrained at decode time to match the schema shape, including enum-
constrained fields like `signal_classification`. When something does go wrong — `JSON.parse()`
throwing, or a timeout — every agent function wraps its call in try/catch and returns `null` or a
typed default rather than crashing the pipeline. What it does *not* do is re-validate the parsed
result against the TypeScript interface at runtime — `JSON.parse(...) as T` is a type assertion, not
a type check, and there's no Zod or equivalent anywhere in the repo."

**Weak answer:** "They probably just ask Gemini to return JSON and parse it."

**Follow-up:** "The TS interfaces and the Gemini Schema objects are two independently maintained
descriptions of the same shape. What happens if they drift?"

---

### C2 [L3] — Is temperature 0 everywhere in this pipeline?

**Testing:** Whether the candidate actually checked, versus repeating the top-level architecture
doc's blanket claim uncritically — a good test of "do you verify claims against code."

**Evidence:** `lib/pipeline.ts:195,205`, `lib/solo-pipeline.ts:168,174`,
`lib/insights-pipeline.ts:86,92` all use `temperature: 0`; `lib/kpi-extractor.ts:370,374` and
`lib/sector-narrative.ts:120,131` use `temperature: 0.1`.

**Strong answer:** "No — it's temperature 0 in three of five AI-calling files: the delta pipeline,
solo pipeline, and insights pipeline all use 0 for deterministic extraction. `lib/kpi-extractor.ts`'s
sector-KPI enrichment call and `lib/sector-narrative.ts`'s narrative-synthesis call both use 0.1
instead. That's a small, deliberate-looking distinction between 'this is pure extraction, be fully
deterministic' and 'this is short synthesized prose, a little variance avoids repetitive phrasing
across runs' — but the top-level architecture doc states 'Temperature 0' as a blanket claim, which
is only true for 3 of 5 call sites. It's the kind of doc-vs-code gap that's easy to repeat
uncritically if you haven't actually grepped the files."

**Weak answer:** "Yes, it's all temperature 0 for consistent extraction."

**Follow-up:** "Why would you want temperature 0.1 for a narrative-generation call specifically, and
not for the thematic extraction calls?"

---

### C3 [Senior] — There's no runtime schema validation (no Zod) after Gemini responds. Defend or critique that.

**Testing:** Ability to reason about defense-in-depth tradeoffs and articulate exactly where the
trust boundary is, rather than reflexively saying "should have used Zod."

**Evidence:** `lib/pipeline.ts:159` (`JSON.parse(result.response.text()) as T`); contrast with the
**archived** prototype's `finance-agent/multiagent_analysis/config.py:34-63`, which does
`schema.model_validate(data)` after `json.loads()` — genuine Pydantic runtime validation the
production TypeScript rewrite dropped.

**Strong answer:** "I'd call this a calculated bet, not an oversight — and it's a bet the codebase
itself shows was made consciously, because the archived Python prototype *did* do real runtime
validation with Pydantic's `model_validate()`, and the TypeScript rewrite dropped it. The trust
boundary here is Gemini's own `responseSchema` enforcement — the model is constrained at generation
time, which is a stronger guarantee than most systems get from an LLM. But it's not a complete
guarantee: schema enforcement can still produce an empty array, an empty string, or an
edge-of-range number that satisfies the required-field check but is semantically wrong. There is
some ad hoc defense — `Math.max(0, Math.min(10, result.score))` clamps the evasiveness score, and
the repository layer refuses to cache a result whose `insights` array is empty — but that's field-
level defensive coding, not a declared schema. I'd add a thin Zod layer at the repository-write
boundary specifically, not because I distrust `responseSchema`, but because it's the one place a
malformed value would otherwise get silently persisted and served to every user who views that
ticker."

**Weak answer:** "It's fine because Gemini's schema means it's always valid, so extra validation
would be redundant."

**Follow-up:** "Where specifically would you insert that Zod layer — before the cache write, or
before the client response — and why does that choice matter?"

---

### C4 [Staff] — The pipeline never reads `usageMetadata` or logs a single token count anywhere. Design a cost-accounting system for it.

**Testing:** Whether the candidate can design real AI-cost observability from scratch, understanding
exactly what's missing today and why the current "cost model" is actually a spend proxy, not a
measurement.

**Evidence:** grep for `usageMetadata|promptTokenCount|candidatesTokenCount` across `lib/` and
`app/` returns zero matches; `lib/credits.ts`'s `ACTION_COSTS = { delta: 3, solo: 1, insights: 4 }`
is a flat per-action charge, decoupled from actual transcript size or Gemini spend.

**Strong answer:** "Today, cost control and cost *measurement* are two different things that happen
to be conflated. `lib/credits.ts` charges a flat 3/1/4 credits per action regardless of transcript
length or how many of the ~19 Gemini calls actually ran — that's a product-pricing gate, not a
telemetry system, and the `TECHNICAL_ARCHITECTURE.md` cost estimates are static engineering
guesses, not measured numbers. I'd start by reading `result.response.usageMetadata` — which the SDK
already exposes and the code just never touches — inside `invokeStructured()`, and logging
`{promptTokenCount, candidatesTokenCount, stage, ticker, quarter}` as one structured line per call.
Once that's flowing, I'd aggregate it into a per-run total attached to the `analysis_results` row
itself — a `gemini_tokens_used` JSONB field alongside the payload — so you can finally answer 'is a
3-hour Reliance transcript actually costing us more than a 20-minute mid-cap call,' which today is
architecturally invisible. Only after that instrumentation exists would I consider whether the flat
credit pricing is actually leaving margin on the table for large transcripts, or overcharging for
small ones."

**Weak answer:** "You'd just add some logging for how many tokens each call uses."

**Follow-up:** "Once you have per-call token data, would you use it to change the credit-pricing
model, or keep pricing flat and just use the data for margin monitoring? Why?"

---

## D. RAG

### D1 [L2] — Does this system do RAG? Defend your answer.

**Testing:** The single most important "don't overclaim" test in the whole interview — whether the
candidate can precisely distinguish production reality from an archived prototype, and define
retrieval + augmentation + generation with actual rigor rather than using "RAG" as a synonym for
"gives an LLM some context."

**Evidence:** Zero vector index, embeddings, or chunking anywhere in `lib/`/`app/` (grep-verified);
`finance-agent/core/vector.py` (FAISS `IndexFlatL2`) + `core/embeddings.py` +
`agents/financial_agent.py`'s `analyze_financials()` — genuine retrieval → augmentation → generation
— exists only in the archived prototype.

**Strong answer:** "No, not in production. Production's context construction is pure string
truncation: `extractPdfText()` slices a PDF to 120,000 characters and pastes the whole thing into
every relevant prompt — there's no retrieval step, because there's nothing to retrieve *from*; each
call only ever needs the one transcript already in scope for that request. RAG requires all three
legs — retrieval over an indexed corpus, augmentation of a prompt with retrieved content, and
generation conditioned on it — and there's no indexed corpus here at all. The archived Python
prototype genuinely does earn the RAG label: `finance-agent/core/vector.py` wraps a FAISS
`IndexFlatL2` index, `core/embeddings.py` embeds via Gemini's embedding endpoint, and
`agents/financial_agent.py` concatenates both FAISS search results and a structured fact-store lookup
into one prompt before calling `call_gemini()` — retrieval, augmentation, and generation, all
present and traceable. That system was frozen in February when the team pivoted to the leaner
Next.js rewrite, and none of it shipped."

**Weak answer:** "Yeah, it's RAG because it pulls in the transcript and gives it to the LLM as
context."

**Follow-up:** "Given the whole system fits in Gemini's context window today, at what point — cost,
transcript length, or corpus size — would RAG actually start earning its complexity for this
product?"

---

### D2 [L3] — What exactly happened to the archived prototype's FAISS retrieval when the pipeline was ported to TypeScript?

**Testing:** Precision about what was dropped versus what was never built in the first place, and
whether the candidate understands the difference between "never built" and "built, then abandoned."

**Evidence:** `lib/pipeline.ts:2`'s own header comment ("TypeScript port of the Python pipeline");
`finance-agent/core/vector.py`, `core/embeddings.py`, `core/financial_memory.py` have no TypeScript
counterpart anywhere in `lib/`.

**Strong answer:** "It wasn't ported at all — it was dropped outright, not degraded or simplified.
`lib/pipeline.ts` literally documents itself as a TypeScript port of the Python pipeline, but the
port only carried over the multi-agent extraction-and-delta-comparison shape, not the retrieval
layer. There's no TypeScript file anywhere that plays the role of `core/vector.py` or
`core/embeddings.py` — no FAISS equivalent, no embedding calls, nothing. This tracks with the
broader pivot documented in the ADR log: the whole `finance-agent/` retrieval-and-memory layer was
part of the ambition the team explicitly abandoned in late February when they rebuilt the product
as a narrower, stateless pipeline. It's not that retrieval got refactored into something leaner — the
production system's 'context construction' is a fundamentally different, retrieval-free design."

**Weak answer:** "They probably simplified the vector search into something lighter weight for
TypeScript."

**Follow-up:** "The Python prototype also had `financial_memory.py` — a separate, non-vector
structured-fact retrieval path. Did that survive the port either?"

---

### D3 [Senior/Staff] — Given Quantalyze's actual economics, would you add RAG? When would it earn its complexity?

**Testing:** Strategic judgment about when RAG is the right engineering call versus fashionable
over-engineering — a question that rewards economic reasoning, not pattern-matching "RAG is best
practice."

**Evidence:** `MAX_TRANSCRIPT_CHARS = 120_000` in `lib/pipeline.ts:238`; ~$0.03/run estimated cost at
Gemini Flash Lite pricing; transcripts sourced one-at-a-time per analysis request.

**Strong answer:** "I wouldn't add it today, and I think the decision not to is defensible on the
economics alone. Every one of Quantalyze's queries is scoped to one or two specific transcripts that
already fit comfortably inside Gemini's context window — RAG earns its complexity when a query has
to draw from a corpus too large to fit in context, and that's just not this product's shape yet.
Retrieval also introduces a real accuracy risk this product specifically can't absorb: nearly every
prompt instructs the model to extract 'VERBATIM quotes, do NOT paraphrase,' and a retrieval step
risks silently dropping the exact passage a downstream agent needed, which a full-document read
never does. Where it *would* earn its keep is the moment the product needs genuine cross-document
reasoning — comparing eight quarters' worth of transcripts at once, or reasoning across a whole
portfolio of tickers simultaneously — which is precisely the capability the archived prototype was
built toward and the live product deliberately walked away from. If a customer asked for
'cross-portfolio correlation of risk exposure,' that's the trigger to revisit retrieval, not before."

**Weak answer:** "RAG is generally good practice so I'd probably add it to make the system more
scalable."

**Follow-up:** "If you did add retrieval for a future 'compare across 8 quarters' feature, would you
still send full transcripts for the two quarters being compared, or retrieve chunks from all eight?
Why?"

---

## E. Agents

### E1 [L2] — Are the 5 parallel calls in `lib/pipeline.ts` agents? Why or why not?

**Testing:** Rigorous application of an autonomy-based definition of "agent" instead of a
naming-based one — the single most commonly overclaimed thing in AI-engineering interviews.

**Evidence:** `lib/pipeline.ts:783,788,796` (`AGENT_PROMPTS`, dispatched by hard-coded orchestration
code); zero `tools`/`functionDeclarations` in any `generationConfig` in the whole `lib/`/`app/` tree
(grep-verified).

**Strong answer:** "No — they're LLM-powered functions, not agents, and the test I'd apply is
autonomy over what happens next: does the component choose a tool, loop based on its own output, or
plan a sequence not fixed by the calling code? None of that is true here. `AGENT_PROMPTS` is a
`Record<string, string>` of five fixed system prompts, dispatched by `Object.keys(AGENT_PROMPTS).map()`
— hard-coded orchestration code decides which prompt runs, when, and with what input. Every one of
the 19 calls in a full delta run is `invokeStructured()`: one `generateContent` call, one fixed
schema, zero tool declarations. The only branching on the model's output anywhere in the pipeline is
null-filtering after a timeout or parse failure — that's graceful degradation, not agency. The
correct term is parallel LLM-function composition with schema-constrained outputs, which is a
legitimate, cost-effective pattern for this domain, but claiming it's multi-agent is the single
easiest thing to get caught overstating in an interview."

**Weak answer:** "Yeah, they're called agents in the code and they each specialize in a domain, so
they're agents."

**Follow-up:** "If the code named these functions 'analyzers' instead of 'agents,' would your answer
change? What does that tell you about how to evaluate this kind of claim?"

---

### E2 [L3] — What's the one place in the entire two-system codebase where real agentic tool use exists?

**Testing:** Depth beyond the headline verdict — knowing the one genuine exception, and being able
to explain precisely why it counts when nothing else does.

**Evidence:** `finance-agent/multiagent_analysis/agents/market_validation.py:86` —
`types.Tool(google_search=types.GoogleSearch())`, archived, never ported to production.

**Strong answer:** "It's in the archived Python prototype, not production: `market_validation.py`
gives the model an actual Google Search tool via `types.Tool(google_search=types.GoogleSearch())`,
so inside that one call the model itself decides whether and what to search — genuine, if narrow,
tool-use autonomy. That's meaningfully different from everything else in either system, where the
code always decides what gets called next. It's worth noting the scope, though: the agency lives
*inside* one call site, not in the orchestration around it — the Python pipeline still invokes that
grounded call unconditionally as one fixed step in a six-step sequence, so even here the outer
control flow isn't agentic, only the one call's internal behavior is. And it was never ported to the
TypeScript production rewrite — `lib/pipeline.ts`'s `computeMarketAlignment()` replaced it with a
pure-function stock-price directional check that has no model involvement and no search tool at
all."

**Weak answer:** "The five parallel agents in `lib/pipeline.ts` are the closest thing, since they
each have their own specialty."

**Follow-up:** "Why do you think that grounded market-validation call didn't get carried over to the
production pipeline?"

---

### E3 [Senior] — The archived `control_plane.py` claims to do 'task routing and orchestration.' Does it?

**Testing:** Whether the candidate reads past a README's own claims to what the code actually does —
a direct test of intellectual honesty about a system, applied to code the candidate presumably
didn't write.

**Evidence:** `finance-agent/control/control_plane.py:113-137` (`ControlPlane.run_task()`) always
calls `analyze_financials(query)` unconditionally; `README_ARCHIVE.md:48-52` claims routing.

**Strong answer:** "No — it's a thin shim, not a router, despite the archive's own README claiming
'task routing and orchestration.' `run_task()` does three things: it extracts company names via a
hard-coded dictionary of 8 companies and keyword aliases — not an LLM call — then calls exactly one
function, always: `analyze_financials(query)`. There's no `if`/`match` anywhere that could route to
`analyze_risks` or `analyze_competition`, even though both exist and are directly callable elsewhere
in the codebase. The five other agent functions in `finance-agent/agents/` are only reachable by code
that imports them directly, never through this control plane. `VerificationAgent.verify()` is
similarly overstated — it's regex/substring matching against stored facts, and its own inline
comment admits 'In a real system, we'd use an LLM or stricter NLI.' The README's claim that 'traces
are first-class artifacts' does hold up — `TraceStep` objects give this a genuine execution log —
but 'routing' as a capability simply isn't built, and I'd flag that gap explicitly in any review
rather than take the README at its word."

**Weak answer:** "It probably does some routing based on the query since that's what it's called."

**Follow-up:** "If you had to actually build the routing logic this file claims to have, what would
the dispatch decision look like, and would you use an LLM for it or keep it rule-based?"

---

### E4 [Staff] — If you wanted to add genuine model-driven routing to Quantalyze without adopting a full agent framework, what's the minimal viable design?

**Testing:** Ability to design a real, scoped agentic capability from first principles, grounded in
what already exists — not reaching for LangGraph/CrewAI reflexively.

**Evidence:** Current state: three hard-coded pipeline entry points (`runPipeline`,
`runSoloPipeline`, `runInsightsPipeline`), selected by which frontend button the user clicks, per
`06_AGENT_ARCHITECTURE.md`'s Role Census ("Router: NOT PRESENT as an AI component, in either
system").

**Strong answer:** "I'd resist the urge to bolt on a framework, because the domain genuinely doesn't
need dynamic planning today — quarterly earnings-delta extraction is a fixed shape, which is exactly
why the Planner role is correctly absent per the architecture case study. Where routing would
actually add value is a natural-language entry point — say, a chat box where a user types 'what
changed at Reliance last quarter' instead of picking Delta vs. Deep Dive vs. Insights from three
buttons. I'd add one narrow, schema-constrained classification call — same `invokeStructured`
pattern already used everywhere else, same `responseSchema` discipline — that outputs one of the
three existing pipeline names plus extracted ticker/quarter arguments, then dispatches to the
existing `runPipeline`/`runSoloPipeline`/`runInsightsPipeline` functions unchanged. That's model-
driven routing with the actual autonomy scoped to exactly one decision — which of three known,
fixed pipelines to run — rather than an open-ended tool-calling loop, which would be a much bigger,
harder-to-validate change for a product whose core value is deterministic, auditable financial
extraction."

**Weak answer:** "I'd add LangChain or an agent framework so the model can decide what to do
dynamically."

**Follow-up:** "How would you validate that the classification call correctly extracted the ticker
and quarter before dispatching, given there's no runtime schema validation anywhere else in this
codebase either?"

---

## F. Backend

### F1 [L2] — Why do 14 of 24 routes have no auth, and which ones should be fixed first?

**Testing:** Ability to triage a real security gap by actual blast radius, not just count routes.

**Evidence:** `08_BACKEND_ARCHITECTURE.md` §9.1 — `middleware.ts`'s matcher only covers
`/api/public/:path*`; auth on `/api/v1/*` is opt-in per-route via `getCurrentUser()`.

**Strong answer:** "There's no middleware covering `/api/v1/*` at all — `middleware.ts`'s matcher is
scoped only to `/api/public/:path*`, so every internal route's auth is opt-in, decided per-file by
whether that route's author remembered to call `getCurrentUser()`. Ten of 24 do; 14 don't. Most of
those 14 are read-only endpoints like `/screener` or `/available` — exposing proprietary output
without a login is a real business-model leak but not an operational hazard. I'd fix the other four
first, in this order: `POST /api/v1/seed-analysis` and `/seed-transcripts`, because they run
unbounded Gemini pipelines across up to 200 tickers with `maxDuration=300` and zero credit
deduction — anyone who finds the URL can burn the project's own Gemini budget indefinitely; then
`DELETE /api/v1/kpis`, which wipes the entire KPI cache table for any unauthenticated caller with no
confirmation; then the two `calendar/seed`/`sectors/seed` routes, which hit third-party scraping
targets at will. None of the five have a secret header or IP allowlist — they read as
internal-tooling routes written assuming security-by-obscurity."

**Weak answer:** "They probably just forgot to add auth checks to some routes, should add them all."

**Follow-up:** "Given there's no role/admin concept anywhere in this codebase, what's the smallest
change that gates those four routes without building a full RBAC system?"

---

### F2 [L3] — Walk me through exactly what `/api/v1/seed-analysis` can do to this system if abused.

**Testing:** Precision about a specific, cited finding — can the candidate reason about actual
attacker-reachable consequences, not just say "that's bad."

**Evidence:** `app/api/v1/seed-analysis/route.ts` — no auth check, no `checkAndDeduct()` call,
`maxDuration = 300`.

**Strong answer:** "It's a `POST` route with zero auth check that runs the full Gemini analysis
pipeline across up to all ~200 Nifty 200 tickers in one call, capped at 300 seconds. Critically, it
never calls `checkAndDeduct()` — it's the one AI-triggering path in the whole codebase that
completely bypasses the credits system, unlike the user-facing `/analyze` route which always deducts
before running. So anyone who discovers this URL can repeatedly trigger up to 200 tickers' worth of
~19-call pipelines against the project's own `GOOGLE_API_KEY`, for free, with no rate limit and no
IP allowlist, as many times as they like. At scale that's straightforward unbounded-cost abuse
against the project's own Gemini budget — not a data breach, but a real, unmitigated cost-denial
vector."

**Weak answer:** "It could let someone run analyses they shouldn't be able to run."

**Follow-up:** "This route presumably exists for legitimate ops use — 'run this after each quarter
end.' What's the minimal fix that preserves that workflow while closing the abuse path?"

---

### F3 [Senior] — Contrast the internal API's error handling with the public API's. What's structurally different?

**Testing:** Ability to see two genuinely different design philosophies coexisting in one codebase
and articulate the tradeoff each represents.

**Evidence:** `lib/services/errors.ts` (`NotFoundError`/`UnauthorizedError`/`EntitlementError`/
`QuotaExceededError`, each self-declaring an HTTP status, used only by the 3 public routes) vs. every
`/api/v1` route's hand-rolled `try/catch` with the message-extraction idiom repeated near-verbatim.

**Strong answer:** "The public API has a real, extensible domain-error hierarchy — four error
classes, each self-declaring its HTTP status, matched via `isDomainError()` at the route boundary —
and it always returns a fixed `{ error: 'internal error' }` on anything that isn't a recognized
domain error, so nothing about the failure mode leaks. The internal API has none of that: every
`/api/v1` route hand-rolls its own `try/catch` with the same copy-pasted
`e instanceof Error ? e.message : String(e)` idiom, and several routes — `analyze/route.ts`,
`transcript/download/route.ts` — forward that raw `Error.message` straight into the client-visible
response, which can leak SDK-specific error phrasing or internal file paths. It's not a stack-trace
leak, but it's a real information-disclosure surface that the newer public-API code deliberately
closed and the older internal routes never picked up. The pattern mirrors the service-layer gap
exactly: the disciplined approach was built once, for the newest surface, and never backported."

**Weak answer:** "The public API probably has better error handling since it's newer."

**Follow-up:** "Which specific internal route leaks the most operationally sensitive error detail to
the client today?"

---

## G. APIs

### G1 [L2] — Explain the difference between `/api/v1` and `/api/public/v1`.

**Testing:** Whether the candidate understands this as two genuinely different systems, not two
version numbers of the same thing.

**Evidence:** 21 of 24 routes under `/api/v1` (session-cookie auth, consumed only by the Next.js
frontend); 3 routes under `/api/public/v1` (Bearer API-key auth via `middleware.ts`, entitlements,
daily quota).

**Strong answer:** "`/api/v1` is the internal, frontend-only surface — 21 of the 24 route handlers,
authenticated via the NextAuth session cookie through `getCurrentUser()`, consumed exclusively by
the Next.js app itself, same-origin, no manual token handling needed. `/api/public/v1` is a
completely separate, metered B2B product surface — just 3 routes, authenticated by hashed Bearer API
keys checked in `middleware.ts` before the request ever reaches a route handler, with per-key
per-product entitlements and a daily quota backed by the `api_keys`/`api_usage` tables. They don't
share an auth mechanism, they don't share response shapes — the public routes go through
`lib/api-contracts/v1/*.ts` DTOs, the internal routes return raw internal domain shapes — and
they're not consistently layered either: the public routes delegate cleanly to `lib/services`, the
internal routes mostly don't."

**Weak answer:** "One's internal and one's for the public, but they're basically the same API at
different paths."

**Follow-up:** "If a partner asked to consume the internal `/api/v1/screener` endpoint directly
instead of waiting for a public equivalent, what would you tell them, and why?"

---

### G2 [L3] — Is "v1" real API versioning here? Defend your answer.

**Testing:** Distinguishing a namespace convention from an actual version-negotiation mechanism.

**Evidence:** No `v2` directory anywhere; no `Accept`/`API-Version` header handling in `middleware.ts`
or any route; the literal string `"v1"` baked into path prefixes and function names
(`toCompanyResponseV1`).

**Strong answer:** "No — it's a namespace convention adopted in case versioning is ever needed, not a
live version-negotiation mechanism. There's no `v2` directory anywhere in the tree, no header
negotiation in `middleware.ts` or any route, and no version field in any request or response body.
If a `v2` were introduced today, it would mean duplicating every route file under a new
`app/api/v2/` tree from scratch — there's no shared handler that branches on version, no strategy
for coexistence or graceful deprecation. That said, I wouldn't call this a mistake at the current
stage: baking `v1` into the path now is cheap insurance, and it's exactly the kind of thing you'd
want in place *before* you have partners depending on stability, which the public API explicitly
does via its manually-provisioned-keys model."

**Weak answer:** "Yes, it's versioned because the URL has 'v1' in it."

**Follow-up:** "What's the smallest change you'd make today to make a future `v2` actually
low-cost to introduce, without over-engineering for a version that may never ship?"

---

### G3 [Senior] — Why does the public API have its own DTO layer (`lib/api-contracts/v1`) while the internal API doesn't?

**Testing:** Understanding of the Anti-Corruption Layer pattern and why it's applied selectively
rather than universally, and whether that selectivity is actually correct.

**Evidence:** `lib/api-contracts/v1/company.ts` (camelCase, curated field subset, `generatedAt`
stamp) used only by the 3 public routes; internal routes return `DashboardPayload` — the raw,
snake_case internal shape — directly.

**Strong answer:** "It's a deliberate Anti-Corruption Layer, and the spec that introduced it says so
explicitly: partner integrations need to survive internal pipeline changes untouched, so
`toCompanyResponseV1()` maps the internal `Analysis` entity into a stable, curated, camelCase wire
shape that hides internal fields like `validationScore` or full per-metric quote data — 'curated
intelligence products without revealing prompts, pipeline internals, or source code,' per the design
doc. The internal API skips this entirely and returns `DashboardPayload` — the exact snake_case shape
the pipeline produces — directly to the frontend, and that's actually documented as deliberate too:
`lib/repositories/analysis.ts` explicitly keeps the field names un-renamed because the existing
frontend depends on them exactly as they are. So the asymmetry is intentional: a stability contract
matters when the consumer is an external partner you can't coordinate a breaking change with; it
matters less when the consumer is a frontend you own and can update in the same deploy."

**Weak answer:** "The public API probably just needs more security so it has extra data
transformation."

**Follow-up:** "If Quantalyze ever wanted to expose the Delta Analysis pipeline itself as a public
product, what would the new contract file need to deliberately omit, and why?"

---

## H. Databases

### H1 [L2] — Why does `scripts/migrate-schema-to-azure.ts` strip RLS statements, and what replaced that security boundary?

**Testing:** Understanding of Postgres RLS as a Supabase-specific mechanism, and what application-
level isolation actually looks like once it's gone.

**Evidence:** `scripts/migrate-schema-to-azure.ts:9-19` (comments: "Azure Postgres has no `auth.uid()`
function"; "`auth.users` doesn't exist on Azure Postgres"); `07_DATA_ARCHITECTURE.md` §0.

**Strong answer:** "RLS on Supabase depends on `auth.uid()` — a SQL function Supabase's own
auth-integrated Postgres provides, evaluated against a request-scoped session context that Supabase's
PostgREST layer sets up. Azure Database for PostgreSQL Flexible Server has no such function and no
`auth.users` table at all, so a policy like `USING (auth.uid() = user_id)` would just fail to
evaluate. `migrate-schema-to-azure.ts` strips every `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY`
statement at deploy time for exactly that reason. What replaced it is pure application discipline:
every repository method that touches user-scoped data — `analysis.ts`'s `listUserHistory`,
`credits.ts`, `watchlist.ts` — binds `userId` as a parameterized `$1` and filters in the `WHERE`
clause by hand. There's no database-level backstop anymore; if one repository method ever forgets
that filter, the database will happily return another user's rows to whatever service credential is
connected — which today is a single account-level `pg.Pool` connection string with full read/write
access to everything."

**Weak answer:** "Azure doesn't support RLS so they just removed it and added checks in the app
instead."

**Follow-up:** "The original SQL migrations still show RLS enabled on 3 tables. Is that RLS providing
any real protection today?" *(Bridges directly to N2.)*

---

### H2 [L3] — Why do `analysis_results` and `solo_analysis_cache` use delete-then-insert instead of upsert, and what's the actual risk?

**Testing:** Understanding the difference between application-level idempotency and a database-
enforced invariant — and being able to name the specific concurrency scenario that breaks it.

**Evidence:** `lib/repositories/analysis.ts:308-325` — separate `DELETE` then `INSERT`, not wrapped
in a transaction; neither table has a `UNIQUE` constraint on its natural cache key
(`(company_ticker, q_prev, q_curr)` / `(ticker, quarter)`).

**Strong answer:** "It's a deliberate pattern with documented history — `PRODUCT_NOTES.md` calls it
'Atomic Delete-Insert (Timeout-Wipe Protection),' introduced specifically to avoid an earlier bug
where a bulk delete-all-then-loop-insert could wipe data if the function timed out mid-loop. But
'atomic' there means 'one delete plus one insert per key,' not a real transaction — the two
statements aren't wrapped in `BEGIN`/`COMMIT`, and neither table has a `UNIQUE` constraint on its
natural key to fall back on if they interleave badly. The actual risk: two concurrent cache-miss
requests for the same ticker/quarter-pair — two browser tabs, a double-click before the button
disables — can interleave their DELETE and INSERT and leave duplicate rows behind, which
`getCachedAnalysis()`'s `ORDER BY created_at DESC LIMIT 1` silently masks by always picking the
newest. So duplicates are tolerated, not prevented, and worse: if the process crashes or the
connection drops between the DELETE and the INSERT — a real, documented failure mode on Azure's VNet
path — that ticker/quarter-pair ends up with *no* cached row at all, silently forcing the next
request to redo the full up-to-270-second pipeline run. I'd replace both with a single
`INSERT ... ON CONFLICT (company_ticker, q_prev, q_curr) DO UPDATE SET payload = EXCLUDED.payload`
— exactly the pattern already used correctly for `insights_cache` and `kpi_snapshots` in the same
schema."

**Weak answer:** "It's probably just an oversight, they should use upsert like everything else."

**Follow-up:** "Every *other* cache table in this schema — `insights_cache`, `kpi_snapshots`,
`concall_links` — does use a real `ON CONFLICT` upsert. Why do you think these two specifically
don't?"

---

### H3 [Senior] — Why JSONB instead of normalized columns for the AI pipeline output?

**Testing:** Real schema-design judgment — recognizing when normalization is the wrong tool, and
naming the actual tradeoff cost precisely rather than treating JSONB as a free lunch.

**Evidence:** `DashboardPayload` (`sections: SectionalInsight[]`, variable per-run shape) stored
whole in `analysis_results.payload JSONB`; every repository read is whole-document fetch-by-key, no
`payload->>'field'` partial access anywhere in the query layer.

**Strong answer:** "The AI pipeline's output is a deeply nested, per-run-varying tree — a variable
number of thematic sections, each with a variable number of metrics, each carrying free-text fields
— and the shape of that tree is defined by TypeScript `Schema` objects passed to Gemini, not by SQL
DDL. Fully normalizing it would mean a `sections` table and a `metrics` table with foreign keys back
to `analysis_results`, plus a migration every time a prompt schema gains a field — and the two
schema definitions, TS and SQL, would now need to be kept in sync by hand on top of the TS-interface-
vs-Gemini-Schema sync problem that already exists. More importantly, every actual read pattern in
this codebase is 'fetch the whole payload for one ticker/quarter and hand it to the frontend or
another agent as one blob' — there's no query anywhere that reads a single nested field out of a
JSONB column. That's exactly JSONB's strong case: no relational joins are ever needed *into* the
payload, only whole-document fetch-by-key. The real cost, and it's a real one, is that Postgres can't
enforce structural invariants like 'every metric's `signal_score` is between -10 and 10' — that
burden falls entirely on application code, and you can see it show up as ad hoc
`Array.isArray()` gatekeeping in the repository layer rather than a database constraint."

**Weak answer:** "JSONB is more flexible so it's easier to store AI output without worrying about the
schema."

**Follow-up:** "If a future feature needed to query 'every metric across all companies with
`signal_score > 5`,' would JSONB still be the right call? What would you change?"

---

### H4 [Staff] — `analysis_results` has no index on its natural cache key. Design the fix and quantify the impact.

**Testing:** Ability to reason about a real, cited performance gap with actual query-pattern
awareness, and to design an index that matches every access path, not just the obvious one.

**Evidence:** `07_DATA_ARCHITECTURE.md` §4 — zero `CREATE INDEX` on `analysis_results` beyond the
surrogate `id` PK, despite `getCachedAnalysis` filtering `WHERE company_ticker=$1 AND q_prev=$2 AND
q_curr=$3 ORDER BY created_at DESC LIMIT 1`, and `listAllByTickers`/`listByTickersAndQuarterPair`
filtering on `company_ticker` alone or the full triple.

**Strong answer:** "Every cache-hit lookup — the single highest-traffic read in the product, hit on
every dashboard load and every `/api/v1/screener` call — does a sequential scan today, because
there's no index beyond the implicit one on the surrogate `id` primary key. I'd add a composite
index on `(company_ticker, q_prev, q_curr, created_at DESC)` — that covers `getCachedAnalysis`'s
exact filter-and-order pattern in one index scan instead of a full table scan followed by a sort. I'd
also want a second index on `company_ticker` alone, or make the composite index's leading column do
double duty, since `listAllByTickers` filters on ticker only, without the quarter pair, for the
screener's Nifty50 pass. Given the table currently has no unique constraint at all on its natural key
either — the same finding behind the delete-then-insert non-atomicity — I'd actually just add a real
`UNIQUE INDEX` on `(company_ticker, q_prev, q_curr)`, which solves both problems in one migration:
it gives the DELETE-then-INSERT pattern something to eventually replace with a real `ON CONFLICT`
upsert, *and* it's the exact index the cache-hit query needs. At today's scale — a few hundred
companies, low query volume, per the migration spec's own 'pre-launch' framing — this isn't causing
visible pain yet, but it's a straightforward, low-risk fix worth doing before traffic grows, not
after a slow-query incident forces it."

**Weak answer:** "You'd just add an index on the ticker column and that should fix it."

**Follow-up:** "Given this table also has no unique constraint, would you add the unique index and
switch to `ON CONFLICT` in the same migration, or do them separately? What's the risk of doing them
together?"

---

## I. Frontend

### I1 [L2] — Trace exactly how `AgentPanel.tsx` gets its data. Is it reading the stream itself?

**Testing:** Precise understanding of container/presentational component separation, and whether
the candidate can name the actual data path rather than assuming the visible component owns its own
fetching.

**Evidence:** `components/AgentPanel.tsx` — zero `fetch`/`EventSource`/`getReader` references
(grep-verified); `app/dashboard/DashboardClient.tsx:480-546` owns the `onEvent` callback and
`setAgentState`.

**Strong answer:** "No — `AgentPanel` is purely presentational. It takes one prop, `state:
AgentPanelState`, and has zero fetch or stream-reading logic of its own. All the actual stream
consumption lives in `DashboardClient.tsx`, via `runAnalysisStream()` in `lib/api.ts`, which opens
`response.body.getReader()`, buffers bytes, splits on newlines, and calls the caller-supplied
`onEvent` callback once per parsed NDJSON line. That `onEvent` callback is defined inline inside
`DashboardClient.tsx`'s `handleAnalyze`, and it calls `setAgentState()` synchronously for every event
— so React re-renders `AgentPanel` after every single NDJSON line, not after the stream closes.
`AgentPanel` just renders whatever `AgentPanelState` object it's handed at that instant — a clean
container/presentational split, verified by the total absence of any streaming primitive inside the
component file itself."

**Weak answer:** "AgentPanel probably listens to the stream directly and updates its own state as
events come in."

**Follow-up:** "If you wanted `AgentPanel` to be reusable for the Insights page's progress UI too,
what would need to change about how it receives state?"

---

### I2 [L3] — Is the NDJSON streaming here real token-level LLM streaming? Defend precisely.

**Testing:** The exact distinction between "the UI updates progressively" and "you watch the model
generate text" — a distinction that's genuinely easy to blur in a resume bullet and genuinely
important to get right in an interview.

**Evidence:** Every Gemini call uses `generateContent`, never `generateContentStream` (grep-verified
across all pipeline files); NDJSON events carry only section names/scores, never partial text.

**Strong answer:** "No, and the distinction matters. Every Gemini call in this codebase uses
`model.generateContent(...)` — the non-streaming call — never `generateContentStream`. Each call
blocks until Gemini returns a complete parsed JSON object; there's no partial-token forwarding to the
client at any point. What actually streams is coarse pipeline progress: one NDJSON line per completed
agent or phase, sent from a `ReadableStream` on the route handler. A `thematic_done` event carries
only a section name and which quarter it was — never a content fragment. The actual analysis
content — every `key_takeaways`, every quote — only reaches the client in the single final `done`
line, after all ~19 Gemini calls have completed. So 'streaming' here means 'the UI can show which of
19 calls have finished,' not 'the user watches text appear as the model generates it.' That's a
legitimate and honestly quite elegant architecture for a multi-agent pipeline — there's no single
generation stream to tap, since the useful unit of progress genuinely is 'agent N finished' — but it
should never be described as token-level LLM streaming."

**Weak answer:** "Yeah it's real streaming, you can see the results come in live as the AI generates
them."

**Follow-up:** "If Quantalyze wanted true token-level streaming for one specific output — say, the
'What Changed' synthesis bullets — what would need to change in both the Gemini call and the NDJSON
protocol?"

---

### I3 [Senior] — Why are there two independent 'watchlist' implementations in the same app?

**Testing:** Ability to spot an architectural seam that isn't documented anywhere as intentional,
and to reason about whether it's a real problem or an acceptable accident.

**Evidence:** `DashboardClient.tsx:190`'s `useWatchlist()` (`localStorage`-only, never touches the
server) vs. `DashboardClient.tsx:273`'s `useUserTickers()` (server-backed via `/api/v1/user-tickers`
→ `PostgresWatchlistRepository` → `user_tickers` table); `InsightsClient.tsx:48`'s
`useInsightsWatchlist()` is a *third*, independent implementation.

**Strong answer:** "There are actually two unrelated concepts both called 'watchlist,' plus a third,
independent implementation on a different page. The star/bookmark ticker chips on the dashboard —
`useWatchlist()` — are pure `localStorage`, capped at 20, seeded with 10 defaults, and never touch
the server at all. Separately, 'Add TICKER to my list' from the company search's fallback UI is
wired to `useUserTickers()`, which does hit `/api/v1/user-tickers` and persists to a real
`user_tickers` Postgres table. They're not synchronized with each other — starring a ticker in one
doesn't show up in the other's list. And `InsightsClient.tsx` has its own third, file-local
`useInsightsWatchlist()`, unrelated to either. I don't think this is catastrophic — it's not a data
correctness bug, just user-facing conceptual overlap that no comment anywhere flags as deliberate —
but it's exactly the kind of thing that costs a new engineer real time reverse-engineering 'wait,
which watchlist does this button actually write to' before touching either one."

**Weak answer:** "There's probably a bug where the watchlist doesn't sync properly across pages."

**Follow-up:** "If you had to unify these into one watchlist concept, would you make it fully
server-backed, or keep a local-first version with server sync? What's the tradeoff?"

---

## J. Distributed Systems

### J1 [L2] — What breaks if this app scales to 5 Container Apps replicas?

**Testing:** Whether the candidate can distinguish genuinely stateless design from state that only
looks stateless because it's never been tested under concurrency.

**Evidence:** `11_PRODUCTION_ENGINEERING.md` SCALABILITY section — no in-memory caches, no
module-level mutable state in route handlers (statelessness holds), but `lib/credits.ts:33-49`'s
read-then-write race gets strictly worse across replicas since there's no cross-replica
coordination.

**Strong answer:** "The good news is real: every route handler and pipeline function is genuinely
stateless — no in-memory caches, no file locks, everything cross-request lives in Postgres. The
process-local state that does exist — the lazy-singleton `pg.Pool` and the Supabase admin client —
is exactly the right pattern, per-process connection reuse, not shared application state, so
horizontal scaling doesn't break the request-handling path itself. What *does* get strictly worse is
the credits race in `lib/credits.ts`: `checkAndDeduct()` reads the current `used` count, then writes
`used + cost` as a plain `UPDATE`, not an atomic increment. On a single process, two concurrent
requests can already interleave that race; across 5 replicas with zero cross-replica coordination,
it becomes more likely, not newly possible — a classic 'works fine in dev, misbehaves under
production concurrency' bug that horizontal scaling makes worse, not causes. The Postgres connection
pool is also worth flagging: it has no explicit `max` configured, so it runs at `pg`'s library
default of 10 per process — 5 replicas means up to 50 idle-capable connections against a single
Azure Postgres Flexible Server instance with no documented connection budget."

**Weak answer:** "Probably nothing breaks since it's all serverless/containerized and stateless."

**Follow-up:** "Walk me through the exact interleaving that causes the credits race to under-charge
a user — what has to happen, in what order, across which two requests?" *(Bridges to J2.)*

---

### J2 [L3] — Walk through the credits race condition precisely — under what interleaving does it manifest?

**Testing:** Can the candidate reason step-by-step about a real concurrency bug rather than gesturing
at "race conditions are bad."

**Evidence:** `lib/credits.ts:33-49` (`checkAndDeduct`); `lib/repositories/credits.ts`'s Postgres
`setUsed` does `UPDATE user_credits SET used=$1 WHERE ...` — a raw overwrite, not
`used = used + $1`.

**Strong answer:** "`checkAndDeduct(userId, action)` reads the current status via
`getOrCreateStatus()` — a read — checks `status.remaining < cost` and rejects if insufficient, then
separately calls `setUsed(userId, status.month, status.used + cost)` — a write of a value computed
from that earlier read. Say a user has `used=10` out of a 2,500 quota and double-clicks 'Analyze,'
firing two concurrent `/api/v1/analyze` requests for a 3-credit action. Request A reads `used=10`,
computes `10+3=13`. Before A's write lands, Request B also reads `used=10` — still 10, because A
hasn't written yet — and computes `10+3=13` too. Both requests pass the quota check, both pipelines
run, both cost real Gemini spend, but the database ends up with `used=13`, not `used=16`. The user
was charged for one action instead of two — a silent, unrecoverable under-charge. It's the inverse of
what people usually worry about with metering races: this doesn't lock users out unfairly, it leaks
revenue quietly, and it would only ever surface as a mismatch between metered Gemini spend and billed
credits during a financial reconciliation — invisible in normal QA because nothing errors or looks
wrong to the user."

**Weak answer:** "Two requests come in at the same time and one of them doesn't get charged
correctly."

**Follow-up:** "The public-API rate limiter in `middleware.ts` has the exact same shape of race, but
the code explicitly comments on and accepts it, while `credits.ts` doesn't mention it at all. Why do
you think that is?"

---

### J3 [Senior/Staff] — The Postgres pool has no explicit max size configured. What happens as replica count grows, and what's the actual fix?

**Testing:** Can the candidate reason about a resource-exhaustion failure mode that's currently
latent, connecting connection-pool sizing to the specific hosting migration this app already went
through.

**Evidence:** `lib/postgres/client.ts:8-39` — lazy-singleton `pg.Pool`, no `max` option passed, so it
runs at the library default (10); Azure Database for PostgreSQL Flexible Server has a documented,
finite `max_connections` limit that scales with instance size.

**Strong answer:** "Each Container Apps replica gets its own process, and each process's
lazy-singleton `pg.Pool` will open up to 10 connections by default since nothing overrides `max`.
That's fine at one replica. At 5 replicas under load, that's up to 50 connections just from this app,
against a single Azure Postgres Flexible Server instance whose `max_connections` is finite and not
budgeted for anywhere in the migration docs — and that's before accounting for any other consumer of
the same database. If the app ever needs to scale past whatever headroom the current instance size
provides, new connection attempts start failing outright, and unlike the existing
connection-acquisition retry logic — which is specifically scoped to transient network errors like
`ECONNRESET` — a hard `max_connections` rejection isn't a retry-and-succeed scenario, it's a genuine
capacity wall. The fix is twofold: explicitly set `max` per replica sized to
`(desired total connections) / (max replica count)`, and separately consider PgBouncer or Azure's
own connection pooling in front of Postgres if replica count needs to grow meaningfully — the
same 'introduce a real pooling layer once cache-read volume dominates load' escape hatch the ADR log
already names for the Redis-vs-Postgres-cache decision applies here too."

**Weak answer:** "You'd just increase the pool size or add more database capacity."

**Follow-up:** "Given the connection-acquisition retry logic is explicitly safe because the query was
never sent, would that same reasoning apply if you added a retry around a `max_connections`
rejection? Why or why not?"

---

## K. Scalability

### K1 [L2] — Why is there no background job queue for the "seed" routes?

**Testing:** Recognizing that "no queue" is a specific, consequential architectural choice with a
directly observable effect elsewhere in the system (the 270s timeout race).

**Evidence:** `app/api/v1/seed-analysis/route.ts`, `seed-transcripts`, `calendar/seed`,
`sectors/seed` — all synchronous `POST` handlers relying on `maxDuration`; no message queue, no
worker process, no `app/api/cron/*` route anywhere in the codebase.

**Strong answer:** "There's no queue infrastructure anywhere — no BullMQ, no Azure Service Bus, no
Storage Queue SDK in `package.json`, and no in-app scheduler. Every AI pipeline, including the batch
'seed' routes that process up to 200 tickers, runs synchronously inside the HTTP request/response
lifecycle of whatever route triggered it, bounded only by the platform's request timeout. That's
actually the direct explanation for why `lib/pipeline.ts` needs a 270-second in-request timeout race
against a 300-second `maxDuration` — there's no way to hand a long-running job off to a worker and
poll or stream a result from elsewhere, so the entire timeout-safety design exists specifically to
work around the lack of a queue. I'd guess this is reasonable at the product's current scale — a
human or an external scheduler triggers seed routes manually, per the code comment 'run this after
each quarter end' — but it's a real ceiling: a burst of concurrent Delta Analysis requests is bounded
only by how many concurrent replicas and in-process Gemini calls can be spun up, with no admission
control or backpressure mechanism anywhere."

**Weak answer:** "They probably just haven't gotten around to adding a queue system yet."

**Follow-up:** "If you added a queue for the seed routes specifically, how would you keep the
NDJSON progress-streaming UX working for a job that's now running on a separate worker?"

---

### K2 [L3] — The screener and available endpoints return full unpaginated collections. When does that become a problem, and how would you fix it?

**Testing:** Judgment about when an unpaginated API is fine versus when it isn't — not a reflexive
"always paginate."

**Evidence:** `app/api/v1/screener/route.ts` — no `limit`/`offset`/`cursor` params, returns up to
~200 rows every call; `app/api/v1/available/route.ts` — fires ~200 parallel per-ticker storage
searches internally, but returns one unpaginated map to the client.

**Strong answer:** "Neither endpoint takes pagination parameters — `/screener` fetches every cached
Nifty50 row plus every current-quarter Nifty200 row and returns the whole ranked array in one
response, and `/available` returns one big ticker-to-quarters map covering the entire universe. At
today's scale — at most ~200 Nifty200 constituents, at most 8 quarters each — that's a small,
bounded response and client-side `useMemo` filtering in `ScreenerClient.tsx`/`KPIsClient.tsx` is
genuinely the simpler, faster-to-build choice: no server round-trip per filter change, and the whole
dataset already fits comfortably in memory and in one HTTP response. It becomes a real problem the
moment the company universe stops being a fixed, small set — if Quantalyze ever expands past Nifty200
into the full listed-company universe, or if quarter history grows unbounded instead of staying
capped, both endpoints' full-scan-and-return pattern degrades linearly with dataset size, and the
client-side filtering pattern stops being viable too. The fix is standard: cursor-based pagination
on the API, server-side filter/sort parameters, and a move from `useMemo`-over-full-fetch to
`useMemo`-over-current-page in the client — but I wouldn't build that today, since it would add real
complexity for zero benefit at the current, deliberately bounded company universe."

**Weak answer:** "You'd add pagination parameters to both endpoints so they don't return everything
at once."

**Follow-up:** "If you had to add pagination to `/screener` without breaking the client's current
'sort by adjusted confidence score across the whole set' behavior, what would change?"

---

### K3 [Senior] — Design how you'd add a queue-based architecture for Delta Analysis without breaking the NDJSON streaming UX.

**Testing:** Systems design under a real constraint — the candidate has to preserve a specific
existing UX property (live per-agent progress) while decoupling execution from the request
lifecycle, a genuinely nontrivial tradeoff.

**Evidence:** Current design: `runPipeline()`'s `onProgress` callback is wired directly to
`controller.enqueue()` inside the same request that triggered it — progress and execution share one
HTTP connection's lifetime.

**Strong answer:** "The core tension is that today, progress delivery and pipeline execution are the
same request — `onProgress` calls `controller.enqueue()` directly, so the moment you move execution
to a worker, you lose that direct wire. I'd keep the trigger endpoint synchronous for the fast path
— cache hit still returns immediately, no queue involved — and only enqueue a job on cache miss. The
worker would run the exact same `runPipeline()` function, unchanged, but instead of calling
`onProgress` directly into a `ReadableStream`, it would publish each progress event to a
per-run channel — Azure Service Bus topic, or even a Postgres `LISTEN`/`NOTIFY` given the app is
already Postgres-heavy and this doesn't need Kafka-grade throughput. The client would still open an
NDJSON-style connection, but now to a thin relay endpoint that subscribes to that run's channel and
forwards each event as it arrives — same client-side `reader.getReader()` loop in `lib/api.ts`,
zero change needed there. The real win beyond decoupling: a client disconnect no longer needs to
race a 270-second in-request timeout against Container Apps killing the function, because the
worker's lifecycle is now independent of any browser connection — which also directly fixes the
'closing the tab still burns Gemini calls with no benefit to anyone' gap that exists today, since the
worker can now be told to actually cancel via a real cancellation signal instead of the connection
just going silent."

**Weak answer:** "You'd put the pipeline job on a queue and have the frontend poll for status
updates instead of streaming."

**Follow-up:** "Postgres `LISTEN`/`NOTIFY` doesn't survive a connection drop or scale past a modest
fan-out. At what point would you actually need to move to a real message broker?"

---

## L. Reliability

### L1 [L2] — What happens to a user's credit if a Gemini call times out mid-pipeline?

**Testing:** Precise knowledge of exactly when credits are deducted relative to pipeline execution
and failure — a common "gotcha" question testing whether the candidate actually traced the code path
versus assuming a sensible-sounding answer.

**Evidence:** `app/api/v1/analyze/route.ts:76` — `checkAndDeduct()` runs before the `try` block that
wraps `runPipeline()`; a Solo pipeline failure comment explicitly states "deduct on every call... to
discourage spam."

**Strong answer:** "The credit is already spent — deduction happens *before* the pipeline can fail,
not after it succeeds. In `analyze/route.ts`, `checkAndDeduct(userId, 'delta')` runs on cache miss,
before the `try { await runPipeline(...) }` block that can itself throw — a Gemini timeout,
malformed-JSON parse failure, or a corrupt PDF all happen *after* the credit is already gone. If a
single thematic agent times out, the pipeline actually degrades gracefully rather than failing
outright — that one section is filtered out, `null`, and the rest of the run completes — so the user
usually still gets a result, just a partial one, for their 3 credits. But if something fails hard
enough to throw all the way up — a corrupt PDF during extraction, which isn't individually
try/caught the way agent calls are — the whole run aborts, the client sees an `error` NDJSON event,
and the credit is still gone, with no refund logic anywhere in the codebase. Solo's own code comment
is explicit about accepting this tradeoff deliberately: 'deduct on every call... to discourage
spam' — but that mechanism doesn't distinguish a spam retry from a genuine platform failure, which is
a real UX/billing-fairness gap, not a hypothetical one."

**Weak answer:** "It probably gets refunded automatically if the analysis fails."

**Follow-up:** "Given the credit is already spent regardless of outcome, would you rather move the
deduction to after success and accept the spam risk, or add explicit refund-on-hard-failure logic?
Defend your choice."

---

### L2 [L3] — What happens if one of the 10 parallel thematic Gemini calls fails? Does the whole pipeline fail?

**Testing:** Understanding graceful degradation as implemented, precisely — including its downstream
effect on later phases.

**Evidence:** `lib/pipeline.ts:463-474` (`runThematicAgent` returns `null` on failure);
`:809-814` filters nulls; `runTemporalDelta` only runs "for each section where both prev+curr
succeeded."

**Strong answer:** "No — the pipeline is designed to degrade one section at a time, not fail wholesale.
`runThematicAgent()` wraps its Gemini call in try/catch and returns `null` on any failure —
timeout, malformed JSON, whatever — rather than rethrowing. `Promise.all` on the 11-call batch never
actually sees a rejection, because every individual agent already resolved to `null` instead. Phase
2's fan-out then filters: `snapshotsPrev.filter(s => s !== null)`, and the pipeline logs the survival
rate explicitly. The consequence cascades one layer deeper, though: `runTemporalDelta` in Phase 3
only runs for a section if *both* quarters' thematic call for that section succeeded — so if the
'Macro & Risk' call fails for either quarter, that whole section silently disappears from the delta
output too, not retried, not flagged to the end user beyond a lower implicit signal count. So the
answer is: one failed agent produces a smaller, still-usable report, not a failed run — but there's a
real transparency gap, because nothing in the final payload distinguishes 'this section genuinely had
nothing to say' from 'this section's extraction call failed.'"

**Weak answer:** "If one call fails the whole thing probably just retries or fails."

**Follow-up:** "The Insights pipeline handles this differently — a failed per-quarter brief returns a
fully-populated empty object instead of `null`. Why is that a strictly worse failure mode than the
Delta pipeline's approach?"

---

### L3 [Senior] — `Promise.race` timeouts don't cancel the underlying Gemini call. What's the actual resource/cost consequence at scale?

**Testing:** Ability to reason about compounding cost from a subtle correctness gap under realistic
load — connects directly to B2, but at a systems/cost level rather than a mechanics level.

**Evidence:** Same finding as B2, examined for its aggregate consequence: zero `AbortController`
usage on any Gemini call site; timeouts stop *awaiting*, not the request.

**Strong answer:** "Each individual timeout wastes at most one call's worth of tokens — not
catastrophic on its own — but it compounds in two specific ways worth naming precisely. First,
because `Promise.race` doesn't cancel the loser, a 'failed' call can still complete seconds later and
consume its full token allocation server-side, with the app having already moved on and reported
that section as failed — so the *reported* failure rate and the *actual* Gemini spend diverge, and
there's no telemetry anywhere (see the Observability section) to even notice this is happening.
Second, at higher concurrency — more simultaneous users, more replicas — the number of orphaned
in-flight calls scales with request volume, not with genuine capacity limits, meaning under load
this isn't just 'a little wasted spend,' it's wasted spend that scales with exactly the traffic
pattern most likely to also be causing real timeouts in the first place, since Gemini's own latency
under its own load is presumably part of why calls are timing out. The fix is mechanical —
`AbortController` wired through `RequestOptions.signal`, which the SDK already supports — but the
interesting part is that this bug is invisible without token-usage telemetry, which also doesn't
exist yet, so fixing the cancellation and adding the telemetry are really one project, not two
independent ones."

**Weak answer:** "It just wastes a bit of money each time a call times out, not a huge deal."

**Follow-up:** "If you could only ship one of the two — `AbortController` cancellation, or
`usageMetadata` token logging — which would you build first, and why?"

---

### L4 [Staff] — Design a retry strategy for Gemini calls given the current 25-second per-agent budget.

**Testing:** Whether the candidate can design resilience that actually fits inside an existing hard
constraint, rather than proposing a generic retry-with-backoff that would blow the budget.

**Evidence:** `AGENT_TIMEOUT_MS = 25_000` in `lib/pipeline.ts:189`; zero retry logic anywhere in
production (grep-verified: `grep -rniE "retry|retries|backoff|maxRetries"` returns only one
unrelated hit); contrast with the archived `finance-agent/core/llm.py:21-48`'s `max_retries=3` with
`time.sleep(2 ** attempt)` exponential backoff.

**Strong answer:** "The naive answer — 'add retry-with-exponential-backoff like the archived
prototype had' — doesn't actually fit here, because the archived Python code's retries operated
without a hard per-call deadline, and this pipeline's 25-second agent budget exists specifically so
10 parallel calls resolve in roughly the same window as one call. A single retry with even a 1-second
backoff could blow that budget on its own attempt alone. I'd distinguish two failure classes instead
of retrying blindly: a fast-failing error — malformed request, content-policy block, anything that
fails in under a second — is not worth retrying at all, since retrying a deterministic failure just
wastes the retry budget; a genuinely transient failure — a 5xx or a rate-limit response, which the
SDK's error shape does let you distinguish from a timeout — gets exactly one retry, with a short,
fixed 2-3 second budget carved out of the *existing* 25-second window, not an additional 25 seconds
on top of it. Concretely: `AGENT_TIMEOUT_MS` stays 25s as the ceiling for the whole attempt sequence,
and a first attempt gets ~18s, leaving a same-timeout-budget retry ~5-7s if the first attempt failed
fast enough to leave room. This is meaningfully different from a generic retry policy — it's
retry-within-budget, not retry-on-top-of-budget, and it requires actually distinguishing failure
types the current blanket try/catch doesn't bother to distinguish today."

**Weak answer:** "You'd add retries with exponential backoff like the archived Python code did."

**Follow-up:** "How would you decide, from inside `invokeStructured()`, whether a given SDK error is
worth that one retry versus not, given the SDK's error shapes aren't inspected anywhere in the
current code?"

---

## M. Observability

### M1 [L2] — How would you find out right now if error rates spiked in production?

**Testing:** Honest awareness of an observability gap, not a hypothetical description of a
dashboard that doesn't exist.

**Evidence:** 65 `console.log`/`console.error`/`console.warn` call sites across 16 files, all
free-text bracket-tagged strings (`[Pipeline]`, `[KPI]`, `[Cache]`); no metrics library, no `/metrics`
endpoint, no APM/tracing SDK anywhere in `package.json`.

**Strong answer:** "Honestly, you couldn't answer that quickly today — you'd have to grep raw
Container Apps logs by hand. There's no metrics library anywhere in `package.json` — no Prometheus
client, no StatsD, no Azure Monitor SDK — and no `/metrics` endpoint. The only structured logging in
the entire codebase is `middleware.ts`'s `log()` helper, which emits one JSON line per public-API
request with a `requestId`, `status`, and `latencyMs` — genuinely good practice, but scoped to
exactly the low-traffic public API, not the high-traffic internal pipelines where a failure is
actually expensive since it's already burned Gemini cost and a user's credit by the time it fails.
Every other log line — `console.error('[${sectionName}] Agent failed:', e)` in `lib/pipeline.ts`, for
instance — is a free-text, bracket-tagged string, greppable by convention but not queryable as
structured fields without string-parsing the tag out by hand. `/api/health` returns a static
`{status: 'ok'}` with no check of Postgres, Blob Storage, or `GOOGLE_API_KEY` validity, so it
wouldn't even reflect an actual Gemini outage."

**Weak answer:** "You'd check the dashboards or the monitoring alerts."

**Follow-up:** "If you had to add exactly one piece of observability this week — with the least
engineering effort for the most signal — what would you build first?"

---

### M2 [L3] — `/api/health` returns `{status: "ok"}` unconditionally. What's wrong with that as a readiness check?

**Testing:** Understanding the specific difference between liveness and readiness, applied to a real
endpoint the candidate can name.

**Evidence:** `app/api/health/route.ts` — no check of Postgres connectivity, Blob Storage
reachability, or `GOOGLE_API_KEY` validity.

**Strong answer:** "It's a liveness check in the loosest possible sense — 'the Node process is up
and can respond to an HTTP request' — but it's being used, or would naturally be used by a platform
health probe, as if it were a readiness check, and it can't actually tell you that. It would return
`{status: 'ok'}` even if Postgres were completely unreachable, even if Azure Blob Storage were down,
even if `GOOGLE_API_KEY` had expired or been rotated incorrectly — none of those downstream
dependencies are checked. That matters concretely for Container Apps' own health-probe-driven
routing: a genuinely broken instance — one that can accept a request but can't actually serve one,
because its Postgres pool can't connect — would still pass this health check and keep receiving
traffic. I'd add a real readiness variant that does a cheap `SELECT 1` against Postgres and maybe a
blob-container existence check, on a short timeout, and keep the current unconditional check as a
separate liveness endpoint if the deployment platform wants that distinction."

**Weak answer:** "It should probably check the database is connected too."

**Follow-up:** "If the Postgres check in your readiness probe itself times out, should the health
endpoint report unhealthy immediately, or degrade after N consecutive failures? Why?"

---

### M3 [Senior] — Design the minimum viable observability stack for this system, prioritized.

**Testing:** Ability to sequence a real observability rollout by actual leverage, not just list every
tool that exists.

**Evidence:** Current state, per `11_PRODUCTION_ENGINEERING.md`: no metrics, no traces, no AI
telemetry, no user-behavior analytics — only unstructured console logs and one structured logger
scoped to the public API.

**Strong answer:** "I'd sequence this by what's cheapest to add and what would have caught the bugs
this codebase already has, rather than by what's most complete. First: read
`result.response.usageMetadata` inside `invokeStructured()` and log it as one structured JSON line
per Gemini call — same shape as `middleware.ts`'s existing `log()` helper, just extended to the
pipeline files. That's a few lines of code and it immediately answers 'what does a run actually
cost,' which today is a static guess. Second: a request-ID that's generated once at the route handler
and threaded through every `console.log`/`console.error` for that request — right now even
`middleware.ts`'s one good structured logger can't be correlated with whatever the pipeline logs for
the same request, because the request ID never propagates past the middleware. Third: a real
readiness check on `/api/health` (per M2) plus a dead-simple failure-rate counter — even just
incrementing a Postgres counter row per pipeline outcome would answer 'what % of Delta Analyses had
at least one failed agent this week,' a question that today requires grepping raw logs by hand. I'd
deliberately push full distributed tracing (OpenTelemetry, Application Insights) later — it's real
value, but it's also the most infrastructure-heavy of the four, and everything above it is both
cheaper and more directly tied to catching the specific bugs — the credits race, the silent stock-
price failures — this codebase already has."

**Weak answer:** "I'd set up Application Insights and Prometheus and build dashboards for
everything."

**Follow-up:** "Once you have per-call token telemetry, how would you use it to validate or correct
the flat 3/1/4 credit pricing model?"

---

## N. Security

### N1 [L2] — Is this system vulnerable to prompt injection? Show me where.

**Testing:** Concrete identification of the actual injection surface, not a generic "LLMs can be
prompt injected" answer.

**Evidence:** `lib/pipeline.ts:461` (`` `TRANSCRIPT:\n${transcript}` ``); transcripts sourced from
Screener.in scraping and BSE's public API, with only a `%PDF` magic-byte check, no content
trustworthiness check.

**Strong answer:** "Yes, and there's zero mitigation anywhere in the codebase. Every pipeline
interpolates raw, unsanitized transcript text directly into the user-turn prompt with a plain
template literal — `TRANSCRIPT:\n${transcript}` in `lib/pipeline.ts`, and the equivalent in
`solo-pipeline.ts`, `insights-pipeline.ts`, and `kpi-extractor.ts`. The transcripts themselves come
from two external, non-adversarially-vetted sources — Screener.in scraping and the BSE announcements
API — or from a manual upload via `/api/v1/request`, and the only validation on the file itself is a
`%PDF` magic-byte header check, nothing about content trustworthiness. There's no delimiter escaping,
no instruction telling the model to treat the transcript strictly as data, and no output-side check
that generated content doesn't echo an injected directive. The blast radius is bounded somewhat by
`responseSchema` — the model is still constrained to emit valid JSON matching the schema shape, so an
injection couldn't make it call external tools or dump a system prompt in free text — but it could
absolutely corrupt the *content* of `key_takeaways`, `signal_classification`, or `raw_quotes` with
attacker-chosen text, which then gets persisted and rendered to every user who views that
ticker/quarter. Because the output would still be valid-shaped JSON, a successful injection would be
silently indistinguishable from a legitimate extraction — no schema violation would ever flag it."

**Weak answer:** "It's probably fine since the output is constrained to a JSON schema, so injection
can't really do anything."

**Follow-up:** "Given the constraint that the model still needs to read the full transcript
faithfully — you can't just strip suspicious text without risking dropping real financial language —
what's the actual mitigation you'd ship first?" *(Bridges directly to N4.)*

---

### N2 [L3] — Is RLS providing any real security today? Defend your answer precisely.

**Testing:** Whether the candidate distinguishes "the SQL migration file says RLS is enabled" from
"RLS is actually enforced on the database answering production traffic" — a precise, verifiable
claim, not a vibe.

**Evidence:** `supabase/migrations/001_initial.sql`/`006_user_tickers.sql` correctly enable RLS with
`auth.uid() = user_id` policies on 3 tables; `scripts/migrate-schema-to-azure.ts` strips those
statements at deploy time; production connects via `lib/postgres/client.ts`'s raw `pg.Pool`, which
has no session context for `auth.uid()` to evaluate against even if the policy were left in.

**Strong answer:** "No — RLS enforcement on the live production database is zero, on any table,
despite the SQL migrations correctly implementing it on three: `user_connections`, `analysis_results`,
and `user_tickers`, each with an `auth.uid() = user_id` policy. `migrate-schema-to-azure.ts` strips
every `ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` statement at deploy time, specifically because
Azure Postgres has no `auth.uid()` function to evaluate — and even if the statements were left in
untouched, they'd be inert, because production connects via a plain `pg.Pool` service credential, not
through Supabase's PostgREST/RLS-aware layer that would set the session context `auth.uid()` reads
from. This is worth being precise about, because `TECHNICAL_ARCHITECTURE.md` still describes 'RLS on
3 tables' as if it's a live control — it's correct about what the SQL *file* says, and wrong about
what the *database* enforces. Per-user isolation today is 100% application discipline: every
repository method that touches user-scoped data binds `WHERE user_id = $1` by hand, with zero
database-level backstop if one method ever misses that filter."

**Weak answer:** "Yes, RLS is enabled on 3 tables so those are protected."

**Follow-up:** "If a future engineer added a new repository method and forgot the `WHERE user_id`
filter, what's the actual, concrete consequence, given there's no RLS backstop?"

---

### N3 [Senior] — Walk through exactly how the public API authenticates a request, step by step.

**Testing:** Depth on the one part of this codebase's auth story that's genuinely well-engineered —
can the candidate describe it precisely enough to demonstrate they'd design something similar
themselves.

**Evidence:** `middleware.ts:9-70` — SHA-256 hash lookup, `active` check, product entitlement check,
daily quota check, partner-header forwarding.

**Strong answer:** "A request to `/api/public/v1/*` hits `middleware.ts` before any route handler
runs — the matcher is scoped exactly to that path prefix. It extracts the `Authorization: Bearer`
token, SHA-256 hashes it client-side using Web Crypto's `crypto.subtle.digest`, and looks up
`api_keys.key_hash` — the raw key is never stored or compared directly, only its hash, so a database
read or leak doesn't expose a usable key. It checks the key is `active`, then resolves the requested
path to a product name via `resolveProductName()` and checks that name against the key's
`entitledProducts[]` array — a key not entitled to a given product gets a `403` naming the missing
product explicitly, which is real per-key, per-product authorization, not a flat 'has any API key'
boolean. Then it checks a daily quota: reads today's usage count, compares against the key's
`dailyQuota`, and — if allowed — increments it via a genuinely atomic
`INSERT ... ON CONFLICT (key_id, window_start) DO UPDATE SET request_count = request_count + 1`. On
success it forwards `x-api-key-id`/`x-api-partner-id` headers downstream and logs one structured
JSON line with a `requestId`, `latencyMs`, and outcome. This is a real, centralized, request-blocking
auth layer — the opposite of the internal API's per-route opt-in pattern — and it's the most
carefully engineered piece of the whole backend."

**Weak answer:** "It checks an API key against the database and lets the request through if it's
valid."

**Follow-up:** "The quota *increment* is atomic, but the quota *check* that gates whether a request
is even allowed through reads a value from before that increment. What's the practical consequence of
that gap?"

---

### N4 [Staff] — Design a fix for the prompt injection risk, given the constraint that transcripts must still be read in full and faithfully.

**Testing:** Whether the candidate can design a real mitigation under a genuine constraint — you
can't just sanitize away financial language that happens to look imperative — rather than proposing
something that would also break legitimate extraction.

**Evidence:** N1's finding, plus the product's own core promise ("Extract VERBATIM quotes — do NOT
paraphrase," repeated across nearly every system prompt in `lib/pipeline.ts`), which any mitigation
has to preserve.

**Strong answer:** "The constraint that rules out most naive fixes is that this product's whole value
proposition is faithful, verbatim extraction — you can't strip or heavily rewrite transcript text
without risking dropping the exact financial language the product exists to capture, and you can't
reject a transcript outright just because it contains imperative-sounding sentences, since executives
genuinely say things like 'let me be direct about this' or 'ignore the noise in the headline number'
in completely legitimate financial commentary. So I'd layer three cheap, non-destructive mitigations
rather than one heavy one. First: explicit prompt structure — wrap the transcript in a clearly
delimited block and add one line to every system prompt telling the model everything inside that
block is data to analyze, never instructions to follow, which is a well-known, essentially free
mitigation that's currently just missing. Second: a lightweight heuristic scan — not a blocker, a
flag — for patterns like 'ignore previous instructions' or unusually direct second-person imperatives
addressed to 'the AI'/'the assistant,' logged for manual review rather than auto-rejected, since false
positives on legitimate earnings-call bravado are likely and a false rejection is worse than a flagged
review. Third, and this is the part that actually catches a successful injection rather than just
discouraging attempts: extend `localValidation()`'s existing self-consistency check with one
additional cheap heuristic specifically on `raw_quotes` — verify each quote is a reasonably close
substring match against the source transcript text the pipeline already has in memory, since that's
essentially free (no extra Gemini call) and it's the exact class of check the archived prototype's
`judge_evaluator.py:validate_change` did with a full LLM call, but doable here with plain string
matching for a fraction of the cost."

**Weak answer:** "You'd add input sanitization to strip out any suspicious instructions before
sending the transcript to Gemini."

**Follow-up:** "Your third mitigation — substring-matching quotes against source text — is exactly
what the archived Python `judge_evaluator.py` did with a full LLM call instead. Why would you choose
the cheaper string-match version here instead of porting the LLM-judge approach back in?"

---

## O. Cloud

### O1 [L2] — What Azure services does this app actually depend on in production?

**Testing:** Accurate knowledge of the real, current cloud footprint versus what the stale
documentation claims.

**Evidence:** `lib/repositories/index.ts` (`PostgresXRepository`/`AzureBlobStorageRepository`);
`auth.ts` (Microsoft Entra External ID); `.github/workflows/deploy-azure.yml` (Azure Container
Registry + `az containerapp update`).

**Strong answer:** "Four Azure services, end to end: Azure Database for PostgreSQL Flexible Server
for the system of record, connected over a private VNet, not a public endpoint; Azure Blob Storage
for transcript PDFs, with account-key writes server-side and SAS-token-gated, time-limited reads for
anything the browser touches directly; Microsoft Entra External ID as the OIDC identity provider
behind NextAuth; and Azure Container Apps as the compute layer, with images built and pushed to
Azure Container Registry via GitHub Actions using OIDC federation rather than a stored credential.
None of this is what the top-level `README.md` or `TECHNICAL_ARCHITECTURE.md` describe — both still
document a Supabase Auth/Postgres/Storage-on-Vercel stack, which is stale by at least two completed
migrations. The actual dead giveaway that the docs are wrong isn't subtle either — `lib/repositories/
index.ts` is the one file that settles it, since it only ever instantiates the `Postgres*`/`AzureBlob*`
classes, never the `Supabase*` ones that still sit dead in every repository file."

**Weak answer:** "It runs on Supabase and Vercel based on the README."

**Follow-up:** "Why do you think the team kept the dead `Supabase*Repository` classes in the tree
this long after the migration completed, instead of deleting them?"

---

### O2 [L3] — Why was hosting migrated before the database, not simultaneously?

**Testing:** Understanding a real sequencing decision with a concrete networking reason behind it,
not just "they did it in stages for safety."

**Evidence:** ADR #11 (`19_ARCHITECTURE_DECISION_LOG.md`) — explicit rationale: Vercel serverless
functions have no stable outbound IPs, so a database reachable from Vercel had no choice but
public-access networking.

**Strong answer:** "Because of a specific networking constraint, not just general migration caution:
Vercel serverless functions don't have stable outbound IPs, so any database reachable from a
Vercel-hosted app has to accept public-access connections — there's no way to IP-allowlist a
serverless function's egress. If the team had moved the database to Azure first while still hosting
on Vercel, that new Postgres instance would have needed public exposure anyway, just to be reachable,
and then a *second* networking change to go private once hosting moved. By moving hosting to Azure
first, the new Postgres server never needed public exposure at all — it went straight to private,
VNet-only access from day one, because Azure-to-Azure traffic can stay entirely inside the private
network. That's a genuinely well-reasoned sequencing decision, and it's explicitly stated as the
rationale in the migration spec, not something I'm inferring — 'doing hosting first means this
spec's Postgres server never needs public exposure at all... a strictly worse security posture that
would just be thrown away the moment hosting moves anyway.'"

**Weak answer:** "They probably just wanted to do one migration at a time to reduce risk."

**Follow-up:** "Given that reasoning, why was Auth migrated last, after both Hosting and Data+Storage,
rather than in the middle or first?"

---

### O3 [Senior] — The App Service migration doc explicitly said 'no Dockerfile needed.' What actually happened, and what does that tell you about this team's documentation discipline?

**Testing:** Ability to hold two things true at once — genuinely good migration process, and a real
documentation gap — without collapsing into either "they're sloppy" or "it's all fine."

**Evidence:** `docs/superpowers/specs/2026-07-10-azure-hosting-migration-design.md`'s Out-of-scope
section: "No Dockerfile / containerization... Not needed now"; live `.github/workflows/deploy-azure.yml`
titled "Deploy to Azure Container Apps," building and pushing a Docker image, with zero corresponding
design doc for that second move.

**Strong answer:** "The documented plan moved the app to Azure App Service — Linux/Node runtime,
deployed from a built artifact directly, explicitly *not* containerized, with the design doc even
naming Container Apps as a possible future step it wasn't taking yet. But the live deploy workflow
today builds a Docker image and pushes it to Azure Container Registry, then updates a Container App —
the 'not needed now' step was actually taken at some later point, with zero corresponding design doc
anywhere in `docs/superpowers/specs/` or `plans/` explaining when or why. I'd read this as the same
finding as the Supabase-docs staleness, just for infrastructure instead of data: this team clearly
does real, careful, documented migration planning — the App Service doc's own Execution Record
documents genuine production incidents it debugged, like the `npm start` 503 and an SSL-certificate
DNS-ordering issue — but that discipline visibly didn't survive to the next migration. The practical
risk is concrete, not just tidiness: an engineer debugging a live deploy failure today, if they
trusted this doc, would try `az webapp` commands against a resource that doesn't exist anymore,
because Container Apps' revision and traffic-splitting rollback mechanics are genuinely different
from App Service's."

**Weak answer:** "They just moved to containers later and forgot to update the docs, not a big
deal."

**Follow-up:** "If you had to reconstruct the missing App-Service-to-Container-Apps migration doc
retroactively, purely from evidence in the repo, what would you cite as your sources?"

---

## P. Azure

### P1 [L2] — Why did the App Service migration doc explicitly rule out Docker, yet the live deployment uses a Dockerfile on Container Apps?

**Testing:** Same underlying fact as O3, asked from the specific angle the assignment names —
testing whether the candidate can reconcile a documented decision with contradicting live evidence
and explain *why* the contradiction exists rather than just noticing it.

**Evidence:** Same as O3: the design doc's own words, "no Dockerfile is needed for this hosting
choice," versus the live `Dockerfile` (multi-stage, `node:22-alpine`, `.next/standalone`) and
`deploy-azure.yml`.

**Strong answer:** "They're describing two different, sequential deployment targets, and the
Dockerfile simply postdates the doc. App Service's Linux/Node runtime can deploy directly from a
built artifact — no container needed — and the migration doc's Out-of-scope section says exactly
that, while naming Container Apps as a plausible *later* step, explicitly 'not needed now.' At some
point after that migration completed, the team took that later step — the live workflow is titled
'Deploy to Azure Container Apps' and builds a multi-stage Docker image before pushing it — but no
design or plan document anywhere records that second migration happening. So the ruling-out wasn't
wrong when it was written; it's just describing a decision that was later superseded, without the
paper trail a reader would reasonably expect given how thoroughly the *first* migration was
documented. The practical lesson: trust the live workflow YAML and Dockerfile over the design doc
for 'how does this actually deploy today' — they're the only artifacts that reflect the current
state."

**Weak answer:** "The doc is just outdated, they switched to Docker at some point."

**Follow-up:** "What specific advantage does Container Apps give this team over App Service that
would justify taking that 'not needed now' step later — and is there any evidence in the repo for
which one actually motivated it?"

---

### P2 [L3] — Why Entra External ID instead of continuing with Supabase Auth, and what production bug did that migration surface?

**Testing:** Depth on a real, specific bug this team hit and fixed — the OIDC `sub`-vs-`oid` UUID
mismatch — as evidence of genuine production experience, not just naming the provider swap.

**Evidence:** `auth.ts:22-46` — comment explicitly states the fix was "found by testing the real
deployment, not caught by type-checking"; every Postgres `user_id` column is `UUID`-typed, but
Entra's OIDC `sub`/`providerAccountId` claim is a non-UUID opaque pairwise identifier.

**Strong answer:** "The move to Entra ID was go-to-market driven, not technical — the migration
spec's own stated reason is that the product's actual enterprise buyers, Indian AMC/BFSI back-office
IT, are disproportionately Microsoft-standardized, which matters directly for vendor security reviews
and Entra SSO federation if this product is ever sold into an AMC's environment. That's a genuinely
interesting example of infrastructure being a sales decision, not a performance one. The specific bug
it surfaced: every `user_id` column across the schema is typed `UUID` in Postgres, but Entra External
ID's OIDC `sub` claim — the standard identifier NextAuth's JWT callback would use by default — is an
opaque, non-UUID pairwise identifier, so the very first credit-check or analysis-history query after
cutover threw `invalid input syntax for type uuid`. The fix, per `auth.ts`'s own comment, was to swap
`token.sub` to Entra's `oid` claim instead — a real GUID — inside the `jwt` callback, a targeted patch
rather than a schema migration. It's explicitly framed in the code as something 'found by testing the
real deployment, not caught by type-checking' — genuinely honest, useful documentation of a real
production incident, not a hypothetical."

**Weak answer:** "They switched to Entra ID for better Microsoft integration and it mostly just
worked."

**Follow-up:** "If you'd caught this before deploying — by reading the OIDC spec closely enough to
know `sub` isn't guaranteed to be a stable GUID across providers — how would you have designed the
`user_id` column type differently from the start?"

---

### P3 [Senior] — Why was the Postgres connection retry logic specifically scoped to connection-acquisition errors, not query errors?

**Testing:** Deep understanding of exactly-once vs. at-least-once semantics, and why blanket
retry-on-any-error is dangerous for writes — the kind of distinction that separates careful backend
engineers from people who reach for "just add a retry."

**Evidence:** `lib/postgres/client.ts:43-44,62-72` — retry matched against `ECONNRESET`,
"Connection terminated unexpectedly," TLS handshake reset; comment explicitly states this is safe
"because the failure occurs before any SQL reaches the server."

**Strong answer:** "Because retrying blindly on *any* Postgres error would risk double-executing a
write. The retry in `lib/postgres/client.ts` is matched against a narrow, specific set of errors —
`ECONNRESET`, 'Connection terminated unexpectedly,' a TLS reset during handshake — that all happen
during connection *acquisition*, before any SQL statement has actually reached the server. If the
query itself was never sent, retrying is provably safe: there's no way the first attempt already
executed. A query-level error — a timeout after the statement was already dispatched, say — is a
fundamentally different situation, because the server might have already applied the write and just
failed to acknowledge it; blindly retrying that could double-insert or double-decrement something.
This retry is explicitly justified in the code's own comments as targeting a real, observed Azure
failure mode — idle connections getting silently reaped by Azure's NAT/load-balancer path on the
private VNet route — and it's paired with the actual root-cause fix, TCP keepalive tuning
(`keepAlive: true, keepAliveInitialDelayMillis: 10000`), rather than just papering over the symptom
with the retry alone. I'd call this the single best-engineered reliability mechanism in the whole
codebase, precisely because it's scoped this narrowly instead of being a generic 'retry on any
Postgres error' wrapper."

**Weak answer:** "They probably just added a retry for any database connection failure to make it
more robust."

**Follow-up:** "If you needed retry safety for an actual query-level failure — not just connection
acquisition — what would you need to add to make that safe, given Postgres doesn't give you
automatic idempotency keys?"

---

### P4 [Staff] — A skeptical CTO says 'Vercel was working fine, why did we need any of this Azure migration?' What's your answer?

**Testing:** Ability to make the business case for an infrastructure decision precisely, using the
actual stated rationale rather than generic cloud-migration platitudes — and to be honest about the
real costs incurred.

**Evidence:** ADR #11's explicit stated reason: Microsoft Partner Network status, cost, and — "the
decisive factor" — Indian AMC/BFSI back-office IT being disproportionately Microsoft-standardized,
which matters for vendor security reviews if this product is sold into an AMC's environment.

**Strong answer:** "I'd make the case on go-to-market grounds first, because that's genuinely what
drove it, not performance or cost as the primary lever — the migration spec is explicit that the
decisive factor was that Quantalyze's actual target customers, Indian AMC and BFSI back-office IT
departments, are disproportionately Microsoft-standardized shops. A vendor security review at one of
those firms is going to look far more favorably on Entra ID SSO federation and Azure-native data
residency than on a Supabase-and-Vercel stack with public-endpoint Postgres — this isn't hypothetical
brand preference, it's the literal checklist those procurement teams work through. Beyond that, the
sequencing bought a real security improvement independent of the sales motivation: moving hosting to
Azure first meant the new Postgres server never needed public exposure at all, going straight to
private VNet-only access, which Vercel's no-stable-outbound-IP model structurally couldn't offer. I'd
be honest about the costs, too, because a good answer doesn't pretend the migration was free: it
surfaced real production incidents that had to be hand-discovered — the Entra `oid`-vs-`sub` UUID
mismatch, Azure VNet's idle-connection reaping, an App Service `npm start` 503 — and the team's own
top-level docs still haven't caught up, which is a genuine, ongoing cost of the decision, not a
one-time tax. But if the actual buyer is an AMC, the migration was the correct call regardless of
what it cost to execute."

**Weak answer:** "Azure is generally more enterprise-friendly and probably cheaper at scale, so it
made sense to switch."

**Follow-up:** "If the product's customer base were instead US retail investors rather than Indian
AMC back offices, would this migration still have been the right call? Why or why not?"

---

## Q. Product

### Q1 [L2] — Why did the original NotionWealth architecture get abandoned?

**Testing:** Ability to tell the founder's own pivot story accurately and with the real evidence
behind it — this is the single story every candidate should have polished, and the interviewer will
notice if it's vague.

**Evidence:** ADR #1 (`19_ARCHITECTURE_DECISION_LOG.md`) — 15 commits ever touched `finance-agent/`
versus 159 for `app/` and 89 for `lib/`; the pivot commit's message, "move Next.js app to repo root";
`finance-agent/`'s full agentic-platform shape (vector memory, control plane, replay engine, MCP
server) with zero shipped surface anywhere in the live product.

**Strong answer:** "NotionWealth was a genuinely ambitious Python multi-agent cognition platform —
persistent vector memory, a control-plane task router, specialist research agents, a replay engine
for auditable decision-making — the full shape is still visible in `finance-agent/`'s directory
structure. But it never shipped a UI beyond a local Streamlit dev command, and the commit history
tells the real story: only 15 commits ever touched that directory, against 159 for the Next.js `app/`
and 89 for `lib/` — more than a 10x investment ratio favoring the leaner rewrite once it started. The
pivot commit's own message, 'move Next.js app to repo root,' is the tell — it's a structural
promotion, the Next.js app stopping being a satellite next to the Python platform and becoming the
whole repo's center of gravity. The actual reason, as best the evidence supports it, is a mismatch
between the platform's ambition and the real customer's need: a PMS or family-office analyst wants a
fast, trustworthy per-company, per-quarter signal, not portfolio-level institutional memory and
research replay. Three weeks of rebuilding got to five parallel schema-constrained Gemini calls and a
Postgres cache instead of a control plane and a vector store — and *that* version is what's live
today, with a real monetized public API and two subsequent infrastructure migrations behind it."

**Weak answer:** "The old version was too complicated so they just rewrote it simpler in Next.js."

**Follow-up:** "What real capability was actually lost in that pivot, not just complexity — what
could the old system do that the live product genuinely can't?"

---

### Q2 [L3] — Why does Deep Dive deduct a credit even on a cache hit, while Delta Analysis doesn't?

**Testing:** Whether the candidate noticed and can explain a real, deliberate product-economics
asymmetry between two superficially similar features.

**Evidence:** `app/api/v1/analyze/solo/route.ts` comment: "solo pipeline caches internally — deduct
on every call, cache hits return fast but still cost 1 credit to discourage spam"; contrast
`analyze/route.ts`'s cache check runs *before* the credit deduction, so a cache hit costs zero.

**Strong answer:** "This is a real, deliberate asymmetry, not an inconsistency someone missed — and
it comes down to where the cache check sits relative to the credit deduction in each route. In
`analyze/route.ts`, the cache lookup happens first, and `checkAndDeduct()` is only called on the
cache-miss branch — so a repeat Delta Analysis for the same ticker/quarter-pair costs zero credits,
genuinely free. In `analyze/solo/route.ts`, the credit deduction happens unconditionally, before the
pipeline's own internal cache check even runs, and the code comment states the reasoning explicitly:
'cache hits return fast but still cost 1 credit to discourage spam.' Solo/Deep Dive is a single
Gemini call, 1 credit — cheap enough that the team apparently judged the abuse risk of free, instant,
repeatable cache hits (someone re-triggering the same cached result over and over, maybe as a way to
probe rate limits or just accidentally via a retry loop) as worth trading against the UX cost of a
technically-free repeat view. Delta Analysis, at 3 credits and up to 19 Gemini calls on a real run,
apparently didn't need that same anti-spam guard — a free cache hit there is pure user goodwill with
low abuse surface, since the actual expensive path is already gated by the cache check itself."

**Weak answer:** "They're probably just inconsistent about when they charge credits."

**Follow-up:** "If you were designing this from scratch, would you rather have both pipelines share
one consistent free-cache-hit policy, or is the asymmetry actually the right call? Defend either
side."

---

### Q3 [Senior] — Walk me through the reasoning for building a metered public API on top of the same repositories as the internal app.

**Testing:** Product-and-architecture reasoning together — can the candidate explain both the
business motivation (a real API product, not self-serve) and the specific architectural pattern
(Anti-Corruption Layer) that made it low-risk to add.

**Evidence:** ADR #6 — spec explicitly cites "curated intelligence products without revealing
prompts, pipeline internals, or source code," targeting PMS firms first, AMCs second, manually
provisioned keys, "no signup flow, no self-serve billing in this version," modeled explicitly on
Stripe/Twilio-style API product design.

**Strong answer:** "The stated business need is precise: expose curated intelligence to enterprise
partners — PMS firms first, AMCs second — without revealing prompts, pipeline internals, or source
code, and explicitly not as a self-serve product; API keys are manually provisioned per partner, no
signup flow, no self-serve billing at this stage. The architectural answer to that need is a
two-layer structure modeled on how established API businesses like Stripe and Twilio are built: a
stable resource layer (`data:companies`, `data:sectors`) plus a productized view on top
(`products:sector-thesis`), with hashed API keys, per-key product entitlements, and daily rate limits
all enforced in one Edge middleware — reusing the exact same repository layer the internal app
already depends on, rather than duplicating data access. The specific mechanism that makes this safe
is the `lib/api-contracts/v1/*.ts` Anti-Corruption Layer: a partner integration can survive internal
pipeline changes untouched, as long as the mapping function keeps producing the same external shape,
because a direct pass-through of internal routes would leak exactly the internal detail — full
per-metric quote data, validation scores — the product spec says must stay hidden. It's real added
layering for what's currently only 3 external endpoints, but it's the layering that lets the internal
app's refactoring velocity stay completely decoupled from partner-facing stability."

**Weak answer:** "They built a separate API for external customers so they could charge for it."

**Follow-up:** "If Quantalyze eventually wanted self-serve signup and billing for this API, what
would actually need to change architecturally, versus what's already built to support it?"

---

## R. Debugging

### R1 [L2] — A user reports their promoter-pledge flag never fires. Where do you look?

**Testing:** Ability to trace a real, self-documented bug from a bug report to its root cause —
this maps directly to the codebase's own documented divergence-score.ts finding, and rewards
knowing the actual field-name mismatch.

**Evidence:** `lib/divergence-score.ts`'s inline comment; `04_RUNTIME_FLOWS.md` §11 — the divergence
route reads `overall_signal`/`overall_score` off `insights_cache`, but `InsightsWirePayload` (what
`lib/insights-pipeline.ts` actually writes there) has no such fields — it has
`management_credibility_score` instead.

**Strong answer:** "I'd start at `/api/v1/divergence` and trace its cross-reference step, because
'the flag never fires' is exactly the symptom of a known, self-documented bug in this codebase.
`computeDivergence()` computes the pledge-activity half correctly — 90-day recent vs. 90-to-450-day
baseline, flagged elevated if recent exceeds 1.5x baseline — but the *flag itself* additionally
requires the pledge activity to coincide with a positive-or-mixed concall signal, and that second
half reads `overall_signal`/`overall_score` off whatever's stored in `insights_cache`. The actual bug
is a field-name mismatch: `InsightsWirePayload`, the shape `lib/insights-pipeline.ts` genuinely
writes to that cache, has no `overall_signal` or `overall_score` fields at all — it has
`management_credibility_score` instead. So `concallSignal`/`concallScore` are almost certainly always
`null` in production, meaning the flag's 'elevated pledging + positive concall' condition can
essentially never evaluate true, no matter how real the underlying pledge signal is. I'd confirm this
by checking a live `insights_cache` row's actual JSON keys against what `divergence.ts` reads, which
would show the mismatch directly rather than requiring a guess."

**Weak answer:** "I'd check if the BSE data source is returning results and look at the frontend
component."

**Follow-up:** "Given the pledge-activity half of this feature works standalone — the frontend
already shows `pledgeActivityLevel` regardless — what's the minimal fix that doesn't require
touching the Insights pipeline's schema?"

---

### R2 [L3] — A user says their Delta Analysis is missing the "Macro & Risk" section entirely. What's your hypothesis, and how do you confirm it?

**Testing:** Ability to reason from symptom to specific mechanism using knowledge of the exact
degrade-by-null pattern — not a vague "something failed" answer.

**Evidence:** `lib/pipeline.ts:463-474` (agent returns `null` on failure, filtered at line 809);
`runTemporalDelta` only runs "for each section where both prev+curr succeeded" — a single-quarter
thematic failure removes the section from the whole delta output.

**Strong answer:** "My first hypothesis is that the 'Macro & Risk' thematic agent's Gemini call
either timed out (past the 25-second `AGENT_TIMEOUT_MS`) or threw during parsing for at least one of
the two quarters being compared — because that's the exact, documented failure mode that removes a
section from the final output silently, with no error surfaced to the user beyond the section simply
not appearing. `runThematicAgent()` catches its own failure and returns `null` rather than
propagating an error, Phase 2 filters nulls out of `snapshotsPrev`/`snapshotsCurr`, and critically,
`runTemporalDelta` for a given section only runs if *both* quarters' snapshot succeeded — so even if
only the *previous* quarter's Macro & Risk call failed, the *current* quarter's perfectly successful
one still gets dropped from the delta output as a side effect. To confirm, I'd check the server logs
for `[Macro & Risk] Agent failed:` — that's the exact `console.error` line the catch block emits —
around the timestamp of that user's analysis run; if it's there, that confirms the hypothesis
directly, and I'd also check whether it was a timeout specifically versus a parse failure, since
those point to different follow-up fixes."

**Weak answer:** "Probably a bug in the frontend not rendering that section, I'd check the UI code
first."

**Follow-up:** "Given this failure mode produces no user-visible error today, what's the smallest
change to `DashboardPayload` that would let the frontend distinguish 'this section had nothing to
report' from 'this section's extraction failed'?"

---

### R3 [Senior] — Two browser tabs, same user, same ticker — the credit balance seems wrong afterward. Walk me through the bug.

**Testing:** Combines J2's concurrency reasoning with debugging methodology — can the candidate not
just describe the race but explain how they'd actually verify it happened, from evidence available
in this codebase (or lack thereof).

**Evidence:** `lib/credits.ts:33-49`'s non-atomic `checkAndDeduct`; separately, no idempotency key
anywhere on `/api/v1/analyze`, so two concurrent identical requests both pass the cache-miss check
and both run the full pipeline.

**Strong answer:** "Two independent bugs can both contribute here, and I'd want to isolate which one
actually happened. First, there's no idempotency guard on `/api/v1/analyze` at all — a double-click
across two tabs both see a cache miss for the same ticker/quarter-pair, both deduct credits, and
both run the full ~19-call pipeline in parallel, meaning the user is *correctly* charged twice for
one logical intent, even though that feels like a bug from the user's perspective. Second, and this
is the one that actually under-charges rather than double-charges: `checkAndDeduct()`'s
read-then-write isn't atomic, so if both requests' credit deductions land close enough together, one
can silently clobber the other, and the user ends up charged for only *one* of the two runs despite
both actually executing. So depending on the timing, the visible symptom is either 'I got charged
twice for one action' or 'the balance doesn't reflect two runs at all' — genuinely opposite-looking
symptoms from adjacent bugs. To actually confirm which happened, I'd check whether `analysis_results`
shows one row or two for that ticker/quarter-pair around the incident timestamp — two rows confirms
both pipelines genuinely ran, which then tells me to look specifically at `user_credits.used`'s value
against how many runs actually executed, since there's no request-level logging today that would let
me reconstruct the exact read-then-write interleaving directly."

**Weak answer:** "There's probably a race condition in the credits system somewhere."

**Follow-up:** "Given there's no logging that captures the exact interleaving today, what's the
smallest instrumentation you'd add to make this specific bug class provable from logs alone, without
waiting for a customer complaint?"

---

### R4 [Staff] — `lib/pipeline.ts`'s own header comment says "8 parallel calls, 4 agents," but the architecture doc says "11 calls, 5 agents." How do you resolve which is correct, and what does this teach you about trusting comments vs. code?

**Testing:** Whether the candidate defaults to verifying against executable code rather than trusting
either document — a genuinely important debugging and code-review instinct, tested with a real,
citable example rather than a hypothetical.

**Evidence:** `lib/pipeline.ts:1-5`'s stale docstring ("8 parallel Gemini calls (4 thematic agents ×
2 quarters)... 4 temporal delta comparisons") vs. the actual `AGENT_PROMPTS` object (`lines 281-364`)
having 5 keys; `TECHNICAL_ARCHITECTURE.md` correctly says 11/5, matching the code.

**Strong answer:** "Neither document is automatically the source of truth — the code is, and I'd
verify with something as simple as `Object.keys(AGENT_PROMPTS).length` rather than trusting either
prose description. In this case, the actual object has 5 keys — `Revenue & Growth`,
`Margins & Profitability`, `Cost Structure`, `CapEx & Balance Sheet`, `Macro & Risk` — which means 10
thematic calls plus 1 evasiveness call, 11 total for Phase 2, and up to 5 temporal-delta comparisons
in Phase 3, matching the architecture doc's numbers, not the file's own header comment. The header
comment reads like a leftover from an earlier 4-agent version — probably before 'CapEx & Balance
Sheet' or 'Macro & Risk' was added — that never got updated when a 5th agent shipped, sitting three
lines above the code it now contradicts. The broader lesson is one I'd apply generally, not just
here: a file's own top-of-file comment is often the *most* trusted-by-default piece of documentation,
because it's right there next to the code, but that proximity doesn't make it more likely to be
current — if anything, a comment that's easy to skip past during a quick edit is exactly the kind of
comment that goes stale silently. I'd treat any prose claim about a codebase's behavior, including
comments inside the file itself, as a hypothesis to verify against the actual data structure or
control flow, not as ground truth."

**Weak answer:** "I'd probably trust the comment in the file since it's closest to the code, and
assume the architecture doc is the one that's outdated."

**Follow-up:** "This same repo has multiple other instances of doc/code drift — the README's
Supabase claims, a stale 'delete it from Supabase storage' error string post-Azure-migration. What
process would you put in place to catch this class of drift before it compounds further?"

---

## S. Tradeoffs

### S1 [L2] — Defend the decision to use Postgres JSONB caching instead of a dedicated cache layer.

**Testing:** Whether the candidate can articulate why avoiding a second stateful service was the
right call here, specifically, rather than reciting "Redis is faster" as if that settles it.

**Evidence:** ADR #5 — every cache table is a permanent-until-manually-invalidated Postgres JSONB
table, no Redis/Memcached anywhere in `package.json`.

**Strong answer:** "I'd defend it directly: most of these caches are described as effectively
permanent — a Delta Analysis of Q3 FY26 vs. Q4 FY26 for a given ticker doesn't go stale the way a
typical web cache entry does, because the underlying transcript never changes. A TTL-based Redis
layer is solving a staleness problem this data mostly doesn't have. Running a second stateful
service adds real operational surface — provisioning, monitoring, a second connection pool, a second
failure mode — for a product whose actual per-run economics, roughly $0.03 in Gemini cost per Delta
Analysis, don't obviously justify sub-millisecond cache reads over Postgres's tens-of-milliseconds.
And Postgres was already the system of record, so reusing it for cache avoids a consistency problem —
cache and database of record disagreeing — that introducing a separate cache layer would create for
free. The real cost is genuine and worth naming: no sub-millisecond reads if traffic ever grows
enough that Postgres read latency on hot cache keys becomes the bottleneck, and no built-in
eviction primitive, so the app enforces its own TTL logic in code for the one cache that actually
needs it, `insights_cache`'s 30-day window. I'd revisit this the moment cache-read volume starts
dominating database load rather than staying proportional to actual analysis-triggering volume —
which is inherently rate-limited today by the credits system anyway."

**Weak answer:** "Redis would be faster but Postgres is simpler so they went with what they already
had."

**Follow-up:** "You said you'd revisit this if cache-read volume starts dominating load. What's the
first concrete symptom you'd expect to see that signals that threshold has been crossed?"

---

### S2 [L3] — Defend using `Promise.all` with internal try/catch instead of `Promise.allSettled`.

**Testing:** Precise understanding of the two mechanisms' actual behavioral equivalence given this
codebase's specific pattern — and honesty about where that equivalence is fragile.

**Evidence:** `11_PRODUCTION_ENGINEERING.md`/`06_AGENT_ARCHITECTURE.md` — every agent function
self-catches and resolves to `null`/a typed default rather than rejecting, so `Promise.all` never
actually sees a rejection from an agent call; `Promise.allSettled` is never used anywhere in the
codebase.

**Strong answer:** "Given how this codebase is actually written, the two are functionally near-
equivalent — but only because every individual agent function already catches its own errors
internally and resolves to `null` or a typed default rather than rejecting. `runThematicAgent()`
never lets an error propagate out of itself; it catches, logs, and returns `null`. So by the time
`Promise.all` sees the array of promises, none of them can actually reject — the graceful degradation
already happened one layer down. `Promise.allSettled` would be the more defensive, idiomatic choice
specifically because it would make that guarantee structural rather than conventional — right now,
correctness depends entirely on every single agent function remembering to swallow its own errors, a
convention enforced by code review and consistency across files, not by the type system or the
fan-out mechanism itself. If a future engineer adds a sixth pipeline file and forgets the try/catch
inside one new agent function, `Promise.all` would reject the whole batch instead of degrading that
one call gracefully — a real, silent regression risk that `Promise.allSettled` would have prevented
by construction, at essentially zero cost to switch to."

**Weak answer:** "They're basically the same thing so it doesn't really matter which one you use."

**Follow-up:** "If you were adding a sixth pipeline file today, would you switch that new file to
`Promise.allSettled` even though the other five still use `Promise.all`? What's the tradeoff of
having two patterns coexist?"

---

### S3 [Senior] — Defend not retrying failed Gemini calls, given the archived prototype did retry with backoff.

**Testing:** Ability to argue the production decision is actually reasonable given the specific
constraints, not just describe the difference — and to know exactly when that reasoning stops
holding.

**Evidence:** Production: zero retry logic anywhere on any Gemini call (grep-verified). Archived
`finance-agent/core/llm.py:21-48`: `max_retries=3` with `time.sleep(2 ** attempt)` exponential
backoff.

**Strong answer:** "I'd defend the production choice as the more disciplined one for this specific
architecture, even though it looks like a regression at first glance. The archived Python
prototype's retries operated without a tight per-call deadline — it could afford `2^attempt` seconds
of backoff because nothing else in that pipeline was racing against a shared budget. Production's
25-second `AGENT_TIMEOUT_MS` exists specifically so 10 parallel calls resolve in roughly the same
window as one call — a retry-with-backoff inside that budget would either blow it on the first retry
alone, or need to be so aggressively short that it's barely a real retry. Given that constraint,
graceful degradation via null — accept the failure, drop that section, keep the rest of the pipeline
moving — is arguably the *more* correct choice for a 25-second fan-out than a retry that can't
realistically fit inside the deadline. Where this stops being defensible is exactly the point where
transient failures become common enough that losing a whole section per occurrence starts materially
degrading report quality — at that point, a narrowly-scoped single retry carved out of the *existing*
budget, distinguishing transient errors from deterministic ones, is worth the complexity. Today,
there's no telemetry that would even tell you how often that's happening, which is itself the more
urgent gap to close before deciding whether retries are worth adding at all."

**Weak answer:** "Retries just add complexity and slow things down so it's fine without them."

**Follow-up:** "Given the archived prototype's retry approach, would you rather port that logic back
into TypeScript, or design a version specific to the 25-second budget constraint? What would you
change?"

---

### S4 [Staff] — Defend keeping "v1" as a namespace rather than building real API versioning, and tell me when that stops being defensible.

**Testing:** Long-horizon judgment about deferring a real capability — knowing exactly what trigger
condition should force the investment, not just deferring indefinitely with no criteria.

**Evidence:** G2's finding: no `v2` directory, no header negotiation, `"v1"` baked into path prefixes
and DTO function names; public API keys currently manually provisioned per partner, no self-serve.

**Strong answer:** "I'd defend it as correct today, specifically because of who the current consumer
is: the public API has exactly 3 partner integrations, all manually provisioned, all coordinated
directly rather than through a self-serve flow. Real API versioning — content negotiation, parallel
`v1`/`v2` coexistence, deprecation windows — exists to solve a coordination problem: 'I can't ship a
breaking change without warning, because I don't know who's depending on the old shape and can't
reach them directly.' At 3 manually-onboarded partners, that coordination problem doesn't exist yet —
if a breaking change is needed, someone can just talk to the partner directly and coordinate the
cutover, which is genuinely cheaper than building version-negotiation infrastructure for a
consumer base you can count on one hand. It stops being defensible the moment either of two things
happens: the partner count grows past what a person can personally track and coordinate with, or the
product moves to self-serve key issuance — the same 'out of scope, explicitly named as a separate
future project' capability the original API-product spec already flags as deferred. At that point,
you genuinely can't know who's depending on which shape anymore, and that's exactly when a real
versioning mechanism — content negotiation or parallel path-based coexistence — earns its cost. I'd
treat 'we're about to enable self-serve signup' as the concrete trigger to build it, not a vague
'when we have more partners' timeline."

**Weak answer:** "It's fine for now since there aren't that many API consumers yet, they can add
versioning later if they need it."

**Follow-up:** "If self-serve signup shipped tomorrow with the current `v1`-as-namespace approach
still in place, what's the first concrete incident you'd expect to happen as a result?"
