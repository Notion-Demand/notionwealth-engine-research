import { supabaseAdmin } from "@/lib/supabase/admin";
import { query } from "@/lib/postgres/client";
import type { PromoterActivityEvent as FetcherEvent } from "@/lib/promoter-activity-fetcher";

// Reuses the existing PromoterActivityEvent shape from promoter-activity-fetcher.ts
// (already camelCase) rather than defining a second, differently-named entity —
// the route already converts DB rows to this exact shape today.
export type PromoterActivityEvent = FetcherEvent & { ticker: string };

export interface PromoterActivityRepository {
  getFetchLog(ticker: string): Promise<{ fetchedAt: string } | null>;
  saveFetchLog(ticker: string, fetchedAt: string, rowCount: number): Promise<{ error: string | null }>;
  upsertEvents(events: PromoterActivityEvent[]): Promise<{ error: string | null }>;
  listByTicker(ticker: string): Promise<{ events: PromoterActivityEvent[]; error: string | null }>;
}

function toEntity(row: {
  news_id: string; disclosure_date: string; subcat_name: string;
  headline: string; attachment_name: string | null; event_type: string;
}, ticker: string): PromoterActivityEvent {
  return {
    ticker,
    newsId: row.news_id,
    disclosureDate: row.disclosure_date,
    subcatName: row.subcat_name,
    headline: row.headline,
    attachmentName: row.attachment_name,
    eventType: row.event_type as FetcherEvent["eventType"],
  };
}

export class SupabasePromoterActivityRepository implements PromoterActivityRepository {
  async getFetchLog(ticker: string): Promise<{ fetchedAt: string } | null> {
    const { data } = await supabaseAdmin()
      .from("promoter_activity_fetch_log")
      .select("fetched_at")
      .eq("ticker", ticker)
      .maybeSingle();
    return data ? { fetchedAt: data.fetched_at } : null;
  }

  async saveFetchLog(ticker: string, fetchedAt: string, rowCount: number): Promise<{ error: string | null }> {
    const { error } = await supabaseAdmin()
      .from("promoter_activity_fetch_log")
      .upsert({ ticker, fetched_at: fetchedAt, row_count: rowCount }, { onConflict: "ticker" });
    return { error: error ? error.message : null };
  }

  async upsertEvents(events: PromoterActivityEvent[]): Promise<{ error: string | null }> {
    if (events.length === 0) return { error: null };
    const { error } = await supabaseAdmin().from("promoter_activity").upsert(
      events.map((e) => ({
        ticker: e.ticker,
        news_id: e.newsId,
        disclosure_date: e.disclosureDate,
        subcat_name: e.subcatName,
        headline: e.headline,
        attachment_name: e.attachmentName,
        event_type: e.eventType,
      })),
      { onConflict: "ticker,news_id" }
    );
    return { error: error ? error.message : null };
  }

  async listByTicker(ticker: string): Promise<{ events: PromoterActivityEvent[]; error: string | null }> {
    const { data, error } = await supabaseAdmin()
      .from("promoter_activity")
      .select("news_id, disclosure_date, subcat_name, headline, attachment_name, event_type")
      .eq("ticker", ticker)
      .order("disclosure_date", { ascending: false });
    if (error) return { events: [], error: error.message };
    return { events: (data ?? []).map((row) => toEntity(row, ticker)), error: null };
  }
}

export class PostgresPromoterActivityRepository implements PromoterActivityRepository {
  async getFetchLog(ticker: string): Promise<{ fetchedAt: string } | null> {
    const rows = await query<{ fetched_at: string }>(
      `SELECT fetched_at FROM promoter_activity_fetch_log WHERE ticker = $1`,
      [ticker]
    );
    return rows.length > 0 ? { fetchedAt: rows[0].fetched_at } : null;
  }

  async saveFetchLog(ticker: string, fetchedAt: string, rowCount: number): Promise<{ error: string | null }> {
    try {
      await query(
        `INSERT INTO promoter_activity_fetch_log (ticker, fetched_at, row_count)
         VALUES ($1, $2, $3)
         ON CONFLICT (ticker) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, row_count = EXCLUDED.row_count`,
        [ticker, fetchedAt, rowCount]
      );
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async upsertEvents(events: PromoterActivityEvent[]): Promise<{ error: string | null }> {
    if (events.length === 0) return { error: null };
    try {
      const valueClauses: string[] = [];
      const params: unknown[] = [];
      events.forEach((e, i) => {
        const base = i * 7;
        valueClauses.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
        params.push(e.ticker, e.newsId, e.disclosureDate, e.subcatName, e.headline, e.attachmentName, e.eventType);
      });
      await query(
        `INSERT INTO promoter_activity (ticker, news_id, disclosure_date, subcat_name, headline, attachment_name, event_type)
         VALUES ${valueClauses.join(", ")}
         ON CONFLICT (ticker, news_id) DO UPDATE SET
           subcat_name = EXCLUDED.subcat_name, headline = EXCLUDED.headline,
           attachment_name = EXCLUDED.attachment_name, event_type = EXCLUDED.event_type`,
        params
      );
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async listByTicker(ticker: string): Promise<{ events: PromoterActivityEvent[]; error: string | null }> {
    try {
      const rows = await query<{
        news_id: string; disclosure_date: string; subcat_name: string;
        headline: string; attachment_name: string | null; event_type: string;
      }>(
        `SELECT news_id, disclosure_date, subcat_name, headline, attachment_name, event_type
         FROM promoter_activity WHERE ticker = $1 ORDER BY disclosure_date DESC`,
        [ticker]
      );
      return { events: rows.map((row) => toEntity(row, ticker)), error: null };
    } catch (err) {
      return { events: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
}
