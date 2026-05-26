import { NextRequest, NextResponse } from "next/server";
import { NIFTY200 } from "@/lib/nifty200";
import { quarterLabel } from "@/lib/nifty50";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/concall?ticker=RELIANCE&quarter=Q4_2026
 *
 * Returns a YouTube link for the company's earnings concall.
 *  - If YOUTUBE_API_KEY is set: searches YouTube Data API v3 and returns
 *    the best-matching direct video URL.
 *  - Otherwise: returns a YouTube search URL (opens search results page).
 *
 * Response: { url: string; direct: boolean; query: string }
 */

// ── Search query builder ──────────────────────────────────────────────────────

function buildQuery(companyName: string, quarter: string): string {
    // "Q4_2026" → "Q4 FY26"  (matches how channels title their videos)
    const ql = quarterLabel(quarter); // e.g. "Q4 FY26"

    // Full FY year as well — some channels write "FY2026" not "FY26"
    const fyFull = quarter.match(/\d{4}/)?.[0] ?? "";

    // Primary query: company name + quarter + earnings concall
    return `${companyName} ${ql} FY${fyFull} earnings concall`;
}

// ── YouTube Data API search ───────────────────────────────────────────────────

interface YtSearchItem {
    id: { videoId: string };
    snippet: { title: string; channelTitle: string };
}

async function searchYouTube(query: string, apiKey: string): Promise<string | null> {
    try {
        const url = new URL("https://www.googleapis.com/youtube/v3/search");
        url.searchParams.set("part", "snippet");
        url.searchParams.set("q", query);
        url.searchParams.set("type", "video");
        url.searchParams.set("maxResults", "5");
        url.searchParams.set("relevanceLanguage", "en");
        url.searchParams.set("key", apiKey);

        const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(6_000) });
        if (!resp.ok) return null;

        const data = await resp.json();
        const items: YtSearchItem[] = data.items ?? [];
        if (items.length === 0) return null;

        // Prefer items whose title contains the company name and "concall" or "earnings call"
        const preferred = items.find((it) =>
            /concall|earnings call|conference call/i.test(it.snippet.title)
        );

        const best = preferred ?? items[0];
        return `https://www.youtube.com/watch?v=${best.id.videoId}`;
    } catch {
        return null;
    }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const ticker  = searchParams.get("ticker")?.toUpperCase();
    const quarter = searchParams.get("quarter");

    if (!ticker || !quarter) {
        return NextResponse.json(
            { error: "ticker and quarter are required" },
            { status: 400 }
        );
    }

    const info = NIFTY200[ticker];
    if (!info) {
        return NextResponse.json({ error: "ticker not in Nifty 200" }, { status: 404 });
    }

    const query = buildQuery(info.name, quarter);
    const apiKey = process.env.YOUTUBE_API_KEY;

    if (apiKey) {
        const directUrl = await searchYouTube(query, apiKey);
        if (directUrl) {
            return NextResponse.json({ url: directUrl, direct: true, query });
        }
    }

    // Fallback: YouTube search page — still useful, user sees all matching videos
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    return NextResponse.json({ url: searchUrl, direct: false, query });
}
