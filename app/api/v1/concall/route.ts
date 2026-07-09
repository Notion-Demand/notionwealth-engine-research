import { NextRequest, NextResponse } from "next/server";
import { NIFTY200 } from "@/lib/nifty200";
import { quarterLabel } from "@/lib/nifty50";
import { concallRepo } from "@/lib/repositories";

export const dynamic = "force-dynamic";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConcallResult {
    url: string;
    videoId: string | null;
    title: string | null;
    channel: string | null;
    direct: boolean;       // true = real video, false = search page
    query: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildQuery(companyName: string, quarter: string): string {
    const ql = quarterLabel(quarter);               // "Q4 FY26"
    const fyFull = quarter.match(/\d{4}/)?.[0] ?? "";
    return `${companyName} ${ql} FY${fyFull} earnings concall`;
}

// Words to strip when extracting key name tokens for title matching
const STOP_WORDS = new Set([
    "india", "indian", "limited", "ltd", "industries", "industry",
    "enterprises", "corporation", "corp", "company", "co", "the",
    "and", "&", "group", "holdings", "services", "technologies",
    "technology", "solutions", "international", "global", "national",
]);

/**
 * Returns true only if the video title contains enough of the company's
 * key name tokens that we're confident it's actually about this company.
 */
function titleMatchesCompany(title: string, companyName: string, ticker: string): boolean {
    const t = title.toLowerCase();

    // Ticker match is a strong signal (e.g. "POLYCAB" in title)
    if (t.includes(ticker.toLowerCase())) return true;

    // Extract meaningful tokens from company name
    const tokens = companyName
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

    if (tokens.length === 0) return false;

    // At least the first key token must appear
    if (!t.includes(tokens[0])) return false;

    // For names with 2+ meaningful tokens, require 2 to match
    if (tokens.length >= 2) {
        const matches = tokens.filter((w) => t.includes(w)).length;
        return matches >= 2;
    }

    return true;
}

async function searchYouTube(
    query: string,
    apiKey: string,
    companyName: string,
    ticker: string,
): Promise<{ videoId: string; title: string; channel: string } | null> {
    try {
        const url = new URL("https://www.googleapis.com/youtube/v3/search");
        url.searchParams.set("part", "snippet");
        url.searchParams.set("q", query);
        url.searchParams.set("type", "video");
        url.searchParams.set("maxResults", "10");   // more results = better chance of finding correct one
        url.searchParams.set("relevanceLanguage", "en");
        url.searchParams.set("key", apiKey);

        const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(8_000) });
        if (!resp.ok) return null;

        const data = await resp.json();
        const items: Array<{
            id: { videoId: string };
            snippet: { title: string; channelTitle: string };
        }> = data.items ?? [];
        if (items.length === 0) return null;

        // Filter strictly: title must actually mention this company
        const matching = items.filter((it) =>
            titleMatchesCompany(it.snippet.title, companyName, ticker)
        );

        // No confirmed match → don't cache a wrong video, fall back to search URL
        if (matching.length === 0) return null;

        // Among matching, prefer concall/earnings call/conference call
        const preferred = matching.find((it) =>
            /concall|earnings call|conference call/i.test(it.snippet.title)
        );
        const best = preferred ?? matching[0];
        return {
            videoId: best.id.videoId,
            title:   best.snippet.title,
            channel: best.snippet.channelTitle,
        };
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
        return NextResponse.json({ error: "ticker and quarter required" }, { status: 400 });
    }

    const info = NIFTY200[ticker];
    if (!info) {
        return NextResponse.json({ error: "ticker not in Nifty 200" }, { status: 404 });
    }

    const query = buildQuery(info.name, quarter);

    // ── 1. Check DB cache ─────────────────────────────────────────────────────
    const cached = await concallRepo.getCached(ticker, quarter);

    if (cached) {
        const result: ConcallResult = {
            url:     cached.youtubeUrl,
            videoId: cached.videoId,
            title:   cached.videoTitle,
            channel: cached.channelTitle,
            direct:  !!cached.videoId,
            query,
        };
        return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    // ── 2. Search YouTube API (if key present) ────────────────────────────────
    const apiKey = process.env.YOUTUBE_API_KEY;
    let result: ConcallResult;

    if (apiKey) {
        const yt = await searchYouTube(query, apiKey, info.name, ticker);
        if (yt) {
            const watchUrl = `https://www.youtube.com/watch?v=${yt.videoId}`;
            result = { url: watchUrl, videoId: yt.videoId, title: yt.title, channel: yt.channel, direct: true, query };
        } else {
            const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
            result = { url: searchUrl, videoId: null, title: null, channel: null, direct: false, query };
        }
    } else {
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        result = { url: searchUrl, videoId: null, title: null, channel: null, direct: false, query };
    }

    // ── 3. Cache result in DB ─────────────────────────────────────────────────
    await concallRepo.saveLink({
        ticker,
        quarter,
        youtubeUrl: result.url,
        videoId: result.videoId,
        videoTitle: result.title,
        channelTitle: result.channel,
        fetchedAt: new Date().toISOString(),
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
