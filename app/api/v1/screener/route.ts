import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NIFTY200 } from "@/lib/nifty200";
import { QUARTERS } from "@/lib/nifty50";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Always compare the two most recent global quarters
const Q_CURR = QUARTERS[0]; // e.g. Q4_2026
const Q_PREV = QUARTERS[1]; // e.g. Q3_2026

// ── Payload types ─────────────────────────────────────────────────────────────

interface MetricDelta {
    subtopic: string;
    language_shift: string;
    signal_classification: "Positive" | "Negative" | "Noise";
    signal_score: number;
}

interface SectionalInsight {
    section_name: string;
    metrics: MetricDelta[];
}

interface StoredPayload {
    company_ticker: string;
    quarter: string;
    quarter_previous: string;
    overall_score: number;
    overall_signal: "Positive" | "Negative" | "Mixed" | "Noise";
    summary: string;
    insights: SectionalInsight[];
    earnings_delta?: string[];
    // Signal quality fields (all present in pipeline output)
    validation_score?: number;        // 0–100
    flagged_count?: number;           // integer ≥ 0
    executive_evasiveness_score?: number; // 0–10
}

export interface ScreenerSignal {
    ticker: string;
    subtopic: string;
    language_shift: string;
    score: number;
    signal: "Positive" | "Negative" | "Noise";
    section: string;
    overall_score: number;
    overall_signal: "Positive" | "Negative" | "Mixed" | "Noise";
    summary: string;
    quarter: string;
    quarter_previous: string;
    earnings_delta: string[];
    // Confidence layer
    confidence_pct: number;           // 0–100: how trustworthy the signal is
    adjusted_score: number;           // score × confidence_multiplier
    flags: SignalFlag[];              // warning flags that reduced confidence
}

export type SignalFlag =
    | "DISCLOSURE INFLATION"
    | "EARNINGS QUALITY"
    | "ONE-TIME ITEMS"
    | "MANAGEMENT EVASION"
    | "NARRATIVE TRAP";

// ── Confidence computation ────────────────────────────────────────────────────

/**
 * Detect if the Q-over-Q comparison is inflated by disclosure quality improvement
 * rather than actual business improvement. We look for language that signals the
 * previous quarter had insufficient transcript data.
 */
function detectDisclosureInflation(summary: string, earningsDelta: string[]): boolean {
    const corpus = [summary, ...earningsDelta].join(" ");
    return /placeholder|lack of actionable|no actionable|previous quarter lacked|complete lack|absence of.*data|no transcript|prior quarter.*no|no prior|compared to.*absence|stark contrast.*lack|limited.*previous|insufficient.*prev/i.test(corpus);
}

interface ConfidenceResult {
    multiplier: number;   // 0–1 applied to raw score
    pct: number;          // 0–100 rounded
    flags: SignalFlag[];
}

function computeConfidence(
    validationScore: number,
    flaggedCount: number,
    evasiveness: number,
    isDisclosureInflation: boolean,
    rawScore: number
): ConfidenceResult {
    const flags: SignalFlag[] = [];

    // 1. Earnings quality (validation_score 0→100 maps to factor 0.5→1.0)
    const earningsQuality = Math.min(1.0, 0.5 + validationScore / 200);
    if (validationScore < 55 || flaggedCount >= 3) {
        flags.push("EARNINGS QUALITY");
    }

    // 2. One-time item flags (each flag = -12% confidence, floor 0.5)
    const flagPenalty = Math.max(0.5, 1 - flaggedCount * 0.12);
    if (flaggedCount >= 2) {
        flags.push("ONE-TIME ITEMS");
    }

    // 3. Management evasiveness (0→10 maps to factor 1.0→0.5)
    const evasivenessFactor = Math.max(0.5, 1 - evasiveness / 20);
    if (evasiveness > 6.5) {
        flags.push("MANAGEMENT EVASION");
    }

    // 4. Disclosure inflation (biggest penalty — signal reflects IR improvement, not business)
    const disclosureFactor = isDisclosureInflation ? 0.4 : 1.0;
    if (isDisclosureInflation) {
        flags.push("DISCLOSURE INFLATION");
    }

    const multiplier = earningsQuality * flagPenalty * evasivenessFactor * disclosureFactor;
    const pct = Math.round(multiplier * 100);

    // 5. Narrative trap: raw score is very bullish but confidence is low
    if (rawScore > 6 && pct < 50) {
        flags.push("NARRATIVE TRAP");
    }

    return { multiplier, pct, flags };
}

// ── Main handler ──────────────────────────────────────────────────────────────

