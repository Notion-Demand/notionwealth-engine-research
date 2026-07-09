import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ConcallLink {
  ticker: string;
  quarter: string;
  youtubeUrl: string;
  videoId: string | null;
  videoTitle: string | null;
  channelTitle: string | null;
  fetchedAt: string;
}

export interface ConcallRepository {
  getCached(ticker: string, quarter: string): Promise<ConcallLink | null>;
  saveLink(link: ConcallLink): Promise<void>;
}

function toEntity(ticker: string, quarter: string, row: {
  youtube_url: string; video_id: string | null; video_title: string | null; channel_title: string | null;
}): ConcallLink {
  return {
    ticker,
    quarter,
    youtubeUrl: row.youtube_url,
    videoId: row.video_id,
    videoTitle: row.video_title,
    channelTitle: row.channel_title,
    fetchedAt: "",
  };
}

export class SupabaseConcallRepository implements ConcallRepository {
  async getCached(ticker: string, quarter: string): Promise<ConcallLink | null> {
    const { data } = await supabaseAdmin()
      .from("concall_links")
      .select("youtube_url, video_id, video_title, channel_title")
      .eq("ticker", ticker)
      .eq("quarter", quarter)
      .maybeSingle();
    if (!data) return null;
    return toEntity(ticker, quarter, data);
  }

  async saveLink(link: ConcallLink): Promise<void> {
    await supabaseAdmin()
      .from("concall_links")
      .upsert(
        {
          ticker: link.ticker,
          quarter: link.quarter,
          youtube_url: link.youtubeUrl,
          video_id: link.videoId,
          video_title: link.videoTitle,
          channel_title: link.channelTitle,
          fetched_at: link.fetchedAt || new Date().toISOString(),
        },
        { onConflict: "ticker,quarter" }
      );
  }
}
