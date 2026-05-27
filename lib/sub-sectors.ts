/**
 * Sub-Sector Universe
 *
 * Defines thematic sub-sectors that complement the broad SECTOR_UNIVERSE.
 * Sub-sectors are seeded independently in sector_intelligence and carry
 * a parent_sector reference and a PM-grade thesis for context.
 *
 * Usage:
 *   import { ALL_SECTOR_UNIVERSE } from "@/lib/sub-sectors"
 *   Use ALL_SECTOR_UNIVERSE in seed + GET routes in place of SECTOR_UNIVERSE.
 */

import { SECTOR_UNIVERSE } from "@/lib/nifty50";

// ── Shared type ───────────────────────────────────────────────────────────────

export interface SectorConfig {
    tickers: string[];
    label: string;
    /** Set for sub-sectors — the parent SECTOR_UNIVERSE key */
    parent_sector?: string;
    /** PM-grade investment thesis for this sector / sub-sector */
    thesis?: string;
    /** true = this is a sub-sector, not a top-level sector */
    is_sub_sector?: boolean;
}

// ── Sub-sector definitions ────────────────────────────────────────────────────

export const SUB_SECTOR_UNIVERSE: Record<string, SectorConfig> = {

    // ── Banking sub-sectors ──────────────────────────────────────────────────

    "PSU Banks": {
        tickers: ["SBI", "PNB", "BANKBARODA", "CANBK", "BANKINDIA", "UNIONBANK", "INDIANB"],
        label: "PSU Banks",
        parent_sector: "Banking",
        thesis:
            "Government-owned lenders: credit cost normalisation vs. NIM compression " +
            "as the rate cycle turns. Watch for deposit market share shifts to private " +
            "banks and the pace of NPA resolution in stressed sectors.",
        is_sub_sector: true,
    },

    "Private Banks": {
        tickers: ["HDFC", "ICICI", "KOTAKBANK", "AXISBANK", "INDUSINDBK", "IDFCFIRSTB", "FEDERALBNK"],
        label: "Private Banks",
        parent_sector: "Banking",
        thesis:
            "Franchise-quality play: CASA stickiness, fee-income diversification, and " +
            "deposit mobilisation in a tightening liability environment. Premium " +
            "valuations hinge on sustaining ROE above 16% through the credit cycle.",
        is_sub_sector: true,
    },

    // ── Capital Markets sub-sector ───────────────────────────────────────────

    "Capital Markets": {
        tickers: ["BSE", "HDFCAMC", "MOTILALOFS", "360ONE", "SBICARD", "POLICYBZR"],
        label: "Capital Markets & Fintechs",
        parent_sector: "NBFC",
        thesis:
            "India's financialisation wave: SIP inflows, demat account growth, and " +
            "insurance penetration as structural secular tailwinds. Revenue streams are " +
            "highly equity-market correlated — de-rate risk if Nifty corrects >20%.",
        is_sub_sector: true,
    },

    // ── IT mid-caps sub-sector ───────────────────────────────────────────────

    "IT Midcap": {
        tickers: ["LTIM", "PERSISTENT", "MPHASIS", "COFORGE", "KPITTECH"],
        label: "IT Mid-caps",
        parent_sector: "IT",
        thesis:
            "Higher-growth IT mid-caps with concentrated BFSI and engineering-services " +
            "vertical exposure. Outperform large-caps in upcycles; key watch items are " +
            "deal ramp-up velocity, attrition trends, and margin leverage on fixed-price " +
            "contracts as AI-automation impacts billing rates.",
        is_sub_sector: true,
    },

    // ── Renewable Energy sub-sector ──────────────────────────────────────────

    Renewables: {
        tickers: ["ADANIGREEN", "JSWENERGY", "TORNTPOWER", "NTPCGREEN", "NHPC"],
        label: "Renewable Energy",
        parent_sector: "Power",
        thesis:
            "India's 500 GW by 2030 target: a capacity-addition race where tariff " +
            "discovery risk, grid integration timelines, and equipment supply-chain " +
            "availability are the critical constraints. Long-duration capital allocation " +
            "means FCF generation is years away — valuation driven purely by MW pipeline.",
        is_sub_sector: true,
    },
};

// ── Combined universe ─────────────────────────────────────────────────────────

/**
 * All broad sectors + thematic sub-sectors.
 * Drop-in replacement for SECTOR_UNIVERSE in seed and GET routes.
 */
export const ALL_SECTOR_UNIVERSE: Record<string, SectorConfig> = {
    // Promote existing SECTOR_UNIVERSE entries to the shared SectorConfig type
    ...Object.fromEntries(
        Object.entries(SECTOR_UNIVERSE).map(([k, v]) => [k, { ...v, is_sub_sector: false } as SectorConfig])
    ),
    // Append sub-sectors
    ...SUB_SECTOR_UNIVERSE,
};
