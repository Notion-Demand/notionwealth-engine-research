# 05 — AI Architecture

Deep reverse-engineering of every AI/LLM component in Quantalyze, verified line-by-line against source. Two systems are covered and never conflated:

- **PRODUCTION** — the live Next.js app. All AI code lives in `lib/pipeline.ts`, `lib/solo-pipeline.ts`, `lib/insights-pipeline.ts`, `lib/kpi-extractor.ts`, `lib/sector-narrative.ts`. Calls Google Gemini directly via the `@google/generative-ai` npm SDK.
- **`finance-agent/` + `disclosure-analysis-pipeline/`** — an **IMPLEMENTED-BUT-ARCHIVED / PROTOTYPE-ONLY** Python system. 15 commits touched it vs. 89+159 for `lib/`+`app/`, and grep confirms zero cross-references from the Next.js app into `finance-agent/`. It never ran in production. Everything under the "Archived Prototype" headings below is prototype code, not part of the shipped product — flagged explicitly every time.

Every component below is labeled **IMPLEMENTED / PARTIALLY IMPLEMENTED / IMPLEMENTED-BUT-ARCHIVED / IMPLIED-ARCHITECTURALLY-PREPARED / NOT IMPLEMENTED**.

---

## 1. LLM Providers

### Production: Gemini via `@google/generative-ai`

**IMPLEMENTED.** Every production AI call site imports the same npm SDK and instantiates it the same way:

```ts
// lib/pipeline.ts:6, 183-186
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
...
function getGenAI(): GoogleGenerativeAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
  return new GoogleGenerativeAI(apiKey);
}
```

Identical `getGenAI()` (or an inline equivalent) is repeated verbatim in:
- `lib/pipeline.ts:183-186`
- `lib/solo-pipeline.ts:39-42`
- `lib/insights-pipeline.ts:75-78`
- `lib/sector-narrative.ts:112,118` (inline, not factored into a helper)
- `lib/kpi-extractor.ts:361,368` (inline)

This is the **API-key-authenticated Gemini Developer API**, not Vertex AI — `GoogleGenerativeAI(apiKey)` takes a plain API key, unlike the Vertex AI Node SDK which authenticates via GCP project/location and Application Default Credentials. There is no Vertex AI import anywhere in `lib/` or `app/` (grep-verified).

### Archived Prototype: also Gemini Developer API — "Vertex" in name only

**IMPLEMENTED-BUT-ARCHIVED, and a documentation trap.** `finance-agent/requirements.txt` lists `google-cloud-aiplatform` (the real Vertex AI SDK), which is why the context pack describes this as a Vertex AI system. But every actual call site in the codebase uses the **`google-genai`** package instead — the same Developer-API-key SDK family as production, just the Python client:

```python
# finance-agent/vertex.py:1-10 — file is named "vertex.py" but never touches Vertex AI
import os
from google import genai
from dotenv import load_dotenv
load_dotenv()
client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
```

```python
# finance-agent/core/llm.py — same pattern, no Vertex
client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
def generate(prompt, model="gemini-2.0-flash"):
    return client.models.generate_content(model=model, contents=prompt).text
```

`grep -rl "vertexai\|aiplatform\|from google.cloud"` across `finance-agent/` returns **zero source files** — only `requirements.txt` mentions the package. `finance-agent/main.py:3` even imports `from vertex import call_gemini`, so the FastAPI entrypoint's only LLM path is this same API-key client. **`google-cloud-aiplatform` is a declared, unused dependency; the "Vertex AI" system is actually the Gemini Developer API end-to-end**, in both production and the archived prototype. Treat "Vertex AI" claims about this codebase as aspirational, not implemented.

The `judge_evaluator.py` (see §11) and `multiagent_analysis/config.py` (§4) modules add a **third** access pattern on top: LangChain's `ChatGoogleGenerativeAI` wrapper and the raw `google-genai` client respectively — still the same underlying Developer API, different client libraries, all archived.

---

## 2. Model Configuration — grepped, not assumed

| File | Model string | Temperature | responseMimeType/Schema | Timeout |
|---|---|---|---|---|
| `lib/pipeline.ts:195,205` | `"gemini-2.5-flash-lite"` | `0` | yes | 25s/agent call (`AGENT_TIMEOUT_MS`, line 189) |
| `lib/solo-pipeline.ts:168,174` | `"gemini-2.5-flash-lite"` | `0` | yes | 55s (`TIMEOUT_MS`, line 45) |
| `lib/insights-pipeline.ts:86,92` | `"gemini-2.5-flash-lite"` | `0` | yes | 55s (`CALL_TIMEOUT_MS`, line 81) |
| `lib/kpi-extractor.ts:370,374` | `"gemini-2.5-flash-lite"` | **`0.1`** | yes | none (no `Promise.race` wrapper) |
| `lib/sector-narrative.ts:120,131` | `"gemini-2.5-flash-lite"` | **`0.1`** | yes | 22s (`NARRATIVE_TIMEOUT_MS`, line 92) |

`TECHNICAL_ARCHITECTURE.md` §1 states "AI Model: Gemini 2.5 Flash Lite... Temperature 0" as a blanket claim — **this is only true for 3 of 5 call sites**. `lib/kpi-extractor.ts` and `lib/sector-narrative.ts` both run at temperature `0.1`, not `0`. This is a small but real doc/code drift worth calling out in an interview: the doc oversimplifies "deterministic extraction" into a universal claim when two synthesis-flavored call sites intentionally trade a little determinism for less repetitive prose.

No `maxOutputTokens` is set anywhere (SDK default applies, uncapped by the app). **No `safetySettings` / `HarmCategory` / `HarmBlockThreshold` configuration exists anywhere in `lib/*.ts`** (grep-verified, zero hits) — the app runs on Gemini's default safety thresholds with zero custom tuning. This matters for a financial-content product: harsh disclosure language, distressed-company transcripts, or executive Q&A about layoffs/fraud could in principle trip default safety filters with no override in place — **NOT IMPLEMENTED**.

`AGENT_TIMEOUT_MS = 25_000` (pipeline.ts:189) and the 270s pipeline-level timeout (`app/api/v1/analyze/route.ts:96`, `PIPELINE_TIMEOUT_MS = 270_000`) both match `TECHNICAL_ARCHITECTURE.md` §4a exactly — those two specific numeric claims check out in code.

---

## 3. Provider Abstraction — none for the LLM, a real one for storage

**NOT IMPLEMENTED** for the model layer. There is no `LLMProvider` interface, no adapter, no factory that could swap Gemini for GPT-4 or Claude. Every pipeline file imports `GoogleGenerativeAI` directly and constructs a model object inline (`lib/pipeline.ts:191-214`, duplicated near-verbatim in `lib/solo-pipeline.ts:163-183` and `lib/insights-pipeline.ts:83-100`). The closest thing to shared abstraction is each file's private `invokeStructured<T>()` helper, but that wraps only the Gemini SDK's own call shape (`systemInstruction`, `generationConfig.responseSchema`) — it is not provider-agnostic, and swapping models would mean rewriting all five files' request/response glue, not implementing an interface.

