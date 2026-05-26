import { NextRequest, NextResponse } from "next/server";
import { NIFTY200 } from "@/lib/nifty200";
import { quarterLabel } from "@/lib/nifty50";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

async function searchYouTube(query: string, apiKey: string): Promise<{
    videoId: string; title: string; channel: string;
} | null> {
    try {
        const url = new URL("https://www.googleapis.com/youtube/v3/search");
        url.searchParams.set("part", "snippet");
        url.searchParams.set("q", query);
        url.searchParams.set("type", "video");
        url.searchParams.set("maxResults", "5");
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

        // Prefer items whose title contains "concall" / "earnings call" / "conference call"
        const preferred = items.find((it) =>
            /concall|earnings call|conference call|results/i.test(it.snippet.title)
        );
        const best = preferred ?? items[0];
        return {
            videoId: best.id.videoId,
            title: best.snippet.title,
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
    const { data: cached } = await supabaseAdmin()
        .from("concall_links")
        .select("youtube_url, video_id, video_title, channel_title")
        .eq("ticker", ticker)
        .eq("quarter", quarter)
        .maybeSingle();

    if (cached) {
        const result: ConcallResult = {
            url:     cached.youtube_url,
            videoId: cached.video_id ?? null,
            title:   cached.video_title ?? null,
            channel: cached.channel_title ?? null,
            direct:  !!cached.video_id,
            query,
        };
        return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    // ── 2. Search YouTube API (if key present) ────────────────────────────────
    const apiKey = process.env.YOUTUBE_API_KEY;
    let result: ConcallResult;

    if (apiKey) {
        const yt = await searchYouTube(query, apiKey);
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
    await supabaseAdmin()
        .from("concall_links")
        .upsert({
            ticker,
            quarter,
            youtube_url:   result.url,
            video_id:      result.videoId,
            video_title:   result.title,
            channel_title: result.channel,
            fetched_at:    new Date().toISOString(),
        }, { onConflict: "ticker,quarter" });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
