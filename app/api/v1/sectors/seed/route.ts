import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SECTOR_UNIVERSE, MARKET_CAPS } from "@/lib/nifty50";
import { fetchAndUploadTranscripts } from "@/lib/transcript-fetcher";
import { runPipeline, resolvePdfKey } from "@/lib/pipeline";
import type { DashboardPayload } from "@/lib/pipeline";
import { getCachedAnalysis, saveAnalysis } from "@/lib/analysis-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — run locally, not on Vercel Hobby

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanySignal {
    ticker: string;
    signal: string;
    direction: "positive" | "neutral" | "negative";
    score: number;
    market_cap: number;
    weight_pct: number;
}

interface SectorDimension {
    dimension: string;
    signal: string;
    direction: "strengthening" | "stable" | "weakening";
    weighted_score: number;
    details: string[];
    company_signals: CompanySignal[];
}

interface SectorIntelligence {
    sector: string;
    sector_label: string;
    company_count: number;
    quarter: string;
    quarter_previous: string;
    dimensions: SectorDimension[];
}

// ── Dimension extraction from analysis payloads ───────────────────────────────

const DIMENSION_KEYWORDS: Record<string, { section: string; keywords: RegExp }> = {
    "Demand Momentum": {
        section: "Revenue & Growth",
        keywords: /demand|order|pipeline|volume|consumption|deal|booking|backlog|growth/i,
    },
    "Pricing Power": {
        section: "Revenue & Growth",
        keywords: /pric|tariff|arpu|premium|discount|rate hike|realiz/i,
    },
    "Capex Cycle": {
        section: "Capital & Liquidity",
        keywords: /capex|capacity|investment|expansion|capital exp|project|greenfield|brownfield/i,
    },
    "Margin Trajectory": {
        section: "Operational Margin",
        keywords: /./, // all subtopics in this section are relevant
    },
    "Management Confidence": {
        section: "__overall__", // derived from overall_score + evasiveness
        keywords: /./,
    },
};

/**
 * Extract per-company, per-dimension scores from a DashboardPayload.
 * Returns a map of dimension → { score, details }.
 */
function extractDimensionScores(payload: DashboardPayload): Map<string, { score: number; details: string[] }> {
    const result = new Map<string, { score: number; details: string[] }>();

    for (const [dimName, config] of Object.entries(DIMENSION_KEYWORDS)) {
        if (config.section === "__overall__") {
            // Management Confidence: derived from overall_score adjusted by evasiveness
            const evasiveness = payload.executive_evasiveness_score ?? 5;
            const adjustedScore = payload.overall_score * (1 - evasiveness / 20);
            result.set(dimName, {
                score: Math.max(-10, Math.min(10, adjustedScore)),
                details: [payload.summary ?? "No summary available"],
            });
            continue;
        }

        const section = payload.insights?.find((ins) => ins.section_name === config.section);
        if (!section || !section.metrics) {
            result.set(dimName, { score: 0, details: ["Insufficient data"] });
            continue;
        }

        const matchedMetrics = section.metrics.filter(
            (m) => config.keywords.test(m.subtopic) || config.keywords.test(m.language_shift)
        );

        if (matchedMetrics.length === 0) {
            // Fall back to section average if no keyword match
            const allScores = section.metrics.map((m) => m.signal_score);
            const avg = allScores.length > 0
                ? allScores.reduce((a, b) => a + b, 0) / allScores.length
                : 0;
            result.set(dimName, {
                score: avg,
                details: section.key_takeaways?.slice(0, 2) ?? ["No specific signals found"],
            });
        } else {
            const scores = matchedMetrics.map((m) => m.signal_score);
            const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
            const details = matchedMetrics
                .slice(0, 3)
                .map((m) => `${m.subtopic}: ${m.language_shift}`);
            result.set(dimName, { score: avg, details });
        }
    }

    return result;
}

/**
 * Compute market-cap weighted sector signals from per-company analysis payloads.
 */
