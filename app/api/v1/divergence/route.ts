import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NIFTY200 } from "@/lib/nifty200";
import { fetchPromoterActivity, type PromoterActivityEvent } from "@/lib/promoter-activity-fetcher";
import { computeDivergence } from "@/lib/divergence-score";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * GET /api/v1/divergence?ticker=TCS
 *
 * Returns the promoter pledge-activity level for the ticker, cross-referenced
 * against its latest concall sentiment read. Caches BSE fetches per ticker for
 * 24h (?force=1 to bypass).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker")?.toUpperCase();
  const force = url.searchParams.has("force");

  if (!ticker) {
    return NextResponse.json({ detail: "Provide ?ticker=TICKER" }, { status: 400 });
  }

  const bseCode = NIFTY200[ticker]?.bse;
  const db = supabaseAdmin();

  if (bseCode) {
    const { data: log } = await db
      .from("promoter_activity_fetch_log")
      .select("fetched_at")
      .eq("ticker", ticker)
      .maybeSingle();

    const isStale = !log || Date.now() - new Date(log.fetched_at).getTime() > CACHE_TTL_MS;

    if (isStale || force) {
      const events = await fetchPromoterActivity(bseCode);

      if (events.length > 0) {
        const { error: upsertError } = await db.from("promoter_activity").upsert(
          events.map((e) => ({
            ticker,
            news_id: e.newsId,
            disclosure_date: e.disclosureDate,
            subcat_name: e.subcatName,
            headline: e.headline,
            attachment_name: e.attachmentName,
            event_type: e.eventType,
          })),
          { onConflict: "ticker,news_id" }
        );
        if (upsertError) {
          console.error("[divergence] promoter_activity upsert failed:", upsertError.message);
        }
      }

      const { error: logError } = await db
        .from("promoter_activity_fetch_log")
        .upsert(
          { ticker, fetched_at: new Date().toISOString(), row_count: events.length },
          { onConflict: "ticker" }
        );
      if (logError) {
        console.error("[divergence] fetch_log upsert failed:", logError.message);
      }
    }
  }

  const { data: rows, error } = await db
    .from("promoter_activity")
    .select("news_id, disclosure_date, subcat_name, headline, attachment_name, event_type")
    .eq("ticker", ticker)
    .order("disclosure_date", { ascending: false });

  if (error) {
    return NextResponse.json({ detail: `DB error: ${error.message}` }, { status: 500 });
  }

  const events: PromoterActivityEvent[] = (rows ?? []).map((r) => ({
    newsId: r.news_id,
    disclosureDate: r.disclosure_date,
    subcatName: r.subcat_name,
    headline: r.headline,
    attachmentName: r.attachment_name,
    eventType: r.event_type as PromoterActivityEvent["eventType"],
  }));

  const result = await computeDivergence(ticker, events);

  return NextResponse.json(
    { ...result, hasBseMapping: !!bseCode },
    { headers: { "Cache-Control": "no-store" } }
  );
}
