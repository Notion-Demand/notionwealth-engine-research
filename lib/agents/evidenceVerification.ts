/**
 * Evidence Verification Agent — Quantalyze's first genuine autonomous agent.
 *
 * Not "an agent" in the inflated sense (a single LLM call with a fancy
 * name). It runs a real observe -> retrieve -> verify -> synthesize ->
 * persist loop, makes its own per-claim decisions about what it can and
 * can't establish from the source transcript, and produces a durable,
 * independently-queryable record of its conclusions (evidence_verifications
 * — see lib/repositories/evidenceVerifications.ts) rather than a paragraph
 * bolted onto a chat response.
 *
 * What it does: takes an already-generated Analysis's earningsDelta bullets
 * (the pipeline's own "what changed vs last quarter" claims) and checks
 * each one against the actual current-quarter transcript via RAG retrieval
 * — i.e. it fact-checks Quantalyze's own prior output against its source
 * material. This is deliberately narrow scope: single-transcript grounding,
 * capped claim count, no cross-quarter or cross-company reasoning.
 *
 * What it does NOT do (explicit, not an oversight):
 *   - It does not re-run or replace the analysis pipeline (lib/pipeline.ts)
 *     — it only checks a subset of that pipeline's already-produced output.
 *   - It does not verify every claim class the pipeline produces (sections,
 *     fcfImplications, keyMetrics) — only earningsDelta, and only the first
 *     MAX_CLAIMS of those. Widening this is future work, not this slice.
 *   - It has no retry/backoff, no cost budget beyond the claim cap, and no
 *     scheduling — it runs once, synchronously, when invoked (via the
 *     verify_company_analysis MCP tool — see lib/mcp/tools/).
 *   - It does not decide whether a claim is TRUE — only whether the source
 *     transcript's retrieved passages support, contradict, or don't settle
 *     it. That distinction is preserved in the "reasoning" field of every
 *     finding rather than collapsed into a confidence score.
 */
import { SchemaType } from "@google/generative-ai";
import type { Schema } from "@google/generative-ai";
import { analysisRepo, evidenceVerificationRepo } from "@/lib/repositories";
import type { SimilarChunk } from "@/lib/repositories/transcriptChunks";
import { ensureTranscriptIngested } from "@/lib/rag/ingest";
import { retrieveSupportingPassages } from "@/lib/rag/retrieve";
import { invokeStructured } from "@/lib/llm/structured";

const AGENT_VERSION = "evidence-verification-v1";
const MODEL_NAME = "gemini-2.5-flash-lite";

// Cost/latency cap — one Gemini call per claim, run synchronously inside an
// MCP tool call. 5 keeps a worst-case run well inside AGENT_TIMEOUT_MS-scale
// budgets; raising this is a deliberate cost decision, not a constant to
// tune casually.
const MAX_CLAIMS = 5;

// ── Domain types (Row <-> these types is owned by evidenceVerifications.ts) ──

export interface EvidenceFinding {
  claim: string;
  status: "supported" | "unsupported" | "uncertain";
  supportingPassages: SimilarChunk[];
  reasoning: string;
}

export interface EvidenceVerificationResult {
  ticker: string;
  quarter: string;
  quarterPrevious: string;
  /** "failed" = every claim's verification call errored (not: the model
   *  concluded "unsupported" — that's a legitimate completed finding). */
  status: "completed" | "partial" | "failed";
  findings: EvidenceFinding[];
  supportedCount: number;
  unsupportedCount: number;
  uncertainCount: number;
  model: string;
  agentVersion: string;
  createdAt: string;
}

export type EvidenceVerificationOutcome =
  | { ok: true; result: EvidenceVerificationResult; persistedId: string }
  | { ok: false; code: "NOT_FOUND"; message: string }
  | { ok: false; code: "NO_CLAIMS"; message: string }
  | { ok: false; code: "INGESTION_FAILED"; message: string };

// ── VERIFY stage ─────────────────────────────────────────────────────────────

const VERIFICATION_SYSTEM = `You are a fact-checking assistant for equity research. You are given one
claim about a company's earnings and a set of passages retrieved from that
company's actual earnings-call transcript for the relevant quarter.

Decide whether the retrieved passages SUPPORT, do not support
(UNSUPPORTED), or don't settle (UNCERTAIN) the claim:
- "supported": the passages contain a specific statement consistent with the claim.
- "unsupported": the passages contain a statement that contradicts the claim.
- "uncertain": the passages are on-topic but don't clearly confirm or contradict the claim, or are off-topic/insufficient.

Base your answer ONLY on the provided passages. Do not use outside
knowledge of the company. Be conservative: prefer "uncertain" over guessing.`;

const VERIFICATION_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    status: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["supported", "unsupported", "uncertain"],
    },
    reasoning: {
      type: SchemaType.STRING,
      description: "One or two sentences citing what in the passages drove the verdict.",
    },
  },
  required: ["status", "reasoning"],
};

