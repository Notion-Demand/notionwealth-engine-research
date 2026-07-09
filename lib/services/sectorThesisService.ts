import type { SectorRepository } from "@/lib/repositories/sectors";
import type { KpiRepository } from "@/lib/repositories/kpis";
import type { AnalysisRepository } from "@/lib/repositories/analysis";
import { NotFoundError } from "@/lib/services/errors";

export interface SectorThesisCompany {
  ticker: string;
  signal: string;
  direction: "positive" | "neutral" | "negative";
  weightPct: number;
  topKpi?: { name: string; changePct: number | null };
  managementConfidence?: "high" | "moderate" | "low";
}

export interface SectorThesisResult {
  sector: string;
  sectorLabel: string;
  quarter: string;
  quarterPrevious: string;
  companyCount: number;
  narrative: {
    competitiveStructure: string;
    strategicTheme: string;
    tailwinds: string[];
    headwinds: string[];
    keyTriggers: string[];
    macroSensitivity: string;
    transformationSignal: string;
  } | null;
  dimensions: { dimension: string; signal: string; direction: string; weightedScore: number }[];
  topCompanies: SectorThesisCompany[];
}

const TOP_N = 5;

export class SectorThesisService {
  constructor(
    private deps: {
      sectorRepo: SectorRepository;
      kpiRepo: KpiRepository;
      analysisRepo: AnalysisRepository;
    }
  ) {}

  async getSectorThesis(sector: string): Promise<SectorThesisResult> {
    const sectorData = await this.deps.sectorRepo.getBySector(sector);
    if (!sectorData) {
      throw new NotFoundError(`no sector data available for '${sector}'`);
    }

    const byTicker = new Map<string, { ticker: string; signal: string; direction: "positive" | "neutral" | "negative"; weightPct: number }>();
    for (const dim of sectorData.dimensions) {
      for (const cs of dim.companySignals) {
        const existing = byTicker.get(cs.ticker);
        if (!existing || cs.weightPct > existing.weightPct) {
          byTicker.set(cs.ticker, { ticker: cs.ticker, signal: cs.signal, direction: cs.direction, weightPct: cs.weightPct });
        }
      }
    }
    const topTickers = Array.from(byTicker.values())
      .sort((a, b) => b.weightPct - a.weightPct)
      .slice(0, TOP_N);
    const topTickerList = topTickers.map((t) => t.ticker);

    // Two batched calls cover every top company at once, instead of one
    // KPI call and one analysis call per company (see Performance note above).
    const kpiByTicker = await this.deps.kpiRepo.getLatestByTickers(topTickerList);
    const analysisRecords = await this.deps.analysisRepo.listByTickersAndQuarterPair(
      topTickerList,
      sectorData.quarterPrevious,
      sectorData.quarter
    );
    const analysisByTicker = new Map<string, (typeof analysisRecords)[number]["analysis"]>();
    for (const record of analysisRecords) {
      if (analysisByTicker.has(record.ticker)) continue; // first record per ticker = most recent
      analysisByTicker.set(record.ticker, record.analysis);
    }

    const topCompanies: SectorThesisCompany[] = topTickers.map((t) => {
      const company: SectorThesisCompany = {
        ticker: t.ticker,
        signal: t.signal,
        direction: t.direction,
        weightPct: t.weightPct,
      };

      const kpiSnapshot = kpiByTicker.get(t.ticker);
      const highlights = kpiSnapshot?.kpis.filter((k) => k.is_highlight) ?? [];
      const highlight = highlights.reduce<typeof highlights[number] | undefined>((best, k) => {
        if (!best) return k;
        const bestMag = best.change_pct !== null ? Math.abs(best.change_pct) : -1;
        const kMag = k.change_pct !== null ? Math.abs(k.change_pct) : -1;
        return kMag > bestMag ? k : best;
      }, undefined);
      if (highlight) {
        company.topKpi = { name: highlight.name, changePct: highlight.change_pct };
      }

      const analysis = analysisByTicker.get(t.ticker);
      if (analysis) {
        company.managementConfidence =
          analysis.evasivenessScore < 4 ? "high" : analysis.evasivenessScore <= 7 ? "moderate" : "low";
      }

      return company;
    });

    return {
      sector: sectorData.sector,
      sectorLabel: sectorData.sectorLabel,
      quarter: sectorData.quarter,
      quarterPrevious: sectorData.quarterPrevious,
      companyCount: sectorData.companyCount,
      narrative: sectorData.narrative
        ? {
            competitiveStructure: sectorData.narrative.competitive_structure,
            strategicTheme: sectorData.narrative.strategic_theme,
            tailwinds: sectorData.narrative.tailwinds,
            headwinds: sectorData.narrative.headwinds,
            keyTriggers: sectorData.narrative.key_triggers,
            macroSensitivity: sectorData.narrative.macro_sensitivity,
            transformationSignal: sectorData.narrative.transformation_signal,
          }
        : null,
      dimensions: sectorData.dimensions.map((d) => ({
        dimension: d.dimension,
        signal: d.signal,
        direction: d.direction,
        weightedScore: d.weightedScore,
      })),
      topCompanies,
    };
  }
}
