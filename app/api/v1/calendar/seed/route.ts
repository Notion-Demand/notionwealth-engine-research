/**
 * POST /api/v1/calendar/seed
 *
 * Layered earnings-date pipeline for Nifty 200 companies.
 * Sources in priority order:
 *   1. Tickertape API  — single call, all companies, accurate dates
 *   2. BSE board meeting notices API — per-company, 2-3 weeks advance notice
 *   3. NSE event calendar  — Nifty200 board meeting events
 *   4. Quarterly cycle estimation — always runs as fallback, market-cap weighted
 *
 * Results are upserted into the earnings_calendar Supabase table.
 * Run once per month (or after each quarter-end).
 *
 * Body: { quarters?: string[] }  — defaults to QUARTERS[0] + QUARTERS[1]
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NIFTY200 } from "@/lib/nifty200";
import { QUARTERS, MARKET_CAPS } from "@/lib/nifty50";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ── Types ─────────────────────────────────────────────────────────────────────

type EarningsSource = "tickertape" | "bse_notice" | "nse_calendar" | "estimated";

interface ResolvedDate {
    ticker: string;
    date: string;   // YYYY-MM-DD
    source: EarningsSource;
}

// ── Headers ───────────────────────────────────────────────────────────────────

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BSE_HEADERS = {
    "User-Agent": BROWSER_UA,
    Referer: "https://www.bseindia.com/",
    Origin: "https://www.bseindia.com",
    Accept: "application/json, */*",
};

const NSE_HEADERS = {
    "User-Agent": BROWSER_UA,
    Referer: "https://www.nseindia.com/",
    Accept: "application/json, */*",
    "X-Requested-With": "XMLHttpRequest",
};

const TICKERTAPE_HEADERS = {
    "User-Agent": BROWSER_UA,
    Referer: "https://www.tickertape.in/",
    Accept: "application/json, */*",
    Origin: "https://www.tickertape.in",
};

// ── Quarter window computation ────────────────────────────────────────────────

/** Advance one quarter: Q4_2026 → Q1_2027, Q3_2026 → Q4_2026, etc. */
function nextQuarter(q: string): string {
    const m = q.match(/^Q(\d)_(\d{4})$/);
    if (!m) return q;
    const qNum = parseInt(m[1]);
    const fy   = parseInt(m[2]);
    return qNum === 4 ? `Q1_${fy + 1}` : `Q${qNum + 1}_${fy}`;
}

/**
 * Given an Indian FY quarter string, return the calendar date range when
 * companies typically announce results.
 *
 * Q1 FY2026 = Apr–Jun 2025  → results Jul 15 – Aug 31, 2025
 * Q2 FY2026 = Jul–Sep 2025  → results Oct 15 – Nov 30, 2025
 * Q3 FY2026 = Oct–Dec 2025  → results Jan 15 – Feb 28, 2026
 * Q4 FY2026 = Jan–Mar 2026  → results Apr 15 – May 31, 2026
 */
export function getQuarterResultsWindow(quarter: string): { from: string; to: string; calYear: number } {
    const m = quarter.match(/^Q(\d)_(\d{4})$/);
    if (!m) throw new Error(`Invalid quarter: ${quarter}`);
    const qNum = parseInt(m[1]);
    const fy = parseInt(m[2]);

    type Window = { startMo: number; startDay: number; endMo: number; endDay: number; calYear: number };
    const WINDOWS: Record<number, Window> = {
        // Q1 FY26 = Apr-Jun 2025, results Jul-Aug 2025 (calendar year = fy - 1)
        1: { startMo: 7,  startDay: 15, endMo: 8,  endDay: 31, calYear: fy - 1 },
        // Q2 FY26 = Jul-Sep 2025, results Oct-Nov 2025
        2: { startMo: 10, startDay: 15, endMo: 11, endDay: 30, calYear: fy - 1 },
        // Q3 FY26 = Oct-Dec 2025, results Jan-Feb 2026
        3: { startMo: 1,  startDay: 15, endMo: 2,  endDay: 28, calYear: fy },
        // Q4 FY26 = Jan-Mar 2026, results Apr-May 2026
        4: { startMo: 4,  startDay: 15, endMo: 5,  endDay: 31, calYear: fy },
    };

    const w = WINDOWS[qNum];
    if (!w) throw new Error(`Unknown quarter number: ${qNum}`);

    const pad = (n: number) => String(n).padStart(2, "0");
    const from = `${w.calYear}-${pad(w.startMo)}-${pad(w.startDay)}`;
    const to   = `${w.calYear}-${pad(w.endMo)}-${pad(w.endDay)}`;
    return { from, to, calYear: w.calYear };
}

