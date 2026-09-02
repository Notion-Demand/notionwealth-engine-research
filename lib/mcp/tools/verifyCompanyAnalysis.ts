/**
 * verify_company_analysis — the second MCP tool, and the first one backed
 * by an autonomous agent rather than a plain repository read.
 *
 * Unlike get_company_analysis (read-only, zero incremental cost), this tool
 * DOES do work on every call: it runs the Evidence Verification Agent
 * (lib/agents/evidenceVerification.ts), which may ingest a transcript
 * (chunk + embed, if not already cached) and makes one Gemini call per
 * claim it verifies. It is intentionally NOT marked readOnlyHint — it
 * writes a new evidence_verifications row every time it's called, even for
 * the same ticker (no dedup/caching of verification runs in this slice;
 * see AGENT_ARCHITECTURE.md for that as explicit future work, not an
 * oversight).
 *
 * Same shape as getCompanyAnalysis.ts: a pure, independently-testable
 * `run*` function plus exported zod input/output shapes, so this file has
 * no business logic beyond validate input -> call the agent -> shape the
 * MCP envelope -> map outcome codes to structured MCP errors.
 */
import { z } from "zod";
import { runEvidenceVerificationAgent } from "@/lib/agents/evidenceVerification";
import type { McpToolEnvelope } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";

export const verifyCompanyAnalysisInputSchema = {
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .describe("NSE/BSE ticker symbol, e.g. \"RELIANCE\" or \"TCS\". Case-insensitive."),
};

const findingShape = z.object({
  claim: z.string(),
  status: z.enum(["supported", "unsupported", "uncertain"]),
  supportingPassages: z.array(
    z.object({
      chunkIndex: z.number(),
      content: z.string(),
      distance: z.number(),
    })
  ),
  reasoning: z.string(),
});

const verificationDataShape = z.object({
  ticker: z.string(),
  quarter: z.string(),
  quarterPrevious: z.string(),
  status: z.enum(["completed", "partial", "failed"]),
  findings: z.array(findingShape),
  supportedCount: z.number(),
  unsupportedCount: z.number(),
  uncertainCount: z.number(),
  model: z.string(),
  agentVersion: z.string(),
});

const metadataShape = z.object({
  source: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  timestamp: z.string(),
  provenance: z.string(),
  warnings: z.array(z.string()),
});

export const verifyCompanyAnalysisOutputSchema = {
  data: verificationDataShape,
  metadata: metadataShape,
};

export type VerifyCompanyAnalysisResult = McpToolEnvelope<z.infer<typeof verificationDataShape>>;

export type VerifyCompanyAnalysisOutcome =
  | { ok: true; result: VerifyCompanyAnalysisResult }
  | { ok: false; code: "NOT_FOUND" | "NO_CLAIMS" | "INGESTION_FAILED"; message: string };

export async function runVerifyCompanyAnalysis(rawTicker: string): Promise<VerifyCompanyAnalysisOutcome> {
  const outcome = await runEvidenceVerificationAgent(rawTicker);

  if (!outcome.ok) {
    return { ok: false, code: outcome.code, message: outcome.message };
  }

  const { result, persistedId } = outcome;
  const warnings: string[] = [];
  if (result.status !== "completed") {
    warnings.push(
      `verification run status is "${result.status}" — ${result.status === "failed" ? "every" : "at least one"} claim's verification call failed; see individual findings' reasoning`
    );
  }

  const envelope: VerifyCompanyAnalysisResult = {
    data: {
      ticker: result.ticker,
      quarter: result.quarter,
      quarterPrevious: result.quarterPrevious,
      status: result.status,
      findings: result.findings,
      supportedCount: result.supportedCount,
      unsupportedCount: result.unsupportedCount,
      uncertainCount: result.uncertainCount,
      model: result.model,
      agentVersion: result.agentVersion,
    },
    metadata: {
      source: "quantalyze.postgres.evidence_verifications",
      // Real signal: fraction of checked claims the retrieved transcript
      // evidence actually supported. Not populated when there's nothing to
      // divide by (shouldn't happen — NO_CLAIMS is a separate outcome).
      confidence:
        result.findings.length > 0 ? result.supportedCount / result.findings.length : undefined,
      timestamp: nowIso(),
      provenance: `evidence_verifications row ${persistedId}, generated ${result.createdAt}`,
      warnings,
    },
  };

  return { ok: true, result: envelope };
}
