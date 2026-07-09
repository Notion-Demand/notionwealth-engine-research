import type { SectorThesisResult } from "@/lib/services/sectorThesisService";
import type { SectorNarrativeV1, SectorDimensionV1 } from "@/lib/api-contracts/v1/sector";

export interface SectorThesisCompanyV1 {
  ticker: string;
  signal: string;
  direction: "positive" | "neutral" | "negative";
  weightPct: number;
  topKpi?: { name: string; changePct: number | null };
  managementConfidence?: "high" | "moderate" | "low";
}

export interface SectorThesisResponseV1 {
  sector: string;
  sectorLabel: string;
  quarter: string;
  quarterPrevious: string;
  companyCount: number;
  narrative: SectorNarrativeV1 | null;
  dimensions: SectorDimensionV1[];
  topCompanies: SectorThesisCompanyV1[];
  generatedAt: string;
}

export function toSectorThesisResponseV1(result: SectorThesisResult, generatedAt: string): SectorThesisResponseV1 {
  return {
    sector: result.sector,
    sectorLabel: result.sectorLabel,
    quarter: result.quarter,
    quarterPrevious: result.quarterPrevious,
    companyCount: result.companyCount,
    narrative: result.narrative,
    dimensions: result.dimensions.map((d) => ({
      dimension: d.dimension,
      signal: d.signal,
      direction: d.direction as "strengthening" | "stable" | "weakening",
      weightedScore: d.weightedScore,
    })),
    topCompanies: result.topCompanies.map((c) => ({
      ticker: c.ticker,
      signal: c.signal,
      direction: c.direction,
      weightPct: c.weightPct,
      topKpi: c.topKpi,
      managementConfidence: c.managementConfidence,
    })),
    generatedAt,
  };
}
