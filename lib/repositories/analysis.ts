import { supabaseAdmin } from "@/lib/supabase/admin";
import { query } from "@/lib/postgres/client";
import type { SectionalInsight, KeyMetrics, DashboardPayload } from "@/lib/pipeline";

// ── Domain entity ─────────────────────────────────────────────────────────────
// Field-for-field equivalent of lib/pipeline.ts's DashboardPayload, renamed to
// camelCase — DashboardPayload's snake_case mirrors a JSON wire format, which
// is a storage/wire concern that stops at this repository's boundary.

export interface Analysis {
  ticker: string;
  quarter: string;
  quarterPrevious: string;
  evasivenessScore: number;
  sections: SectionalInsight[];
  overallScore: number;
  overallSignal: "Positive" | "Negative" | "Mixed" | "Noise";
  summary: string;
  validationScore: number;
  flaggedCount: number;
  marketAlignmentPct: number;
  stockPriceChange: number;
  marketSources: string[];
  earningsDelta: string[];
  fcfImplications: string[];
  keyMetrics?: KeyMetrics;
}

export interface AnalysisRecord {
  ticker: string;
  quarterPrevious: string;
  quarter: string;
  analysis: Analysis;
  createdAt: string;
}

// ── Repository interface ────────────────────────────────────────────────────

export interface AnalysisRepository {
  getCachedAnalysis(ticker: string, qPrev: string, qCurr: string, opts?: { strict?: boolean }): Promise<Analysis | null>;
  saveAnalysis(userId: string | null, ticker: string, qPrev: string, qCurr: string, analysis: Analysis): Promise<string>;
  /** nifty200-sampler.ts: extra Nifty200 signals for sector narrative context. */
  listRecentByTickersAndQuarter(tickers: string[], qCurr: string, limit: number): Promise<AnalysisRecord[]>;
  /** screener Pass 1 (Nifty50): best available analysis per ticker, any quarter. */
  listAllByTickers(tickers: string[]): Promise<{ records: AnalysisRecord[]; error: string | null }>;
  /** screener Pass 2 (Nifty200 non-N50): current quarter pair only. */
  listByTickersAndQuarterPair(tickers: string[], qPrev: string, qCurr: string): Promise<AnalysisRecord[]>;
  /** calendar route: which of these tickers already have any analysis (to mark "confirmed"). */
  listTickersWithAnalysis(tickers: string[]): Promise<string[]>;
  /** calendar seed route: every (ticker, qCurr) pair ever analyzed, unfiltered. */
  listAllTickerQuarterPairs(): Promise<{ ticker: string; qCurr: string }[]>;
  /** analyze/history route: one user's own recent analyses. */
  listUserHistory(userId: string, limit: number): Promise<(AnalysisRecord & { id: string })[]>;
  /** public API companies endpoint: most recent analysis for this ticker, any quarter. */
  getLatestByTicker(ticker: string): Promise<Analysis | null>;
}

// ── Mapping: persisted (DashboardPayload-shaped JSONB) <-> Analysis entity ────

// Reuses lib/pipeline.ts's DashboardPayload as the stored/wire shape rather
// than redeclaring an equivalent interface — this IS what's persisted in
// analysis_results.payload, and it's also still what runPipeline() returns
// and what the (unchanged) frontend expects over the wire. Callers that must
// preserve the exact existing frontend contract (e.g. the /api/v1/analyze
// streaming route, which sends both a cache-hit entity and a cache-miss
// runPipeline() result through the same response shape) use the exported
// toDashboardPayload() below rather than hand-rolling their own conversion.
type StoredPayload = DashboardPayload;

/**
 * Converts a DashboardPayload (e.g. a fresh runPipeline() result) into the
 * Analysis entity, for callers that have a DashboardPayload in hand and need
 * to pass it to saveAnalysis() — see app/api/v1/analyze/route.ts.
 */
export function fromDashboardPayload(ticker: string, qPrev: string, qCurr: string, payload: DashboardPayload): Analysis {
  return toEntity(ticker, qPrev, qCurr, payload);
}

