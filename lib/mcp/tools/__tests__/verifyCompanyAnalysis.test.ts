import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/agents/evidenceVerification", () => ({
  runEvidenceVerificationAgent: vi.fn(),
}));

import { runEvidenceVerificationAgent } from "@/lib/agents/evidenceVerification";
import {
  runVerifyCompanyAnalysis,
  verifyCompanyAnalysisInputSchema,
} from "@/lib/mcp/tools/verifyCompanyAnalysis";
import type { EvidenceVerificationResult } from "@/lib/agents/evidenceVerification";

const mockedRunAgent = vi.mocked(runEvidenceVerificationAgent);

function makeResult(overrides: Partial<EvidenceVerificationResult> = {}): EvidenceVerificationResult {
  return {
    ticker: "RELIANCE",
    quarter: "Q2FY26",
    quarterPrevious: "Q1FY26",
    status: "completed",
    findings: [
      {
        claim: "Revenue up 12% QoQ",
        status: "supported",
        supportingPassages: [{ chunkIndex: 0, content: "Revenue grew 12%.", distance: 0.05 }],
        reasoning: "Matches the transcript.",
      },
    ],
    supportedCount: 1,
    unsupportedCount: 0,
    uncertainCount: 0,
    model: "gemini-2.5-flash-lite",
    agentVersion: "evidence-verification-v1",
    createdAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("runVerifyCompanyAnalysis", () => {
  beforeEach(() => {
    mockedRunAgent.mockReset();
  });

  it("passes through a NOT_FOUND outcome from the agent unchanged", async () => {
    mockedRunAgent.mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "no analysis available for ticker 'X'" });

    const outcome = await runVerifyCompanyAnalysis("X");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("NOT_FOUND");
  });

  it("wraps a completed result into the MCP envelope with a real support-rate confidence", async () => {
    mockedRunAgent.mockResolvedValue({ ok: true, result: makeResult(), persistedId: "vid-1" });

    const outcome = await runVerifyCompanyAnalysis("RELIANCE");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.data.status).toBe("completed");
    expect(outcome.result.metadata.confidence).toBeCloseTo(1); // 1/1 supported
    expect(outcome.result.metadata.source).toBe("quantalyze.postgres.evidence_verifications");
    expect(outcome.result.metadata.provenance).toContain("vid-1");
    expect(outcome.result.metadata.warnings).toEqual([]);
  });

  it("surfaces a warning (not a failure) when the run status is partial", async () => {
    mockedRunAgent.mockResolvedValue({
      ok: true,
      result: makeResult({ status: "partial" }),
      persistedId: "vid-2",
    });

    const outcome = await runVerifyCompanyAnalysis("RELIANCE");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.metadata.warnings).toHaveLength(1);
    expect(outcome.result.metadata.warnings[0]).toContain("partial");
  });
});

describe("verifyCompanyAnalysisInputSchema.ticker", () => {
  it("rejects an empty ticker", () => {
    expect(verifyCompanyAnalysisInputSchema.ticker.safeParse("").success).toBe(false);
  });

  it("accepts a normal ticker string", () => {
    expect(verifyCompanyAnalysisInputSchema.ticker.safeParse("TCS").success).toBe(true);
  });
});