By contrast, the **storage/persistence layer does have a real abstraction** — worth noting as a contrast, because it shows the team knows how to build one when it matters to them: `lib/repositories/index.ts` wires concrete `Postgres*Repository` classes behind interfaces (`AnalysisRepository`, `SoloAnalysisRepository`, etc.), and `lib/repositories/analysis.ts` even ships **two parallel implementations** (`SupabaseAnalysisRepository` and `PostgresAnalysisRepository`) behind the same `AnalysisRepository` interface — evidence of a completed Supabase→Postgres migration. No equivalent exists for the LLM call surface.

**INTERVIEW**: "If Quantalyze needed to add a GPT-4 fallback for Gemini outages, what's the smallest refactor? What breaks first?" (Answer: five files' worth of duplicated `invokeStructured` helpers would need a real `LLMClient` interface; schemas would need translating from Gemini's `SchemaType` enum format to OpenAI's JSON Schema; and every system prompt currently passed via Gemini's `systemInstruction` field would need re-plumbing since OpenAI models are more sensitive to system/user message ordering.)

---

## 4. Prompts and System Prompts — all inline, no template files

**IMPLEMENTED**, entirely as hardcoded template-literal strings inside the pipeline `.ts` files — there is no `prompts/` directory, no `.txt`/`.md` prompt files, no prompt-management library (LangChain, Guidance, etc.) in the production app. Grep for prompt file conventions across `lib/` and `app/` turns up nothing; every prompt lives beside the code that uses it.

`lib/pipeline.ts` alone defines **five distinct thematic-agent system prompts** as a `Record<string, string>` (`AGENT_PROMPTS`, lines 281-364) — one each for `"Revenue & Growth"`, `"Margins & Profitability"`, `"Cost Structure"`, `"CapEx & Balance Sheet"`, `"Macro & Risk"` — plus separate system-prompt constants for the temporal-delta comparison (`TEMPORAL_DELTA_SYSTEM`, lines 366-392), the "What Changed" synthesis (`EARNINGS_DELTA_SYSTEM`, 394-411), the "Financial Impact" synthesis (`FCF_IMPLICATIONS_SYSTEM`, 413-430), the evasiveness scorer (`EVASIVENESS_SYSTEM`, 432-442), and the key-metrics extractor (`KEY_METRICS_SYSTEM`, 164-179). That's **9 distinct system prompts in one file**. Representative excerpt (the Revenue & Growth agent, `lib/pipeline.ts:282-298`):

```
You are a senior equity research analyst specializing in revenue quality and growth decomposition.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **Volume vs Realisation split** — volume growth %, realisation/price per unit trends...
...
RULES:
- Extract VERBATIM quotes (do NOT paraphrase). Include speaker attribution.
- Separate volume-driven growth from price/realisation-driven growth wherever discussed
...
```

Every one of these prompts is domain-role-primed ("senior equity research analyst," "senior credit analyst," "senior risk analyst") and closes with an explicit anti-fabrication or anti-paraphrase instruction ("Extract VERBATIM quotes," "Never fabricate data. If you cannot find a number, describe qualitatively" — `lib/solo-pipeline.ts:111`). These are prompt-level hallucination controls (§8) — there is no code that verifies the model actually complied.

`lib/insights-pipeline.ts:154` is notable for a different pattern: rather than five sector-specific agents, it uses **one sector-adaptive prompt** that tells the model to reinterpret its own field definitions per company type ("do not force manufacturing-specific concepts onto a bank, or banking-specific concepts onto a manufacturer" — `QUARTER_BRIEF_SYSTEM`, line 154), because a single ticker stream can be a bank one quarter's analysis and an FMCG company the next, and pre-declaring 5 domains (as `lib/pipeline.ts` does) doesn't generalize across arbitrary Nifty-200 sectors.

**Extraction schema enforced by each prompt** (paired with a Gemini `responseSchema` — see §6):
- Thematic agents → `{ section_name, key_takeaways: string[], raw_quotes: string[] }`
- Temporal delta → `{ section_name, key_takeaways: string[], metrics: MetricDelta[] }` where each `MetricDelta` carries `subtopic, quote_old, quote_new, language_shift, signal_classification ∈ {Positive,Negative,Noise}, signal_score, ui_component_type ∈ {metric_card,status_warning,quote_expander}`
- Evasiveness → `{ score: number, reasoning: string }`
- Synthesis bullets → `{ bullets: string[] }`

---

## 5. Context Construction

**IMPLEMENTED**, and mechanically simple — no retrieval, no chunk selection, no reranking. Context assembly is string concatenation of (a) the PDF-extracted transcript, capped, and (b) for later phases, the structured output of earlier Gemini calls.

**Phase-by-phase, in `lib/pipeline.ts`:**

1. `extractPdfText()` (lines 240-266) parses the PDF with `pdf-parse`, then hard-truncates: `text.slice(0, MAX_TRANSCRIPT_CHARS)` where `MAX_TRANSCRIPT_CHARS = 120_000` (line 238). Comment: "Large conglomerate calls (e.g. Reliance, TCS) run 2-3+ hours — cap at 120K to ensure all segments and Q&A are captured without hitting Gemini context limits." This is a **naive prefix truncation**, not a smart chunker — if a 3-hour transcript's Q&A section (often where analysts extract the most risk-relevant signal, per the prompts' own instructions to "pay EXTRA attention to Q&A") falls past char 120,000, it is silently dropped. No summarization-then-recombine, no sliding window, no "keep last N chars of Q&A" logic.
2. Each thematic agent's user prompt (lines 455-461) is just `Company / Quarter / TRANSCRIPT: {full 120K-char text}` — the entire capped transcript is sent to all 10 thematic calls plus the evasiveness call, undifferentiated. There is no per-agent slicing (e.g., the Cost Structure agent doesn't get a cost-focused excerpt — it gets the same 120K chars as Revenue & Growth and relies purely on its system prompt to know what to extract).
3. The **evasiveness agent** is the one exception that does slice context: `transcript.slice(-30000)` (line 482) — last 30K chars only, on the theory that Q&A (where evasiveness shows up) is at the end of the transcript.
4. The **key-metrics agent** slices differently again: `transcript.slice(0, 40_000)` (line 613) — first 40K chars, on the theory that headline numbers are stated early.
5. Phase 3 (`runTemporalDelta`, lines 495-529) builds its prompt from **structured prior output, not raw text**: it takes the `key_takeaways` and first 10 `raw_quotes` from each quarter's thematic-agent result and formats them into a compact "PREVIOUS QUARTER / CURRENT QUARTER" block. This is context compression across pipeline stages — the model never re-reads the raw transcript in Phase 3, only the Phase 2 agents' extracted claims.
6. Phase 4 synthesis agents (`buildDeltaSummary`, lines 554-564) compress even further: only non-Noise metrics, capped at 4 per section, formatted as `[Positive] subtopic: language_shift` one-liners.

