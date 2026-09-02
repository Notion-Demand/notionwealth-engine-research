import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock every dependency of the agent loop so this test never touches
// Postgres or Gemini — it exercises exactly the observe -> retrieve ->
// verify -> synthesize -> persist contract the agent is built from.
vi.mock("@/lib/repositories", () => ({
  analysisRepo: { getLatestByTickerWithMeta: vi.fn() },
  evidenceVerificationRepo: { save: vi.fn() },
}));
vi.mock("@/lib/rag/ingest", () => ({
  ensureTranscriptIngested: vi.fn(),
}));
vi.mock("@/lib/rag/retrieve", () => ({
  retrieveSupportingPassages: vi.fn(),
}));
vi.mock("@/lib/llm/structured", () => ({
  invokeStructured: vi.fn(),
}));

import { analysisRepo, evidenceVerificationRepo } from "@/lib/repositories";
import { ensureTranscriptIngested } from "@/lib/rag/ingest";
import { retrieveSupportingPassages } from "@/lib/rag/retrieve";
import { invokeStructured } from "@/lib/llm/structured";
import { runEvidenceVerificationAgent } from "@/lib/agents/evidenceVerification";
import type { Analysis } from "@/lib/repositories/analysis";
import type { SimilarChunk } from "@/lib/repositories/transcriptChunks";

const mockedGetLatest = vi.mocked(analysisRepo.getLatestByTickerWithMeta);
const mockedSave = vi.mocked(evidenceVerificationRepo.save);
const mockedIngest = vi.mocked(ensureTranscriptIngested);
const mockedRetrieve = vi.mocked(retrieveSupportingPassages);
const mockedInvoke = vi.mocked(invokeStructured);

function makeAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    ticker: "RELIANCE",
    quarter: "Q2FY26",
    quarterPrevious: "Q1FY26",
    evasivenessScore: 2,
    sections: [],
    overallScore: 78,
    overallSignal: "Positive",
    summary: "Strong quarter.",
    validationScore: 92,
    flaggedCount: 0,
    marketAlignmentPct: 80,
    stockPriceChange: 3.2,
    marketSources: [],
    earningsDelta: ["Revenue up 12% QoQ", "Margins expanded 150bps"],
    fcfImplications: [],
    ...overrides,
  };
}

function makePassage(overrides: Partial<SimilarChunk> = {}): SimilarChunk {
  return { chunkIndex: 0, content: "Revenue grew 12% quarter over quarter.", distance: 0.1, ...overrides };
}

describe("runEvidenceVerificationAgent", () => {
  beforeEach(() => {
    mockedGetLatest.mockReset();
    mockedSave.mockReset();
    mockedIngest.mockReset();
    mockedRetrieve.mockReset();
    mockedInvoke.mockReset();
    mockedIngest.mockResolvedValue({ alreadyIngested: true, chunkCount: 0 });
    mockedSave.mockResolvedValue("verification-id-1");
  });

  it("returns NOT_FOUND when there is no analysis for the ticker", async () => {
    mockedGetLatest.mockResolvedValue(null);

    const outcome = await runEvidenceVerificationAgent("NOSUCHTICKER");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("NOT_FOUND");
    expect(mockedIngest).not.toHaveBeenCalled();
  });

  it("returns NO_CLAIMS when the analysis has no earningsDelta bullets", async () => {
    mockedGetLatest.mockResolvedValue({
      analysis: makeAnalysis({ earningsDelta: [] }),
      createdAt: "2026-08-15T10:00:00.000Z",
    });

    const outcome = await runEvidenceVerificationAgent("RELIANCE");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("NO_CLAIMS");
  });

  it("returns INGESTION_FAILED when the transcript can't be ingested", async () => {
    mockedGetLatest.mockResolvedValue({
      analysis: makeAnalysis(),
      createdAt: "2026-08-15T10:00:00.000Z",
    });
    mockedIngest.mockRejectedValue(new Error("PDF not found: RELIANCE Q2FY26"));

    const outcome = await runEvidenceVerificationAgent("RELIANCE");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("INGESTION_FAILED");
      expect(outcome.message).toContain("PDF not found");
    }
    expect(mockedRetrieve).not.toHaveBeenCalled();
  });

  it("produces a completed result when every claim verifies successfully, and persists it", async () => {
    mockedGetLatest.mockResolvedValue({
      analysis: makeAnalysis(),
      createdAt: "2026-08-15T10:00:00.000Z",
    });
    mockedRetrieve.mockResolvedValue([makePassage()]);
    mockedInvoke
      .mockResolvedValueOnce({ status: "supported", reasoning: "Matches the transcript." })
      .mockResolvedValueOnce({ status: "unsupported", reasoning: "Contradicted by the transcript." });

    const outcome = await runEvidenceVerificationAgent("reliance");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe("completed");
    expect(outcome.result.ticker).toBe("RELIANCE"); // normalized
    expect(outcome.result.findings).toHaveLength(2);
    expect(outcome.result.supportedCount).toBe(1);
    expect(outcome.result.unsupportedCount).toBe(1);
    expect(outcome.result.uncertainCount).toBe(0);
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(outcome.persistedId).toBe("verification-id-1");
  });

  it("marks a claim uncertain without calling Gemini when no passages are retrieved", async () => {
    mockedGetLatest.mockResolvedValue({
      analysis: makeAnalysis({ earningsDelta: ["Some unverifiable claim"] }),
      createdAt: "2026-08-15T10:00:00.000Z",
    });
    mockedRetrieve.mockResolvedValue([]);

    const outcome = await runEvidenceVerificationAgent("RELIANCE");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.findings[0].status).toBe("uncertain");
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(outcome.result.status).toBe("completed"); // a legitimate "uncertain" isn't a failure
  });

  it("returns status 'partial' when some but not all verification calls fail", async () => {
    mockedGetLatest.mockResolvedValue({
      analysis: makeAnalysis(),
      createdAt: "2026-08-15T10:00:00.000Z",
    });
    mockedRetrieve.mockResolvedValue([makePassage()]);
    mockedInvoke
      .mockResolvedValueOnce({ status: "supported", reasoning: "ok" })
      .mockRejectedValueOnce(new Error("Gemini call timed out"));

    const outcome = await runEvidenceVerificationAgent("RELIANCE");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe("partial");
    expect(outcome.result.findings[1].status).toBe("uncertain");
    expect(outcome.result.findings[1].reasoning).toContain("Verification call failed");
  });

  it("returns status 'failed' when every verification call fails", async () => {
    mockedGetLatest.mockResolvedValue({
      analysis: makeAnalysis({ earningsDelta: ["Claim A", "Claim B"] }),
      createdAt: "2026-08-15T10:00:00.000Z",
    });
    mockedRetrieve.mockResolvedValue([makePassage()]);
    mockedInvoke.mockRejectedValue(new Error("Gemini call timed out"));

    const outcome = await runEvidenceVerificationAgent("RELIANCE");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe("failed");
  });

  it("caps verification at the first 5 earningsDelta claims", async () => {
    mockedGetLatest.mockResolvedValue({
      analysis: makeAnalysis({ earningsDelta: ["c1", "c2", "c3", "c4", "c5", "c6", "c7"] }),
      createdAt: "2026-08-15T10:00:00.000Z",
    });
    mockedRetrieve.mockResolvedValue([makePassage()]);
    mockedInvoke.mockResolvedValue({ status: "uncertain", reasoning: "n/a" });

    const outcome = await runEvidenceVerificationAgent("RELIANCE");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.findings).toHaveLength(5);
    expect(mockedRetrieve).toHaveBeenCalledTimes(5);
  });
});
