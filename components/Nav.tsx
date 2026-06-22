"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import {
    LogOut, BarChart2, BarChart3, TrendingUp,
    Inbox, Layers, CalendarDays, Bell, CheckCircle2, Clock, X, Youtube,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import clsx from "clsx";

const NAV_ITEMS = [
    { href: "/dashboard",  label: "Concall Analysis",        icon: BarChart2 },
    { href: "/insights",   label: "Multi-Quarter Insights", icon: BarChart3 },
    { href: "/sectors",    label: "Sector Intelligence",    icon: Layers },
    { href: "/screener",   label: "Screener",               icon: TrendingUp },
    { href: "/calendar",   label: "Calendar",               icon: CalendarDays },
    { href: "/videos",     label: "Videos",                 icon: Youtube },
    { href: "/request",    label: "Request",                icon: Inbox },
];

// ── Earnings notification bell ────────────────────────────────────────────────

interface EarningsEvent {
    ticker: string;
    name: string;
    date: string;         // YYYY-MM-DD
    quarter: string | null;
    hasAnalysis: boolean;
    source: string;
}

function EarningsBell() {
    const router = useRouter();
    const [events, setEvents] = useState<EarningsEvent[]>([]);
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const today = new Date();
        fetch(`/api/v1/calendar?month=${today.getMonth() + 1}&year=${today.getFullYear()}`)
            .then((r) => r.json())
            .then((data) => {
                const now = today.toISOString().slice(0, 10);
                const fortnight = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000)
                    .toISOString().slice(0, 10);

                const upcoming: EarningsEvent[] = [];
                for (const [date, evs] of Object.entries(data.events ?? {})) {
                    if (date >= now && date <= fortnight) {
                        for (const ev of evs as EarningsEvent[]) {
                            upcoming.push({ ...ev, date });
                        }
                    }
                }
                upcoming.sort((a, b) => a.date.localeCompare(b.date));
                setEvents(upcoming);
            })
            .catch(() => {/* silent */});
    }, []);

    // Close on outside click
    useEffect(() => {
        function onMouseDown(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, []);

    const count = events.length;

    // Group by date for display
    const grouped: Record<string, EarningsEvent[]> = {};
    for (const ev of events) {
        if (!grouped[ev.date]) grouped[ev.date] = [];
        grouped[ev.date].push(ev);
    }

    function formatDate(dateStr: string) {
        const today = new Date().toISOString().slice(0, 10);
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        if (dateStr === today) return "Today";
        if (dateStr === tomorrow) return "Tomorrow";
        return new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", {
            weekday: "short", day: "numeric", month: "short",
        });
    }

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen((v) => !v)}
                className="relative flex items-center justify-center w-8 h-8 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                title="Upcoming earnings"
            >
                <Bell size={15} />
                {count > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white">
                        {count > 9 ? "9+" : count}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <p className="text-sm font-semibold text-gray-800">
                            Upcoming Earnings
                            {count > 0 && (
                                <span className="ml-2 text-xs font-normal text-gray-400">
                                    next 14 days
                                </span>
                            )}
                        </p>
                        <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                            <X size={14} />
                        </button>
                    </div>

                    {count === 0 ? (
                        <div className="px-4 py-6 text-center">
                            <p className="text-sm text-gray-400">No earnings scheduled in the next 14 days.</p>
                            <button
                                onClick={() => { setOpen(false); router.push("/calendar"); }}
                                className="mt-3 text-xs text-blue-600 hover:text-blue-700 font-medium"
                            >
                                View full calendar →
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                                {Object.entries(grouped).map(([date, evs]) => (
                                    <div key={date} className="px-4 py-2.5">
                                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                                            {formatDate(date)}
                                        </p>
                                        <div className="space-y-1">
                                            {evs.map((ev) => (
                                                <button
                                                    key={ev.ticker}
                                                    onClick={() => {
                                                        setOpen(false);
                                                        router.push(`/dashboard?ticker=${ev.ticker}`);
                                                    }}
                                                    className="w-full text-left flex items-center justify-between rounded-md px-2.5 py-1.5 hover:bg-gray-50 transition-colors group"
                                                >
                                                    <span className="flex items-center gap-2">
                                                        {ev.hasAnalysis
                                                            ? <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                                                            : <Clock size={12} className="text-blue-400 shrink-0" />}
                                                        <span>
                                                            <span className="text-sm font-semibold text-gray-800">
                                                                {ev.ticker}
                                                            </span>
                                                            <span className="text-xs text-gray-400 ml-1.5">
                                                                {ev.name.split(" ").slice(0, 3).join(" ")}
                                                            </span>
                                                        </span>
                                                    </span>
                                                    {ev.quarter && (
                                                        <span className="text-[11px] text-gray-400 font-mono">
                                                            {ev.quarter}
                                                        </span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="border-t border-gray-100 px-4 py-2.5">
                                <button
                                    onClick={() => { setOpen(false); router.push("/calendar"); }}
                                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                                >
                                    View full calendar →
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Credits indicator ─────────────────────────────────────────────────────────

function CreditsIndicator() {
    const [credits, setCredits] = useState<{ used: number; quota: number; remaining: number } | null>(null);

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (!session) return;
            fetch("/api/v1/credits", {
                headers: { Authorization: `Bearer ${session.access_token}` },
            })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => { if (d) setCredits(d); })
                .catch(() => {});
        });
    }, []);

    if (!credits) return null;

    const pct = Math.round((credits.remaining / credits.quota) * 100);
    const low = pct < 20;

    return (
        <div className="flex items-center gap-2" title={`${credits.remaining} of ${credits.quota} credits remaining this month`}>
            <div className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <div
                    className={clsx("h-full rounded-full transition-all", low ? "bg-red-500" : "bg-emerald-500")}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className={clsx("text-[10px] font-mono font-medium", low ? "text-red-500" : "text-gray-400")}>
                {credits.remaining}
            </span>
        </div>
    );
}

// ── Main nav ──────────────────────────────────────────────────────────────────

export default function Nav() {
    const router = useRouter();
    const pathname = usePathname();
    const supabase = createClient();

    async function signOut() {
        await supabase.auth.signOut();
        router.push("/login");
    }

    return (
        <nav className="border-b border-gray-200 bg-white px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-6">
                <Link href="/dashboard" className="font-semibold text-gray-900 text-sm">
                    Quantalyze
                </Link>
                {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                    const active = pathname.startsWith(href);
                    return (
                        <Link
                            key={href}
                            href={href}
                            className={clsx(
                                "flex items-center gap-1.5 text-sm transition-colors",
                                active
                                    ? "text-gray-900 font-medium border-b-2 border-gray-900 pb-[1px]"
                                    : "text-gray-500 hover:text-gray-900"
                            )}
                        >
                            <Icon size={15} />
                            {label}
                        </Link>
                    );
                })}
            </div>

            <div className="flex items-center gap-4">
                <CreditsIndicator />
                <EarningsBell />
                <button
                    onClick={signOut}
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
                >
                    <LogOut size={15} />
                    Sign out
                </button>
            </div>
        </nav>
    );
}
