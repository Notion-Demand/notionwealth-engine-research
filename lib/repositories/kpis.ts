import { supabaseAdmin } from "@/lib/supabase/admin";
import { query } from "@/lib/postgres/client";
import type { KPIEntry } from "@/lib/kpi-extractor";

// Only fields actually persisted in kpi_snapshots — a company display name is
// NOT stored (callers derive it from the NIFTY50/NIFTY200 registry at read
// time, same as before this migration).
export interface KpiSnapshot {
  ticker: string;
  sector: string | null;
  quarter: string;
  quarterPrevious: string;
  kpis: KPIEntry[];
}

export interface KpiRepository {
  getLatestByTicker(ticker: string): Promise<KpiSnapshot | null>;
  /** Batch variant of getLatestByTicker, for callers needing several tickers at once (e.g. SectorThesisService). */
  getLatestByTickers(tickers: string[]): Promise<Map<string, KpiSnapshot>>;
  upsertSnapshot(snapshot: KpiSnapshot): Promise<{ error: string | null }>;
  listAll(sectorFilter?: string): Promise<{ snapshots: KpiSnapshot[]; error: string | null }>;
  deleteAll(): Promise<{ error: string | null }>;
}

interface StoredKpiRow {
  company_ticker: string;
  sector: string | null;
  quarter: string;
  quarter_previous: string;
  kpis: KPIEntry[];
}

function toEntity(row: StoredKpiRow): KpiSnapshot {
  return {
    ticker: row.company_ticker,
    sector: row.sector,
    quarter: row.quarter,
    quarterPrevious: row.quarter_previous,
    kpis: row.kpis,
  };
}

export class SupabaseKpiRepository implements KpiRepository {
  async getLatestByTicker(ticker: string): Promise<KpiSnapshot | null> {
    const { data } = await supabaseAdmin()
      .from("kpi_snapshots")
      .select("*")
      .eq("company_ticker", ticker)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return toEntity(data as StoredKpiRow);
  }

  async getLatestByTickers(tickers: string[]): Promise<Map<string, KpiSnapshot>> {
    if (tickers.length === 0) return new Map();
    const { data } = await supabaseAdmin()
      .from("kpi_snapshots")
      .select("*")
      .in("company_ticker", tickers)
      .order("created_at", { ascending: false });

    const result = new Map<string, KpiSnapshot>();
    for (const row of (data ?? []) as StoredKpiRow[]) {
      if (result.has(row.company_ticker)) continue; // first row per ticker = most recent
      result.set(row.company_ticker, toEntity(row));
    }
    return result;
  }

  async upsertSnapshot(snapshot: KpiSnapshot): Promise<{ error: string | null }> {
    const { error } = await supabaseAdmin()
      .from("kpi_snapshots")
      .upsert(
        {
          company_ticker: snapshot.ticker,
          quarter: snapshot.quarter,
          quarter_previous: snapshot.quarterPrevious,
          sector: snapshot.sector,
          kpis: snapshot.kpis,
        },
        { onConflict: "company_ticker,quarter" }
      );
    return { error: error ? error.message : null };
  }

  async listAll(sectorFilter?: string): Promise<{ snapshots: KpiSnapshot[]; error: string | null }> {
    let query = supabaseAdmin().from("kpi_snapshots").select("*").order("created_at", { ascending: false });
    if (sectorFilter) query = query.eq("sector", sectorFilter);
    const { data, error } = await query;
    if (error) return { snapshots: [], error: error.message };

    const seen = new Set<string>();
    const snapshots: KpiSnapshot[] = [];
    for (const row of (data ?? []) as StoredKpiRow[]) {
      if (seen.has(row.company_ticker)) continue;
      seen.add(row.company_ticker);
      snapshots.push(toEntity(row));
    }
    return { snapshots, error: null };
  }

  async deleteAll(): Promise<{ error: string | null }> {
    const { error } = await supabaseAdmin()
      .from("kpi_snapshots")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    return { error: error ? error.message : null };
  }
}

export class PostgresKpiRepository implements KpiRepository {
  async getLatestByTicker(ticker: string): Promise<KpiSnapshot | null> {
    const rows = await query<StoredKpiRow>(
      `SELECT company_ticker, sector, quarter, quarter_previous, kpis FROM kpi_snapshots
       WHERE company_ticker = $1 ORDER BY created_at DESC LIMIT 1`,
      [ticker]
    );
    return rows.length > 0 ? toEntity(rows[0]) : null;
  }

  async getLatestByTickers(tickers: string[]): Promise<Map<string, KpiSnapshot>> {
    if (tickers.length === 0) return new Map();
    const rows = await query<StoredKpiRow>(
      `SELECT DISTINCT ON (company_ticker) company_ticker, sector, quarter, quarter_previous, kpis
       FROM kpi_snapshots WHERE company_ticker = ANY($1::text[])
       ORDER BY company_ticker, created_at DESC`,
      [tickers]
    );
    const result = new Map<string, KpiSnapshot>();
    for (const row of rows) result.set(row.company_ticker, toEntity(row));
    return result;
  }

  async upsertSnapshot(snapshot: KpiSnapshot): Promise<{ error: string | null }> {
    try {
      await query(
        `INSERT INTO kpi_snapshots (company_ticker, quarter, quarter_previous, sector, kpis)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (company_ticker, quarter) DO UPDATE SET
           quarter_previous = EXCLUDED.quarter_previous, sector = EXCLUDED.sector, kpis = EXCLUDED.kpis`,
        [snapshot.ticker, snapshot.quarter, snapshot.quarterPrevious, snapshot.sector, JSON.stringify(snapshot.kpis)]
      );
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async listAll(sectorFilter?: string): Promise<{ snapshots: KpiSnapshot[]; error: string | null }> {
    try {
      const rows = await query<StoredKpiRow>(
        `SELECT DISTINCT ON (company_ticker) company_ticker, sector, quarter, quarter_previous, kpis
         FROM kpi_snapshots
         WHERE $1::text IS NULL OR sector = $1
         ORDER BY company_ticker, created_at DESC`,
        [sectorFilter ?? null]
      );
      return { snapshots: rows.map(toEntity), error: null };
    } catch (err) {
      return { snapshots: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async deleteAll(): Promise<{ error: string | null }> {
    try {
      await query(`DELETE FROM kpi_snapshots`);
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
