import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SECTOR_UNIVERSE, MARKET_CAPS } from "@/lib/nifty50";
import { fetchAndUploadTranscripts } from "@/lib/transcript-fetcher";
import { runPipeline, resolvePdfKey } from "@/lib/pipeline";
import type { DashboardPayload } from "@/lib/pipeline";
import { getCachedAnalysis, saveAnalysis } from "@/lib/analysis-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 60s per sector call — pass ?sector=Banking to seed one at a time

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

// NOTE: section names must match the pipeline's SECTION_NAMES exactly:
//   "Revenue & Growth", "Margins & Profitability", "Cost Structure",
//   "CapEx & Balance Sheet", "Macro & Risk"
const DIMENSION_KEYWORDS: Record<string, { section: string; keywords: RegExp }> = {
    "Demand Momentum": {
        section: "Revenue & Growth",
        keywords: /demand|order|pipeline|volume|consumption|deal|booking|backlog|growth/i,
    },
    "Pricing Power": {
        section: "Revenue & Growth",
        keywords: /pric|tariff|arpu|premium|discount|rate hike|realiz/i,
    },
    "Margin Trajectory": {
        section: "Margins & Profitability",   // was "Operational Margin" — broken; now fixed
        keywords: /./, // all subtopics in this section are relevant
    },
    "Cost Pressure": {
        section: "Cost Structure",             // NEW dimension
        keywords: /raw material|commodity|energy|power|labour|freight|input cost|working capital/i,
    },
    "CapEx & Allocation": {
        section: "CapEx & Balance Sheet",      // was "Capital & Liquidity" — broken; now fixed
        keywords: /capex|capacity|investment|expansion|debt|fcf|free cash|return|roic/i,
    },
    "Macro & Cycle Risk": {
        section: "Macro & Risk",               // NEW dimension
        keywords: /./, // entire section is relevant
    },
    "Management Confidence": {
        section: "__overall__",
        keywords: /./,
    },
    "Earnings Quality": {
        section: "__validation__",             // NEW — derived from validation metrics
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

        if (config.section === "__validation__") {
            // Earnings Quality: validation_score (0-100) + flagged signal penalty
            const validationScore = payload.validation_score ?? 70;
            const flaggedCount = payload.flagged_count ?? 0;
            // Map to -10..+10: 100 validation = +5, 50 = 0, 0 = -5, then subtract 0.5 per flag
            const raw = (validationScore / 100) * 10 - 5 - flaggedCount * 0.5;
            const score = Math.max(-10, Math.min(10, raw));
            const details = flaggedCount > 0
                ? [`${flaggedCount} signals flagged — earnings quality requires scrutiny`]
                : [`Validation score ${validationScore.toFixed(0)}% — signals appear clean`];
            result.set(dimName, { score, details });
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

export async function POST(request: Request) {
    const startTime = Date.now();
    const log: string[] = [];
    const sectorResults: SectorIntelligence[] = [];

    // Query params:
    //   ?sector=Banking      → seed only that one sector (required for Vercel)
    //   ?skipFetch=true      → skip transcript download step (use existing storage files)
    //   ?maxNew=N            → run at most N fresh pipeline (Gemini) analyses per call
    //                          use skipFetch=true&maxNew=1 to fill cache one ticker at a time
    //                          use skipFetch=true&maxNew=0 for pure cache-only aggregation
    // No params              → seed all sectors, download new transcripts (local use only)
    const { searchParams } = new URL(request.url);
    const sectorParam = searchParams.get("sector");
    const skipFetch = searchParams.get("skipFetch") === "true";
    const maxNew = parseInt(searchParams.get("maxNew") ?? "999", 10);

    const sectorsToProcess = sectorParam
        ? Object.entries(SECTOR_UNIVERSE).filter(([s]) => s === sectorParam)
        : Object.entries(SECTOR_UNIVERSE);

    if (sectorParam && sectorsToProcess.length === 0) {
        return NextResponse.json(
            { error: `Unknown sector: ${sectorParam}`, available: Object.keys(SECTOR_UNIVERSE) },
            { status: 400 }
        );
    }

    // NOTE: old code deleted rows up-front then inserted later — if the function
    // timed out between DELETE and INSERT the sector would vanish from the DB.
    // Instead, we now delete immediately before each sector's INSERT (atomic swap).
    const sectorsBeingSeeded = sectorsToProcess.map(([s]) => s);
    log.push(`Will seed: ${sectorsBeingSeeded.join(", ")} | skipFetch=${skipFetch}`);

    for (const [sector, config] of sectorsToProcess) {
        log.push(`\n=== Processing sector: ${sector} (${config.tickers.join(", ")}) ===`);

        // Step 1: Fetch & upload transcripts (skip if ?skipFetch=true)
        if (!skipFetch) {
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
        } else {
            log.push(`[${sector}] Skipping transcript fetch (skipFetch=true)`);
        }

        // Step 2: For each company, find available quarter pairs and run analysis
        const companyPayloads: { ticker: string; payload: DashboardPayload; quarter: string; quarterPrev: string }[] = [];
        let newPipelineRuns = 0; // counts fresh pipeline runs this call (for maxNew enforcement)

        for (const ticker of config.tickers) {
            log.push(`[${sector}/${ticker}] Looking for available transcripts...`);

            // List available PDFs for this ticker.
            // Stop as soon as we have ≥2 matching quarters — avoids paging through hundreds
            // of files for large-cap tickers like HDFC/SBI that have many transcripts uploaded.
            const fileRe = new RegExp(`^${ticker}_Q(\\d)_(\\d{4})\\.pdf$`, "i");
            const foundQuarters: string[] = [];
            let off = 0;
            outer: while (true) {
                const { data: page } = await supabaseAdmin()
                    .storage.from("transcripts")
                    .list("", { limit: 100, offset: off, search: ticker });
                if (!page || page.length === 0) break;
                for (const f of page) {
                    const m = f.name.match(fileRe);
                    if (m) foundQuarters.push(`Q${m[1]}_${m[2]}`);
                    if (foundQuarters.length >= 8) break outer; // have enough, stop paging
                }
                if (page.length < 100) break; // last page
                off += page.length;
            }

            const quarters = foundQuarters
                .sort((a, b) => quarterToCalendarIndex(b) - quarterToCalendarIndex(a)); // newest first

            if (quarters.length < 2) {
                log.push(`[${sector}/${ticker}] Only ${quarters.length} quarters available, need ≥2. Skipping.`);
                continue;
            }

            // Try each consecutive quarter pair from most recent backwards until we find a cache hit.
            // This means BHARTI at (Q1_2026→Q2_2026) still contributes even if (Q2_2026→Q3_2026)
            // hasn't been analyzed yet — avoids empty sectors just because the newest pair isn't cached.
            let foundCached: { payload: DashboardPayload; qCurr: string; qPrev: string } | null = null;
            for (let qi = 0; qi < quarters.length - 1; qi++) {
                const qC = quarters[qi];     // newer
                const qP = quarters[qi + 1]; // older
                const hit = await getCachedAnalysis(ticker, qP, qC, { strict: false });
                if (hit) {
                    foundCached = { payload: hit, qCurr: qC, qPrev: qP };
                    break;
                }
            }

            if (foundCached) {
                log.push(`[${sector}/${ticker}] Cache HIT for ${foundCached.qPrev}→${foundCached.qCurr}`);
                companyPayloads.push({ ticker, payload: foundCached.payload, quarter: foundCached.qCurr, quarterPrev: foundCached.qPrev });
                continue;
            }

            // No cached analysis found for any quarter pair — fall through to pipeline
            const qCurr = quarters[0];
            const qPrev = quarters[1];

            // maxNew=0 means cache-only — never run the pipeline
            // maxNew>0 (default 999) allows up to N fresh analyses this call
            if (newPipelineRuns >= maxNew) {
                log.push(`[${sector}/${ticker}] maxNew=${maxNew} reached — deferring to next call`);
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
                newPipelineRuns++;
                log.push(`[${sector}/${ticker}] Analysis complete. Overall: ${payload.overall_signal} (${payload.overall_score})`);
            } catch (e) {
                log.push(`[${sector}/${ticker}] PIPELINE FAILED: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        // Step 3: Compute market-cap weighted sector intelligence
        if (companyPayloads.length >= 1) {
            const sectorIntel = computeSectorIntelligence(sector, config.label, companyPayloads);
            sectorResults.push(sectorIntel);

            // Save to DB — delete-then-insert (atomic swap, right before write).
            // Keeps existing data if the function times out during pipeline runs above.
            const quarter = companyPayloads[0].quarter;

            // Delete ALL existing rows for this sector (any quarter) then insert fresh.
            await supabaseAdmin()
                .from("sector_intelligence")
                .delete()
                .eq("sector", sector);

            const { data: insertData, error: insertErr } = await supabaseAdmin()
                .from("sector_intelligence")
                .insert({
                    sector,
                    quarter,
                    payload: sectorIntel as unknown as Record<string, unknown>,
                })
                .select("id")
                .single();

            if (insertErr) {
                log.push(`[${sector}] DB INSERT ERROR: ${insertErr.message} (code=${insertErr.code})`);
            } else {
                log.push(`[${sector}] Stored sector intelligence: ${companyPayloads.length} companies, quarter=${quarter} id=${insertData?.id}`);
            }
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
