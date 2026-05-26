import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NIFTY200 } from "@/lib/nifty200";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalendarEvent {
    ticker: string;
    name: string;
    sector: string;
    quarter: string | null;     // e.g. "Q4_2026" if known
    date: string;               // YYYY-MM-DD
    source: "transcript" | "board_meeting" | "estimated";
    hasAnalysis: boolean;       // we have an analysis for this ticker
}

export interface CalendarResponse {
    events: Record<string, CalendarEvent[]>; // YYYY-MM-DD → events
    month: number;
    year: number;
    upcoming_week_count: number; // events in the next 7 days from today
}

// ── BSE board meeting types ───────────────────────────────────────────────────

interface BseBoardMeeting {
    scrip_cd?: string;
    short_name?: string;
    bm_desc?: string;
    BM_DATE?: string;    // "28/04/2026" or "28 Apr 2026" or ISO
    purpose?: string;
    Purpose?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BSE_API_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: "https://www.bseindia.com/",
    Origin: "https://www.bseindia.com",
    Accept: "application/json, */*",
};

const NSE_API_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json, */*",
    Referer: "https://www.nseindia.com/",
    "X-Requested-With": "XMLHttpRequest",
};

/** Build BSE code → ticker map for fast lookup */
function buildBseMap(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [ticker, info] of Object.entries(NIFTY200)) {
        if (info.bse) m.set(String(info.bse), ticker);
    }
    return m;
}

/** Build NSE symbol → ticker map (NSE symbol is stored as nse field e.g. "RELIANCE.NS") */
function buildNseMap(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [ticker, info] of Object.entries(NIFTY200)) {
        const sym = info.nse.replace(".NS", "").toUpperCase();
        m.set(sym, ticker);
        m.set(ticker, ticker); // also index by our own ticker
    }
    return m;
}

