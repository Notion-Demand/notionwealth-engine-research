/**
 * Pure scoring logic for the Evidence Verification Agent's offline
 * evaluation harness (scripts/evaluate-evidence-verification.ts).
 *
 * Deliberately separated from the script that actually calls Gemini
 * (verifyClaim, live model calls) so this — the part with real logic worth
 * getting right — is independently testable with no network/API-key
 * dependency, same discipline as lib/rag/chunk.ts. This is the direct,
 * scoped implementation of the regression-suite half of the evaluation
 * framework discussions/12_AI_EVALUATION.md §4.2/§4.3 proposed: exact-match
 * accuracy on a closed-label field (here, verifyClaim's three-way
 * supported/unsupported/uncertain status — a closed enum, so exact match is
 * a meaningful, cheap check, unlike free text).
 */
import type { GoldenCase } from "@/lib/eval/goldenSet";

export type VerdictStatus = "supported" | "unsupported" | "uncertain";

export interface CaseResult {
  id: string;
  claim: string;
  expected: VerdictStatus;
  actual: VerdictStatus;
  correct: boolean;
  reasoning: string;
  note: string;
}

export interface ConfusionMatrix {
  // matrix[expected][actual] = count
  matrix: Record<VerdictStatus, Record<VerdictStatus, number>>;
}

export interface EvaluationSummary {
  total: number;
  correct: number;
  accuracy: number; // 0-1
  confusionMatrix: ConfusionMatrix;
  /** Cases the run got wrong — the part an engineer actually needs to act
   *  on, surfaced separately rather than buried in the aggregate, same
   *  "don't only report the aggregate" lesson the archived judge's
   *  evaluation_report.py already got right (12_AI_EVALUATION.md §1.4). */
  failures: CaseResult[];
  results: CaseResult[];
}

const STATUSES: VerdictStatus[] = ["supported", "unsupported", "uncertain"];

function emptyMatrix(): ConfusionMatrix["matrix"] {
  const matrix = {} as ConfusionMatrix["matrix"];
  for (const expected of STATUSES) {
    matrix[expected] = { supported: 0, unsupported: 0, uncertain: 0 };
  }
  return matrix;
}

/** Scores a set of (golden case, actual verdict) pairs into an aggregate
 *  summary. Pure — no I/O, no model calls; takes already-produced verdicts. */
export function scoreGoldenSet(
  cases: GoldenCase[],
  actuals: Map<string, { status: VerdictStatus; reasoning: string }>
): EvaluationSummary {
  const matrix = emptyMatrix();
  const results: CaseResult[] = [];

  for (const c of cases) {
    const actual = actuals.get(c.id);
    if (!actual) {
      throw new Error(`scoreGoldenSet: no actual verdict provided for golden case '${c.id}'`);
    }
    matrix[c.expectedStatus][actual.status] += 1;
    results.push({
      id: c.id,
      claim: c.claim,
      expected: c.expectedStatus,
      actual: actual.status,
      correct: actual.status === c.expectedStatus,
      reasoning: actual.reasoning,
      note: c.note,
    });
  }

  const correct = results.filter((r) => r.correct).length;
  const failures = results.filter((r) => !r.correct);

  return {
    total: results.length,
    correct,
    accuracy: results.length > 0 ? correct / results.length : 0,
    confusionMatrix: { matrix },
    failures,
    results,
  };
}

/** Renders the confusion matrix as a small markdown table — used by both
 *  the terminal summary and the saved report so the two never drift. */
export function renderConfusionMatrixMarkdown(cm: ConfusionMatrix): string {
  const header = `| expected \\ actual | ${STATUSES.join(" | ")} |`;
  const divider = `|---|${STATUSES.map(() => "---").join("|")}|`;
  const rows = STATUSES.map((expected) => {
    const cells = STATUSES.map((actual) => String(cm.matrix[expected][actual]));
    return `| **${expected}** | ${cells.join(" | ")} |`;
  });
  return [header, divider, ...rows].join("\n");
}
