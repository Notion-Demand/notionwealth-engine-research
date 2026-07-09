import type { Analysis } from "@/lib/repositories/analysis";

export interface CompanyResponseV1 {
  ticker: string;
  quarter: string;
  quarterPrevious: string;
  overallSignal: "Positive" | "Negative" | "Mixed" | "Noise";
  overallScore: number;
  summary: string;
  keyMetrics?: {
    revenue?: string;
    revenueGrowth?: string;
    ebitdaMargin?: string;
    patGrowth?: string;
  };
  earningsDelta: string[];
  generatedAt: string;
}

export function toCompanyResponseV1(analysis: Analysis, generatedAt: string): CompanyResponseV1 {
  return {
    ticker: analysis.ticker,
    quarter: analysis.quarter,
    quarterPrevious: analysis.quarterPrevious,
    overallSignal: analysis.overallSignal,
    overallScore: analysis.overallScore,
    summary: analysis.summary,
    keyMetrics: analysis.keyMetrics
      ? {
          revenue: analysis.keyMetrics.revenue,
          revenueGrowth: analysis.keyMetrics.revenue_growth,
          ebitdaMargin: analysis.keyMetrics.ebitda_margin,
          patGrowth: analysis.keyMetrics.pat_growth,
        }
      : undefined,
    earningsDelta: analysis.earningsDelta,
    generatedAt,
  };
}