function computeSectorIntelligence(
    sector: string,
    sectorLabel: string,
    companyPayloads: { ticker: string; payload: DashboardPayload; quarter: string; quarterPrev: string }[]
): SectorIntelligence {
    const dimensions: SectorDimension[] = [];
    const quarter = companyPayloads[0]?.quarter ?? "unknown";
    const quarterPrev = companyPayloads[0]?.quarterPrev ?? "unknown";

    for (const dimName of Object.keys(DIMENSION_KEYWORDS)) {
        const companySignals: CompanySignal[] = [];
        let weightedSum = 0;
        let totalWeight = 0;

        for (const { ticker, payload } of companyPayloads) {
            const dimScores = extractDimensionScores(payload);
            const dimData = dimScores.get(dimName);
            if (!dimData) continue;

            const mcap = MARKET_CAPS[ticker] ?? 1;
            weightedSum += dimData.score * mcap;
            totalWeight += mcap;

            companySignals.push({
                ticker,
                signal: dimData.details[0] ?? "No signal",
                direction: dimData.score > 1.5 ? "positive" : dimData.score < -1.5 ? "negative" : "neutral",
                score: Math.round(dimData.score * 100) / 100,
                market_cap: mcap,
                weight_pct: 0, // filled below
            });
        }

        // Fill weight percentages
        for (const cs of companySignals) {
            cs.weight_pct = totalWeight > 0
                ? Math.round((cs.market_cap / totalWeight) * 1000) / 10
                : 0;
        }

        const weightedScore = totalWeight > 0
            ? Math.round((weightedSum / totalWeight) * 100) / 100
            : 0;

        const direction: "strengthening" | "stable" | "weakening" =
            weightedScore > 1.5 ? "strengthening" : weightedScore < -1.5 ? "weakening" : "stable";

        // Build summary signal text
        const positiveCount = companySignals.filter((cs) => cs.direction === "positive").length;
        const negativeCount = companySignals.filter((cs) => cs.direction === "negative").length;
        const totalCount = companySignals.length;

        let signal: string;
        if (direction === "strengthening") {
            signal = `${positiveCount}/${totalCount} companies showing positive momentum.`;
        } else if (direction === "weakening") {
            signal = `${negativeCount}/${totalCount} companies showing weakness.`;
        } else {
            signal = `Mixed signals across ${totalCount} companies.`;
        }

        // Collect top details across companies
        const allDetails: string[] = [];
        for (const { ticker, payload } of companyPayloads) {
            const dimScores = extractDimensionScores(payload);
            const dimData = dimScores.get(dimName);
            if (dimData && dimData.details.length > 0 && dimData.details[0] !== "Insufficient data") {
                allDetails.push(`${ticker}: ${dimData.details[0]}`);
            }
        }

        dimensions.push({
            dimension: dimName,
            signal,
            direction,
            weighted_score: weightedScore,
            details: allDetails.slice(0, 4),
            company_signals: companySignals.sort((a, b) => b.weight_pct - a.weight_pct),
        });
    }

    return {
        sector,
        sector_label: sectorLabel,
        company_count: companyPayloads.length,
        quarter,
        quarter_previous: quarterPrev,
        dimensions,
    };
}

/**
 * Convert Indian FY quarter string to a sortable calendar index.
 * Q1_2026 = Apr-Jun 2025 → 202504
 * Q2_2026 = Jul-Sep 2025 → 202507
 * Q3_2026 = Oct-Dec 2025 → 202510
 * Q4_2025 = Jan-Mar 2025 → 202501
 */
function quarterToCalendarIndex(q: string): number {
    const m = q.match(/^Q(\d)_(\d{4})$/);
    if (!m) return 0;
    const qNum = parseInt(m[1]);
    const fy = parseInt(m[2]);
    const calendarMonth = { 1: 4, 2: 7, 3: 10, 4: 1 }[qNum] ?? 1;
    const calendarYear = qNum <= 3 ? fy - 1 : fy;
    return calendarYear * 100 + calendarMonth;
}

// ── Main seed handler ─────────────────────────────────────────────────────────

