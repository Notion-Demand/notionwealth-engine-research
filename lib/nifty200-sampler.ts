/**
 * Nifty 200 Sampler
 *
 * Queries analysis_results for Nifty 200 companies beyond the primary
 * SECTOR_UNIVERSE tickers to enrich sector narrative generation.
 * These "extended context" signals give Gemini a broader picture of the sector.
 */

import { analysisRepo } from "@/lib/repositories";
import { NIFTY200 } from "@/lib/nifty200";

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
    const records = await analysisRepo.listRecentByTickersAndQuarter(candidateTickers, qCurr, maxSamples * 3);
    if (records.length === 0) return [];

    const seen = new Set<string>();
    const results: CompactSignal[] = [];

    for (const record of records) {
        if (seen.has(record.ticker)) continue;
        seen.add(record.ticker);

        const { analysis } = record;

        // Skip empty or low-quality results
        if (!Array.isArray(analysis.sections) || analysis.sections.length === 0) continue;
        if (!analysis.summary?.trim()) continue;

        const info = NIFTY200[record.ticker];
        results.push({
            ticker: record.ticker,
            name: info?.name ?? record.ticker,
            overall_signal: analysis.overallSignal ?? "Neutral",
            overall_score: analysis.overallScore ?? 0,
            summary: analysis.summary.trim(),
        });

        if (results.length >= maxSamples) break;
    }

    return results;
}
