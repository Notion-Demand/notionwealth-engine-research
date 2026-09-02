/**
 * get_company_analysis — the first MCP tool.
 *
 * Adapts Quantalyze's existing "latest analysis for a ticker" domain
 * capability into an MCP tool. Deliberately the least risky capability to
 * expose first:
 *   - read-only (no writes, no state change)
 *   - zero incremental cost (reads an already-cached analysis_results row;
 *     never triggers a Gemini call — see runPipeline() in lib/pipeline.ts
 *     for what a paid-generation tool would need to guard, which is future
 *     work, not this slice)
 *   - already has a REST twin (app/api/public/v1/data/companies/[ticker]/
 *     route.ts) to prove this tool reuses the application layer rather than
 *     duplicating it — same repository call, same DTO shaping.
 *
 * NO business logic lives in this file beyond: validate input, call the
 * repository, shape the MCP envelope, map domain errors to a structured MCP
 * error. Everything else (what "latest analysis" means, how scoring works,
 * what counts as validation) stays owned by lib/repositories/analysis.ts
 * and lib/pipeline.ts, exactly where it already lived.
 */
import { z } from "zod";
import { analysisRepo } from "@/lib/repositories";
import { toCompanyResponseV1 } from "@/lib/api-contracts/v1/company";
import type { McpToolEnvelope } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";

export const getCompanyAnalysisInputSchema = {
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .describe("NSE/BSE ticker symbol, e.g. \"RELIANCE\" or \"TCS\". Case-insensitive."),
};

const keyMetricsShape = z
  .object({
    revenue: z.string().optional(),
    revenueGrowth: z.string().optional(),
    ebitdaMargin: z.string().optional(),
    patGrowth: z.string().optional(),
  })
  .optional();

const companyDataShape = z.object({
  ticker: z.string(),
  quarter: z.string(),
  quarterPrevious: z.string(),
  overallSignal: z.enum(["Positive", "Negative", "Mixed", "Noise"]),
  overallScore: z.number(),
  summary: z.string(),
  keyMetrics: keyMetricsShape,
  earningsDelta: z.array(z.string()),
  generatedAt: z.string(),
});

const metadataShape = z.object({
  source: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  timestamp: z.string(),
  provenance: z.string(),
  warnings: z.array(z.string()),
});

/** registerTool's outputSchema wants a raw shape (object of zod schemas),
 *  not a single z.object() — this is that shape, shared with server.ts. */
export const getCompanyAnalysisOutputSchema = {
  data: companyDataShape,
  metadata: metadataShape,
};

export type GetCompanyAnalysisResult = McpToolEnvelope<z.infer<typeof companyDataShape>>;

export type GetCompanyAnalysisOutcome =
  | { ok: true; result: GetCompanyAnalysisResult }
  | { ok: false; code: "NOT_FOUND"; message: string };

/** The actual capability, factored out from the MCP callback below so it's
 *  independently testable without constructing an MCP server or transport
 *  (rule: every new AI/tool operation must be independently testable). */
export async function runGetCompanyAnalysis(rawTicker: string): Promise<GetCompanyAnalysisOutcome> {
  const ticker = rawTicker.trim().toUpperCase();

  const record = await analysisRepo.getLatestByTickerWithMeta(ticker);
  if (!record) {
    return { ok: false, code: "NOT_FOUND", message: `no analysis available for ticker '${ticker}'` };
  }
  const { analysis, createdAt } = record;

  const warnings: string[] = [];
  if (analysis.flaggedCount > 0) {
    warnings.push(`${analysis.flaggedCount} section(s) flagged by Quantalyze's local validation check`);
  }

  const envelope: GetCompanyAnalysisResult = {
    data: toCompanyResponseV1(analysis, createdAt),
    metadata: {
      source: "quantalyze.postgres.analysis_results",
      // validationScore is Quantalyze's own local self-consistency check
      // (lib/pipeline.ts localValidation()) — a real, already-computed
      // signal, not a fabricated confidence number. See discussions/
      // 05_AI_ARCHITECTURE.md for exactly what this check does and doesn't
      // verify (it does not re-check claims against the source transcript).
      confidence: clamp01(analysis.validationScore / 100),
      timestamp: nowIso(),
      provenance: `analysis_results row for ${ticker}, generated ${createdAt}`,
      warnings,
    },
  };

  return { ok: true, result: envelope };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
