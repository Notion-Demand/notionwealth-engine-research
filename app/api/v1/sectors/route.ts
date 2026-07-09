import { NextResponse } from "next/server";
import { ALL_SECTOR_UNIVERSE } from "@/lib/sub-sectors";
import { sectorRepo } from "@/lib/repositories";
import { toSectorWirePayload, type SectorWirePayload as SectorIntelligence } from "@/lib/repositories/sectors";

export const dynamic = "force-dynamic";

// ── GET handler — reads from pre-computed cache ───────────────────────────────

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const sectorFilter = searchParams.get("sector");

    // Fetch pre-computed sector intelligence — sectors + sub-sectors in ALL_SECTOR_UNIVERSE
    const validSectors = Object.keys(ALL_SECTOR_UNIVERSE);
    const { records: rows, error } = await sectorRepo.listBySectors(validSectors);

    if (error) {
        console.error("[sectors] DB error:", error);
        return NextResponse.json({ error: "Failed to fetch sector data" }, { status: 500 });
    }

    if (rows.length === 0) {
        return NextResponse.json({
            sectors: [],
            available_sectors: Object.keys(ALL_SECTOR_UNIVERSE).sort(),
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
    console.log(`[sectors GET] ${rows.length} total rows from DB:`, rows.map(r => `${r.sector}:${r.quarter} (created=${r.createdAt})`));
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

    // Convert entities to the frontend's expected wire shape
    const sectors: SectorIntelligence[] = [];
    for (const [, row] of Array.from(latestBySector)) {
        if (sectorFilter && row.payload.sector !== sectorFilter) continue;
        sectors.push(toSectorWirePayload(row.payload));
    }

    // Sort by company count (most data first)
    sectors.sort((a, b) => b.company_count - a.company_count);

    return NextResponse.json(
        {
            sectors,
            available_sectors: Object.keys(ALL_SECTOR_UNIVERSE).sort(),
            _debug: {
                total_db_rows: rows.length,
                raw_rows: rows.map(r => ({ sector: r.sector, quarter: r.quarter, qIdx: qIdx(r.quarter), created_at: r.createdAt })),
                selected: Array.from(latestBySector).map(([k, v]) => ({
                    sector: k,
                    quarter: v.quarter,
                    created_at: v.createdAt,
                    payload_quarter: v.payload.quarter,
                    payload_quarter_previous: v.payload.quarterPrevious,
                })),
            }
        },
        { headers: { "Cache-Control": "no-store" } }
    );
}