function toEntity(ticker: string, qPrev: string, qCurr: string, raw: unknown): Analysis {
  const p = (typeof raw === "string" ? JSON.parse(raw) : raw) as StoredPayload;
  return {
    ticker,
    quarter: qCurr,
    quarterPrevious: qPrev,
    evasivenessScore: p.executive_evasiveness_score,
    sections: p.insights,
    overallScore: p.overall_score,
    overallSignal: p.overall_signal,
    summary: p.summary,
    validationScore: p.validation_score,
    flaggedCount: p.flagged_count,
    marketAlignmentPct: p.market_alignment_pct,
    stockPriceChange: p.stock_price_change,
    marketSources: p.market_sources,
    earningsDelta: p.earnings_delta,
    fcfImplications: p.fcf_implications,
    keyMetrics: p.key_metrics,
  };
}

/**
 * Converts an Analysis entity back into the DashboardPayload shape the
 * (unchanged) frontend and runPipeline() both still use. Needed at any API
 * boundary that must return the same wire shape regardless of whether the
 * value came from cache (an Analysis entity) or a fresh pipeline run (a
 * DashboardPayload already) — see app/api/v1/analyze/route.ts.
 */
export function toDashboardPayload(a: Analysis): DashboardPayload {
  return fromEntity(a);
}

function fromEntity(a: Analysis): StoredPayload {
  return {
    company_ticker: a.ticker,
    quarter: a.quarter,
    quarter_previous: a.quarterPrevious,
    executive_evasiveness_score: a.evasivenessScore,
    insights: a.sections,
    overall_score: a.overallScore,
    overall_signal: a.overallSignal,
    summary: a.summary,
    validation_score: a.validationScore,
    flagged_count: a.flaggedCount,
    market_alignment_pct: a.marketAlignmentPct,
    stock_price_change: a.stockPriceChange,
    market_sources: a.marketSources,
    earnings_delta: a.earningsDelta,
    fcf_implications: a.fcfImplications,
    key_metrics: a.keyMetrics,
  };
}

// ── Supabase implementation ──────────────────────────────────────────────────

export class SupabaseAnalysisRepository implements AnalysisRepository {
  async getCachedAnalysis(ticker: string, qPrev: string, qCurr: string, opts: { strict?: boolean } = {}): Promise<Analysis | null> {
    const strict = opts.strict ?? true;
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
    let raw: StoredPayload;
    try {
      raw = typeof data.payload === "string" ? JSON.parse(data.payload) : (data.payload as StoredPayload);
    } catch {
      return null;
    }
    if (!Array.isArray(raw.insights) || raw.insights.length === 0) return null;
    if (strict && !Array.isArray(raw.earnings_delta)) return null;

    return toEntity(ticker.toUpperCase(), qPrev, qCurr, raw);
  }

  async saveAnalysis(userId: string | null, ticker: string, qPrev: string, qCurr: string, analysis: Analysis): Promise<string> {
    try {
      if (!Array.isArray(analysis.sections) || analysis.sections.length === 0) {
        return "not-cached-empty";
      }
      const tickerUp = ticker.toUpperCase();
      const db = supabaseAdmin();

      await db.from("analysis_results").delete().eq("company_ticker", tickerUp).eq("q_prev", qPrev).eq("q_curr", qCurr);

      const { data } = await db
        .from("analysis_results")
        .insert({
          user_id: userId,
          company_ticker: tickerUp,
          q_prev: qPrev,
          q_curr: qCurr,
          payload: fromEntity(analysis),
        })
        .select("id")
        .single();
      return data?.id ?? "unknown";
    } catch (e) {
      console.error("Failed to save analysis result:", e);
      return "unknown";
    }
  }

  async listRecentByTickersAndQuarter(tickers: string[], qCurr: string, limit: number): Promise<AnalysisRecord[]> {
    const { data, error } = await supabaseAdmin()
      .from("analysis_results")
      .select("company_ticker, payload")
      .eq("q_curr", qCurr)
      .in("company_ticker", tickers)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((row) => ({
      ticker: row.company_ticker,
      quarterPrevious: "",
      quarter: qCurr,
      analysis: toEntity(row.company_ticker, "", qCurr, row.payload),
      createdAt: "",
    }));
  }