export async function POST() {
    const startTime = Date.now();
    const log: string[] = [];
    const sectorResults: SectorIntelligence[] = [];

    // Clean up any stale sector_intelligence rows before re-seeding
    const validSectors = Object.keys(SECTOR_UNIVERSE);
    await supabaseAdmin()
        .from("sector_intelligence")
        .delete()
        .in("sector", validSectors);
    log.push(`Cleared old sector_intelligence rows for ${validSectors.length} sectors.`);

    for (const [sector, config] of Object.entries(SECTOR_UNIVERSE)) {
        log.push(`\n=== Processing sector: ${sector} (${config.tickers.join(", ")}) ===`);

        // Step 1: Fetch & upload transcripts for each company
        for (const ticker of config.tickers) {
            log.push(`[${sector}/${ticker}] Fetching transcripts...`);
            try {
                const result = await fetchAndUploadTranscripts(ticker, 4);
                log.push(`[${sector}/${ticker}] uploaded=${result.uploaded.length} skipped=${result.skipped.length} errors=${result.errors.length}`);
                if (result.errors.length > 0) {
                    log.push(`[${sector}/${ticker}] errors: ${result.errors.join(", ")}`);
                }
            } catch (e) {
                log.push(`[${sector}/${ticker}] FETCH FAILED: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        // Step 2: For each company, find available quarter pairs and run analysis
        const companyPayloads: { ticker: string; payload: DashboardPayload; quarter: string; quarterPrev: string }[] = [];

        for (const ticker of config.tickers) {
            log.push(`[${sector}/${ticker}] Looking for available transcripts...`);

            // List available PDFs for this ticker
            const allFiles: { name: string }[] = [];
            let off = 0;
            while (true) {
                const { data: page } = await supabaseAdmin()
                    .storage.from("transcripts")
                    .list("", { limit: 100, offset: off, search: ticker });
                if (!page || page.length === 0) break;
                allFiles.push(...page);
                off += page.length;
            }

            const fileRe = new RegExp(`^${ticker}_Q(\\d)_(\\d{4})\\.pdf$`, "i");

            const quarters = allFiles
                .map((f) => {
                    const m = f.name.match(fileRe);
                    return m ? `Q${m[1]}_${m[2]}` : null;
                })
                .filter((q): q is string => q !== null)
                .sort((a, b) => quarterToCalendarIndex(b) - quarterToCalendarIndex(a)); // newest first

            if (quarters.length < 2) {
                log.push(`[${sector}/${ticker}] Only ${quarters.length} quarters available, need ≥2. Skipping.`);
                continue;
            }

            // Use the two most recent quarters
            const qCurr = quarters[0];
            const qPrev = quarters[1];

            // Check cache first
            const cached = await getCachedAnalysis(ticker, qPrev, qCurr);
            if (cached) {
                log.push(`[${sector}/${ticker}] Cache HIT for ${qPrev}→${qCurr}`);
                companyPayloads.push({ ticker, payload: cached, quarter: qCurr, quarterPrev: qPrev });
                continue;
            }

            // Run analysis pipeline
            log.push(`[${sector}/${ticker}] Running analysis pipeline for ${qPrev}→${qCurr}...`);
            try {
                const qPrevKey = await resolvePdfKey(ticker, qPrev);
                const qCurrKey = await resolvePdfKey(ticker, qCurr);
                const payload = await runPipeline(qPrevKey, qCurrKey);

                // Save to cache
                await saveAnalysis(null, ticker, qPrev, qCurr, payload);
                companyPayloads.push({ ticker, payload, quarter: qCurr, quarterPrev: qPrev });
                log.push(`[${sector}/${ticker}] Analysis complete. Overall: ${payload.overall_signal} (${payload.overall_score})`);
            } catch (e) {
                log.push(`[${sector}/${ticker}] PIPELINE FAILED: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        // Step 3: Compute market-cap weighted sector intelligence
        if (companyPayloads.length >= 1) {
            const sectorIntel = computeSectorIntelligence(sector, config.label, companyPayloads);
            sectorResults.push(sectorIntel);

            // Save to DB
            const quarter = companyPayloads[0].quarter;
            await supabaseAdmin()
                .from("sector_intelligence")
                .upsert(
                    {
                        sector,
                        quarter,
                        payload: sectorIntel as unknown as Record<string, unknown>,
                    },
                    { onConflict: "sector,quarter" }
                );

            log.push(`[${sector}] Stored sector intelligence: ${companyPayloads.length} companies, quarter=${quarter}`);
        } else {
            log.push(`[${sector}] No company data available. Skipping sector.`);
        }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log.push(`\n=== DONE in ${elapsed}s. ${sectorResults.length} sectors processed. ===`);

    return NextResponse.json(
        {
            ok: true,
            sectors_processed: sectorResults.length,
            elapsed_seconds: elapsed,
            log,
        },
        { headers: { "Cache-Control": "no-store" } }
    );
}