export interface Verdict {
  status: "supported" | "unsupported" | "uncertain";
  reasoning: string;
  /** true only when the Gemini call itself errored/timed out — distinct
   *  from the model legitimately returning "uncertain". */
  callFailed: boolean;
}

/** Exported (not just used internally) so the offline evaluation harness
 *  (scripts/evaluate-evidence-verification.ts, lib/eval/) can call the exact
 *  production verification step against a hand-labeled golden set, instead
 *  of re-implementing it — an eval that doesn't exercise the real code path
 *  isn't evaluating anything. */
export async function verifyClaim(
  ticker: string,
  quarter: string,
  claim: string,
  passages: SimilarChunk[]
): Promise<Verdict> {
  if (passages.length === 0) {
    return {
      status: "uncertain",
      reasoning: "No relevant transcript passages were retrieved for this claim.",
      callFailed: false,
    };
  }

  const passagesText = passages
    .map((p, i) => `[Passage ${i + 1}, distance=${p.distance.toFixed(3)}]\n${p.content}`)
    .join("\n\n---\n\n");

  const userPrompt = `Company: ${ticker}
Quarter: ${quarter}

CLAIM: ${claim}

RETRIEVED TRANSCRIPT PASSAGES:
${passagesText}`;

  try {
    const result = await invokeStructured<{ status: Verdict["status"]; reasoning: string }>(
      VERIFICATION_SYSTEM,
      userPrompt,
      VERIFICATION_SCHEMA,
      { modelName: MODEL_NAME }
    );
    return { ...result, callFailed: false };
  } catch (e) {
    return {
      status: "uncertain",
      reasoning: `Verification call failed: ${e instanceof Error ? e.message : String(e)}`,
      callFailed: true,
    };
  }
}

// ── OBSERVE -> RETRIEVE -> VERIFY -> SYNTHESIZE -> PERSIST loop ─────────────

/** The actual agent loop, factored out from MCP wiring so it's independently
 *  testable without an MCP server or transport (same rule getCompanyAnalysis
 *  follows in lib/mcp/tools/getCompanyAnalysis.ts). */
export async function runEvidenceVerificationAgent(rawTicker: string): Promise<EvidenceVerificationOutcome> {
  const ticker = rawTicker.trim().toUpperCase();

  // OBSERVE: what did Quantalyze's own pipeline already conclude?
  const record = await analysisRepo.getLatestByTickerWithMeta(ticker);
  if (!record) {
    return { ok: false, code: "NOT_FOUND", message: `no analysis available for ticker '${ticker}'` };
  }
  const { quarter, quarterPrevious, earningsDelta } = record.analysis;

  const claims = earningsDelta.slice(0, MAX_CLAIMS);
  if (claims.length === 0) {
    return { ok: false, code: "NO_CLAIMS", message: `analysis for '${ticker}' ${quarter} has no earningsDelta claims to verify` };
  }

  // Make sure this transcript is chunked+embedded before retrieval needs it.
  try {
    await ensureTranscriptIngested(ticker, quarter);
  } catch (e) {
    return {
      ok: false,
      code: "INGESTION_FAILED",
      message: `could not ingest transcript for ${ticker} ${quarter}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const findings: EvidenceFinding[] = [];
  let failedCount = 0;

  for (const claim of claims) {
    // RETRIEVE
    let passages: SimilarChunk[];
    try {
      passages = await retrieveSupportingPassages(ticker, quarter, claim);
    } catch (e) {
      failedCount++;
      findings.push({
        claim,
        status: "uncertain",
        supportingPassages: [],
        reasoning: `Retrieval failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    // VERIFY
    const verdict = await verifyClaim(ticker, quarter, claim, passages);
    if (verdict.callFailed) failedCount++;
    findings.push({
      claim,
      status: verdict.status,
      supportingPassages: passages,
      reasoning: verdict.reasoning,
    });
  }

  // SYNTHESIZE
  const supportedCount = findings.filter((f) => f.status === "supported").length;
  const unsupportedCount = findings.filter((f) => f.status === "unsupported").length;
  const uncertainCount = findings.filter((f) => f.status === "uncertain").length;
  const status: EvidenceVerificationResult["status"] =
    failedCount === 0 ? "completed" : failedCount === claims.length ? "failed" : "partial";

  const result: EvidenceVerificationResult = {
    ticker,
    quarter,
    quarterPrevious,
    status,
    findings,
    supportedCount,
    unsupportedCount,
    uncertainCount,
    model: MODEL_NAME,
    agentVersion: AGENT_VERSION,
    createdAt: new Date().toISOString(),
  };

  // PERSIST
  const persistedId = await evidenceVerificationRepo.save(result);

  return { ok: true, result, persistedId };
}