  async listAllByTickers(tickers: string[]): Promise<{ records: AnalysisRecord[]; error: string | null }> {
    const { data, error } = await supabaseAdmin()
      .from("analysis_results")
      .select("company_ticker, q_curr, q_prev, payload, created_at")
      .in("company_ticker", tickers)
      .order("created_at", { ascending: false });
    if (error) return { records: [], error: error.message };
    const records = (data ?? []).map((row) => ({
      ticker: row.company_ticker,
      quarterPrevious: row.q_prev,
      quarter: row.q_curr,
      analysis: toEntity(row.company_ticker, row.q_prev, row.q_curr, row.payload),
      createdAt: row.created_at,
    }));
    return { records, error: null };
  }

  async getLatestByTicker(ticker: string): Promise<Analysis | null> {
    const { data } = await supabaseAdmin()
      .from("analysis_results")
      .select("company_ticker, q_curr, q_prev, payload, created_at")
      .eq("company_ticker", ticker)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return toEntity(data.company_ticker, data.q_prev, data.q_curr, data.payload);
  }

  async listByTickersAndQuarterPair(tickers: string[], qPrev: string, qCurr: string): Promise<AnalysisRecord[]> {
    const { data } = await supabaseAdmin()
      .from("analysis_results")
      .select("company_ticker, q_curr, q_prev, payload, created_at")
      .eq("q_prev", qPrev)
      .eq("q_curr", qCurr)
      .in("company_ticker", tickers)
      .order("created_at", { ascending: false });
    if (!data) return [];
    return data.map((row) => ({
      ticker: row.company_ticker,
      quarterPrevious: row.q_prev,
      quarter: row.q_curr,
      analysis: toEntity(row.company_ticker, row.q_prev, row.q_curr, row.payload),
      createdAt: row.created_at,
    }));
  }

  async listTickersWithAnalysis(tickers: string[]): Promise<string[]> {
    const { data } = await supabaseAdmin()
      .from("analysis_results")
      .select("company_ticker")
      .in("company_ticker", tickers);
    return (data ?? []).map((r) => r.company_ticker);
  }

  async listAllTickerQuarterPairs(): Promise<{ ticker: string; qCurr: string }[]> {
    const { data } = await supabaseAdmin().from("analysis_results").select("company_ticker, q_curr");
    return (data ?? []).map((r) => ({ ticker: r.company_ticker, qCurr: r.q_curr }));
  }

  async listUserHistory(userId: string, limit: number): Promise<(AnalysisRecord & { id: string })[]> {
    const { data } = await supabaseAdmin()
      .from("analysis_results")
      .select("id, company_ticker, q_curr, payload, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) => ({
      id: row.id,
      ticker: row.company_ticker,
      quarterPrevious: "",
      quarter: row.q_curr,
      analysis: toEntity(row.company_ticker, "", row.q_curr, row.payload),
      createdAt: row.created_at,
    }));
  }
}

// ── Postgres implementation ──────────────────────────────────────────────────

export class PostgresAnalysisRepository implements AnalysisRepository {
  async getCachedAnalysis(ticker: string, qPrev: string, qCurr: string, opts: { strict?: boolean } = {}): Promise<Analysis | null> {
    const strict = opts.strict ?? true;
    const rows = await query<{ payload: unknown }>(
      `SELECT payload FROM analysis_results
       WHERE company_ticker = $1 AND q_prev = $2 AND q_curr = $3
       ORDER BY created_at DESC LIMIT 1`,
      [ticker.toUpperCase(), qPrev, qCurr]
    );
    if (rows.length === 0) return null;
    let raw: Record<string, unknown>;
    try {
      raw = (typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload as string) : rows[0].payload) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (!Array.isArray(raw.insights) || raw.insights.length === 0) return null;
    if (strict && !Array.isArray(raw.earnings_delta)) return null;
    return toEntity(ticker.toUpperCase(), qPrev, qCurr, raw);
  }

