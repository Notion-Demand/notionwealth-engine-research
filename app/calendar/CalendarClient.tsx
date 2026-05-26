"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import {
    ChevronLeft, ChevronRight, Calendar, Loader2,
    CheckCircle2, Clock, ExternalLink, RefreshCw, AlertCircle,
} from "lucide-react";
import clsx from "clsx";
import type { CalendarEvent, CalendarResponse } from "@/app/api/v1/calendar/route";

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Calendar grid builder ─────────────────────────────────────────────────────

function buildGrid(year: number, month: number): (number | null)[] {
    const firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month, 0).getDate();
    const startOffset = (firstDow + 6) % 7; // Mon = 0

    const grid: (number | null)[] = [];
    for (let i = 0; i < startOffset; i++) grid.push(null);
    for (let d = 1; d <= daysInMonth; d++) grid.push(d);
    while (grid.length % 7 !== 0) grid.push(null);
    return grid;
}

function toDateStr(year: number, month: number, day: number): string {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ── Day cell ─────────────────────────────────────────────────────────────────

const MAX_VISIBLE = 3;

function DayCell({
    day,
    dateStr,
    isToday,
    isPast,
    events,
    onEventClick,
}: {
    day: number | null;
    dateStr: string;
    isToday: boolean;
    isPast: boolean;
    events: CalendarEvent[];
    onEventClick: (ticker: string) => void;
}) {
    const [showAll, setShowAll] = useState(false);

    if (day === null) {
        return <div className="h-full min-h-[100px] bg-gray-50/40 border-b border-r border-gray-100" />;
    }

    const visible = showAll ? events : events.slice(0, MAX_VISIBLE);
    const overflow = events.length - MAX_VISIBLE;

    return (
        <div
            className={clsx(
                "h-full min-h-[100px] border-b border-r border-gray-100 p-1.5 transition-colors",
                isToday ? "bg-blue-50/60" : isPast ? "bg-white" : "bg-white"
            )}
        >
            {/* Day number */}
            <div className="flex items-center justify-between mb-1">
                <span
                    className={clsx(
                        "text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full",
                        isToday
                            ? "bg-blue-600 text-white"
                            : isPast
                            ? "text-gray-400"
                            : "text-gray-700"
                    )}
                >
                    {day}
                </span>
                {events.length > 0 && (
                    <span className="text-[10px] text-gray-400 font-medium">
                        {events.length} {events.length === 1 ? "co." : "cos."}
                    </span>
                )}
            </div>

            {/* Event chips */}
            <div className="space-y-0.5">
                {visible.map((ev) => (
                    <button
                        key={ev.ticker}
                        onClick={() => onEventClick(ev.ticker)}
                        title={`${ev.name} — ${ev.quarter ?? "Board Meeting"}\n${ev.source === "transcript" ? "Transcript available" : "Board meeting"}`}
                        className={clsx(
                            "w-full text-left rounded px-1.5 py-0.5 text-[11px] font-medium truncate transition-colors",
                            ev.hasAnalysis
                                ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                                : ev.source === "board_meeting"
                                ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        )}
                    >
                        <span className="flex items-center gap-1">
                            {ev.hasAnalysis
                                ? <CheckCircle2 size={9} className="shrink-0" />
                                : <Clock size={9} className="shrink-0 text-blue-500" />}
                            {ev.ticker}
                            {ev.quarter && (
                                <span className="opacity-60 font-normal">
                                    {ev.quarter.replace("_", " FY").replace("Q", "Q").replace("FY20", "FY")}
                                </span>
                            )}
                        </span>
                    </button>
                ))}

                {!showAll && overflow > 0 && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowAll(true); }}
                        className="w-full text-left text-[11px] text-gray-400 hover:text-gray-600 px-1.5 py-0.5"
                    >
                        +{overflow} more
                    </button>
                )}
                {showAll && overflow > 0 && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowAll(false); }}
                        className="w-full text-left text-[11px] text-gray-400 hover:text-gray-600 px-1.5 py-0.5"
                    >
                        Show less
                    </button>
                )}
            </div>
        </div>
    );
}

