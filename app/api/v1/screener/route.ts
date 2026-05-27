import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NIFTY200 } from "@/lib/nifty200";
import { NIFTY50, QUARTERS } from "@/lib/nifty50";

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
    /** true = this is the global current quarter pair (Q_CURR/Q_PREV) */
    is_current_quarter: boolean;
    /** true = this ticker is in the Nifty 50 */
    is_nifty50: boolean;
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

// ── Quarter → sortable calendar index ────────────────────────────────────────

function qIdx(q: string): number {
    const m = q.match(/^Q(\d)_(\d{4})$/);
    if (!m) return 0;
    const qNum = parseInt(m[1]);
    const fy = parseInt(m[2]);
    const calMonth = ({ 1: 4, 2: 7, 3: 10, 4: 1 } as Record<number, number>)[qNum] ?? 1;
    return (qNum <= 3 ? fy - 1 : fy) * 100 + calMonth;
}

// ── Signal builder ────────────────────────────────────────────────────────────

type DbRow = { company_ticker: string; q_curr: string; q_prev: string; payload: unknown; created_at: string };

function buildSignal(
    ticker: string,
    row: DbRow,
    isNifty50: boolean,
): ScreenerSignal | null {
    let payload: StoredPayload;
    try {
        payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload as StoredPayload;
    } catch {
        return null;
    }
    if (!payload?.insights || !Array.isArray(payload.insights)) return null;

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
    if (allMetrics.length === 0) return null;

    allMetrics.sort((a, b) => Math.abs(b.metric.signal_score) - Math.abs(a.metric.signal_score));
    const top = allMetrics[0];

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

    return {
        ticker,
        subtopic: top.metric.subtopic,
        language_shift: top.metric.language_shift,
        score: top.metric.signal_score,
        signal: top.metric.signal_classification,
        section: top.section,
        overall_score: payload.overall_score ?? 0,
        overall_signal: payload.overall_signal ?? "Noise",
        summary: payload.summary ?? "",
        quarter: row.q_curr,
        quarter_previous: row.q_prev,
        earnings_delta: payload.earnings_delta ?? [],
        confidence_pct: confidence.pct,
        adjusted_score: Math.round(top.metric.signal_score * confidence.multiplier * 100) / 100,
        flags: confidence.flags,
        is_current_quarter: row.q_curr === Q_CURR && row.q_prev === Q_PREV,
        is_nifty50: isNifty50,
    };
}

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/screener
 *
 * Two-pass strategy:
 *  Pass 1 — Nifty 50: fetch ALL analysis_results rows per ticker (any quarter),
 *            pick the highest q_curr per ticker. Guarantees all 50 appear even
 *            if most recent quarter hasn't been analyzed yet.
 *  Pass 2 — Nifty 200 (non-Nifty50): strict current quarter pair only.
 *            These appear as a bonus when they happen to have current data.
 *
 * Result: screener always shows ≥ N50 companies with data, plus whatever
 *         Nifty 200 companies are freshly analyzed at the current quarter.
 */
export async function GET() {
    const nifty50Tickers   = Object.keys(NIFTY50);
    const nifty50Set       = new Set(nifty50Tickers);
    const nifty200Tickers  = Object.keys(NIFTY200);
    // Nifty 200 tickers NOT already in Nifty 50 (avoid double-counting)
    const nifty200OnlyTickers = nifty200Tickers.filter((t) => !nifty50Set.has(t));

    // ── Pass 1: Nifty 50 — best available analysis per ticker ─────────────────
    const { data: n50Rows, error: n50Err } = await supabaseAdmin()
        .from("analysis_results")
        .select("company_ticker, q_curr, q_prev, payload, created_at")
        .in("company_ticker", nifty50Tickers)
        .order("created_at", { ascending: false });

    if (n50Err) {
        console.error("[screener] Nifty50 DB error:", n50Err);
        return NextResponse.json({ error: "Failed to fetch results" }, { status: 500 });
    }

    // Keep the row with the highest q_curr per ticker
    const n50Best = new Map<string, DbRow>();
    for (const row of (n50Rows ?? [])) {
        const existing = n50Best.get(row.company_ticker);
        if (!existing || qIdx(row.q_curr) > qIdx(existing.q_curr)) {
            n50Best.set(row.company_ticker, row as DbRow);
        }
    }

    // ── Pass 2: Nifty 200 (non-N50) — current quarter pair only ──────────────
    const { data: n200Rows } = await supabaseAdmin()
        .from("analysis_results")
        .select("company_ticker, q_curr, q_prev, payload, created_at")
        .eq("q_prev", Q_PREV)
        .eq("q_curr", Q_CURR)
        .in("company_ticker", nifty200OnlyTickers)
        .order("created_at", { ascending: false });

    const n200Best = new Map<string, DbRow>();
    for (const row of (n200Rows ?? [])) {
        if (!n200Best.has(row.company_ticker)) {
            n200Best.set(row.company_ticker, row as DbRow);
        }
    }

    // ── Merge & build signals ─────────────────────────────────────────────────
    const signals: ScreenerSignal[] = [];

    for (const [ticker, row] of Array.from(n50Best)) {
        const s = buildSignal(ticker, row, true);
        if (s) signals.push(s);
    }
    for (const [ticker, row] of Array.from(n200Best)) {
        const s = buildSignal(ticker, row, false);
        if (s) signals.push(s);
    }

    if (signals.length === 0) {
        return NextResponse.json({
            signals: [],
            quarter: Q_CURR,
            quarter_previous: Q_PREV,
            companies_analyzed: 0,
        });
    }

    // Rank: current-quarter signals first (within each tier by |adjusted_score|),
    // then stale-quarter signals sorted the same way.
    signals.sort((a, b) => {
        // Current quarter rows come before stale rows
        if (a.is_current_quarter !== b.is_current_quarter) {
            return a.is_current_quarter ? -1 : 1;
        }
        return Math.abs(b.adjusted_score) - Math.abs(a.adjusted_score);
    });

    const currentQCount = signals.filter((s) => s.is_current_quarter).length;

    return NextResponse.json(
        {
            signals,
            quarter: Q_CURR,
            quarter_previous: Q_PREV,
            companies_analyzed: signals.length,
            current_quarter_count: currentQCount,
        },
        { headers: { "Cache-Control": "no-store" } }
    );
}
