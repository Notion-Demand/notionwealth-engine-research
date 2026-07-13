import { supabaseAdmin } from "@/lib/supabase/admin";
import { query } from "@/lib/postgres/client";

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

export class PostgresConcallRepository implements ConcallRepository {
  async getCached(ticker: string, quarter: string): Promise<ConcallLink | null> {
    const rows = await query<{
      youtube_url: string; video_id: string | null; video_title: string | null; channel_title: string | null;
    }>(
      `SELECT youtube_url, video_id, video_title, channel_title FROM concall_links
       WHERE ticker = $1 AND quarter = $2`,
      [ticker, quarter]
    );
    if (rows.length === 0) return null;
    return toEntity(ticker, quarter, rows[0]);
  }

  async saveLink(link: ConcallLink): Promise<void> {
    await query(
      `INSERT INTO concall_links (ticker, quarter, youtube_url, video_id, video_title, channel_title, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (ticker, quarter) DO UPDATE SET
         youtube_url = EXCLUDED.youtube_url, video_id = EXCLUDED.video_id,
         video_title = EXCLUDED.video_title, channel_title = EXCLUDED.channel_title,
         fetched_at = EXCLUDED.fetched_at`,
      [link.ticker, link.quarter, link.youtubeUrl, link.videoId, link.videoTitle, link.channelTitle, link.fetchedAt || new Date().toISOString()]
    );
  }
}
