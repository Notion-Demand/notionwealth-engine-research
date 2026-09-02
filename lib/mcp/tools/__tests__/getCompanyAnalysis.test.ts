import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the whole repositories module — runGetCompanyAnalysis's only
// dependency — so this test never touches Postgres, and so it exercises
// exactly the contract lib/mcp/tools/getCompanyAnalysis.ts depends on:
// analysisRepo.getLatestByTickerWithMeta().
vi.mock("@/lib/repositories", () => ({
  analysisRepo: { getLatestByTickerWithMeta: vi.fn() },
}));

import { analysisRepo } from "@/lib/repositories";
import {
  runGetCompanyAnalysis,
  getCompanyAnalysisInputSchema,
} from "@/lib/mcp/tools/getCompanyAnalysis";
import type { Analysis } from "@/lib/repositories/analysis";

const mockedGetLatest = vi.mocked(analysisRepo.getLatestByTickerWithMeta);

function makeAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    ticker: "RELIANCE",
    quarter: "Q2FY26",
    quarterPrevious: "Q1FY26",
    evasivenessScore: 2,
    sections: [],
    overallScore: 78,
    overallSignal: "Positive",
    summary: "Strong quarter driven by retail segment growth.",
    validationScore: 92,
    flaggedCount: 0,
    marketAlignmentPct: 80,
    stockPriceChange: 3.2,
    marketSources: [],
    earningsDelta: ["Revenue up 12% QoQ"],
    fcfImplications: [],
    ...overrides,
  };
}

describe("runGetCompanyAnalysis", () => {
  beforeEach(() => {
    mockedGetLatest.mockReset();
  });

  it("returns NOT_FOUND when the repository has no analysis for the ticker", async () => {
    mockedGetLatest.mockResolvedValue(null);

    const outcome = await runGetCompanyAnalysis("NOSUCHTICKER");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("NOT_FOUND");
      expect(outcome.message).toContain("NOSUCHTICKER");
    }
  });

  it("normalizes the ticker (trim + uppercase) before querying the repository", async () => {
    mockedGetLatest.mockResolvedValue(null);

    await runGetCompanyAnalysis("  reliance  ");

    expect(mockedGetLatest).toHaveBeenCalledWith("RELIANCE");
  });

  it("maps a found analysis into the MCP envelope with real provenance and clamped confidence", async () => {
    mockedGetLatest.mockResolvedValue({
      analysis: makeAnalysis({ validationScore: 92, flaggedCount: 0 }),
      createdAt: "2026-08-15T10:00:00.000Z",
    });

    const outcome = await runGetCompanyAnalysis("RELIANCE");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.data.ticker).toBe("RELIANCE");
    expect(outcome.result.data.generatedAt).toBe("2026-08-15T10:00:00.000Z");
    expect(outcome.result.metadata.confidence).toBeCloseTo(0.92);
    expect(outcome.result.metadata.source).toBe("quantalyze.postgres.analysis_results");
    expect(outcome.result.metadata.provenance).toContain("2026-08-15T10:00:00.000Z");
    expect(outcome.result.metadata.warnings).toEqual([]);
  });

  it("surfaces a warning, not a failure, when sections were flagged by local validation", async () => {
    mockedGetLatest.mockResolvedValue({
      analysis: makeAnalysis({ flaggedCount: 2 }),
      createdAt: "2026-08-15T10:00:00.000Z",
    });

    const outcome = await runGetCompanyAnalysis("RELIANCE");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.metadata.warnings).toEqual([
      "2 section(s) flagged by Quantalyze's local validation check",
    ]);
  });

  it("never lets a confidence value escape the [0, 1] range even on unexpected input", async () => {
    mockedGetLatest.mockResolvedValue({
      analysis: makeAnalysis({ validationScore: 150 }), // out-of-range on purpose
      createdAt: "2026-08-15T10:00:00.000Z",
    });

    const outcome = await runGetCompanyAnalysis("RELIANCE");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.metadata.confidence).toBe(1);
  });
});

describe("getCompanyAnalysisInputSchema.ticker", () => {
  it("rejects an empty ticker", () => {
    expect(getCompanyAnalysisInputSchema.ticker.safeParse("").success).toBe(false);
  });

  it("accepts a normal ticker string", () => {
    expect(getCompanyAnalysisInputSchema.ticker.safeParse("TCS").success).toBe(true);
  });

  it("rejects a ticker longer than 20 characters", () => {
    expect(getCompanyAnalysisInputSchema.ticker.safeParse("A".repeat(21)).success).toBe(false);
  });
});
