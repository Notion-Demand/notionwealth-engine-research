import { NextResponse } from "next/server";
import { NIFTY200 } from "@/lib/nifty200";
import { fetchPromoterActivity, type PromoterActivityEvent } from "@/lib/promoter-activity-fetcher";
import { computeDivergence } from "@/lib/divergence-score";
import { promoterActivityRepo } from "@/lib/repositories";

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

  if (bseCode) {
    const log = await promoterActivityRepo.getFetchLog(ticker);

    const isStale = !log || Date.now() - new Date(log.fetchedAt).getTime() > CACHE_TTL_MS;

    if (isStale || force) {
      const events = await fetchPromoterActivity(bseCode);

      if (events.length > 0) {
        const { error: upsertError } = await promoterActivityRepo.upsertEvents(
          events.map((e) => ({
            ticker,
            newsId: e.newsId,
            disclosureDate: e.disclosureDate,
            subcatName: e.subcatName,
            headline: e.headline,
            attachmentName: e.attachmentName,
            eventType: e.eventType,
          }))
        );
        if (upsertError) {
          console.error("[divergence] promoter_activity upsert failed:", upsertError);
        }
      }

      const { error: logError } = await promoterActivityRepo.saveFetchLog(ticker, new Date().toISOString(), events.length);
      if (logError) {
        console.error("[divergence] fetch_log upsert failed:", logError);
      }
    }
  }

  const { events: rows, error } = await promoterActivityRepo.listByTicker(ticker);

  if (error) {
    return NextResponse.json({ detail: `DB error: ${error}` }, { status: 500 });
  }

  const events: PromoterActivityEvent[] = rows.map((r) => ({
    newsId: r.newsId,
    disclosureDate: r.disclosureDate,
    subcatName: r.subcatName,
    headline: r.headline,
    attachmentName: r.attachmentName,
    eventType: r.eventType,
  }));

  const result = await computeDivergence(ticker, events);

  return NextResponse.json(
    { ...result, hasBseMapping: !!bseCode },
    { headers: { "Cache-Control": "no-store" } }
  );
}
