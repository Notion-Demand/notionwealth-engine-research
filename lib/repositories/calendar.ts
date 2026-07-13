import { supabaseAdmin } from "@/lib/supabase/admin";
import { query } from "@/lib/postgres/client";

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

export class PostgresCalendarRepository implements CalendarRepository {
  async listInRange(fromDate: string, toDate: string): Promise<{ events: EarningsEvent[]; error: string | null }> {
    try {
      const rows = await query<{ ticker: string; date: string; quarter: string; source: string; confirmed: boolean }>(
        `SELECT ticker, date, quarter, source, confirmed FROM earnings_calendar
         WHERE date >= $1 AND date <= $2 ORDER BY date`,
        [fromDate, toDate]
      );
      return { events: rows.map(toEntity), error: null };
    } catch (err) {
      return { events: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async upsertEvents(events: (EarningsEvent & { updatedAt: string })[]): Promise<{ inserted: number; error: string | null }> {
    if (events.length === 0) return { inserted: 0, error: null };
    try {
      const valueClauses: string[] = [];
      const params: unknown[] = [];
      events.forEach((e, i) => {
        const base = i * 6;
        valueClauses.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
        params.push(e.ticker, e.date, e.quarter, e.source, e.confirmed, e.updatedAt);
      });
      await query(
        `INSERT INTO earnings_calendar (ticker, date, quarter, source, confirmed, updated_at)
         VALUES ${valueClauses.join(", ")}
         ON CONFLICT (ticker, quarter) DO UPDATE SET
           date = EXCLUDED.date, source = EXCLUDED.source, confirmed = EXCLUDED.confirmed, updated_at = EXCLUDED.updated_at`,
        params
      );
      return { inserted: events.length, error: null };
    } catch (err) {
      return { inserted: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