`lib/insights-pipeline.ts` follows the identical compress-as-you-go pattern: per-quarter briefs (raw transcript → structured `QuarterBrief`) feed a synthesis agent that receives a hand-built text digest of all briefs (`runSynthesisAgent`, lines 337-368), never the raw transcripts again.

**No prior-quarter caching of raw text** across pipeline runs — every run re-downloads and re-parses the PDF from Supabase/Azure Blob Storage (`storageRepo.download`, `lib/pipeline.ts:241`) even if that exact transcript was analyzed minutes ago in a different (ticker, quarter) pairing.

---

## 6. Structured Outputs — Gemini `responseSchema`, no secondary validation layer

**IMPLEMENTED** via Gemini's native JSON-mode schema enforcement, **not** manual `JSON.parse` + hand-rolled validation. Every call site constructs a Gemini `Schema` object (from `SchemaType.OBJECT/ARRAY/STRING/NUMBER`, with `format: "enum"` for constrained string fields) and passes it as `generationConfig.responseSchema` alongside `responseMimeType: "application/json"`:

```ts
// lib/pipeline.ts:191-214
async function invokeStructured<T>(systemPrompt, userPrompt, schema, modelName = "gemini-2.5-flash-lite"): Promise<T> {
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0,
    } as any,
  });
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini agent timed out")), AGENT_TIMEOUT_MS));
  const result = await Promise.race([model.generateContent(userPrompt), timeout]);
  return JSON.parse(result.response.text()) as T;   // ← no schema re-validation after parse
}
```

Six schemas are defined in `lib/pipeline.ts` alone: `QUARTER_SNAPSHOT_SCHEMA`, `METRIC_DELTA_SCHEMA`, `SECTIONAL_INSIGHT_SCHEMA`, `EVASIVENESS_SCHEMA`, `BULLETS_SCHEMA`, `KEY_METRICS_SCHEMA` (lines 83-162), each with a `required` array. `lib/insights-pipeline.ts` adds `QUARTER_BRIEF_SCHEMA` and `SYNTHESIS_SCHEMA` (lines 102-221); `lib/solo-pipeline.ts` adds `SOLO_SCHEMA` (47-65); `lib/sector-narrative.ts` adds `NARRATIVE_SCHEMA` (32-52).

**Expected TypeScript shapes** are separately hand-declared as `interface`s next to each schema — `QuarterSnapshot`, `MetricDelta`, `SectionalInsight`, `KeyMetrics`, `DashboardPayload` in `lib/pipeline.ts:26-79`; `SoloPayload`/`SoloSection` in `lib/solo-pipeline.ts:15-26`; `QuarterBrief`/`RecurringTheme`/`GuidanceTrack`/`InsightsPayload` in `lib/insights-pipeline.ts:29-71`. **These TS interfaces and the Gemini `Schema` objects are two independently-maintained descriptions of the same shape** — nothing generates one from the other, and nothing asserts they stay in sync at compile time or runtime. `JSON.parse(result.response.text()) as T` is a type **assertion**, not a type **check**: if Gemini's schema enforcement ever produced a shape that satisfies its own `Schema` object but not the hand-written TS `interface` (e.g. an enum drift, or a field present in one but not the other), TypeScript would not catch it, and neither would any runtime code — **no Zod, no `io-ts`, no manual field-presence check exists anywhere in `lib/*.ts`** (grep-verified: zero `zod`/`safeParse` hits outside the archived Python prototype's Pydantic use).

`lib/api-contracts/v1/*.ts` (`company.ts`, `sector.ts`, `sectorThesis.ts`) is a **separate, smaller layer** — public-API response DTOs (`CompanyResponseV1`, etc.) that reshape the internal `Analysis` entity into a stable external wire format for `lib/public-api/`. It is not the extraction-schema layer; it sits downstream of it, mapping already-validated-by-Gemini fields into camelCase public types.

