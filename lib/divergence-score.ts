/**
 * Divergence score v1 — cross-references promoter pledge-activity frequency
 * against the existing concall sentiment signal (overall_signal/overall_score
 * from lib/pipeline.ts).
 *
 * v1 is frequency-based, not directional: SEBI Reg. 31 disclosures fire on
 * BOTH pledge increases and releases, and the headline text alone doesn't
 * say which. So this flags an *activity spike* worth checking against the
 * underlying filing — it does not itself claim bullish/bearish promoter intent.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PromoterActivityEvent } from "./promoter-activity-fetcher";

export type PledgeActivityLevel = "quiet" | "normal" | "elevated";

export interface DivergenceResult {
  ticker: string;
  pledgeActivityLevel: PledgeActivityLevel;
  pledgeEventsRecent: number;
  pledgeEventsBaseline: number; // baseline rate, normalized to a 90-day window
  recentEvents: PromoterActivityEvent[];
  concallSignal: "Positive" | "Negative" | "Mixed" | "Noise" | null;
  concallScore: number | null;
  flag: boolean; // elevated pledge activity + Positive/Mixed concall read
  note: string;
}

const RECENT_WINDOW_DAYS = 90;
const BASELINE_WINDOW_DAYS = 450; // ~15 months prior to the recent window
const SPIKE_MULTIPLIER = 1.5;

function daysAgo(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
}

export async function computeDivergence(
  ticker: string,
  events: PromoterActivityEvent[]
): Promise<DivergenceResult> {
  const pledgeEvents = events.filter((e) => e.eventType === "pledge");
  const recentEvents = pledgeEvents.filter((e) => daysAgo(e.disclosureDate) <= RECENT_WINDOW_DAYS);
  const baselineEvents = pledgeEvents.filter((e) => {
    const age = daysAgo(e.disclosureDate);
    return age > RECENT_WINDOW_DAYS && age <= BASELINE_WINDOW_DAYS;
  });

  // Normalize baseline count to a "per RECENT_WINDOW_DAYS" rate for comparison
  const baselineSpanDays = BASELINE_WINDOW_DAYS - RECENT_WINDOW_DAYS;
  const baselineRate = (baselineEvents.length / baselineSpanDays) * RECENT_WINDOW_DAYS;

  let pledgeActivityLevel: PledgeActivityLevel;
  if (recentEvents.length === 0) {
    pledgeActivityLevel = "quiet";
  } else if (recentEvents.length > baselineRate * SPIKE_MULTIPLIER) {
    pledgeActivityLevel = "elevated";
  } else {
    pledgeActivityLevel = "normal";
  }

  // Latest concall sentiment read, if one exists
  const { data } = await supabaseAdmin()
    .from("insights_cache")
    .select("payload")
    .eq("ticker", ticker)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = data?.payload as
    | { overall_signal?: DivergenceResult["concallSignal"]; overall_score?: number }
    | undefined;
  const concallSignal = payload?.overall_signal ?? null;
  const concallScore = payload?.overall_score ?? null;

  const flag =
    pledgeActivityLevel === "elevated" &&
    (concallSignal === "Positive" || concallSignal === "Mixed");

  let note: string;
  if (pledgeActivityLevel === "elevated") {
    note = flag
      ? `Promoter pledge-related filings rose to ${recentEvents.length} in the last ${RECENT_WINDOW_DAYS} days (vs. a ~${baselineRate.toFixed(1)} baseline) while the latest concall read as ${concallSignal}. Worth checking the underlying BSE filings for direction.`
      : `Promoter pledge-related filings rose to ${recentEvents.length} in the last ${RECENT_WINDOW_DAYS} days (vs. a ~${baselineRate.toFixed(1)} baseline).`;
  } else if (pledgeActivityLevel === "normal") {
    note = `${recentEvents.length} promoter pledge-related filing${recentEvents.length > 1 ? "s" : ""} in the last ${RECENT_WINDOW_DAYS} days — within the recent baseline.`;
  } else {
    note = "No promoter pledge-related disclosures in the last 18 months.";
  }

  return {
    ticker,
    pledgeActivityLevel,
    pledgeEventsRecent: recentEvents.length,
    pledgeEventsBaseline: Math.round(baselineRate * 10) / 10,
    recentEvents,
    concallSignal,
    concallScore,
    flag,
    note,
  };
}
