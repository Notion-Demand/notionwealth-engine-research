import { supabaseAdmin } from "@/lib/supabase/admin";
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
