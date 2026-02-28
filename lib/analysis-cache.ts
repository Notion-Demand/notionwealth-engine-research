import { supabaseAdmin } from "@/lib/supabase/admin";
import type { DashboardPayload } from "@/lib/pipeline";

/**
 * Look up a previously computed analysis result.
 * Cache key = (company_ticker, q_prev, q_curr) — results are deterministic
 * across users since all users run against the same PDF files.
 */
export async function getCachedAnalysis(
  ticker: string,
  qPrev: string,
  qCurr: string
): Promise<DashboardPayload | null> {
  const { data } = await supabaseAdmin()
    .from("analysis_results")
    .select("payload")
    .eq("company_ticker", ticker.toUpperCase())
    .eq("q_prev", qPrev)
    .eq("q_curr", qCurr)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.payload) return null;
  const raw = data.payload;
  // Old records may have been stored as JSON.stringify(payload), which Supabase
  // stores as a JSONB string and returns as a JS string. Parse those on the fly.
  let parsed: DashboardPayload;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as DashboardPayload;
    } catch {
      return null;
    }
  } else {
    parsed = raw as unknown as DashboardPayload;
  }
  // Don't serve results with no insights — force a fresh pipeline run instead.
  // This prevents stale/failed runs (overall_signal: Noise, insights: []) from
  // being permanently cached.
  if (!Array.isArray(parsed.insights) || parsed.insights.length === 0) {
    return null;
  }
  return parsed;
}

/**
 * Persist an analysis result. Returns the new row id, or "unknown" on failure.
 */
export async function saveAnalysis(
  userId: string,
  ticker: string,
  qPrev: string,
  qCurr: string,
  payload: DashboardPayload
): Promise<string> {
  try {
    // Don't cache pipeline runs that produced no insights — they're likely
    // failed or low-quality runs. Keeping them would block good results.
    if (!Array.isArray(payload.insights) || payload.insights.length === 0) {
      return "not-cached-empty";
    }

    const tickerUp = ticker.toUpperCase();

    // Replace any existing record so stale results never accumulate.
    // (INSERT every run creates duplicates; the wrong one can become "newest".)
    await supabaseAdmin()
      .from("analysis_results")
      .delete()
      .eq("company_ticker", tickerUp)
      .eq("q_prev", qPrev)
      .eq("q_curr", qCurr);

    const { data } = await supabaseAdmin()
      .from("analysis_results")
      .insert({
        user_id: userId,
        company_ticker: tickerUp,
        q_prev: qPrev,
        q_curr: qCurr,
        payload: payload,
      })
      .select("id")
      .single();
    return data?.id ?? "unknown";
  } catch (e) {
    console.error("Failed to save analysis result:", e);
    return "unknown";
  }
}
