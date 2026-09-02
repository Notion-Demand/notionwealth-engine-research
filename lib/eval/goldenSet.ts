/**
 * Hand-labeled golden set for offline-evaluating the Evidence Verification
 * Agent's VERIFY stage (lib/agents/evidenceVerification.ts's verifyClaim()).
 *
 * Every case is a (claim, retrieved-passage-text, human-assigned expected
 * label) triple, authored to have an unambiguous correct answer — the point
 * of a golden set is that a competent judge (human or model) would not
 * disagree about the label, so a wrong verdict here is evidence of an
 * actual regression (a prompt edit, a model swap, a schema change), not
 * reasonable disagreement. Passages are written to look like real
 * transcript excerpts but are authored fixtures, not taken from a real
 * filing — this eval targets the VERIFY stage in isolation and deliberately
 * does not depend on Postgres, blob storage, or the RAG retrieval step
 * (see RAG_ARCHITECTURE.md/AGENT_ARCHITECTURE.md for what retrieval-quality
 * evaluation would still need to cover — not built in this slice).
 */
import type { SimilarChunk } from "@/lib/repositories/transcriptChunks";

export interface GoldenCase {
  id: string;
  ticker: string;
  quarter: string;
  claim: string;
  passages: SimilarChunk[];
  expectedStatus: "supported" | "unsupported" | "uncertain";
  /** Why this expected label is the unambiguous right answer — kept next to
   *  the case so a future maintainer can judge disagreement, not just count it. */
  note: string;
}

function passage(content: string, distance = 0.12, chunkIndex = 0): SimilarChunk {
  return { chunkIndex, content, distance };
}

export const EVIDENCE_VERIFICATION_GOLDEN_SET: GoldenCase[] = [
  {
    id: "supported-direct-quote",
    ticker: "ACME",
    quarter: "Q2FY26",
    claim: "Revenue grew 12% quarter-over-quarter.",
    passages: [
      passage(
        "Our consolidated revenue for the quarter came in at ₹4,120 crore, up 12% quarter-over-quarter, " +
          "driven primarily by strong volume growth in the retail segment."
      ),
    ],
    expectedStatus: "supported",
    note: "Passage states the exact figure and direction the claim asserts.",
  },
  {
    id: "supported-paraphrased",
    ticker: "ACME",
    quarter: "Q2FY26",
    claim: "EBITDA margins expanded compared to the prior quarter.",
    passages: [
      passage(
        "On profitability, our EBITDA margin improved to 24.3% this quarter from 22.1% last quarter, " +
          "primarily on the back of operating leverage and lower input costs."
      ),
    ],
    expectedStatus: "supported",
    note: "Margin expansion is stated with concrete before/after figures, just not the word 'expanded'.",
  },
  {
    id: "unsupported-direct-contradiction",
    ticker: "ACME",
    quarter: "Q2FY26",
    claim: "The company reported a decline in net profit for the quarter.",
    passages: [
      passage(
        "Net profit for the quarter stood at ₹612 crore, up 18% year-over-year and up 6% sequentially, " +
          "our highest quarterly net profit on record."
      ),
    ],
    expectedStatus: "unsupported",
    note: "Passage explicitly states profit rose, not declined — direct contradiction.",
  },
  {
    id: "unsupported-wrong-direction",
    ticker: "ACME",
    quarter: "Q2FY26",
    claim: "Management guided for lower capex spending next fiscal year.",
    passages: [
      passage(
        "Looking ahead, we are stepping up our capex program meaningfully — we expect capital expenditure " +
          "next fiscal year to be roughly 40% higher than this year as we bring the new manufacturing line online."
      ),
    ],
    expectedStatus: "unsupported",
    note: "Passage guides capex UP, claim asserts guidance for lower capex.",
  },
  {
    id: "uncertain-off-topic-passage",
    ticker: "ACME",
    quarter: "Q2FY26",
    claim: "The company signed a new distribution partnership in Southeast Asia.",
    passages: [
      passage(
        "On the domestic front, we added 42 new retail touchpoints this quarter across tier-2 and tier-3 " +
          "cities, taking our total store count to 1,180."
      ),
    ],
    expectedStatus: "uncertain",
    note: "Passage is about domestic retail expansion, not a Southeast Asia distribution deal — no basis to confirm or deny.",
  },
  {
    id: "uncertain-vague-hedge",
    ticker: "ACME",
    quarter: "Q2FY26",
    claim: "The CFO confirmed the divestment of the packaging division is finalized.",
    passages: [
      passage(
        "On the packaging business, as we've said before, we continue to evaluate strategic alternatives " +
          "and will update the market as and when there is anything concrete to share."
      ),
    ],
    expectedStatus: "uncertain",
    note: "Passage is a deliberate non-answer/hedge — explicitly does not confirm finalization, and doesn't deny it either.",
  },
  {
    id: "uncertain-no-passages-retrieved",
    ticker: "ACME",
    quarter: "Q2FY26",
    claim: "The company announced a new CFO appointment this quarter.",
    passages: [],
    expectedStatus: "uncertain",
    note: "No passages at all — verifyClaim's own no-passages short-circuit should fire without a model call.",
  },
  {
    id: "supported-multi-passage",
    ticker: "ACME",
    quarter: "Q2FY26",
    claim: "Export revenue grew faster than domestic revenue this quarter.",
    passages: [
      passage("Domestic revenue grew 8% quarter-over-quarter to ₹2,900 crore.", 0.1, 0),
      passage(
        "Export revenue was the standout this quarter, growing 21% quarter-over-quarter to ₹1,220 crore " +
          "on strong demand from our European customers.",
        0.11,
        1
      ),
    ],
    expectedStatus: "supported",
    note: "Requires combining two passages (8% domestic vs 21% export) to confirm the comparative claim — tests multi-passage reasoning, not just single-quote matching.",
  },
];
