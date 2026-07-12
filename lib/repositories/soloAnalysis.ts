import { supabaseAdmin } from "@/lib/supabase/admin";
import { query } from "@/lib/postgres/client";

export interface SoloSection {
  title: string;
  bullets: string[];
}

export interface SoloAnalysis {
  ticker: string;
  quarter: string;
  headline: string;
  managementTone: string;
  sections: SoloSection[];
}

export interface SoloAnalysisRepository {
  getCached(ticker: string, quarter: string): Promise<SoloAnalysis | null>;
  saveAnalysis(ticker: string, quarter: string, analysis: SoloAnalysis): Promise<string>;
}

// Wire/persisted shape — matches lib/solo-pipeline.ts's SoloPayload exactly.
// Note: company_ticker here actually holds a resolved company DISPLAY NAME
// (see parseFilename() in solo-pipeline.ts), not the raw ticker symbol —
// preserved as-is, not a naming bug introduced by this migration.
export interface SoloWirePayload {
  company_ticker: string;
  quarter: string;
  headline: string;
  management_tone: string;
  sections: SoloSection[];
}

function toEntity(ticker: string, quarter: string, raw: unknown): SoloAnalysis {
  const p = (typeof raw === "string" ? JSON.parse(raw) : raw) as SoloWirePayload;
  return {
    ticker,
    quarter,
    headline: p.headline,
    managementTone: p.management_tone,
    sections: p.sections,
  };
}

function fromEntity(a: SoloAnalysis): SoloWirePayload {
  return {
    company_ticker: a.ticker,
    quarter: a.quarter,
    headline: a.headline,
    management_tone: a.managementTone,
    sections: a.sections,
  };
}

/** For callers (solo-pipeline.ts) that already have a SoloWirePayload and need to save it. */
export function fromSoloWirePayload(ticker: string, quarter: string, payload: SoloWirePayload): SoloAnalysis {
  return toEntity(ticker, quarter, payload);
}

/** For callers that have a SoloAnalysis entity and need the exact existing frontend wire shape. */
export function toSoloWirePayload(a: SoloAnalysis): SoloWirePayload {
  return fromEntity(a);
}

export class SupabaseSoloAnalysisRepository implements SoloAnalysisRepository {
  async getCached(ticker: string, quarter: string): Promise<SoloAnalysis | null> {
    const { data } = await supabaseAdmin()
      .from("solo_analysis_cache")
      .select("payload")
      .eq("ticker", ticker)
      .eq("quarter", quarter)
      .maybeSingle();
    if (!data?.payload) return null;
    const entity = toEntity(ticker, quarter, data.payload);
    if (!entity.sections || entity.sections.length === 0) return null;
    return entity;
  }

  async saveAnalysis(ticker: string, quarter: string, analysis: SoloAnalysis): Promise<string> {
    try {
      await supabaseAdmin().from("solo_analysis_cache").delete().eq("ticker", ticker).eq("quarter", quarter);
      const { data } = await supabaseAdmin()
        .from("solo_analysis_cache")
        .insert({ ticker, quarter, payload: fromEntity(analysis) })
        .select("id")
        .single();
      return data?.id ?? "unknown";
    } catch {
      return "unknown";
    }
  }
}

export class PostgresSoloAnalysisRepository implements SoloAnalysisRepository {
  async getCached(ticker: string, quarter: string): Promise<SoloAnalysis | null> {
    const rows = await query<{ payload: unknown }>(
      `SELECT payload FROM solo_analysis_cache WHERE ticker = $1 AND quarter = $2`,
      [ticker, quarter]
    );
    if (rows.length === 0) return null;
    const entity = toEntity(ticker, quarter, rows[0].payload);
    if (!entity.sections || entity.sections.length === 0) return null;
    return entity;
  }

  async saveAnalysis(ticker: string, quarter: string, analysis: SoloAnalysis): Promise<string> {
    try {
      await query(`DELETE FROM solo_analysis_cache WHERE ticker = $1 AND quarter = $2`, [ticker, quarter]);
      const rows = await query<{ id: string }>(
        `INSERT INTO solo_analysis_cache (ticker, quarter, payload) VALUES ($1, $2, $3::jsonb) RETURNING id`,
        [ticker, quarter, JSON.stringify(fromEntity(analysis))]
      );
      return rows[0]?.id ?? "unknown";
    } catch {
      return "unknown";
    }
  }
}