// ── Date parsing ──────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseDate(raw: string | undefined | null): string | null {
    if (!raw) return null;
    raw = raw.trim();

    // ISO: 2026-04-28 or 2026-04-28T00:00:00
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    // DD/MM/YYYY or D/M/YYYY
    const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

    // "28 Apr 2026" or "28-Apr-2026" or "28th April, 2026"
    const mdy = raw.match(/(\d{1,2})(?:st|nd|rd|th)?[\s\-,]+([A-Za-z]{3,9})[\s\-,]+(\d{4})/);
    if (mdy) {
        const mo = MONTH_MAP[mdy[2].slice(0, 3).toLowerCase()];
        if (mo) return `${mdy[3]}-${mo}-${mdy[1].padStart(2, "0")}`;
    }

    // "April 28, 2026" or "April 28 2026"
    const mdy2 = raw.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?[\s,]+(\d{4})/);
    if (mdy2) {
        const mo = MONTH_MAP[mdy2[1].slice(0, 3).toLowerCase()];
        if (mo) return `${mdy2[3]}-${mo}-${mdy2[2].padStart(2, "0")}`;
    }

    return null;
}

/** Extract a date from a BSE board meeting headline, e.g.
 *  "Board Meeting on 28/04/2026 to consider Q4 results"
 *  "Intimation of Board Meeting to be held on 28-04-2026"
 */
function extractDateFromHeadline(headline: string): string | null {
    // Look for date patterns after common keywords
    const after = headline.replace(/board meeting|intimation|to be held|scheduled|on\b/gi, " ").trim();
    return parseDate(after) ?? parseDate(headline);
}

// ── Source 1: Tickertape ──────────────────────────────────────────────────────

/** Build NSE symbol → ticker lookup (strips .NS suffix) */
function buildNseToTicker(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [ticker, info] of Object.entries(NIFTY200)) {
        const sym = info.nse.replace(/\.NS$/i, "").toUpperCase();
        m.set(sym, ticker);
        m.set(ticker.toUpperCase(), ticker); // also direct ticker
    }
    return m;
}

