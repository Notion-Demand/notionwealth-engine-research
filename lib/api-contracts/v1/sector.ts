import type { Sector } from "@/lib/repositories/sectors";

export interface SectorDimensionV1 {
  dimension: string;
  signal: string;
  direction: "strengthening" | "stable" | "weakening";
  weightedScore: number;
}

export interface SectorNarrativeV1 {
  competitiveStructure: string;
  strategicTheme: string;
  tailwinds: string[];
  headwinds: string[];
  keyTriggers: string[];
  macroSensitivity: string;
  transformationSignal: string;
}

export interface SectorResponseV1 {
  sector: string;
  sectorLabel: string;
  quarter: string;
  companyCount: number;
  dimensions: SectorDimensionV1[];
  narrative: SectorNarrativeV1 | null;
  generatedAt: string;
}

export function toSectorResponseV1(sector: Sector, generatedAt: string): SectorResponseV1 {
  return {
    sector: sector.sector,
    sectorLabel: sector.sectorLabel,
    quarter: sector.quarter,
    companyCount: sector.companyCount,
    dimensions: sector.dimensions.map((d) => ({
      dimension: d.dimension,
      signal: d.signal,
      direction: d.direction,
      weightedScore: d.weightedScore,
    })),
    narrative: sector.narrative
      ? {
          competitiveStructure: sector.narrative.competitive_structure,
          strategicTheme: sector.narrative.strategic_theme,
          tailwinds: sector.narrative.tailwinds,
          headwinds: sector.narrative.headwinds,
          keyTriggers: sector.narrative.key_triggers,
          macroSensitivity: sector.narrative.macro_sensitivity,
          transformationSignal: sector.narrative.transformation_signal,
        }
      : null,
    generatedAt,
  };
}
