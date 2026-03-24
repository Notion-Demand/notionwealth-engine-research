import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractKPIs, type KPISnapshot } from "@/lib/kpi-extractor";
import { NIFTY50 } from "@/lib/nifty50";

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
            const { data: cached } = await supabaseAdmin()
                .from("kpi_snapshots")
                .select("*")
                .eq("company_ticker", ticker)
                .order("created_at", { ascending: false })
                .limit(1)
                .single();

            if (cached) {
                return NextResponse.json(
                    {
                        ticker: cached.company_ticker,
                        company: NIFTY50[cached.company_ticker]?.name ?? cached.company_ticker,
                        sector: cached.sector ?? NIFTY50[cached.company_ticker]?.sector ?? "Other",
                        quarter: cached.quarter,
                        quarter_previous: cached.quarter_previous,
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
        const { error: upsertError } = await supabaseAdmin()
            .from("kpi_snapshots")
            .upsert(
                {
                    company_ticker: snapshot.ticker,
                    quarter: snapshot.quarter,
                    quarter_previous: snapshot.quarter_previous,
                    sector: snapshot.sector,
                    kpis: snapshot.kpis,
                },
                { onConflict: "company_ticker,quarter" }
            );
        if (upsertError) {
            console.error("[KPI] Cache save failed:", upsertError.message);
        } else {
            console.log(`[KPI] Cached ${snapshot.ticker} ${snapshot.quarter}`);
        }

        return NextResponse.json({
            ...snapshot,
            _debug_cache: upsertError ? { error: upsertError.message, code: upsertError.code, details: upsertError.details } : "saved",
        }, {
            headers: { "Cache-Control": "no-store" },
        });
    }

    // ── All / sector-filtered request ────────────────────────────────────────
    if (all || sectorFilter) {
        let query = supabaseAdmin()
            .from("kpi_snapshots")
            .select("*")
            .order("created_at", { ascending: false });

        if (sectorFilter) {
            query = query.eq("sector", sectorFilter);
        }

        const { data: rows, error } = await query;

        if (error) {
            return NextResponse.json(
                { detail: `DB error: ${error.message}` },
                { status: 500 }
            );
        }

        // Deduplicate: keep only the latest snapshot per ticker
        const seen = new Set<string>();
        const snapshots: KPISnapshot[] = [];
        for (const row of rows ?? []) {
            if (seen.has(row.company_ticker)) continue;
            seen.add(row.company_ticker);
            snapshots.push({
                ticker: row.company_ticker,
                company: NIFTY50[row.company_ticker]?.name ?? row.company_ticker,
                sector: row.sector ?? NIFTY50[row.company_ticker]?.sector ?? "Other",
                quarter: row.quarter,
                quarter_previous: row.quarter_previous,
                kpis: row.kpis as KPISnapshot["kpis"],
            });
        }

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
    const { error } = await supabaseAdmin()
        .from("kpi_snapshots")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000"); // delete all rows

    if (error) {
        return NextResponse.json({ detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: "All KPI snapshots deleted" });
}
