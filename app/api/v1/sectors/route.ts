import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SECTOR_UNIVERSE } from "@/lib/nifty50";

export const dynamic = "force-dynamic";

// ── Types (match what seed endpoint stores) ───────────────────────────────────

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

// ── GET handler — reads from pre-computed cache ───────────────────────────────

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const sectorFilter = searchParams.get("sector");

    // Fetch pre-computed sector intelligence — only sectors in SECTOR_UNIVERSE
    const validSectors = Object.keys(SECTOR_UNIVERSE);
    const query = supabaseAdmin()
        .from("sector_intelligence")
        .select("sector, quarter, payload, created_at")
        .in("sector", validSectors)
        .order("created_at", { ascending: false });

    const { data: rows, error } = await query;

    if (error) {
        console.error("[sectors] DB error:", error);
        return NextResponse.json({ error: "Failed to fetch sector data" }, { status: 500 });
    }

    if (!rows || rows.length === 0) {
        return NextResponse.json({
            sectors: [],
            available_sectors: validSectors.sort(),
        });
    }

    // Indian FY quarter → calendar sort index (Q3_2026=Oct 2025 → 202510)
    function qIdx(q: string): number {
        const m = q.match(/^Q(\d)_(\d{4})$/);
        if (!m) return 0;
        const qNum = parseInt(m[1]);
        const fy = parseInt(m[2]);
        const calMonth = { 1: 4, 2: 7, 3: 10, 4: 1 }[qNum] ?? 1;
        return (qNum <= 3 ? fy - 1 : fy) * 100 + calMonth;
    }

    // Keep only the latest row per sector.
    // Primary sort: by quarter (calendar index, newest first).
    // Tiebreaker: by created_at (newest first — already ordered from DB).
    console.log(`[sectors GET] ${rows.length} total rows from DB:`, rows.map(r => `${r.sector}:${r.quarter} (created=${r.created_at})`));
    const latestBySector = new Map<string, typeof rows[0]>();
    for (const row of rows) {
        const existing = latestBySector.get(row.sector);
        if (!existing) {
            // First row for this sector (already the newest by created_at due to DB ordering)
            latestBySector.set(row.sector, row);
        } else {
            // Replace only if this row has a strictly newer quarter
            const existingQIdx = qIdx(existing.quarter);
            const rowQIdx = qIdx(row.quarter);
            if (rowQIdx > existingQIdx) {
                console.log(`[sectors GET] ${row.sector}: replacing ${existing.quarter}(${existingQIdx}) with ${row.quarter}(${rowQIdx})`);
                latestBySector.set(row.sector, row);
            }
        }
    }
    console.log(`[sectors GET] Selected:`, Array.from(latestBySector).map(([k, v]) => `${k}:${v.quarter}`));

    // Parse payloads
    const sectors: SectorIntelligence[] = [];
    for (const [, row] of Array.from(latestBySector)) {
        try {
            const payload: SectorIntelligence =
                typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
            if (sectorFilter && payload.sector !== sectorFilter) continue;
            sectors.push(payload);
        } catch {
            continue;
        }
    }

    // Sort by company count (most data first)
    sectors.sort((a, b) => b.company_count - a.company_count);

    return NextResponse.json(
        {
            sectors,
            available_sectors: Object.keys(SECTOR_UNIVERSE).sort(),
            _debug: {
                total_db_rows: rows.length,
                raw_rows: rows.map(r => ({ sector: r.sector, quarter: r.quarter, qIdx: qIdx(r.quarter), created_at: r.created_at })),
                selected: Array.from(latestBySector).map(([k, v]) => ({
                    sector: k,
                    quarter: v.quarter,
                    created_at: v.created_at,
                    payload_quarter: (typeof v.payload === 'string' ? JSON.parse(v.payload) : v.payload)?.quarter,
                    payload_quarter_previous: (typeof v.payload === 'string' ? JSON.parse(v.payload) : v.payload)?.quarter_previous,
                })),
            }
        },
        { headers: { "Cache-Control": "no-store" } }
    );
}
