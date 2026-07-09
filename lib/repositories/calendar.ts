import { supabaseAdmin } from "@/lib/supabase/admin";

export interface EarningsEvent {
  ticker: string;
  date: string;
  quarter: string;
  source: string;
  confirmed: boolean;
}

export interface CalendarRepository {
  listInRange(fromDate: string, toDate: string): Promise<{ events: EarningsEvent[]; error: string | null }>;
  upsertEvents(events: (EarningsEvent & { updatedAt: string })[]): Promise<{ inserted: number; error: string | null }>;
}

function toEntity(row: { ticker: string; date: string; quarter: string; source: string; confirmed: boolean }): EarningsEvent {
  return row;
}

export class SupabaseCalendarRepository implements CalendarRepository {
  async listInRange(fromDate: string, toDate: string): Promise<{ events: EarningsEvent[]; error: string | null }> {
    const { data, error } = await supabaseAdmin()
      .from("earnings_calendar")
      .select("ticker, date, quarter, source, confirmed")
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("date");
    if (error) return { events: [], error: error.message };
    return { events: (data ?? []).map(toEntity), error: null };
  }

  async upsertEvents(events: (EarningsEvent & { updatedAt: string })[]): Promise<{ inserted: number; error: string | null }> {
    const rows = events.map((e) => ({
      ticker: e.ticker,
      date: e.date,
      quarter: e.quarter,
      source: e.source,
      confirmed: e.confirmed,
      updated_at: e.updatedAt,
    }));
    const { error } = await supabaseAdmin().from("earnings_calendar").upsert(rows, { onConflict: "ticker,quarter" });
    return { inserted: error ? 0 : rows.length, error: error ? error.message : null };
  }
}
