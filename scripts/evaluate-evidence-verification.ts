/**
 * Offline evaluation harness for the Evidence Verification Agent's VERIFY
 * stage (lib/agents/evidenceVerification.ts's verifyClaim()).
 *
 * This is the live-product evaluation pipeline discussions/12_AI_EVALUATION.md
 * documented as NOT IMPLEMENTED (only an archived, never-wired-in LLM-as-judge
 * existed) — scoped narrowly and honestly, following that file's own §4
 * proposal rather than building something generic:
 *
 *   - It calls the EXACT production verifyClaim() function against a small,
 *     hand-labeled golden set (lib/eval/goldenSet.ts) — not a re-implementation,
 *     so a prompt edit or model swap that breaks real verification also
 *     breaks this eval.
 *   - It reports exact-match accuracy on a closed 3-value label
 *     (supported/unsupported/uncertain) — the cheapest, highest-signal check
 *     per 12_AI_EVALUATION.md §4.2's own reasoning, not a fuzzy judge score.
 *   - It's an opt-in CLI script (`npx tsx scripts/evaluate-evidence-verification.ts`),
 *     run manually or from a scheduled CI job — never on the synchronous
 *     request path, same "evaluation is not a blocking cost on a real user
 *     request" principle 12_AI_EVALUATION.md §4.3 states explicitly.
 *   - It costs one real Gemini call per golden case (currently 7 — one case
 *     has zero passages and is verified as a free no-model-call short-circuit,
 *     see lib/eval/goldenSet.ts) and needs GOOGLE_API_KEY set. No Postgres,
 *     no Azure Blob Storage — this evaluates VERIFY in isolation, not the
 *     full ingest → retrieve → verify path (see "What this does NOT cover" below).
 *
 * Usage:
 *   GOOGLE_API_KEY=... npx tsx scripts/evaluate-evidence-verification.ts
 *
 * Writes a timestamped JSON + Markdown report under eval-reports/ (gitignored
 * — these are run artifacts, not source) and prints a terminal summary.
 *
 * What this does NOT cover (stated explicitly, not implied):
 *   - Retrieval quality (did lib/rag/retrieve.ts fetch the RIGHT passages for
 *     a claim) — this harness hands verifyClaim hand-picked passages
 *     directly, bypassing retrieval entirely. A retrieval-quality eval
 *     (precision/recall of retrieved chunks against a labeled relevant-chunk
 *     set) is real future work, not built here.
 *   - The full agent loop (lib/agents/evidenceVerification.ts's
 *     runEvidenceVerificationAgent) end to end, including ingestion and
 *     persistence — this is VERIFY-stage-only, by design (§4.2's own
 *     "cheapest, highest-signal check first" reasoning).
 *   - Any of the five original analysis pipelines (lib/pipeline.ts and
 *     siblings) — those remain entirely unevaluated, exactly as
 *     12_AI_EVALUATION.md's §0 verdict already stated.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyClaim } from "@/lib/agents/evidenceVerification";
import { EVIDENCE_VERIFICATION_GOLDEN_SET } from "@/lib/eval/goldenSet";
import { scoreGoldenSet, renderConfusionMatrixMarkdown, type VerdictStatus } from "@/lib/eval/scoreEvaluation";

const REPORT_DIR = path.join(process.cwd(), "eval-reports");

async function main() {
  if (!process.env.GOOGLE_API_KEY) {
    console.error("GOOGLE_API_KEY is not set — verifyClaim() needs a real Gemini API key.");
    process.exit(1);
  }

  const cases = EVIDENCE_VERIFICATION_GOLDEN_SET;
  console.log(`=== Evidence Verification Agent — offline eval (${cases.length} golden cases) ===\n`);

  const actuals = new Map<string, { status: VerdictStatus; reasoning: string }>();

  for (const c of cases) {
    process.stdout.write(`  [${c.id}] `);
    try {
      const verdict = await verifyClaim(c.ticker, c.quarter, c.claim, c.passages);
      actuals.set(c.id, { status: verdict.status, reasoning: verdict.reasoning });
      const mark = verdict.status === c.expectedStatus ? "OK  " : "MISS";
      console.log(`${mark} expected=${c.expectedStatus} actual=${verdict.status}${verdict.callFailed ? " (call failed)" : ""}`);
    } catch (e) {
      // A thrown error (not a caught-and-recorded "uncertain") means
      // verifyClaim's own error handling broke, not just a wrong verdict —
      // surface it distinctly rather than silently scoring it as a miss.
      console.error(`ERROR calling verifyClaim for '${c.id}': ${e instanceof Error ? e.message : String(e)}`);
      actuals.set(c.id, { status: "uncertain", reasoning: `harness error: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const summary = scoreGoldenSet(cases, actuals);

  console.log(`\n=== Summary ===`);
  console.log(`Accuracy: ${summary.correct}/${summary.total} (${(summary.accuracy * 100).toFixed(1)}%)`);
  console.log(`\nConfusion matrix (expected \\ actual):`);
  console.log(renderConfusionMatrixMarkdown(summary.confusionMatrix));

  if (summary.failures.length > 0) {
    console.log(`\n=== Failures (${summary.failures.length}) — the part to actually look at ===`);
    for (const f of summary.failures) {
      console.log(`\n[${f.id}] "${f.claim}"`);
      console.log(`  expected: ${f.expected}  actual: ${f.actual}`);
      console.log(`  golden-set note: ${f.note}`);
      console.log(`  model reasoning: ${f.reasoning}`);
    }
  }

  await writeReport(summary, cases.length);
}

async function writeReport(
  summary: Awaited<ReturnType<typeof scoreGoldenSet>>,
  caseCount: number
): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `evidence-verification-${timestamp}.json`);
  const mdPath = path.join(REPORT_DIR, `evidence-verification-${timestamp}.md`);

  await writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf-8");

  const md = [
    `# Evidence Verification Agent — offline eval report`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    `Golden set size: ${caseCount}`,
    ``,
    `## Summary`,
    ``,
    `Accuracy: **${summary.correct}/${summary.total} (${(summary.accuracy * 100).toFixed(1)}%)**`,
    ``,
    `## Confusion matrix (expected \\ actual)`,
    ``,
    renderConfusionMatrixMarkdown(summary.confusionMatrix),
    ``,
    `## Failures (${summary.failures.length})`,
    ``,
    ...(summary.failures.length === 0
      ? ["None — every golden case verdicted correctly."]
      : summary.failures.flatMap((f) => [
          `### ${f.id}`,
          ``,
          `- Claim: "${f.claim}"`,
          `- Expected: \`${f.expected}\`  Actual: \`${f.actual}\``,
          `- Golden-set note: ${f.note}`,
          `- Model reasoning: ${f.reasoning}`,
          ``,
        ])),
  ].join("\n");

  await writeFile(mdPath, md, "utf-8");
  console.log(`\nReport written: ${jsonPath}\n                 ${mdPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
