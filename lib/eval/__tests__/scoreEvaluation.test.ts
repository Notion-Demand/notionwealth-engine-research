import { describe, it, expect } from "vitest";
import { scoreGoldenSet, renderConfusionMatrixMarkdown } from "@/lib/eval/scoreEvaluation";
import type { GoldenCase } from "@/lib/eval/goldenSet";

function makeCase(overrides: Partial<GoldenCase> = {}): GoldenCase {
  return {
    id: "case-1",
    ticker: "ACME",
    quarter: "Q1FY26",
    claim: "Revenue grew.",
    passages: [],
    expectedStatus: "supported",
    note: "test fixture",
    ...overrides,
  };
}

describe("scoreGoldenSet", () => {
  it("scores 100% accuracy when every actual verdict matches the expected label", () => {
    const cases = [makeCase({ id: "a", expectedStatus: "supported" }), makeCase({ id: "b", expectedStatus: "unsupported" })];
    const actuals = new Map([
      ["a", { status: "supported" as const, reasoning: "matches" }],
      ["b", { status: "unsupported" as const, reasoning: "matches" }],
    ]);

    const summary = scoreGoldenSet(cases, actuals);

    expect(summary.total).toBe(2);
    expect(summary.correct).toBe(2);
    expect(summary.accuracy).toBe(1);
    expect(summary.failures).toEqual([]);
  });

  it("computes a fractional accuracy and lists failures separately when some verdicts are wrong", () => {
    const cases = [
      makeCase({ id: "a", expectedStatus: "supported" }),
      makeCase({ id: "b", expectedStatus: "unsupported" }),
      makeCase({ id: "c", expectedStatus: "uncertain" }),
    ];
    const actuals = new Map([
      ["a", { status: "supported" as const, reasoning: "correct" }],
      ["b", { status: "uncertain" as const, reasoning: "wrong: should be unsupported" }],
      ["c", { status: "uncertain" as const, reasoning: "correct" }],
    ]);

    const summary = scoreGoldenSet(cases, actuals);

    expect(summary.accuracy).toBeCloseTo(2 / 3);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].id).toBe("b");
    expect(summary.failures[0].expected).toBe("unsupported");
    expect(summary.failures[0].actual).toBe("uncertain");
  });

  it("builds a confusion matrix that tallies expected-vs-actual pairs, including off-diagonal misses", () => {
    const cases = [
      makeCase({ id: "a", expectedStatus: "unsupported" }),
      makeCase({ id: "b", expectedStatus: "unsupported" }),
    ];
    const actuals = new Map([
      ["a", { status: "uncertain" as const, reasoning: "" }],
      ["b", { status: "unsupported" as const, reasoning: "" }],
    ]);

    const summary = scoreGoldenSet(cases, actuals);

    expect(summary.confusionMatrix.matrix.unsupported.uncertain).toBe(1);
    expect(summary.confusionMatrix.matrix.unsupported.unsupported).toBe(1);
    expect(summary.confusionMatrix.matrix.unsupported.supported).toBe(0);
    expect(summary.confusionMatrix.matrix.supported.supported).toBe(0);
  });

  it("throws rather than silently skipping when a case has no actual verdict provided", () => {
    const cases = [makeCase({ id: "missing" })];
    expect(() => scoreGoldenSet(cases, new Map())).toThrow(/missing/);
  });

  it("returns zero accuracy (not NaN) for an empty case set", () => {
    const summary = scoreGoldenSet([], new Map());
    expect(summary.total).toBe(0);
    expect(summary.accuracy).toBe(0);
  });
});

describe("renderConfusionMatrixMarkdown", () => {
  it("renders a 3x3 markdown table with expected counts in the right cells", () => {
    const cases = [makeCase({ id: "a", expectedStatus: "supported" })];
    const actuals = new Map([["a", { status: "supported" as const, reasoning: "" }]]);
    const summary = scoreGoldenSet(cases, actuals);

    const md = renderConfusionMatrixMarkdown(summary.confusionMatrix);

    expect(md).toContain("expected \\ actual");
    expect(md).toContain("**supported**");
    const supportedRow = md.split("\n").find((line) => line.startsWith("| **supported**"));
    expect(supportedRow).toContain("| 1 |");
  });
});
