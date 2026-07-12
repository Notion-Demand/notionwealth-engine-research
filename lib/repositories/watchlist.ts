import { supabaseAdmin } from "@/lib/supabase/admin";
import { query } from "@/lib/postgres/client";

// user_tickers previously relied on Postgres Row-Level Security (RLS) plus a
// request-scoped, RLS-authenticated Supabase client to filter each user's own
// rows invisibly. Raw `pg` has no equivalent mechanism (no JWT-to-RLS wiring
// without Supabase's PostgREST layer in front of Postgres), and every other
// repository in this codebase already relies on explicit application-level
// filtering with no RLS at all. This repository was updated to match that
// pattern — a conscious, documented decision (see docs/superpowers/specs/
// 2026-07-09-azure-data-storage-migration-design.md's "Watchlist security
// model" section), not a silent regression. Both implementations below now
// take `userId` directly instead of a per-request Supabase client.

export interface WatchlistTicker {
  ticker: string;
  name: string;
  sector: string;
  addedAt: string;
}

export interface WatchlistRepository {
  list(userId: string): Promise<{ tickers: WatchlistTicker[]; error: string | null }>;
  add(userId: string, ticker: string, name: string, sector: string): Promise<{ ticker: WatchlistTicker | null; error: string | null }>;
  remove(userId: string, ticker: string): Promise<void>;
}

function toEntity(row: { ticker: string; name: string; sector: string; added_at: string }): WatchlistTicker {
  return { ticker: row.ticker, name: row.name, sector: row.sector, addedAt: row.added_at };
}

export class SupabaseWatchlistRepository implements WatchlistRepository {
  async list(userId: string): Promise<{ tickers: WatchlistTicker[]; error: string | null }> {
    const { data, error } = await supabaseAdmin()
      .from("user_tickers")
      .select("ticker, name, sector, added_at")
      .eq("user_id", userId)
      .order("added_at", { ascending: false });
    return { tickers: (data ?? []).map(toEntity), error: error ? error.message : null };
  }

  async add(userId: string, ticker: string, name: string, sector: string): Promise<{ ticker: WatchlistTicker | null; error: string | null }> {
    const { data, error } = await supabaseAdmin()
      .from("user_tickers")
      .upsert({ user_id: userId, ticker, name: name || ticker, sector }, { onConflict: "user_id,ticker" })
      .select("ticker, name, sector, added_at")
      .single();
    return { ticker: data ? toEntity(data) : null, error: error ? error.message : null };
  }

  async remove(userId: string, ticker: string): Promise<void> {
    await supabaseAdmin().from("user_tickers").delete().eq("user_id", userId).eq("ticker", ticker);
  }
}

export class PostgresWatchlistRepository implements WatchlistRepository {
  async list(userId: string): Promise<{ tickers: WatchlistTicker[]; error: string | null }> {
    try {
      const rows = await query<{ ticker: string; name: string; sector: string; added_at: string }>(
        `SELECT ticker, name, sector, added_at FROM user_tickers WHERE user_id = $1 ORDER BY added_at DESC`,
        [userId]
      );
      return { tickers: rows.map(toEntity), error: null };
    } catch (err) {
      return { tickers: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async add(userId: string, ticker: string, name: string, sector: string): Promise<{ ticker: WatchlistTicker | null; error: string | null }> {
    try {
      const rows = await query<{ ticker: string; name: string; sector: string; added_at: string }>(
        `INSERT INTO user_tickers (user_id, ticker, name, sector)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, ticker) DO UPDATE SET name = EXCLUDED.name, sector = EXCLUDED.sector
         RETURNING ticker, name, sector, added_at`,
        [userId, ticker, name || ticker, sector]
      );
      return { ticker: rows[0] ? toEntity(rows[0]) : null, error: null };
    } catch (err) {
      return { ticker: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async remove(userId: string, ticker: string): Promise<void> {
    await query(`DELETE FROM user_tickers WHERE user_id = $1 AND ticker = $2`, [userId, ticker]);
  }
}