**What happens on a malformed response**: there is no malformed-response handling beyond a blanket `try/catch` per agent. `JSON.parse()` itself could throw (e.g. if `responseSchema` enforcement is bypassed by a truncated/MAX_TOKENS-cut response, which the SDK's JSON mode does not fully guard against) — and every agent-level caller (`runThematicAgent`, `runEvasivenessAgent`, `runTemporalDelta`, `runEarningsDeltaAgent`, `runFCFImplicationsAgent`, `runKeyMetricsAgent`, all in `lib/pipeline.ts`) wraps its call in `try { ... } catch (e) { console.error(...); return null / default }`. There is no distinction between "Gemini API error," "timeout," and "malformed JSON" — all three collapse into the same catch block and the same degraded fallback. **PARTIALLY IMPLEMENTED**: failure is caught and doesn't crash the pipeline, but there's no retry-on-malformed-JSON, no schema-repair pass, and no visibility into which failure mode actually occurred beyond a server log line.

**Archived prototype contrast**: `finance-agent/multiagent_analysis/config.py:34-63` (`invoke_structured`) does the **same thing better** — it accepts a Pydantic `BaseModel` subclass as `schema` and calls `schema.model_validate(data)` after `json.loads(raw)`, which is genuine second-layer runtime validation (Pydantic will raise on a type mismatch that satisfied Gemini's schema but not the Python model). Production has no equivalent.

---

## 7. Output Validation, Hallucination Controls, Confidence Scoring, Grounding, Source Attribution

Searched specifically for each of these — results are mixed, and stated plainly rather than assumed:

- **Prompt-level anti-hallucination instructions**: **IMPLEMENTED**, but only as prose, not code. Nearly every system prompt in `lib/pipeline.ts`, `lib/solo-pipeline.ts`, and `lib/insights-pipeline.ts` contains an instruction like "Extract VERBATIM quotes (do NOT paraphrase)" or "Never fabricate data" or "Do NOT make up data not in the briefs" (`SYNTHESIS_SYSTEM`, `lib/insights-pipeline.ts:244`). This is a request to the model, not an enforced constraint — nothing checks that a `quote_old`/`quote_new` field actually appears verbatim in the source transcript.
- **Deterministic (non-LLM) validation**: **IMPLEMENTED**, and correctly self-labeled in `TECHNICAL_ARCHITECTURE.md` §4a as "Phase 5 — Local Validation (no LLM)." `localValidation()` (`lib/pipeline.ts:631-658`) is a pure consistency check: if `signal_classification === "Positive"` but `signal_score < 0` (or the negative/positive mirror), it marks that metric `validation_status: "flagged"` and increments a counter; `validationScore = (total - flagged) / total * 100`. This catches **internal self-contradiction** in the model's own output (it said "Positive" and gave a negative number), not factual accuracy against the source transcript. It cannot detect a confidently wrong-but-internally-consistent extraction.
- **Confidence scoring**: **NOT IMPLEMENTED** as a genuine model-reported confidence. `executive_evasiveness_score` and `signal_score` are extraction *outputs* (the model's judgment on a 0-10/−10..+10 scale), not calibrated confidence in the extraction's own correctness. No field anywhere asks Gemini "how confident are you in this extraction" or derives confidence from token log-probabilities (the SDK call sites never request `logprobs`).
- **Market-alignment cross-check**: **IMPLEMENTED** as a weak external grounding signal — `computeMarketAlignment()` (`lib/pipeline.ts:725-755`) compares each metric's `signal_classification` against the ticker's actual quarter-over-quarter stock price move (fetched from Yahoo Finance, `fetchStockPriceChange`, lines 696-722) and tags each metric `aligned`/`divergent`/`unclear`. This is a genuinely interesting grounding mechanism — it's the one place production checks an LLM claim against a real external data point — but it validates *sentiment direction*, not factual content, and a stock can move for reasons unrelated to the specific claim being checked.
- **Source attribution**: **IMPLIED-ARCHITECTURALLY-PREPARED, NOT IMPLEMENTED**. `DashboardPayload.market_sources: string[]` exists as a schema field (`lib/pipeline.ts:75`) but `runPipeline()`'s return statement hardcodes `market_sources: []` (line 876) — always empty, dead field. Quotes (`quote_old`/`quote_new`) do carry section provenance implicitly (they're grouped under a `section_name`), but there is no page number, no character offset into the source PDF, and no link back to the exact transcript excerpt the model used.
- **Grounding via web search**: **NOT IMPLEMENTED in production.** It exists **only in the archived prototype**: `finance-agent/multiagent_analysis/config.py:66-90` (`invoke_grounded`) wires Gemini's native `types.Tool(google_search=types.GoogleSearch())` grounding tool and returns `(response_text, source_urls)` from `groundingMetadata` — genuine web-grounded generation with citations. Nothing resembling this (Google Search grounding, or any retrieval-augmented grounding) exists in `lib/pipeline.ts` or any production file.

**Bottom line for this section, stated plainly**: production has exactly two automated checks on LLM output — an internal signal/score self-consistency check, and an external stock-price directional cross-check. There is **no factuality/grounding check against the source PDF itself** — nothing verifies a "verbatim" quote is actually verbatim.

---

## 8. Token Management, Latency Management, Cost Management

- **Token counting**: **NOT IMPLEMENTED.** `grep -rn "usageMetadata\|promptTokenCount\|candidatesTokenCount\|totalTokenCount"` across `lib/`, `app/`, and `finance-agent/` returns **zero matches**. The Gemini SDK response object (`result.response`) does carry a `usageMetadata` field with actual token counts, but the code never reads it. `TECHNICAL_ARCHITECTURE.md` §9's cost table ("~600K input tokens... ~$0.03") is a **static estimate written into documentation**, not a number derived from any runtime accounting — there is no code path that measures actual tokens consumed and logs or bills against it.
- **Cost management**: **PARTIALLY IMPLEMENTED**, and importantly, **decoupled from actual model usage**. `lib/credits.ts` implements a flat per-*action* credit charge — `ACTION_COSTS = { delta: 3, solo: 1, insights: 4 }` (lines 15-19), each credit worth $0.01, deducted once per pipeline invocation regardless of transcript length, number of thematic sections that actually ran, or whether any individual agent silently failed and returned a null/degraded result. A 3-page transcript and a 3-hour-conglomerate 120K-char transcript both cost the user exactly 3 credits for Delta Analysis. This is a **fixed-price product gate**, not a metering system — it protects Quantalyze's margin against *volume* of requests, not against *actual Gemini spend per request*, which can vary meaningfully given the variable transcript sizes and variable agent counts (Phase 3's delta calls run "up to 5," not always 5, per `TECHNICAL_ARCHITECTURE.md` §4a).
- **Latency management**: **IMPLEMENTED**, via timeouts and parallelism, not caching-of-partial-work or speculative execution. Per-call timeouts are enforced with `Promise.race([model.generateContent(...), timeout])` in every pipeline file (e.g. `lib/pipeline.ts:209-213`); differing per pipeline (25s for the high-fan-out Delta pipeline's individual agents, 55s for the single/few-call Solo and Insights pipelines, 22s for the lighter Sector Narrative call). A second, pipeline-wide timeout (`PIPELINE_TIMEOUT_MS = 270_000`, `app/api/v1/analyze/route.ts:96`) races the whole `runPipeline()` call against Vercel's 300s `maxDuration` (`export const maxDuration = 300`, same file, line 8), explicitly to "fire 30s before Vercel kill → sends proper error event" (matching `TECHNICAL_ARCHITECTURE.md` §10's stated rationale, and confirmed correct in code). Parallelism (Promise.all fan-out, §10 below) is the primary latency lever — 10 thematic Gemini calls run concurrently rather than serially, which the code comments and `TECHNICAL_ARCHITECTURE.md` both frame as the reason for choosing 5 domain-specialist agents over 1 comprehensive call ("wall-clock ~15-25s vs ~120s").

---

## 9. Caching — genuine AI-response caching, not just persistence

**IMPLEMENTED**, and it is real cost/latency-saving cache-before-call logic, not merely "we happen to persist results to Postgres." Traced end-to-end in `app/api/v1/analyze/route.ts:52-74`:

```ts
// app/api/v1/analyze/route.ts:52-74
const cached = force ? null : await analysisRepo.getCachedAnalysis(tickerUp, q_prev, q_curr);
if (cached) {
  console.log(`[Cache] HIT for ${tickerUp} ${q_prev}→${q_curr}`);
  // ...stream a single "done" NDJSON line and close — runPipeline() is never called
}
// ── Credit check (only on cache miss — cache hits are free) ───────────────
const { allowed, remaining } = await checkAndDeduct(userId, "delta");
```

Two things make this genuine LLM-cost caching rather than incidental persistence:
1. On a cache hit, **`runPipeline()` is never invoked at all** — zero Gemini calls happen, confirmed by the code path returning before the credit-check block, let alone the pipeline call.
2. **Credits are only deducted on a cache miss** (comment: `"cache hits are free"`) — the caching layer is explicitly wired into the cost model, not just a read-through convenience.

The cache-validity check itself lives in `lib/repositories/analysis.ts:136-159` (`SupabaseAnalysisRepository.getCachedAnalysis`) / `lib/repositories/analysis.ts:288-306` (the parallel `PostgresAnalysisRepository` implementation — production runs the Postgres one per `lib/repositories/index.ts:14`, `export const analysisRepo = new PostgresAnalysisRepository()`). Both implementations reject a cached row that is structurally suspect before returning it — this is the "Analysis cache validation" `TECHNICAL_ARCHITECTURE.md` §7 refers to (that doc names a file `lib/analysis-cache.ts` that doesn't exist in this codebase; the logic actually lives inline in `lib/repositories/analysis.ts`):

```ts
// lib/repositories/analysis.ts:155-156
if (!Array.isArray(raw.insights) || raw.insights.length === 0) return null;
if (strict && !Array.isArray(raw.earnings_delta)) return null;
```

Same cache-before-call pattern is repeated for the other two pipelines:
- **Deep Dive** (`lib/solo-pipeline.ts:147-151`): `if (!options?.force) { const cached = await getCached(ticker, quarter); if (cached) return { payload: cached, id: "cached" }; }` — checked before PDF download even happens.
- **Multi-Quarter Insights** (`lib/insights-pipeline.ts:386-398`): same pattern, plus a **30-day TTL** (`CACHE_TTL_DAYS = 30`, line 253) passed into the repository query — the only one of the three caches with a real expiry rather than "permanent until manually invalidated" (matching `TECHNICAL_ARCHITECTURE.md` §7's table).

**Cache write is fire-and-forget for Insights** specifically: `setCachedInsights(...).catch((e) => console.warn(...))` (`lib/insights-pipeline.ts:432-434`) — a cache-write failure never fails the user-facing request, but also silently means the next identical request re-runs the full N+1 Gemini calls instead of hitting cache.

---

## 10. Streaming — progress-per-agent-completion NDJSON, not token-level streaming

**Verified precisely, because the distinction matters**: **this is NOT token-by-token LLM streaming.** Gemini is called with `model.generateContent(...)` (non-streaming) in every single call site across all pipeline files — none use `generateContentStream`. Each Gemini call blocks until it returns a complete JSON object; there is no partial-token forwarding to the client at any point.

What actually streams is **coarse pipeline progress, one NDJSON line per completed agent/phase**, sent over a `ReadableStream` from the Next.js Route Handler. The mechanism, traced end to end:

```ts
// app/api/v1/analyze/route.ts:88-119 (abbreviated)
const stream = new ReadableStream({
  async start(controller) {
    let closed = false;
    const send = (data: object) => {
      if (closed) return;
      try { controller.enqueue(encoder.encode(JSON.stringify(data) + "\n")); }
      catch { closed = true; }
    };
    const timeout = setTimeout(() => { send({ type: "error", ... }); closed = true; controller.close(); }, PIPELINE_TIMEOUT_MS);
    try {
      const payload = await runPipeline(qPrevKey, qCurrKey, send);   // ← `send` is the onProgress callback
      const savedId = await analysisRepo.saveAnalysis(...);
      send({ type: "done", payload, id: savedId });
    } catch (e) { send({ type: "error", detail: ... }); }
    finally { clearTimeout(timeout); if (!closed) controller.close(); }
  },
});
return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", ... } });
```

`runPipeline`'s `onProgress` callback (`ProgressCallback` type, `lib/pipeline.ts:15-22`) is invoked at exactly five granularities, each firing only after a full agent call has already returned its complete parsed JSON:

```ts
export type ProgressEvent =
  | { type: "start"; sections: string[] }
  | { type: "thematic_done"; section: string; which: "prev" | "curr" }   // fires 10x, once per completed agent
  | { type: "evasiveness_done"; score: number }                          // fires once, with the final score already computed
  | { type: "delta_done"; section: string }                              // fires up to 5x
  | { type: "stock_done"; stockPriceChange: number };
```

Each `.then((r) => { onProgress?.({ type: "thematic_done", ... }); return r; })` chained onto a `runThematicAgent(...)` call (`lib/pipeline.ts:789-792` etc.) fires the progress event **after** that agent's Gemini call has fully resolved and its JSON has been parsed — the event carries only a section name/label, never a content fragment. The client (`lib/api.ts`, per `TECHNICAL_ARCHITECTURE.md` §6) reads this to animate a progress UI ("Revenue & Growth: done," "Margins & Profitability: done," ...) — it is progress telemetry, not content delivery. The actual analysis content — every `key_takeaways`, every `quote_old`/`quote_new` — only reaches the client in the single final `{ type: "done", payload, id }` line, after the entire pipeline (all ~19 Gemini calls) has finished.

**Interview-credibility summary**: "streaming" in this product means *"the UI can show which of ~19 sequential/parallel Gemini calls have completed,"* not *"the user watches text appear as the model generates it."* This is an accurate and reasonable architecture choice for a multi-agent pipeline (there's no single generation stream to tap — the useful unit of progress genuinely is "agent N finished"), but it should never be described to an interviewer as token-level LLM streaming.

**Safety mechanisms** (matching `TECHNICAL_ARCHITECTURE.md` §6, confirmed in code): the `closed` boolean guards `controller.enqueue` after a timeout or client disconnect (`send()`'s `if (closed) return`, plus the `catch { closed = true }` around `enqueue` itself for a broken pipe); the 270s pipeline timeout races 30s ahead of Vercel's 300s hard kill specifically so an error event reaches the client instead of a silent stream truncation.

---

## 11. Asynchronous Execution — `Promise.all` fan-out, no retries, degrade-by-null

**IMPLEMENTED as parallel fan-out with per-agent graceful degradation — not retries, not `Promise.allSettled`.** Every parallel batch in `lib/pipeline.ts` uses `Promise.all`, never `Promise.allSettled` — this works safely here only because **each individual agent function already catches its own errors internally** and resolves to `null` (or a typed default) rather than rejecting, so the outer `Promise.all` never actually sees a rejection from an agent call:

```ts
// lib/pipeline.ts:463-474
async function runThematicAgent(...): Promise<QuarterSnapshot | null> {
  try {
    const result = await invokeStructured<QuarterSnapshot>(systemPrompt, userPrompt, QUARTER_SNAPSHOT_SCHEMA);
    result.section_name = sectionName;
    return result;
  } catch (e) {
    console.error(`[${sectionName}] Agent failed:`, e);
    return null;                       // ← swallowed, not rethrown
  }
}
```

The same catch-and-degrade pattern repeats in `runTemporalDelta` (→ `null`), `runEarningsDeltaAgent`/`runFCFImplicationsAgent` (→ `[]`), `runKeyMetricsAgent` (→ `{}`), and `runEvasivenessAgent` (→ a hardcoded fallback score of `5.0`, line 491 — a "moderate deflection" default, not a signal of failure, meaning a timed-out evasiveness call is indistinguishable downstream from a genuinely moderate reading). Phase 2's fan-out (`lib/pipeline.ts:786-807`) then filters: `snapshotsPrevRaw.filter((s): s is QuarterSnapshot => s !== null)` (line 809) — nulls are dropped, and the pipeline log even reports the survival rate: `console.log(`[Pipeline] Thematic agents done: prev=${snapshotsPrev.length}/4 curr=${snapshotsCurr.length}/4`)` (line 815; note this log message's hardcoded `/4` is itself stale — see §13).

**What happens if one of the parallel Gemini calls fails or times out**, traced precisely: the 25s `AGENT_TIMEOUT_MS` (`lib/pipeline.ts:189`) races each `model.generateContent()` call via `Promise.race`; on timeout the race rejects with `Error("Gemini agent timed out")`, which is caught by that agent's own try/catch, logged, and converted to `null`/default — **the other 9 parallel calls in that `Promise.all` batch are unaffected and continue running to completion.** A single failed section is simply absent from the final `insights` array (and, transitively, absent from Phase 3's temporal-delta comparison for that section, since `runTemporalDelta` is only invoked `for each section where both prev+curr succeeded` — if the "Macro & Risk" thematic call fails for either quarter, that section is silently dropped from the whole delta output, not retried, not flagged to the end user beyond a lower implicit signal count).

**No retries exist anywhere in the production TypeScript pipelines.** `grep -rniE "retry|retries|backoff|maxRetries"` across `lib/*.ts` and `app/api/**` returns only one unrelated hit (`app/api/v1/concall/route.ts:120`, a `?retry=true` query param that skips a *YouTube-link* cache, unrelated to LLM calls). Compare this to the archived prototype, which does implement retries: `finance-agent/core/llm.py:21-48`'s `call_gemini()` takes a `max_retries=3` parameter and retries with exponential backoff (`time.sleep(2 ** attempt)`) on any exception. **Production chose graceful-degradation-via-null over retry-on-failure; the archived prototype chose retry-with-backoff.** Neither approach distinguishes a transient error (rate limit, network blip — worth retrying) from a permanent one (malformed prompt, content-policy block — retrying is pointless); production's approach is arguably the safer default for a 25s-budget fan-out (a retry would blow the per-agent timeout anyway), but it does mean a single transient Gemini hiccup permanently loses that section's data for the run, with no automatic recovery.

**One important asymmetry**: Phase 1's PDF extraction (`lib/pipeline.ts:777-780`, `Promise.all([extractPdfText(qPrevKey), extractPdfText(qCurrKey)])`) is **not** individually try/caught the way agent calls are — if either PDF fails to parse (corrupt file, empty buffer, non-PDF header — all explicitly checked and thrown in `extractPdfText`, lines 246-265), the `Promise.all` rejects and propagates all the way up through `runPipeline()` to the route handler's outer `try/catch` (`app/api/v1/analyze/route.ts:104-112`), which sends a single `{ type: "error" }` NDJSON line and aborts the entire run — **no partial results are salvaged from a PDF-level failure**, unlike an agent-level failure which degrades gracefully. Fetching the stock price (`fetchStockPriceChange`, `lib/pipeline.ts:696-722`) follows the null-pipeline agents' pattern too — it self-catches and returns `0` on any fetch error, never blocking Phase 4's `Promise.all`.

`lib/insights-pipeline.ts` mirrors the same architecture: per-quarter brief agents (`runQuarterBriefAgent`) and the synthesis agent (`runSynthesisAgent`) both self-catch to typed fallback objects rather than rejecting, and are fanned out with plain `Promise.all` (lines 411-418).

**INTERVIEW**: "Why does the pipeline use `Promise.all` with internal try/catch instead of `Promise.allSettled`, and is that a meaningful difference here?" (Answer: functionally near-equivalent given every agent already resolves rather than rejects, but `Promise.allSettled` would be the more defensive/idiomatic choice if a future agent function forgot its own try/catch — right now correctness depends on every single agent function remembering to swallow its own errors, a convention enforced by code review, not by the type system or the fan-out mechanism itself.)

---

## 12. Model Routing / Multiple Models

**NOT IMPLEMENTED** in production. Every production call site uses the exact same string `"gemini-2.5-flash-lite"` (§2 table) — there is no cheaper/faster model used for any lighter-weight stage (e.g. the single-field evasiveness score or the short sector-narrative call both still invoke the full model), and no more-capable model used for any harder stage. The only variation across call sites is `temperature` (0 vs 0.1, §2) — not model selection. `TECHNICAL_ARCHITECTURE.md`'s "Why Gemini 2.5 Flash Lite" rationale (§10 of that doc) is applied uniformly, with no per-task model tiering.

The **archived prototype** shows a different (older) model string throughout — `"gemini-2.0-flash"` — consistently in `finance-agent/vertex.py:33`, `finance-agent/core/llm.py:6`, `finance-agent/multiagent_analysis/config.py:37,74`, `finance-agent/disclosure_pipeline/src/analyzer.py:120`, `finance-agent/disclosure_pipeline/src/judge_evaluator.py:39`, and `finance-agent/disclosure_pipeline/src/semantic_extraction.py:139` — plus a separate **embedding model**, `"models/gemini-embedding-001"` (`finance-agent/core/embeddings.py:35`), which is a genuine second model in the pipeline (used only for vector search, never for generation) — the closest thing to "model routing" anywhere in this codebase, and it's archived, not live.

---

## 13. A note on `TECHNICAL_ARCHITECTURE.md` vs. the actual `lib/pipeline.ts` — worth flagging directly

The **file header comment inside `lib/pipeline.ts` itself is stale** relative to the code beneath it:

```ts
// lib/pipeline.ts:1-5
/**
 * Multi-agent earnings transcript pipeline — TypeScript port of the Python pipeline.
 * Runs 8 parallel Gemini calls (4 thematic agents × 2 quarters) + evasiveness,
 * then 4 temporal delta comparisons, then local validation.
 */
```

The actual `AGENT_PROMPTS` object (lines 281-364) defines **5** thematic agents, not 4 (`"Revenue & Growth"`, `"Margins & Profitability"`, `"Cost Structure"`, `"CapEx & Balance Sheet"`, `"Macro & Risk"`) — meaning **10** parallel thematic calls (5 × 2 quarters), not 8, and up to **5** temporal delta comparisons, not 4. `TECHNICAL_ARCHITECTURE.md` §4a gets this right (it lists all 5 sections and says "11 calls" for Phase 2 including evasiveness, and "up to 5 calls" for Phase 3) — so the top-level architecture doc is more accurate here than the source file's own docstring, which reads like an artifact of an earlier 4-agent version that was never updated after a 5th agent (CapEx & Balance Sheet, or Macro & Risk) was added. This is a small thing, but a very typical real-world finding: **stale comments inside the source are a worse ground truth than a maintained architecture doc**, and an engineer should always verify against the executable code (`Object.keys(AGENT_PROMPTS).length === 5`), not the comment above it.

A second minor doc-arithmetic issue: `TECHNICAL_ARCHITECTURE.md` §4a's "Total Gemini calls" line reads "11 (thematic) + 1 (evasiveness) + 5 (delta) + 3 (synthesis) = ~20 calls" — but the Phase 2 diagram immediately above it already counts evasiveness inside its own "11 calls" total, so the "+1 (evasiveness)" in the sum double-counts. The correct count from code is 10 thematic + 1 evasiveness + up to 5 delta + 3 synthesis (earnings-delta, FCF-implications, key-metrics) = **~19 Gemini calls**, plus one non-Gemini stock-price fetch — close to the doc's "~20," but the doc's own addition doesn't reconcile with its own diagram.

---

## Archived Prototype: Vector Search / Embeddings / RAG / LLM-as-Judge

Everything in this section is **IMPLEMENTED-BUT-ARCHIVED / PROTOTYPE-ONLY**, under `finance-agent/`. None of it is reachable from the live Next.js app — confirmed by grep finding zero imports of `finance-agent/*` anywhere under `lib/` or `app/`. Explicitly **absent from production**: no vector index, no embeddings, no chunking/reranking, no retrieval step of any kind — production's "context construction" (§5) is pure string truncation of a single transcript, never a search over an indexed corpus.

### Vector search & embeddings (`finance-agent/core/vector.py`, `core/embeddings.py`)

**This is genuine RAG** — retrieval, augmentation, and generation are all present and traceable, so the label is earned here (unlike anywhere in production):

- **Retrieval**: `finance-agent/core/vector.py` wraps a `faiss.IndexFlatL2` — a brute-force exact L2-distance FAISS index (`INDEX_PATH = "data/processed/finance.index"`). `search(query, k=5)` (lines 53-61) embeds the query, does `index.search(...)`, and returns the top-k metadata records (`{"source": ..., "text": ...}`).
- **Embeddings**: `finance-agent/core/embeddings.py`'s `embed()` (lines 13-44) calls Gemini's embedding endpoint, `client.models.embed_content(model="models/gemini-embedding-001", contents=batch)`, batched 100-at-a-time, with a **plain in-process dict cache** keyed by exact text string (`_embed_cache = {}`, line 10) — an exact-match cache, not a semantic one; re-embedding is skipped only for byte-identical strings seen before in this process's lifetime.
- **Chunking**: **NOT IMPLEMENTED as a distinct step** — no sentence/token-window chunker exists in `core/`; whatever text unit gets passed to `add(texts, sources)` (`core/vector.py:38-51`) is embedded and indexed as-is. Chunking, if it happens, happens upstream in the ingestion tooling (`finance-agent/tools/ingest.py`, not read in this pass) rather than in the vector-store module itself.
- **Reranking**: **NOT IMPLEMENTED** — `search()` returns FAISS's raw L2-nearest results directly; no cross-encoder or LLM-based reranking pass exists anywhere in `finance-agent/`.
- **Metadata filtering**: **NOT IMPLEMENTED** at the vector-search layer — `search()` takes only `query` and `k`, no company/date/source filter param; FAISS's `IndexFlatL2` here is unfiltered brute-force over the whole corpus every time.
- **A parallel, non-vector "structured fact" retrieval path**: `finance-agent/core/financial_memory.py` is a second, independent retrieval mechanism — a flat JSON fact store (`data/processed/financial_facts.json`) with an in-memory company-name-alias index (`COMPANY_ALIASES`, lines 13-64, hand-mapping variants like `"msft"`/`"microsoft corp"` → canonical `"Microsoft"`) for **exact structured lookup** (`get_facts_for_companies`), not similarity search. This is retrieval too, but keyword/exact-match retrieval, not embedding-based.
- **Augmentation + generation**: `finance-agent/agents/financial_agent.py:analyze_financials()` (lines 7-49) is where retrieval output actually gets injected into a prompt — the clearest, most complete RAG example in the whole codebase:

  ```python
  # finance-agent/agents/financial_agent.py:12-49 (abbreviated)
  facts = get_facts_for_companies(companies)          # structured retrieval
  facts_context = compact_facts(facts)
  search_results = search_financials(query, k=5)       # FAISS vector retrieval
  text_context = "".join(f"Source: {res.get('source')}\nContent: {res.get('text')[:2000]}\n---\n" for res in search_results)
  prompt = f"""...
  1. STRUCTURED FACTS (High precision numbers): {facts_context}
  2. TEXT SEARCH RESULTS (Context and explanations): {text_context}
  Query: {query}
  Instructions: ... Cite your sources (e.g., [Source: _10-K...]). ...
  """
  return call_gemini(prompt)                            # generation
  ```

  Retrieval (both structured-fact and FAISS-vector) → augmentation (both context blocks concatenated into the prompt) → generation (`call_gemini`) — **all three legs present, correctly labeled RAG.** The instruction to "Cite your sources" is prompt-level, not code-enforced (same caveat as production's verbatim-quote instructions, §7).
- **`finance-agent/tools/research.py`** is a stub, not a functioning agent step: `research_query(question)` returns a hardcoded placeholder string ("Research query received: {question}") with a comment "placeholder logic for now" — flagged explicitly so it isn't mistaken for working retrieval-reasoning composition.
- **Web-search grounding (separate from FAISS RAG)**: `finance-agent/multiagent_analysis/config.py:66-90`, `invoke_grounded()`, wires Gemini's native `google_search` tool (`types.Tool(google_search=types.GoogleSearch())`) for freeform grounded generation with `groundingMetadata` source URLs — a second, genuinely different grounding mechanism (live web search vs. a static FAISS corpus), also archived.

### LLM-as-judge / evaluation (`finance-agent/disclosure_pipeline/src/judge_evaluator.py`, `evaluation_report.py`)

**IMPLEMENTED-BUT-ARCHIVED**, and the most sophisticated evaluation code in the whole codebase — genuinely worth walking through even though it never shipped.

`judge_evaluator.py` implements a **4-stage LLM-as-judge harness** using `langchain_google_genai.ChatGoogleGenerativeAI` (model `"gemini-2.0-flash"`, `temperature=0.0` — "Zero temperature for consistent evaluation," line 40) as a separate judge model scoring the disclosure-analysis pipeline's own output:

1. **`validate_extraction`** (lines 73-123) — judges whether extracted PDF-section text is relevant, complete, and clean, returning `{quality_score: 0-100, is_relevant, has_meaningful_content, issues[], reasoning}`.
2. **`validate_change`** (lines 162-215) — given a detected quarter-over-quarter "change" plus the raw source text from both quarters, the judge checks **quote accuracy** ("Verify both quotes actually appear in their respective source texts or are close paraphrases"), **comparability** (are old/new quotes about the same concept), and **description accuracy** — this is exactly the kind of hallucination check production's `localValidation()` (§7) does *not* do: checking the extracted quote against the actual source text, not just internal score consistency.
3. **`validate_signal`** (lines 248-291) — judges whether the pipeline's Positive/Negative/Noise classification for a change is appropriate given the evidence, and can suggest a corrected signal.
4. **`validate_verdict`** (lines 325-380) — judges the final synthesized verdict's coherence, insight quality, and signal alignment against the underlying changes.

**Orchestration**: `run_full_evaluation()` (lines 387-527) fans out **all four stages' worth of judge calls in parallel** via Python's `concurrent.futures.ThreadPoolExecutor(max_workers=8)` (thread-based parallelism, not `asyncio` — a different concurrency primitive than production's `Promise.all`), collects results with `as_completed()`, and computes averaged summary scores per stage plus one blended `overall_accuracy`.

**JSON parsing is fragile and self-admittedly degrades silently**: every judge call extracts JSON from the LLM response via a **regex on raw text**, `re.search(r"\{.*\}", content, re.DOTALL)` (repeated identically at lines 111, 202, 280, 367) — a greedy brace-to-brace regex, not the SDK's own structured-output mode (unlike `multiagent_analysis/config.py`'s `invoke_structured`, judge_evaluator.py does not use Pydantic `responseSchema` enforcement here, despite Pydantic being available in the same codebase). If the regex fails to match, every one of the four stages falls back to a **hardcoded, misleadingly-neutral score** — e.g. `{"quality_score": 50, ..., "reasoning": "Evaluation inconclusive"}` for extraction, or `{"quote_accuracy_score": 70, ..., "reasoning": "Evaluation inconclusive"}` for change validation — meaning a judge-call *parsing failure* silently reports as a middling-but-plausible 50-70% score rather than surfacing as an error, which would corrupt the `overall_accuracy` aggregate without any visible signal that it happened (only a `logger.warning`, easy to miss).

`evaluation_report.py` (283 lines) turns the judge's raw scores into a **human-facing report** in three formats — JSON (`evaluation_report.json`), Markdown (`evaluation_report.md`, with a color/emoji-coded status: ✅ ≥85%, ✓ ≥70%, ⚠️ ≥50%, ❌ <50%), and a colorized terminal summary (`_print_terminal_summary`, ANSI-coded) — including a "Flagged Changes (Score < 70%)" table that surfaces the judge's own reasoning per flagged item. This is a genuinely production-grade evaluation-reporting pattern (the kind of thing a real MLOps eval harness would want), just never wired to run against the live product.

**Is anything like this present in production?** No. `lib/pipeline.ts`'s "Validation Layer" (per `TECHNICAL_ARCHITECTURE.md` §4a, Phase 5) is explicitly `localValidation()` — a **non-LLM, rule-based, self-consistency check only** (§7 above). Production has never had a second model judging the first model's output against source text. This is the single clearest capability gap between the archived prototype and the shipped product: the prototype's judge would have caught fabricated-but-internally-consistent quotes; production's validator structurally cannot.

**Duplication note**: `disclosure-analysis-pipeline/` (top-level, outside `finance-agent/`) is a near-duplicate of `finance-agent/disclosure_pipeline/` — `diff` confirms `analyzer.py`, `parser.py`, `pipeline.py`, and `semantic_extraction.py` exist in both (with differing content, suggesting a fork/copy that diverged), but **`judge_evaluator.py` and `evaluation_report.py` exist only in `finance-agent/disclosure_pipeline/src/`**, not in the top-level `disclosure-analysis-pipeline/` copy — the evaluation harness was not carried over to whichever copy is the more "current" one, whichever that is; both are archived regardless.

---

## Summary Table

| Component | Status | Evidence |
|---|---|---|
| Gemini via `@google/generative-ai` (prod) | IMPLEMENTED | `lib/pipeline.ts:6,183-214` + 4 other files |
| Vertex AI in production | NOT IMPLEMENTED | no `vertexai`/`aiplatform` import anywhere in `lib/`/`app/` |
| "Vertex AI" in archived prototype | NOT IMPLEMENTED (misnamed) | `vertex.py` uses `google.genai`, not `google.cloud.aiplatform`, despite the filename and the requirements.txt dependency |
| Model = gemini-2.5-flash-lite everywhere (prod) | IMPLEMENTED | grep, §2 table |
| Temperature = 0 everywhere (prod) | PARTIALLY IMPLEMENTED | `kpi-extractor.ts`, `sector-narrative.ts` use 0.1 |
| Safety settings tuned | NOT IMPLEMENTED | zero `safetySettings`/`HarmCategory` hits |
| Provider abstraction for LLM | NOT IMPLEMENTED | direct SDK calls in every pipeline file |
| Repository abstraction for storage | IMPLEMENTED | `lib/repositories/*.ts`, dual Supabase/Postgres impls |
| Prompts as separate template files | NOT IMPLEMENTED | all inline template literals |
| Structured output via `responseSchema` | IMPLEMENTED | every pipeline file |
| Secondary schema validation (Zod etc.) | NOT IMPLEMENTED | grep, zero hits in `lib/` |
| Malformed-JSON handling | PARTIALLY IMPLEMENTED | blanket try/catch → null/default, no distinction of failure mode |
| Prompt-level anti-hallucination instructions | IMPLEMENTED (prose only) | every system prompt |
| Code-enforced quote/fact verification | NOT IMPLEMENTED (prod) / IMPLEMENTED-BUT-ARCHIVED | `judge_evaluator.py:validate_change` |
| Confidence scoring | NOT IMPLEMENTED | no logprobs, no calibrated confidence field |
| Market-price grounding cross-check | IMPLEMENTED | `computeMarketAlignment()`, `lib/pipeline.ts:725-755` |
| `market_sources` attribution | IMPLIED-ARCHITECTURALLY-PREPARED, NOT IMPLEMENTED | field exists, always `[]` (`lib/pipeline.ts:876`) |
| Web-search grounding | NOT IMPLEMENTED (prod) / IMPLEMENTED-BUT-ARCHIVED | `multiagent_analysis/config.py:invoke_grounded` |
| Token counting / usage accounting | NOT IMPLEMENTED | zero `usageMetadata` hits anywhere |
| Cost management | PARTIALLY IMPLEMENTED | flat per-action credits, decoupled from actual token spend |
| Latency management (timeouts) | IMPLEMENTED | per-agent + pipeline-level `Promise.race` timeouts |
| AI-response caching (cost/latency) | IMPLEMENTED | cache-before-call in all 3 pipelines; credits only deducted on miss |
| Token-level LLM streaming | NOT IMPLEMENTED | all calls use `generateContent`, none use `generateContentStream` |
| Progress-per-agent NDJSON streaming | IMPLEMENTED | `ProgressCallback` → NDJSON lines, §10 |
| Parallel agent fan-out | IMPLEMENTED | `Promise.all` throughout `lib/pipeline.ts`, `lib/insights-pipeline.ts` |
| Retries on individual agent failure | NOT IMPLEMENTED (prod) / IMPLEMENTED-BUT-ARCHIVED | prod: null-degrade only; `finance-agent/core/llm.py:21` has `max_retries=3` + backoff |
| Pipeline/function-level timeout | IMPLEMENTED | 270s vs. 300s `maxDuration`, `app/api/v1/analyze/route.ts:8,96` |
| Model routing (multiple models per task) | NOT IMPLEMENTED (prod) | single model string everywhere; archived prototype uses a separate embedding model only |
| Vector search / embeddings / RAG | NOT IMPLEMENTED (prod) / IMPLEMENTED-BUT-ARCHIVED | `finance-agent/core/vector.py`, `embeddings.py`, `agents/financial_agent.py` |
| Chunking / reranking / metadata filtering | NOT IMPLEMENTED (archived prototype too) | no chunker, no reranker, unfiltered FAISS `IndexFlatL2` |
| LLM-as-judge evaluation | NOT IMPLEMENTED (prod) / IMPLEMENTED-BUT-ARCHIVED | `judge_evaluator.py`, `evaluation_report.py` |