async function fetchTickertape(
    from: string,
    to: string,
    nseMap: Map<string, string>,
    log: string[]
): Promise<Map<string, ResolvedDate>> {
    const results = new Map<string, ResolvedDate>();

    // Try multiple endpoint variants — Tickertape has changed their API paths
    const endpoints = [
        `https://api.tickertape.in/stocks/earnings-calendar?from=${from}&to=${to}`,
        `https://api.tickertape.in/market/earnings-calendar?from=${from}&to=${to}`,
        `https://api.tickertape.in/stocks/earnings?from=${from}&to=${to}`,
    ];

    for (const url of endpoints) {
        try {
            const resp = await fetch(url, {
                headers: TICKERTAPE_HEADERS,
                signal: AbortSignal.timeout(10_000),
            });
            if (!resp.ok) continue;
            const body = await resp.json();

            // Handle various response shapes
            const items: unknown[] =
                body?.data?.earnings ??
                body?.data?.result ??
                body?.data ??
                (Array.isArray(body) ? body : []);

            if (!Array.isArray(items) || items.length === 0) continue;

            let matched = 0;
            for (const item of items) {
                if (typeof item !== "object" || !item) continue;
                const obj = item as Record<string, unknown>;

                const sym = String(obj.sid ?? obj.symbol ?? obj.ticker ?? "").toUpperCase();
                const rawDate = String(obj.date ?? obj.resultDate ?? obj.earningsDate ?? "");
                const date = parseDate(rawDate);
                if (!sym || !date) continue;

                const ticker = nseMap.get(sym);
                if (!ticker) continue;

                results.set(ticker, { ticker, date, source: "tickertape" });
                matched++;
            }

            log.push(`Tickertape [${url.split("?")[0].split("/").pop()}]: ${matched} matched`);
            if (results.size > 0) break; // stop trying endpoints once we have data
        } catch (e) {
            log.push(`Tickertape [${url.split("?")[0].split("/").pop()}] error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    return results;
}

// ── Source 2: BSE board meeting notices ───────────────────────────────────────

/** Map BSE code → ticker */
function buildBseToTicker(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [ticker, info] of Object.entries(NIFTY200)) {
        if (info.bse) m.set(String(info.bse), ticker);
    }
    return m;
}

interface BseAnn {
    HEADLINE?: string;
    SUBCATNAME?: string;
    DT_TM?: string;
    scrip_cd?: string;
    BM_DATE?: string;   // board meeting specific endpoint
    BM_AGENDA?: string;
}

async function fetchBseBoardMeetingForTicker(
    bseCode: number,
    from: string,
    to: string
): Promise<string | null> {
    const fmt = (d: string) => d.replace(/-/g, ""); // YYYYMMDD

    // Try the dedicated board meetings endpoint first
    const bmUrl =
        `https://api.bseindia.com/BseIndiaAPI/api/Boardmeetings/w` +
        `?strScrip=${bseCode}&strfrom=${fmt(from)}&strto=${fmt(to)}`;

    try {
        const resp = await fetch(bmUrl, {
            headers: BSE_HEADERS,
            signal: AbortSignal.timeout(6_000),
        });
        if (resp.ok) {
            const data = await resp.json();
            const rows: BseAnn[] = data?.Table ?? data?.table ?? [];
            for (const row of rows) {
                // Filter for quarterly results agenda
                const agenda = (row.BM_AGENDA ?? "").toLowerCase();
                if (/result|financial|quarter|q[1-4]/i.test(agenda)) {
                    const date = parseDate(row.BM_DATE);
                    if (date) return date;
                }
            }
        }
    } catch { /* try next */ }

    // Fallback: announcements API filtered for board meetings
    const annUrl =
        `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w` +
        `?strCat=-1&strPrevDate=${fmt(from)}&strScrip=${bseCode}` +
        `&strSearch=P&strToDate=${fmt(to)}&strType=C&subcategory=-1`;

    try {
        const resp = await fetch(annUrl, {
            headers: BSE_HEADERS,
            signal: AbortSignal.timeout(6_000),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const rows: BseAnn[] = data?.Table ?? [];

        for (const row of rows) {
            const sub = (row.SUBCATNAME ?? "").toLowerCase();
            const headline = row.HEADLINE ?? "";
            if (!sub.includes("board meeting")) continue;
            if (!/result|financial|quarter/i.test(headline)) continue;
            const date = extractDateFromHeadline(headline);
            if (date) return date;
        }
    } catch { /* silent */ }

    return null;
}

async function fetchBseNotices(
    tickers: string[],
    from: string,
    to: string,
    bseMap: Map<string, string>,  // ticker → bseCode (we need reverse)
    log: string[]
): Promise<Map<string, ResolvedDate>> {
    const results = new Map<string, ResolvedDate>();

    // Build ticker → bseCode map
    const tickerToBse = new Map<string, number>();
    for (const [ticker, info] of Object.entries(NIFTY200)) {
        if (info.bse) tickerToBse.set(ticker, info.bse);
    }

    // Process in batches of 5 with 150ms delay to avoid rate limiting
    const BATCH = 5;
    let resolved = 0;

    for (let i = 0; i < tickers.length; i += BATCH) {
        const batch = tickers.slice(i, i + BATCH);
        const promises = batch.map(async (ticker) => {
            const bseCode = tickerToBse.get(ticker);
            if (!bseCode) return;
            const date = await fetchBseBoardMeetingForTicker(bseCode, from, to);
            if (date) {
                results.set(ticker, { ticker, date, source: "bse_notice" });
                resolved++;
            }
        });
        await Promise.all(promises);
        if (i + BATCH < tickers.length) {
            await new Promise((r) => setTimeout(r, 150));
        }
    }

    log.push(`BSE notices: ${resolved}/${tickers.length} resolved`);
    return results;
}

// ── Source 3: NSE event calendar ──────────────────────────────────────────────

async function fetchNseCalendar(
    from: string,
    to: string,
    nseMap: Map<string, string>,
    log: string[]
): Promise<Map<string, ResolvedDate>> {
    const results = new Map<string, ResolvedDate>();
    try {
        const resp = await fetch(
            "https://www.nseindia.com/api/event-calendar?index=nifty200",
            { headers: NSE_HEADERS, signal: AbortSignal.timeout(8_000) }
        );
        if (!resp.ok) {
            log.push(`NSE calendar: HTTP ${resp.status}`);
            return results;
        }
        const data = await resp.json();
        if (!Array.isArray(data)) {
            log.push("NSE calendar: unexpected response shape");
            return results;
        }

        let matched = 0;
        for (const item of data) {
            if (typeof item !== "object" || !item) continue;
            const obj = item as Record<string, unknown>;
            const purpose = String(obj.purpose ?? "");
            if (!/result|quarterly/i.test(purpose)) continue;

            const rawDate = String(obj.bfMtgDate ?? obj.date ?? "");
            const date = parseDate(rawDate);
            if (!date || date < from || date > to) continue;

            const sym = String(obj.symbol ?? "").toUpperCase();
            const ticker = nseMap.get(sym);
            if (!ticker) continue;

            results.set(ticker, { ticker, date, source: "nse_calendar" });
            matched++;
        }
        log.push(`NSE calendar: ${matched} matched`);
    } catch (e) {
        log.push(`NSE calendar error: ${e instanceof Error ? e.message : String(e)}`);
    }
    return results;
}

// ── Source 4: Quarterly cycle estimation ──────────────────────────────────────

/**
 * Spread unresolved tickers across the results window, weighted by market cap.
 * Larger companies report earlier in the window.
 */
function estimateDates(
    tickers: string[],
    quarter: string,
    from: string,
    to: string
): Map<string, ResolvedDate> {
    const results = new Map<string, ResolvedDate>();
    if (tickers.length === 0) return results;

    const fromMs = new Date(from).getTime();
    const toMs   = new Date(to).getTime();
    const rangeMs = toMs - fromMs;

    // Sort by market cap descending — larger = earlier date
    const sorted = [...tickers].sort(
        (a, b) => (MARKET_CAPS[b] ?? 0.05) - (MARKET_CAPS[a] ?? 0.05)
    );

    sorted.forEach((ticker, i) => {
        const fraction = sorted.length === 1 ? 0.4 : i / (sorted.length - 1);
        const dateMs = fromMs + fraction * rangeMs;
        const date = new Date(dateMs).toISOString().slice(0, 10);
        results.set(ticker, { ticker, date, source: "estimated" });
    });

    return results;
}

// ── Main seed handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    const log: string[] = [];

    let body: { quarters?: string[] } = {};
    try { body = await req.json(); } catch { /* no body */ }

    // Default: current quarter + previous quarter + next upcoming quarter
    // e.g. Q4_2026 (Apr–May), Q3_2026 (Jan–Feb), Q1_2027 (Jul–Aug)
    const targetQuarters: string[] = body.quarters ?? [
        QUARTERS[0],
        QUARTERS[1],
        nextQuarter(QUARTERS[0]),
    ];
    log.push(`Seeding earnings calendar for quarters: ${targetQuarters.join(", ")}`);

    const nseMap = buildNseToTicker();
    const bseMap = buildBseToTicker();

    // Fetch existing analysis results to mark confirmed tickers
    const { data: analyzed } = await supabaseAdmin()
        .from("analysis_results")
        .select("company_ticker, q_curr");
    const confirmedSet = new Set(
        (analyzed ?? []).map((r) => `${r.company_ticker}:${r.q_curr}`)
    );

    let totalUpserted = 0;

    for (const quarter of targetQuarters) {
        log.push(`\n--- ${quarter} ---`);
        let { from, to } = getQuarterResultsWindow(quarter);
        log.push(`Results window: ${from} → ${to}`);

        const allTickers = Object.keys(NIFTY200);
        const resolved = new Map<string, ResolvedDate>();

        // 1. Tickertape
        const ttResults = await fetchTickertape(from, to, nseMap, log);
        Array.from(ttResults.entries()).forEach(([t, d]) => resolved.set(t, d));
        log.push(`After Tickertape: ${resolved.size}/${allTickers.length} resolved`);

        // 2. NSE calendar (fast, try in parallel with BSE)
        const nseResults = await fetchNseCalendar(from, to, nseMap, log);
        Array.from(nseResults.entries()).forEach(([t, d]) => {
            if (!resolved.has(t)) resolved.set(t, d);
        });
        log.push(`After NSE calendar: ${resolved.size}/${allTickers.length} resolved`);

        // 3. BSE board meeting notices for still-unresolved
        const remaining2 = allTickers.filter((t) => !resolved.has(t));
        if (remaining2.length > 0) {
            log.push(`Fetching BSE notices for ${remaining2.length} tickers...`);
            const bseResults = await fetchBseNotices(remaining2, from, to, bseMap, log);
            Array.from(bseResults.entries()).forEach(([t, d]) => resolved.set(t, d));
        }
        log.push(`After BSE notices: ${resolved.size}/${allTickers.length} resolved`);

        // 4. Quarterly estimation for remaining
        const remaining3 = allTickers.filter((t) => !resolved.has(t));
        if (remaining3.length > 0) {
            const estimated = estimateDates(remaining3, quarter, from, to);
            Array.from(estimated.entries()).forEach(([t, d]) => resolved.set(t, d));
            log.push(`Estimated ${estimated.size} remaining tickers`);
        }

        // 5. Upsert all into earnings_calendar
        const rows = Array.from(resolved.values()).map(({ ticker, date, source }) => ({
            ticker,
            date,
            quarter,
            source,
            confirmed: confirmedSet.has(`${ticker}:${quarter}`),
            updated_at: new Date().toISOString(),
        }));

        const { error } = await supabaseAdmin()
            .from("earnings_calendar")
            .upsert(rows, { onConflict: "ticker,quarter" });

        if (error) {
            log.push(`DB upsert error: ${error.message}`);
        } else {
            log.push(`Upserted ${rows.length} rows for ${quarter}`);
            totalUpserted += rows.length;
        }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log.push(`\nDone in ${elapsed}s — ${totalUpserted} total rows upserted`);

    return NextResponse.json(
        { ok: true, quarters_processed: targetQuarters.length, total_upserted: totalUpserted, log },
        { headers: { "Cache-Control": "no-store" } }
    );
}
