import { NextRequest, NextResponse } from "next/server";
import { NIFTY200 } from "@/lib/nifty200";
import { analysisRepo, calendarRepo } from "@/lib/repositories";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalendarEvent {
    ticker: string;
    name: string;
    sector: string;
    quarter: string | null;
    date: string;               // YYYY-MM-DD
    source: string;
    confirmed: boolean;         // transcript + analysis exists
    hasAnalysis: boolean;       // analysis exists in DB
}

export interface CalendarResponse {
    events: Record<string, CalendarEvent[]>; // YYYY-MM-DD → events
    month: number;
    year: number;
    upcoming_week_count: number;
    seeded: boolean;            // true if data came from DB, false if live fallback
}

// ── Live-fallback helpers (used when DB table is empty) ───────────────────────

const BSE_API_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: "https://www.bseindia.com/",
    Origin: "https://www.bseindia.com",
    Accept: "application/json, */*",
};

const NSE_API_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json, */*",
    Referer: "https://www.nseindia.com/",
    "X-Requested-With": "XMLHttpRequest",
};

function buildBseMap(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [ticker, info] of Object.entries(NIFTY200)) {
        if (info.bse) m.set(String(info.bse), ticker);
    }
    return m;
}

function buildNseMap(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [ticker, info] of Object.entries(NIFTY200)) {
        const sym = info.nse.replace(".NS", "").toUpperCase();
        m.set(sym, ticker);
        m.set(ticker, ticker);
    }
    return m;
}

function parseDate(raw: string | undefined): string | null {
    if (!raw) return null;
    raw = raw.trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    const MONTHS: Record<string, string> = {
        jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
        jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const mdy = raw.match(/(\d{1,2})[\s-]([A-Za-z]{3})[\s-](\d{4})/);
    if (mdy) {
        const mo = MONTHS[mdy[2].toLowerCase()];
        if (mo) return `${mdy[3]}-${mo}-${mdy[1].padStart(2, "0")}`;
    }
    return null;
}

async function liveFallback(
    fromDate: string,
    toDate: string
): Promise<Record<string, { ticker: string; source: string }[]>> {
    const bseMap = buildBseMap();
    const nseMap = buildNseMap();
    const events: Record<string, { ticker: string; source: string }[]> = {};

    const add = (date: string, ticker: string, source: string) => {
        if (!events[date]) events[date] = [];
        if (!events[date].some((e) => e.ticker === ticker)) {
            events[date].push({ ticker, source });
        }
    };

    // NSE
    try {
        const resp = await fetch(
            "https://www.nseindia.com/api/event-calendar?index=nifty200",
            { headers: NSE_API_HEADERS, signal: AbortSignal.timeout(6_000) }
        );
        if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data)) {
                for (const item of data) {
                    const purpose = String(item.purpose ?? "");
                    if (!/result|quarterly/i.test(purpose)) continue;
                    const date = parseDate(String(item.bfMtgDate ?? ""));
                    if (!date || date < fromDate || date > toDate) continue;
                    const ticker = nseMap.get(String(item.symbol ?? "").toUpperCase());
                    if (ticker) add(date, ticker, "board_meeting");
                }
            }
        }
    } catch { /* silent */ }

    // BSE calendar
    try {
        const fmt = (d: string) => {
            const [y, mo, dd] = d.split("-");
            return `${dd}/${mo}/${y}`;
        };
        const url = `https://api.bseindia.com/BseIndiaAPI/api/Corpresultscalender/w?fDate=${encodeURIComponent(fmt(fromDate))}&tDate=${encodeURIComponent(fmt(toDate))}`;
        const resp = await fetch(url, { headers: BSE_API_HEADERS, signal: AbortSignal.timeout(6_000) });
        if (resp.ok) {
            const data = await resp.json();
            for (const row of data?.Table ?? []) {
                const date = parseDate(row.BM_DATE);
                if (!date || date < fromDate || date > toDate) continue;
                const ticker = bseMap.get(String(row.scrip_cd ?? ""));
                if (ticker) add(date, ticker, "board_meeting");
            }
        }
    } catch { /* silent */ }

    return events;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const today = new Date();
    const month = Math.min(12, Math.max(1, parseInt(searchParams.get("month") ?? String(today.getMonth() + 1))));
    const year  = parseInt(searchParams.get("year") ?? String(today.getFullYear()));

    const fromDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay  = new Date(year, month, 0).getDate();
    const toDate   = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    // ── 1. Query earnings_calendar DB (primary) ───────────────────────────────

    const { events: dbRows, error: dbError } = await calendarRepo.listInRange(fromDate, toDate);

    // ── 2. Check which tickers have analysis results (only relevant tickers) ─

    const relevantTickers = Array.from(new Set((dbRows ?? []).map((r) => r.ticker)));
    let analyzedTickers = new Set<string>();
    if (relevantTickers.length > 0) {
        const tickers = await analysisRepo.listTickersWithAnalysis(relevantTickers);
        analyzedTickers = new Set(tickers);
    }

    const events: Record<string, CalendarEvent[]> = {};

    function addEvent(date: string, ev: CalendarEvent) {
        if (!events[date]) events[date] = [];
        if (!events[date].some((e) => e.ticker === ev.ticker)) {
            events[date].push(ev);
        }
    }

    let seeded = false;

    if (!dbError && dbRows && dbRows.length > 0) {
        // ── Use DB data (seeded) — fast path ─────────────────────────────────
        seeded = true;
        for (const row of dbRows) {
            const info = NIFTY200[row.ticker];
            if (!info) continue;
            addEvent(row.date, {
                ticker: row.ticker,
                name: info.name,
                sector: info.sector,
                quarter: row.quarter,
                date: row.date,
                source: row.source,
                confirmed: row.confirmed || analyzedTickers.has(row.ticker),
                hasAnalysis: analyzedTickers.has(row.ticker),
            });
        }
    } else {
        // ── Not seeded — return empty immediately, let client trigger seed ───
        // Skip expensive live fallback (NSE/BSE API calls + storage pagination)
        // to avoid 12+ second load time. Client auto-seeds on `seeded: false`.
    }

    // Sort each day's events by name
    for (const date of Object.keys(events)) {
        events[date].sort((a, b) => a.name.localeCompare(b.name));
    }

    // Count upcoming-week events
    const todayStr  = today.toISOString().slice(0, 10);
    const weekLater = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const upcoming_week_count = Object.entries(events)
        .filter(([d]) => d >= todayStr && d <= weekLater)
        .reduce((s, [, evs]) => s + evs.length, 0);

    return NextResponse.json(
        { events, month, year, upcoming_week_count, seeded },
        { headers: { "Cache-Control": "no-store" } }
    );
}
