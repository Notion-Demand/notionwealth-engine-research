/**
 * Nifty 200 Sampler
 *
 * Queries analysis_results for Nifty 200 companies beyond the primary
 * SECTOR_UNIVERSE tickers to enrich sector narrative generation.
 * These "extended context" signals give Gemini a broader picture of the sector.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { NIFTY200 } from "@/lib/nifty200";
import type { DashboardPayload } from "@/lib/pipeline";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Compact signal used for narrative enrichment — not stored in DB */
export interface CompactSignal {
    ticker: string;
    name: string;
    overall_signal: string;
    overall_score: number;
    summary: string;
}

// ── Sector → Nifty 200 sector tag mapping ────────────────────────────────────

/**
 * Maps SECTOR_UNIVERSE / SUB_SECTOR_UNIVERSE keys to the sector tag(s)
 * present in the NIFTY200 registry.  Multiple tags = OR match.
 */
const SECTOR_TO_NIFTY200_TAGS: Record<string, string[]> = {
    // Core sectors
    Banking:          ["Banking"],
    NBFC:             ["NBFC", "Financial Services"],
    Insurance:        ["Insurance"],
    IT:               ["IT"],
    Auto:             ["Auto"],
    CapGoods:         ["Capital Goods"],
    Infra:            ["Infra"],
    Realty:           ["Realty"],
    FMCG:             ["FMCG"],
    Consumer:         ["Consumer"],
    Pharma:           ["Pharma"],
    Healthcare:       ["Healthcare"],
    "Oil & Gas":      ["Oil & Gas"],
    Power:            ["Power"],
    Metals:           ["Metals"],
    Cement:           ["Cement"],
    Telecom:          ["Telecom"],
    // Sub-sectors
    "PSU Banks":      ["Banking"],
    "Private Banks":  ["Banking"],
    "Capital Markets":["Financial Services"],
    "IT Midcap":      ["IT"],
    Renewables:       ["Power"],
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Sample additional Nifty 200 signals for a sector from the analysis cache.
 * Returns up to maxSamples compact signals for companies NOT in primaryTickers.
 *
 * @param sector         SECTOR_UNIVERSE key (e.g. "Banking")
 * @param qCurr          Current quarter (e.g. "Q3_2026")
 * @param primaryTickers Tickers already included in the sector's primary analysis
 * @param maxSamples     Max additional signals to return (default 6)
 */
export async function sampleNifty200Signals(
    sector: string,
    qCurr: string,
    primaryTickers: string[],
    maxSamples = 6
): Promise<CompactSignal[]> {
    const tags = SECTOR_TO_NIFTY200_TAGS[sector];
    if (!tags || tags.length === 0) return [];

    // Find Nifty 200 tickers in this sector not already in primary list
    const primarySet = new Set(primaryTickers.map((t) => t.toUpperCase()));
    const candidateTickers = Object.entries(NIFTY200)
        .filter(([ticker, info]) =>
            tags.includes(info.sector) && !primarySet.has(ticker.toUpperCase())
        )
        .map(([ticker]) => ticker.toUpperCase());

    if (candidateTickers.length === 0) return [];

    // Batch query — fetch extra rows to allow for dedup/quality filtering
    const { data, error } = await supabaseAdmin()
        .from("analysis_results")
        .select("company_ticker, payload")
        .eq("q_curr", qCurr)
        .in("company_ticker", candidateTickers)
        .order("created_at", { ascending: false })
        .limit(maxSamples * 3);

    if (error || !data || data.length === 0) return [];

    const seen = new Set<string>();
    const results: CompactSignal[] = [];

    for (const row of data) {
        if (seen.has(row.company_ticker)) continue;
        seen.add(row.company_ticker);

        // Parse payload
        let payload: DashboardPayload;
        try {
            payload = typeof row.payload === "string"
                ? (JSON.parse(row.payload) as DashboardPayload)
                : (row.payload as unknown as DashboardPayload);
        } catch {
            continue;
        }

        // Skip empty or low-quality results
        if (!Array.isArray(payload.insights) || payload.insights.length === 0) continue;
        if (!payload.summary?.trim()) continue;

        const info = NIFTY200[row.company_ticker];
        results.push({
            ticker: row.company_ticker,
            name: info?.name ?? row.company_ticker,
            overall_signal: payload.overall_signal ?? "Neutral",
            overall_score: payload.overall_score ?? 0,
            summary: payload.summary.trim(),
        });

        if (results.length >= maxSamples) break;
    }

    return results;
}
