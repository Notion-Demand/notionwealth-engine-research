import { supabaseAdmin } from "@/lib/supabase/admin";
import { query } from "@/lib/postgres/client";
import type { SectorNarrative } from "@/lib/sector-narrative";

export interface CompanySignal {
  ticker: string;
  signal: string;
  direction: "positive" | "neutral" | "negative";
  score: number;
  marketCap: number;
  weightPct: number;
}

export interface SectorDimension {
  dimension: string;
  signal: string;
  direction: "strengthening" | "stable" | "weakening";
  weightedScore: number;
  details: string[];
  companySignals: CompanySignal[];
}

export interface Sector {
  sector: string;
  sectorLabel: string;
  companyCount: number;
  quarter: string;
  quarterPrevious: string;
  dimensions: SectorDimension[];
  isSubSector?: boolean;
  parentSector?: string;
  thesis?: string;
  narrative?: SectorNarrative | null;
}

export interface SectorRecord {
  sector: string;
  quarter: string;
  payload: Sector;
  createdAt: string;
}

export interface SectorRepository {
  listBySectors(sectors: string[]): Promise<{ records: SectorRecord[]; error: string | null }>;
  getBySector(sector: string): Promise<Sector | null>;
  /** Delete-then-insert: replaces all rows for this sector with one fresh row. */
  replaceSector(sector: string, quarter: string, payload: Sector): Promise<{ id: string | null; error: string | null }>;
}

export type SectorWirePayload = StoredSector;

/**
 * Converts a Sector entity back to the snake_case shape the (unchanged)
 * frontend (SectorsClient.tsx) expects over the wire — this repository's own
 * internal persisted shape happens to already be that same snake_case shape,
 * so this just re-exposes fromEntity() for API-boundary callers.
 */
export function toSectorWirePayload(s: Sector): SectorWirePayload {
  return fromEntity(s);
}

/**
 * Converts a snake_case wire/business-logic payload (e.g. the
 * SectorIntelligence type computeSectorIntelligence() builds in
 * app/api/v1/sectors/seed/route.ts) into a Sector entity, for callers that
 * have already-computed sector data and need to persist it via this
 * repository. Symmetric with toSectorWirePayload().
 */
export function fromSectorWirePayload(payload: SectorWirePayload): Sector {
  return toEntity(payload);
}

interface StoredSector {
  sector: string;
  sector_label: string;
  company_count: number;
  quarter: string;
  quarter_previous: string;
  dimensions: {
    dimension: string;
    signal: string;
    direction: "strengthening" | "stable" | "weakening";
    weighted_score: number;
    details: string[];
    company_signals: {
      ticker: string; signal: string; direction: "positive" | "neutral" | "negative";
      score: number; market_cap: number; weight_pct: number;
    }[];
  }[];
  is_sub_sector?: boolean;
  parent_sector?: string;
  thesis?: string;
  narrative?: SectorNarrative | null;
}

function toEntity(raw: unknown): Sector {
  const p = raw as StoredSector;
  return {
    sector: p.sector,
    sectorLabel: p.sector_label,
    companyCount: p.company_count,
    quarter: p.quarter,
    quarterPrevious: p.quarter_previous,
    dimensions: p.dimensions.map((d) => ({
      dimension: d.dimension,
      signal: d.signal,
      direction: d.direction,
      weightedScore: d.weighted_score,
      details: d.details,
      companySignals: d.company_signals.map((c) => ({
        ticker: c.ticker, signal: c.signal, direction: c.direction,
        score: c.score, marketCap: c.market_cap, weightPct: c.weight_pct,
      })),
    })),
    isSubSector: p.is_sub_sector,
    parentSector: p.parent_sector,
    thesis: p.thesis,
    narrative: p.narrative,
  };
}

function fromEntity(s: Sector): StoredSector {
  return {
    sector: s.sector,
    sector_label: s.sectorLabel,
    company_count: s.companyCount,
    quarter: s.quarter,
    quarter_previous: s.quarterPrevious,
    dimensions: s.dimensions.map((d) => ({
      dimension: d.dimension,
      signal: d.signal,
      direction: d.direction,
      weighted_score: d.weightedScore,
      details: d.details,
      company_signals: d.companySignals.map((c) => ({
        ticker: c.ticker, signal: c.signal, direction: c.direction,
        score: c.score, market_cap: c.marketCap, weight_pct: c.weightPct,
      })),
    })),
    is_sub_sector: s.isSubSector,
    parent_sector: s.parentSector,
    thesis: s.thesis,
    narrative: s.narrative,
  };
}

export class SupabaseSectorRepository implements SectorRepository {
  async listBySectors(sectors: string[]): Promise<{ records: SectorRecord[]; error: string | null }> {
    const { data, error } = await supabaseAdmin()
      .from("sector_intelligence")
      .select("sector, quarter, payload, created_at")
      .in("sector", sectors)
      .order("created_at", { ascending: false });
    if (error) return { records: [], error: error.message };
    const records = (data ?? []).map((row) => ({
      sector: row.sector,
      quarter: row.quarter,
      payload: toEntity(row.payload),
      createdAt: row.created_at,
    }));
    return { records, error: null };
  }

  async getBySector(sector: string): Promise<Sector | null> {
    const { data } = await supabaseAdmin()
      .from("sector_intelligence")
      .select("payload")
      .eq("sector", sector)
      .maybeSingle();
    if (!data?.payload) return null;
    return toEntity(data.payload);
  }

  async replaceSector(sector: string, quarter: string, payload: Sector): Promise<{ id: string | null; error: string | null }> {
    await supabaseAdmin().from("sector_intelligence").delete().eq("sector", sector);
    const { data, error } = await supabaseAdmin()
      .from("sector_intelligence")
      .insert({ sector, quarter, payload: fromEntity(payload) as unknown as Record<string, unknown> })
      .select("id")
      .single();
    return { id: data?.id ?? null, error: error ? `${error.message} (code=${error.code})` : null };
  }
}

export class PostgresSectorRepository implements SectorRepository {
  async listBySectors(sectors: string[]): Promise<{ records: SectorRecord[]; error: string | null }> {
    try {
      const rows = await query<{ sector: string; quarter: string; payload: unknown; created_at: string }>(
        `SELECT sector, quarter, payload, created_at FROM sector_intelligence
         WHERE sector = ANY($1::text[]) ORDER BY created_at DESC`,
        [sectors]
      );
      const records = rows.map((row) => ({
        sector: row.sector,
        quarter: row.quarter,
        payload: toEntity(row.payload),
        createdAt: row.created_at,
      }));
      return { records, error: null };
    } catch (err) {
      return { records: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async getBySector(sector: string): Promise<Sector | null> {
    const rows = await query<{ payload: unknown }>(
      `SELECT payload FROM sector_intelligence WHERE sector = $1 ORDER BY created_at DESC LIMIT 1`,
      [sector]
    );
    if (rows.length === 0) return null;
    return toEntity(rows[0].payload);
  }

  async replaceSector(sector: string, quarter: string, payload: Sector): Promise<{ id: string | null; error: string | null }> {
    try {
      await query(`DELETE FROM sector_intelligence WHERE sector = $1`, [sector]);
      const rows = await query<{ id: string }>(
        `INSERT INTO sector_intelligence (sector, quarter, payload) VALUES ($1, $2, $3::jsonb) RETURNING id`,
        [sector, quarter, JSON.stringify(fromEntity(payload))]
      );
      return { id: rows[0]?.id ?? null, error: null };
    } catch (err) {
      return { id: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