  async saveAnalysis(userId: string | null, ticker: string, qPrev: string, qCurr: string, analysis: Analysis): Promise<string> {
    try {
      if (!Array.isArray(analysis.sections) || analysis.sections.length === 0) {
        return "not-cached-empty";
      }
      const tickerUp = ticker.toUpperCase();
      await query(`DELETE FROM analysis_results WHERE company_ticker = $1 AND q_prev = $2 AND q_curr = $3`, [tickerUp, qPrev, qCurr]);
      const rows = await query<{ id: string }>(
        `INSERT INTO analysis_results (user_id, company_ticker, q_prev, q_curr, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
        [userId, tickerUp, qPrev, qCurr, JSON.stringify(fromEntity(analysis))]
      );
      return rows[0]?.id ?? "unknown";
    } catch (e) {
      console.error("Failed to save analysis result:", e);
      return "unknown";
    }
  }

  async listRecentByTickersAndQuarter(tickers: string[], qCurr: string, limit: number): Promise<AnalysisRecord[]> {
    const rows = await query<{ company_ticker: string; payload: unknown }>(
      `SELECT company_ticker, payload FROM analysis_results
       WHERE q_curr = $1 AND company_ticker = ANY($2::text[])
       ORDER BY created_at DESC LIMIT $3`,
      [qCurr, tickers, limit]
    );
    return rows.map((row) => ({
      ticker: row.company_ticker,
      quarterPrevious: "",
      quarter: qCurr,
      analysis: toEntity(row.company_ticker, "", qCurr, row.payload),
      createdAt: "",
    }));
  }

  async listAllByTickers(tickers: string[]): Promise<{ records: AnalysisRecord[]; error: string | null }> {
    try {
      const rows = await query<{ company_ticker: string; q_curr: string; q_prev: string; payload: unknown; created_at: string }>(
        `SELECT company_ticker, q_curr, q_prev, payload, created_at FROM analysis_results
         WHERE company_ticker = ANY($1::text[]) ORDER BY created_at DESC`,
        [tickers]
      );
      const records = rows.map((row) => ({
        ticker: row.company_ticker,
        quarterPrevious: row.q_prev,
        quarter: row.q_curr,
        analysis: toEntity(row.company_ticker, row.q_prev, row.q_curr, row.payload),
        createdAt: row.created_at,
      }));
      return { records, error: null };
    } catch (err) {
      return { records: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async getLatestByTicker(ticker: string): Promise<Analysis | null> {
    const rows = await query<{ company_ticker: string; q_curr: string; q_prev: string; payload: unknown }>(
      `SELECT company_ticker, q_curr, q_prev, payload FROM analysis_results
       WHERE company_ticker = $1 ORDER BY created_at DESC LIMIT 1`,
      [ticker]
    );
    if (rows.length === 0) return null;
    return toEntity(rows[0].company_ticker, rows[0].q_prev, rows[0].q_curr, rows[0].payload);
  }

  async listByTickersAndQuarterPair(tickers: string[], qPrev: string, qCurr: string): Promise<AnalysisRecord[]> {
    const rows = await query<{ company_ticker: string; q_curr: string; q_prev: string; payload: unknown; created_at: string }>(
      `SELECT company_ticker, q_curr, q_prev, payload, created_at FROM analysis_results
       WHERE q_prev = $1 AND q_curr = $2 AND company_ticker = ANY($3::text[])
       ORDER BY created_at DESC`,
      [qPrev, qCurr, tickers]
    );
    return rows.map((row) => ({
      ticker: row.company_ticker,
      quarterPrevious: row.q_prev,
      quarter: row.q_curr,
      analysis: toEntity(row.company_ticker, row.q_prev, row.q_curr, row.payload),
      createdAt: row.created_at,
    }));
  }

  async listTickersWithAnalysis(tickers: string[]): Promise<string[]> {
    const rows = await query<{ company_ticker: string }>(
      `SELECT company_ticker FROM analysis_results WHERE company_ticker = ANY($1::text[])`,
      [tickers]
    );
    return rows.map((r) => r.company_ticker);
  }

  async listAllTickerQuarterPairs(): Promise<{ ticker: string; qCurr: string }[]> {
    const rows = await query<{ company_ticker: string; q_curr: string }>(`SELECT company_ticker, q_curr FROM analysis_results`);
    return rows.map((r) => ({ ticker: r.company_ticker, qCurr: r.q_curr }));
  }

  async listUserHistory(userId: string, limit: number): Promise<(AnalysisRecord & { id: string })[]> {
    const rows = await query<{ id: string; company_ticker: string; q_curr: string; payload: unknown; created_at: string }>(
      `SELECT id, company_ticker, q_curr, payload, created_at FROM analysis_results
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return rows.map((row) => ({
      id: row.id,
      ticker: row.company_ticker,
      quarterPrevious: "",
      quarter: row.q_curr,
      analysis: toEntity(row.company_ticker, "", row.q_curr, row.payload),
      createdAt: row.created_at,
    }));
  }
}
