import { NextResponse } from "next/server";
import { extractKPIs, type KPISnapshot } from "@/lib/kpi-extractor";
import { NIFTY50 } from "@/lib/nifty50";
import { kpiRepo } from "@/lib/repositories";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/v1/kpis?ticker=TCS      — KPIs for a single company
 * GET /api/v1/kpis?all=1            — KPIs for all analyzed companies
 * GET /api/v1/kpis?sector=Banking   — KPIs filtered by sector
 */
export async function GET(req: Request) {
    const url = new URL(req.url);
    const ticker = url.searchParams.get("ticker")?.toUpperCase();
    const all = url.searchParams.has("all");
    const sectorFilter = url.searchParams.get("sector");
    const force = url.searchParams.has("force"); // bypass cache

    // ── Single ticker request ────────────────────────────────────────────────
    if (ticker) {
        // Check cache first
        if (!force) {
            const cached = await kpiRepo.getLatestByTicker(ticker);

            if (cached) {
                return NextResponse.json(
                    {
                        ticker: cached.ticker,
                        company: NIFTY50[cached.ticker]?.name ?? cached.ticker,
                        sector: cached.sector ?? NIFTY50[cached.ticker]?.sector ?? "Other",
                        quarter: cached.quarter,
                        quarter_previous: cached.quarterPrevious,
                        kpis: cached.kpis,
                        fromCache: true,
                    },
                    { headers: { "Cache-Control": "no-store" } }
                );
            }
        }

        // Extract fresh KPIs
        const snapshot = await extractKPIs(ticker);
        if (!snapshot) {
            return NextResponse.json(
                { detail: `Could not extract KPIs for ${ticker}` },
                { status: 404 }
            );
        }

        // Save to cache (upsert)
        const { error: upsertError } = await kpiRepo.upsertSnapshot({
            ticker: snapshot.ticker,
            quarter: snapshot.quarter,
            quarterPrevious: snapshot.quarter_previous,
            sector: snapshot.sector,
            kpis: snapshot.kpis,
        });
        if (upsertError) {
            console.error("[KPI] Cache save failed:", upsertError);
        } else {
            console.log(`[KPI] Cached ${snapshot.ticker} ${snapshot.quarter}`);
        }

        return NextResponse.json({
            ...snapshot,
            _debug_cache: upsertError ? { error: upsertError } : "saved",
        }, {
            headers: { "Cache-Control": "no-store" },
        });
    }

    // ── All / sector-filtered request ────────────────────────────────────────
    if (all || sectorFilter) {
        const { snapshots: rows, error } = await kpiRepo.listAll(sectorFilter ?? undefined);

        if (error) {
            return NextResponse.json(
                { detail: `DB error: ${error}` },
                { status: 500 }
            );
        }

        // Deduplication already happened in the repository — just shape the response
        const snapshots: KPISnapshot[] = rows.map((row) => ({
            ticker: row.ticker,
            company: NIFTY50[row.ticker]?.name ?? row.ticker,
            sector: row.sector ?? NIFTY50[row.ticker]?.sector ?? "Other",
            quarter: row.quarter,
            quarter_previous: row.quarterPrevious,
            kpis: row.kpis as KPISnapshot["kpis"],
        }));

        return NextResponse.json(
            { snapshots, count: snapshots.length },
            { headers: { "Cache-Control": "no-store" } }
        );
    }

    return NextResponse.json(
        { detail: "Provide ?ticker=TICKER or ?all=1" },
        { status: 400 }
    );
}

/**
 * DELETE /api/v1/kpis — clear all cached KPI snapshots
 */
export async function DELETE() {
    const { error } = await kpiRepo.deleteAll();

    if (error) {
        return NextResponse.json({ detail: error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: "All KPI snapshots deleted" });
}