// ── Upcoming sidebar ──────────────────────────────────────────────────────────

function UpcomingPanel({
    events,
    onEventClick,
}: {
    events: Record<string, CalendarEvent[]>;
    onEventClick: (ticker: string) => void;
}) {
    const today = new Date().toISOString().slice(0, 10);
    const weekLater = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const upcoming = Object.entries(events)
        .filter(([d]) => d >= today && d <= weekLater)
        .sort(([a], [b]) => a.localeCompare(b));

    if (upcoming.length === 0) return null;

    return (
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-blue-600 mb-3">
                Next 14 days
            </h3>
            <div className="space-y-3">
                {upcoming.map(([date, evs]) => (
                    <div key={date}>
                        <p className="text-[11px] font-semibold text-gray-500 mb-1.5">
                            {new Date(date + "T00:00:00").toLocaleDateString("en-IN", {
                                weekday: "short", day: "numeric", month: "short",
                            })}
                        </p>
                        <div className="space-y-1">
                            {evs.map((ev) => (
                                <button
                                    key={ev.ticker}
                                    onClick={() => onEventClick(ev.ticker)}
                                    className={clsx(
                                        "w-full text-left flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors",
                                        ev.hasAnalysis
                                            ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200"
                                            : "bg-white text-gray-700 hover:bg-gray-50 border border-gray-200"
                                    )}
                                >
                                    <span className="flex items-center gap-1.5">
                                        {ev.hasAnalysis
                                            ? <CheckCircle2 size={11} className="text-emerald-500" />
                                            : <Clock size={11} className="text-blue-400" />}
                                        <span className="font-semibold">{ev.ticker}</span>
                                        <span className="text-gray-400">{ev.name.split(" ").slice(0, 2).join(" ")}</span>
                                    </span>
                                    <ExternalLink size={10} className="text-gray-300" />
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Stats strip ───────────────────────────────────────────────────────────────

function StatsStrip({ events }: { events: Record<string, CalendarEvent[]> }) {
    const allEvents = Object.values(events).flat();
    const analyzed = allEvents.filter((e) => e.hasAnalysis).length;
    const upcoming = allEvents.filter((e) => e.source === "board_meeting" || e.source === "estimated").length;
    const unique = new Set(allEvents.map((e) => e.ticker)).size;

    return (
        <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">This month</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{unique}</p>
                <p className="text-xs text-gray-400">companies reporting</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-emerald-500 font-medium">Analysed</p>
                <p className="text-xl font-bold text-emerald-700 mt-0.5">{analyzed}</p>
                <p className="text-xs text-emerald-400">transcripts in system</p>
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-blue-500 font-medium">Upcoming</p>
                <p className="text-xl font-bold text-blue-700 mt-0.5">{upcoming}</p>
                <p className="text-xs text-blue-400">board meetings scheduled</p>
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CalendarClient() {
    const router = useRouter();
    const today = new Date();

    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth() + 1);
    const [data, setData] = useState<CalendarResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [seeding, setSeeding] = useState(false);
    const [seedLog, setSeedLog] = useState<string[] | null>(null);

    function loadCalendar() {
        setLoading(true);
        setError(null);
        fetch(`/api/v1/calendar?month=${month}&year=${year}`)
            .then((r) => r.json())
            .then((d: CalendarResponse) => setData(d))
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    }

    useEffect(() => { loadCalendar(); }, [month, year]); // eslint-disable-line react-hooks/exhaustive-deps

    async function handleSeed() {
        setSeeding(true);
        setSeedLog(null);
        try {
            const resp = await fetch("/api/v1/calendar/seed", { method: "POST" });
            const result = await resp.json();
            setSeedLog(result.log ?? []);
            loadCalendar(); // reload with fresh DB data
        } catch (e) {
            setSeedLog([`Error: ${e instanceof Error ? e.message : String(e)}`]);
        } finally {
            setSeeding(false);
        }
    }

    const grid = useMemo(() => buildGrid(year, month), [year, month]);
    const todayStr = today.toISOString().slice(0, 10);

    function prevMonth() {
        if (month === 1) { setMonth(12); setYear(y => y - 1); }
        else setMonth(m => m - 1);
    }
    function nextMonth() {
        if (month === 12) { setMonth(1); setYear(y => y + 1); }
        else setMonth(m => m + 1);
    }

    function handleEventClick(ticker: string) {
        router.push(`/dashboard?ticker=${ticker}`);
    }

    const events = data?.events ?? {};
    const hasAnyEvents = Object.keys(events).length > 0;

    return (
        <>
            <Nav />
            <main className="mx-auto max-w-7xl px-6 py-8">

                {/* Header */}
                <div className="mb-6 flex items-start justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
                            <Calendar size={22} className="text-blue-600" />
                            Earnings Calendar
                        </h1>
                        <p className="text-sm text-gray-500 mt-1">
                            Nifty 200 board meetings and earnings dates.
                            Green = transcript analysed · Blue = board meeting scheduled · Click any company to analyse.
                        </p>
                    </div>

                    {/* Month navigation */}
                    <div className="flex items-center gap-3 shrink-0">
                        <button
                            onClick={prevMonth}
                            className="rounded-lg border border-gray-200 bg-white p-2 hover:bg-gray-50 transition-colors"
                        >
                            <ChevronLeft size={16} className="text-gray-600" />
                        </button>
                        <span className="text-base font-semibold text-gray-900 min-w-[150px] text-center">
                            {MONTH_NAMES[month - 1]} {year}
                        </span>
                        <button
                            onClick={nextMonth}
                            className="rounded-lg border border-gray-200 bg-white p-2 hover:bg-gray-50 transition-colors"
                        >
                            <ChevronRight size={16} className="text-gray-600" />
                        </button>
                        {(month !== today.getMonth() + 1 || year !== today.getFullYear()) && (
                            <button
                                onClick={() => { setMonth(today.getMonth() + 1); setYear(today.getFullYear()); }}
                                className="text-xs text-blue-600 hover:text-blue-700 font-medium border border-blue-200 rounded-md px-2.5 py-1.5"
                            >
                                Today
                            </button>
                        )}
                        <button
                            onClick={handleSeed}
                            disabled={seeding}
                            title="Fetch board meeting dates from Tickertape, BSE & NSE and seed the calendar database"
                            className={clsx(
                                "flex items-center gap-1.5 text-xs font-medium rounded-md px-3 py-1.5 border transition-colors",
                                seeding
                                    ? "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                                    : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                            )}
                        >
                            <RefreshCw size={13} className={seeding ? "animate-spin" : ""} />
                            {seeding ? "Seeding…" : "Seed Calendar"}
                        </button>
                    </div>
                </div>

                {/* Not-seeded banner */}
                {!loading && data && !data.seeded && (
                    <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                        <AlertCircle size={16} className="text-amber-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-amber-800">Calendar not seeded</p>
                            <p className="text-xs text-amber-600 mt-0.5">
                                Dates shown are from live BSE/NSE lookups or transcript upload dates — coverage may be incomplete.
                                Click <strong>Seed Calendar</strong> to fetch and store board meeting dates from Tickertape, BSE notices, and NSE for all Nifty 200 companies.
                            </p>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-32">
                        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                        <span className="ml-3 text-sm text-gray-500">Loading earnings calendar…</span>
                    </div>
                ) : error ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-8 text-center">
                        <p className="text-sm text-red-600">{error}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-[1fr_260px] gap-6">
                        <div>
                            {/* Stats */}
                            {hasAnyEvents && <StatsStrip events={events} />}

                            {/* Calendar grid */}
                            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                                {/* Day headers */}
                                <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
                                    {DAY_NAMES.map((d) => (
                                        <div
                                            key={d}
                                            className={clsx(
                                                "py-2.5 text-center text-xs font-semibold uppercase tracking-wide",
                                                d === "Sat" || d === "Sun"
                                                    ? "text-gray-400"
                                                    : "text-gray-500"
                                            )}
                                        >
                                            {d}
                                        </div>
                                    ))}
                                </div>

                                {/* Day cells */}
                                <div className="grid grid-cols-7">
                                    {grid.map((day, idx) => {
                                        const dateStr = day
                                            ? toDateStr(year, month, day)
                                            : "";
                                        const isToday = dateStr === todayStr;
                                        const isPast = dateStr < todayStr;
                                        const cellEvents = day ? (events[dateStr] ?? []) : [];

                                        return (
                                            <DayCell
                                                key={idx}
                                                day={day}
                                                dateStr={dateStr}
                                                isToday={isToday}
                                                isPast={isPast}
                                                events={cellEvents}
                                                onEventClick={handleEventClick}
                                            />
                                        );
                                    })}
                                </div>
                            </div>

                            {!hasAnyEvents && (
                                <div className="rounded-xl border border-gray-200 bg-white px-5 py-16 text-center mt-4">
                                    <Calendar size={28} className="mx-auto text-gray-300 mb-3" />
                                    <p className="text-gray-500 text-sm">
                                        No earnings data for {MONTH_NAMES[month - 1]} {year}.
                                    </p>
                                    <p className="text-xs text-gray-400 mt-1">
                                        Run analyses from the Earnings Analysis tab to populate the calendar.
                                        Board meeting data is fetched live from BSE/NSE.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Sidebar */}
                        <div className="space-y-4">
                            <UpcomingPanel events={events} onEventClick={handleEventClick} />

                            {/* Legend */}
                            <div className="rounded-xl border border-gray-200 bg-white p-4">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
                                    Legend
                                </h3>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-xs text-gray-600">
                                        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 text-emerald-800 px-2 py-0.5 font-medium text-[11px]">
                                            <CheckCircle2 size={9} /> TICKER
                                        </span>
                                        Transcript uploaded + analysed
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-gray-600">
                                        <span className="inline-flex items-center gap-1 rounded bg-blue-100 text-blue-800 px-2 py-0.5 font-medium text-[11px]">
                                            <Clock size={9} /> TICKER
                                        </span>
                                        Board meeting scheduled (BSE/NSE)
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-gray-600">
                                        <span className="inline-flex items-center gap-1 rounded bg-gray-100 text-gray-700 px-2 py-0.5 font-medium text-[11px]">
                                            <Clock size={9} /> TICKER
                                        </span>
                                        Transcript available, no analysis yet
                                    </div>
                                </div>
                                <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
                                    Click any chip to open that company in Earnings Analysis.
                                    Board meeting dates sourced from BSE/NSE corporate filings calendar.
                                </p>
                            </div>

                            {/* Seed log */}
                            {seedLog !== null && (
                                <div className="rounded-xl border border-gray-200 bg-white p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                                            Seed Log
                                        </h3>
                                        <button
                                            onClick={() => setSeedLog(null)}
                                            className="text-[11px] text-gray-400 hover:text-gray-600"
                                        >
                                            clear
                                        </button>
                                    </div>
                                    <div className="space-y-0.5 max-h-56 overflow-y-auto">
                                        {seedLog.map((line, i) => (
                                            <p
                                                key={i}
                                                className={clsx(
                                                    "text-[11px] font-mono leading-relaxed",
                                                    line.startsWith("✓") || line.startsWith("✅")
                                                        ? "text-emerald-600"
                                                        : line.startsWith("✗") || line.toLowerCase().includes("error")
                                                        ? "text-red-500"
                                                        : line.startsWith("→") || line.startsWith("⏭")
                                                        ? "text-blue-500"
                                                        : "text-gray-500"
                                                )}
                                            >
                                                {line}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </main>
        </>
    );
}