/** GET /api/v1/screener — returns confidence-adjusted narrative change signals across Nifty 200 */
export async function GET() {
    const nifty200Tickers = Object.keys(NIFTY200);

    const { data: rows, error } = await supabaseAdmin()
        .from("analysis_results")
        .select("company_ticker, q_curr, q_prev, payload, created_at")
        .eq("q_prev", Q_PREV)
        .eq("q_curr", Q_CURR)
        .in("company_ticker", nifty200Tickers)
        .order("created_at", { ascending: false });

    if (error) {
        console.error("[screener] DB error:", error);
        return NextResponse.json({ error: "Failed to fetch results" }, { status: 500 });
    }

    // Fall back to the previous quarter pair if the latest has no data yet
    let effectiveRows = rows ?? [];
    let effectiveQCurr = Q_CURR;
    let effectiveQPrev = Q_PREV;

    if (effectiveRows.length === 0 && QUARTERS.length >= 3) {
        const fallbackCurr = QUARTERS[1];
        const fallbackPrev = QUARTERS[2];
        const { data: fallbackRows } = await supabaseAdmin()
            .from("analysis_results")
            .select("company_ticker, q_curr, q_prev, payload, created_at")
            .eq("q_prev", fallbackPrev)
            .eq("q_curr", fallbackCurr)
            .in("company_ticker", nifty200Tickers)
            .order("created_at", { ascending: false });
        if (fallbackRows && fallbackRows.length > 0) {
            effectiveRows = fallbackRows;
            effectiveQCurr = fallbackCurr;
            effectiveQPrev = fallbackPrev;
        }
    }

    if (effectiveRows.length === 0) {
        return NextResponse.json({ signals: [], quarter: Q_CURR, quarter_previous: Q_PREV });
    }

    // Keep only the most recent result per ticker
    const latestByTicker = new Map<string, typeof effectiveRows[0]>();
    for (const row of effectiveRows) {
        if (!latestByTicker.has(row.company_ticker)) {
            latestByTicker.set(row.company_ticker, row);
        }
    }

    const signals: ScreenerSignal[] = [];

    for (const [ticker, row] of Array.from(latestByTicker)) {
        let payload: StoredPayload;
        try {
            payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
        } catch {
            continue;
        }

        if (!payload?.insights || !Array.isArray(payload.insights)) continue;

        // Collect all non-Noise metrics
        const allMetrics: { metric: MetricDelta; section: string }[] = [];
        for (const insight of payload.insights) {
            if (!insight.metrics) continue;
            for (const m of insight.metrics) {
                if (m.signal_classification !== "Noise" && Math.abs(m.signal_score) > 0.5) {
                    allMetrics.push({ metric: m, section: insight.section_name });
                }
            }
        }
        if (allMetrics.length === 0) continue;

        // Sort by |score| descending — pick top signal
        allMetrics.sort((a, b) => Math.abs(b.metric.signal_score) - Math.abs(a.metric.signal_score));
        const top = allMetrics[0];

        // Confidence computation
        const validationScore = payload.validation_score ?? 70;
        const flaggedCount = payload.flagged_count ?? 0;
        const evasiveness = payload.executive_evasiveness_score ?? 5;
        const disclosureInflation = detectDisclosureInflation(
            payload.summary ?? "",
            payload.earnings_delta ?? []
        );
        const confidence = computeConfidence(
            validationScore,
            flaggedCount,
            evasiveness,
            disclosureInflation,
            top.metric.signal_score
        );

        signals.push({
            ticker,
            subtopic: top.metric.subtopic,
            language_shift: top.metric.language_shift,
            score: top.metric.signal_score,
            signal: top.metric.signal_classification,
            section: top.section,
            overall_score: payload.overall_score ?? 0,
            overall_signal: payload.overall_signal ?? "Noise",
            summary: payload.summary ?? "",
            quarter: effectiveQCurr,
            quarter_previous: effectiveQPrev,
            earnings_delta: payload.earnings_delta ?? [],
            confidence_pct: confidence.pct,
            adjusted_score: Math.round(top.metric.signal_score * confidence.multiplier * 100) / 100,
            flags: confidence.flags,
        });
    }

    // Rank by |adjusted_score| descending (confidence-weighted)
    signals.sort((a, b) => Math.abs(b.adjusted_score) - Math.abs(a.adjusted_score));

    return NextResponse.json(
        {
            signals,
            quarter: effectiveQCurr,
            quarter_previous: effectiveQPrev,
            companies_analyzed: signals.length,
        },
        { headers: { "Cache-Control": "no-store" } }
    );
}
