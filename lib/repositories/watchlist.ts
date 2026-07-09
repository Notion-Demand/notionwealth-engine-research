import type { SupabaseClient } from "@supabase/supabase-js";

// user_tickers is the one domain in this migration that uses a request-scoped,
// RLS-authenticated Supabase client (createClient() from @/lib/supabase/server,
// built from the request's session cookies), not the service-role
// supabaseAdmin() client every other repository uses. A singleton instantiated
// once in lib/repositories/index.ts cannot hold a fixed client for this
// domain, since the correct client differs per request. This repository's
// methods therefore take the Supabase client as an explicit first parameter —
// a deliberate, documented exception to the "repository holds its own client"
// pattern used everywhere else, made specifically to preserve RLS enforcement
// exactly as it works today. Do not "fix" this by switching to supabaseAdmin()
// with manual user_id filtering — that would silently change the security model.

export interface WatchlistTicker {
  ticker: string;
  name: string;
  sector: string;
  addedAt: string;
}

export interface WatchlistRepository {
  list(supabase: SupabaseClient): Promise<{ tickers: WatchlistTicker[]; error: string | null }>;
  add(supabase: SupabaseClient, userId: string, ticker: string, name: string, sector: string): Promise<{ ticker: WatchlistTicker | null; error: string | null }>;
  remove(supabase: SupabaseClient, userId: string, ticker: string): Promise<void>;
}

function toEntity(row: { ticker: string; name: string; sector: string; added_at: string }): WatchlistTicker {
  return { ticker: row.ticker, name: row.name, sector: row.sector, addedAt: row.added_at };
}

export class SupabaseWatchlistRepository implements WatchlistRepository {
  async list(supabase: SupabaseClient): Promise<{ tickers: WatchlistTicker[]; error: string | null }> {
    const { data, error } = await supabase
      .from("user_tickers")
      .select("ticker, name, sector, added_at")
      .order("added_at", { ascending: false });
    return { tickers: (data ?? []).map(toEntity), error: error ? error.message : null };
  }

  async add(supabase: SupabaseClient, userId: string, ticker: string, name: string, sector: string): Promise<{ ticker: WatchlistTicker | null; error: string | null }> {
    const { data, error } = await supabase
      .from("user_tickers")
      .upsert({ user_id: userId, ticker, name: name || ticker, sector }, { onConflict: "user_id,ticker" })
      .select("ticker, name, sector, added_at")
      .single();
    return { ticker: data ? toEntity(data) : null, error: error ? error.message : null };
  }

  async remove(supabase: SupabaseClient, userId: string, ticker: string): Promise<void> {
    await supabase.from("user_tickers").delete().eq("user_id", userId).eq("ticker", ticker);
  }
}