/** Parse a variety of date formats → YYYY-MM-DD or null */
function parseDate(raw: string | undefined): string | null {
    if (!raw) return null;
    raw = raw.trim();

    // ISO: 2026-04-28T00:00:00 or 2026-04-28
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    // DD/MM/YYYY
    const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

    // "28 Apr 2026" or "28-Apr-2026"
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

/** Infer quarter label from a board meeting purpose string */
function inferQuarter(purpose: string | undefined): string | null {
    if (!purpose) return null;
    const p = purpose.toLowerCase();
    const fy = p.match(/20(\d{2})-(\d{2})|fy\s*(\d{4})|f\.y\.\s*(\d{4})/);
    const fyYear = fy ? parseInt(fy[2] ?? fy[3] ?? fy[4] ?? "0") + 2000 : null;

    if (/q1|apr.*jun|first.?quarter/i.test(p)) return fyYear ? `Q1_${fyYear}` : null;
    if (/q2|jul.*sep|second.?quarter/i.test(p)) return fyYear ? `Q2_${fyYear}` : null;
    if (/q3|oct.*dec|third.?quarter/i.test(p)) return fyYear ? `Q3_${fyYear}` : null;
    if (/q4|jan.*mar|fourth.?quarter|annual|yearly/i.test(p)) return fyYear ? `Q4_${fyYear}` : null;
    return null;
}

// ── External calendar fetchers ────────────────────────────────────────────────

interface ExternalEvent {
    bseCode?: string;
    nseSymbol?: string;
    date: string;        // YYYY-MM-DD
    purpose?: string;
}

/**
 * Try the NSE event calendar API. Returns events for Nifty 200 companies
 * with "Quarterly Results" purpose.
 */
async function fetchNseCalendar(fromDate: string, toDate: string): Promise<ExternalEvent[]> {
    try {
        // NSE event-calendar endpoint — returns board meeting events
        const url = `https://www.nseindia.com/api/event-calendar?index=nifty200`;
        const resp = await fetch(url, {
            headers: NSE_API_HEADERS,
            signal: AbortSignal.timeout(8_000),
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        if (!Array.isArray(data)) return [];

        const events: ExternalEvent[] = [];
        for (const item of data) {
            // Filter to quarterly results only
            const purpose: string = item.purpose ?? item.Purpose ?? "";
            if (!/result|quarterly|q[1-4]/i.test(purpose)) continue;

            const rawDate: string = item.bfMtgDate ?? item.date ?? "";
            const date = parseDate(rawDate);
            if (!date) continue;

            // Filter to requested range
            if (date < fromDate || date > toDate) continue;

            events.push({
                nseSymbol: (item.symbol ?? "").toUpperCase(),
                date,
                purpose,
            });
        }
        return events;
    } catch {
        return [];
    }
}

/**
 * Try the BSE results calendar API.
 */
async function fetchBseCalendar(fromDate: string, toDate: string): Promise<ExternalEvent[]> {
    try {
        // Convert YYYY-MM-DD to DD/MM/YYYY for BSE
        const fmt = (d: string) => {
            const [y, m, dd] = d.split("-");
            return `${dd}/${m}/${y}`;
        };
        const url =
            `https://api.bseindia.com/BseIndiaAPI/api/Corpresultscalender/w` +
            `?fDate=${encodeURIComponent(fmt(fromDate))}&tDate=${encodeURIComponent(fmt(toDate))}`;

        const resp = await fetch(url, {
            headers: BSE_API_HEADERS,
            signal: AbortSignal.timeout(8_000),
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        const rows: BseBoardMeeting[] = data?.Table ?? data?.table ?? [];
        if (!Array.isArray(rows)) return [];

        const out: ExternalEvent[] = [];
        for (const r of rows) {
            const date = parseDate(r.BM_DATE);
            if (!date) continue;
            out.push({ bseCode: r.scrip_cd, date, purpose: r.purpose ?? r.Purpose });
        }
        return out;
    } catch {
        return [];
    }
}

// ── Quarter inference from transcripts ───────────────────────────────────────

function quarterFromFilename(name: string): string | null {
    const m = name.match(/^.+?_(Q\d_\d{4})\.pdf$/i);
    return m ? m[1].toUpperCase() : null;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const today = new Date();
    const month = Math.min(12, Math.max(1, parseInt(searchParams.get("month") ?? String(today.getMonth() + 1))));
    const year = parseInt(searchParams.get("year") ?? String(today.getFullYear()));

    // Date range for the requested month (± a few days for display completeness)
    const fromDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const toDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    // ── 1. Fetch our transcript storage files (source of truth for past events) ─

    const allFiles: { name: string; created_at: string }[] = [];
    let offset = 0;
    while (true) {
        const { data: page } = await supabaseAdmin()
            .storage.from("transcripts")
            .list("", { limit: 200, offset });
        if (!page || page.length === 0) break;
        allFiles.push(
            ...page
                .filter((f) => f.name.endsWith(".pdf"))
                .map((f) => ({ name: f.name, created_at: f.created_at ?? f.updated_at ?? "" }))
        );
        if (page.length < 200) break;
        offset += page.length;
    }

    // ── 2. Check which tickers have analysis results ──────────────────────────

    const { data: analyzed } = await supabaseAdmin()
        .from("analysis_results")
        .select("company_ticker")
        .order("created_at", { ascending: false });

    const analyzedTickers = new Set((analyzed ?? []).map((r) => r.company_ticker));

    // ── 3. Fetch external calendar data (NSE + BSE) ───────────────────────────

    const [nseEvents, bseEvents] = await Promise.all([
        fetchNseCalendar(fromDate, toDate),
        fetchBseCalendar(fromDate, toDate),
    ]);
    const externalEvents = [...nseEvents, ...bseEvents];

    const bseMap = buildBseMap();
    const nseMap = buildNseMap();

    // ── 4. Build events map ────────────────────────────────────────────────────

    const events: Record<string, CalendarEvent[]> = {};

    function addEvent(date: string, ev: CalendarEvent) {
        if (!events[date]) events[date] = [];
        // Deduplicate by ticker per date
        if (!events[date].some((e) => e.ticker === ev.ticker)) {
            events[date].push(ev);
        }
    }

    // 4a. Transcript-based events (files uploaded in the requested month)
    for (const file of allFiles) {
        const uploadDate = parseDate(file.created_at);
        if (!uploadDate || uploadDate < fromDate || uploadDate > toDate) continue;

        const m = file.name.match(/^(.+?)_(Q\d_\d{4})\.pdf$/i);
        if (!m) continue;
        const ticker = m[1].toUpperCase();
        const quarter = m[2].toUpperCase();

        const info = NIFTY200[ticker];
        if (!info) continue; // only Nifty 200

        addEvent(uploadDate, {
            ticker,
            name: info.name,
            sector: info.sector,
            quarter,
            date: uploadDate,
            source: "transcript",
            hasAnalysis: analyzedTickers.has(ticker),
        });
    }

    // 4b. External (NSE/BSE) board meeting events
    for (const ext of externalEvents) {
        let ticker: string | undefined;
        if (ext.nseSymbol) ticker = nseMap.get(ext.nseSymbol);
        if (!ticker && ext.bseCode) ticker = bseMap.get(ext.bseCode);
        if (!ticker) continue;

        const info = NIFTY200[ticker];
        if (!info) continue;

        addEvent(ext.date, {
            ticker,
            name: info.name,
            sector: info.sector,
            quarter: inferQuarter(ext.purpose),
            date: ext.date,
            source: "board_meeting",
            hasAnalysis: analyzedTickers.has(ticker),
        });
    }

    // ── 5. Sort events per day by name ────────────────────────────────────────

    for (const date of Object.keys(events)) {
        events[date].sort((a, b) => a.name.localeCompare(b.name));
    }

    // ── 6. Count upcoming-week events ─────────────────────────────────────────

    const todayStr = today.toISOString().slice(0, 10);
    const weekLater = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);

    const upcoming_week_count = Object.entries(events)
        .filter(([date]) => date >= todayStr && date <= weekLater)
        .reduce((sum, [, evs]) => sum + evs.length, 0);

    return NextResponse.json(
        { events, month, year, upcoming_week_count },
        { headers: { "Cache-Control": "no-store" } }
    );
}
