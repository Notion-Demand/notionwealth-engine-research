import { supabaseAdmin } from "@/lib/supabase/admin";
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
