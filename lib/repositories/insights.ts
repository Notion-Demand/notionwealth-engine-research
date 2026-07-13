import { supabaseAdmin } from "@/lib/supabase/admin";
import { query } from "@/lib/postgres/client";
import type { QuarterBrief, RecurringTheme, GuidanceTrack } from "@/lib/insights-pipeline";

export interface InsightsSummary {
  ticker: string;
  quartersAnalyzed: string[];
  quarterBriefs: QuarterBrief[];
  recurringThemes: RecurringTheme[];
  guidanceTracks: GuidanceTrack[];
  managementCredibilityScore: number;
  newBusinessSignals: string[];
  keyWatchpoints: string[];
  segmentNarrative: string;
}

export interface InsightsRepository {
  getCached(ticker: string, quartersKey: string, ttlDays: number): Promise<InsightsSummary | null>;
  saveInsights(ticker: string, quartersKey: string, insights: InsightsSummary): Promise<void>;
  /**
   * Reads the latest cached payload for a ticker with NO quartersKey/TTL filter,
   * returned as a loosely-typed record rather than InsightsSummary. Exists
   * solely for lib/divergence-score.ts's pre-existing read of overall_signal/
   * overall_score — fields that do not exist on InsightsWirePayload. This is a
   * known, unresolved inconsistency being preserved as-is, not a new contract.
   */
  getLatestRawPayload(ticker: string): Promise<Record<string, unknown> | null>;
}

// Wire/persisted shape — matches lib/insights-pipeline.ts's InsightsPayload
// exactly, which is also the real, unowned frontend contract (InsightsClient.tsx
// reads quarters_analyzed/management_credibility_score/recurring_themes
// directly off this shape).
export interface InsightsWirePayload {
  ticker: string;
  quarters_analyzed: string[];
  quarter_briefs: QuarterBrief[];
  recurring_themes: RecurringTheme[];
  guidance_tracks: GuidanceTrack[];
  management_credibility_score: number;
  new_business_signals: string[];
  key_watchpoints: string[];
  segment_narrative: string;
}

function toEntity(raw: InsightsWirePayload): InsightsSummary {
  return {
    ticker: raw.ticker,
    quartersAnalyzed: raw.quarters_analyzed,
    quarterBriefs: raw.quarter_briefs,
    recurringThemes: raw.recurring_themes,
    guidanceTracks: raw.guidance_tracks,
    managementCredibilityScore: raw.management_credibility_score,
    newBusinessSignals: raw.new_business_signals,
    keyWatchpoints: raw.key_watchpoints,
    segmentNarrative: raw.segment_narrative,
  };
}

function fromEntity(s: InsightsSummary): InsightsWirePayload {
  return {
    ticker: s.ticker,
    quarters_analyzed: s.quartersAnalyzed,
    quarter_briefs: s.quarterBriefs,
    recurring_themes: s.recurringThemes,
    guidance_tracks: s.guidanceTracks,
    management_credibility_score: s.managementCredibilityScore,
    new_business_signals: s.newBusinessSignals,
    key_watchpoints: s.keyWatchpoints,
    segment_narrative: s.segmentNarrative,
  };
}

/** For callers (insights-pipeline.ts) that already have an InsightsWirePayload and need to save it. */
export function fromInsightsWirePayload(payload: InsightsWirePayload): InsightsSummary {
  return toEntity(payload);
}

/** For callers that have an InsightsSummary entity and need the exact existing frontend wire shape. */
export function toInsightsWirePayload(s: InsightsSummary): InsightsWirePayload {
  return fromEntity(s);
}

export class SupabaseInsightsRepository implements InsightsRepository {
  async getCached(ticker: string, quartersKey: string, ttlDays: number): Promise<InsightsSummary | null> {
    try {
      const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabaseAdmin()
        .from("insights_cache")
        .select("payload")
        .eq("ticker", ticker)
        .eq("quarters_key", quartersKey)
        .gte("created_at", cutoff)
        .maybeSingle();
      if (error || !data) return null;
      return toEntity(data.payload as InsightsWirePayload);
    } catch {
      return null;
    }
  }

  async saveInsights(ticker: string, quartersKey: string, insights: InsightsSummary): Promise<void> {
    await supabaseAdmin()
      .from("insights_cache")
      .upsert(
        { ticker, quarters_key: quartersKey, payload: fromEntity(insights), created_at: new Date().toISOString() },
        { onConflict: "ticker,quarters_key" }
      );
  }

  async getLatestRawPayload(ticker: string): Promise<Record<string, unknown> | null> {
    const { data } = await supabaseAdmin()
      .from("insights_cache")
      .select("payload")
      .eq("ticker", ticker)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.payload as Record<string, unknown>) ?? null;
  }
}

export class PostgresInsightsRepository implements InsightsRepository {
  async getCached(ticker: string, quartersKey: string, ttlDays: number): Promise<InsightsSummary | null> {
    try {
      const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();
      const rows = await query<{ payload: InsightsWirePayload }>(
        `SELECT payload FROM insights_cache WHERE ticker = $1 AND quarters_key = $2 AND created_at >= $3`,
        [ticker, quartersKey, cutoff]
      );
      if (rows.length === 0) return null;
      return toEntity(rows[0].payload);
    } catch {
      return null;
    }
  }

  async saveInsights(ticker: string, quartersKey: string, insights: InsightsSummary): Promise<void> {
    await query(
      `INSERT INTO insights_cache (ticker, quarters_key, payload, created_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (ticker, quarters_key) DO UPDATE SET payload = EXCLUDED.payload, created_at = EXCLUDED.created_at`,
      [ticker, quartersKey, JSON.stringify(fromEntity(insights)), new Date().toISOString()]
    );
  }

  async getLatestRawPayload(ticker: string): Promise<Record<string, unknown> | null> {
    const rows = await query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM insights_cache WHERE ticker = $1 ORDER BY created_at DESC LIMIT 1`,
      [ticker]
    );
    return rows.length > 0 ? rows[0].payload : null;
  }
}
