import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NIFTY200 } from "@/lib/nifty200";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

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
}

/** GET /api/v1/screener — returns ranked narrative change signals across Nifty 200 */
export async function GET() {
    const Q_PREV = "Q2_2026";
    const Q_CURR = "Q3_2026";

    // Fetch only Q2_2026 → Q3_2026 results for Nifty 200 tickers
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

    if (!rows || rows.length === 0) {
        return NextResponse.json({ signals: [] });
    }

    // Keep only the most recent result per ticker (in case of duplicates)
    const latestByTicker = new Map<string, typeof rows[0]>();
    for (const row of rows) {
        if (!latestByTicker.has(row.company_ticker)) {
            latestByTicker.set(row.company_ticker, row);
        }
    }

    // Extract top signals per company
    const signals: ScreenerSignal[] = [];

    for (const [ticker, row] of Array.from(latestByTicker)) {
        let payload: StoredPayload;
        try {
            payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
        } catch {
            continue;
        }

        if (!payload?.insights || !Array.isArray(payload.insights)) continue;



        // Collect ALL non-Noise metrics from all sections
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

        // Sort by |signal_score| descending → pick the strongest signal
        allMetrics.sort((a, b) => Math.abs(b.metric.signal_score) - Math.abs(a.metric.signal_score));
        const top = allMetrics[0];

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
            quarter: row.q_curr,
            quarter_previous: row.q_prev,
            earnings_delta: payload.earnings_delta ?? [],
        });
    }

    // Rank by |signal_score| descending
    signals.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

    return NextResponse.json(
        { signals },
        { headers: { "Cache-Control": "no-store" } }
    );
}
