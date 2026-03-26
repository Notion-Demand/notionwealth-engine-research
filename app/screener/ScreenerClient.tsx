"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { TrendingDown, TrendingUp, Minus, ChevronRight, Filter, Loader2 } from "lucide-react";
import Nav from "@/components/Nav";
import clsx from "clsx";

// ── Types ────────────────────────────────────────────────────────────────────

interface ScreenerSignal {
    ticker: string;
    subtopic: string;
    language_shift: string;
    score: number;
    signal: "Positive" | "Negative" | "Noise";
    section: string;
    overall_score: number;
    overall_signal: "Positive" | "Negative" | "Mixed" | "Noise";
    summary: string;
    quarter: string;
    quarter_previous: string;
    earnings_delta: string[];
}

// ── Section → Category mapping ───────────────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
    "Revenue & Growth": "Growth",
    "Operational Margin": "Profitability",
    "Capital & Liquidity": "Capital",
    "Macro & Risk": "Risk",
};
const ALL_CATEGORIES = ["All", "Growth", "Profitability", "Capital", "Risk"];

// ── Signal badge styling ─────────────────────────────────────────────────────

const SIGNAL_STYLES = {
    Positive: "bg-emerald-100 text-emerald-700 border-emerald-200",
    Negative: "bg-red-100 text-red-700 border-red-200",
    Mixed: "bg-amber-100 text-amber-700 border-amber-200",
    Noise: "bg-gray-100 text-gray-500 border-gray-200",
} as const;

const SIGNAL_DOT = {
    Positive: "bg-emerald-500",
    Negative: "bg-red-500",
    Mixed: "bg-amber-500",
    Noise: "bg-gray-400",
} as const;

// ── Strength bar component ───────────────────────────────────────────────────

function StrengthBar({ score }: { score: number }) {
    const pct = Math.min(Math.abs(score) * 10, 100);
    const isPositive = score > 0;

    return (
        <div className="flex items-center gap-2 min-w-[120px]">
            <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                    className={clsx(
                        "h-2 rounded-full transition-all duration-500",
                        isPositive ? "bg-emerald-400" : "bg-red-400"
                    )}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span
                className={clsx(
                    "text-sm font-mono font-semibold tabular-nums w-12 text-right",
                    isPositive ? "text-emerald-600" : "text-red-600"
                )}
            >
                {isPositive ? "+" : ""}{score.toFixed(1)}
            </span>
        </div>
    );
}

// ── Signal direction icon ────────────────────────────────────────────────────

function SignalIcon({ score }: { score: number }) {
    if (score > 2) return <TrendingUp size={16} className="text-emerald-500" />;
    if (score < -2) return <TrendingDown size={16} className="text-red-500" />;
    return <Minus size={16} className="text-gray-400" />;
}

// ── Row with expandable detail ───────────────────────────────────────────────

function SignalRow({
    signal,
    rank,
}: {
    signal: ScreenerSignal;
    rank: number;
}) {
    const [expanded, setExpanded] = useState(false);
    const router = useRouter();
    const category = CATEGORY_MAP[signal.section] || signal.section;

    return (
        <>
            <tr
                className="group cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
                onClick={() => setExpanded((v) => !v)}
            >
                {/* Rank */}
                <td className="pl-5 pr-2 py-3.5 w-10">
                    <span className="text-xs font-medium text-gray-400">
                        {rank}
                    </span>
                </td>

                {/* Direction icon */}
                <td className="px-2 py-3.5 w-8">
                    <SignalIcon score={signal.score} />
                </td>

                {/* Company */}
                <td className="px-3 py-3.5">
                    <div className="flex flex-col">
                        <span className="text-sm font-semibold text-gray-900">
                            {signal.ticker}
                        </span>
                        <span className="text-xs text-gray-400 mt-0.5">
                            {signal.quarter_previous} → {signal.quarter}
                        </span>
                    </div>
                </td>

                {/* Signal description */}
                <td className="px-3 py-3.5 max-w-xs">
                    <p className="text-sm text-gray-700 font-medium truncate">
                        {signal.subtopic}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {signal.language_shift}
                    </p>
                </td>

                {/* Strength */}
                <td className="px-3 py-3.5">
                    <StrengthBar score={signal.score} />
                </td>

                {/* Category */}
                <td className="px-3 py-3.5">
                    <span
                        className={clsx(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border",
                            category === "Growth" &&
                            "bg-blue-50 text-blue-700 border-blue-200",
                            category === "Profitability" &&
                            "bg-purple-50 text-purple-700 border-purple-200",
                            category === "Capital" &&
                            "bg-cyan-50 text-cyan-700 border-cyan-200",
                            category === "Risk" &&
                            "bg-orange-50 text-orange-700 border-orange-200"
                        )}
                    >
                        {category}
                    </span>
                </td>

                {/* Overall */}
                <td className="px-3 py-3.5">
                    <span
                        className={clsx(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                            SIGNAL_STYLES[signal.overall_signal]
                        )}
                    >
                        <span
                            className={clsx(
                                "h-1.5 w-1.5 rounded-full",
                                SIGNAL_DOT[signal.overall_signal]
                            )}
                        />
                        {signal.overall_signal}
                    </span>
                </td>

                {/* Expand arrow */}
                <td className="pr-5 py-3.5 w-8">
                    <ChevronRight
                        size={14}
                        className={clsx(
                            "text-gray-400 transition-transform duration-200",
                            expanded && "rotate-90"
                        )}
                    />
                </td>
            </tr>

            {/* Expanded detail */}
            {expanded && (
                <tr className="bg-gray-50/50">
                    <td colSpan={8} className="px-5 py-4">
                        <div className="grid grid-cols-[1fr_auto] gap-6">
                            <div className="space-y-3">
                                <p className="text-sm text-gray-600 leading-relaxed">
                                    {signal.summary}
                                </p>

                                {signal.earnings_delta.length > 0 && (
                                    <div>
                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                            Key Narrative Shifts
                                        </p>
                                        <ul className="space-y-1.5">
                                            {signal.earnings_delta.slice(0, 5).map((b, i) => (
                                                <li
                                                    key={i}
                                                    className="flex items-start gap-2 text-sm text-gray-600"
                                                >
                                                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
                                                    {b}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-end">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        router.push(
                                            `/dashboard?ticker=${signal.ticker}`
                                        );
                                    }}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors whitespace-nowrap"
                                >
                                    Deep Dive
                                    <ChevronRight size={14} />
                                </button>
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

// ── Main screener ────────────────────────────────────────────────────────────

export default function ScreenerClient() {
    const [signals, setSignals] = useState<ScreenerSignal[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters

    const [selectedCategory, setSelectedCategory] = useState<string>("All");

    // Fetch on mount
    useEffect(() => {
        fetch("/api/v1/screener")
            .then((r) => r.json())
            .then((data) => {
                setSignals(data.signals ?? []);
            })
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    // Filtered signals
    const filtered = useMemo(() => {
        return signals.filter((s) => {
            if (selectedCategory !== "All") {
                const cat = CATEGORY_MAP[s.section] || s.section;
                if (cat !== selectedCategory) return false;
            }
            return true;
        });
    }, [signals, selectedCategory]);

    // Stats
    const negativeCount = filtered.filter((s) => s.signal === "Negative").length;
    const positiveCount = filtered.filter((s) => s.signal === "Positive").length;

    return (
        <div className="min-h-screen bg-gray-50">
            <Nav />

            <main className="mx-auto max-w-6xl px-6 py-8">
                {/* ── Header ──────────────────────────────────────────────────── */}
                <div className="mb-8">
                    <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                        Narrative Change Screener (NIFTY 200 Universe)
                    </h1>
                    <p className="text-sm text-gray-500 mt-1 max-w-xl">
                        Ranked cross-company view of the biggest management narrative shifts
                        this earnings season for NIFTY 200 universe and much more. Click any row to explore details.
                    </p>
                </div>

                {/* ── Stats strip ─────────────────────────────────────────────── */}
                {!loading && signals.length > 0 && (
                    <div className="grid grid-cols-3 gap-4 mb-6">
                        <div className="rounded-xl border border-gray-200 bg-white px-5 py-4">
                            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                                Companies Analyzed
                            </p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">
                                {filtered.length}
                            </p>
                        </div>
                        <div className="rounded-xl border border-red-100 bg-red-50/40 px-5 py-4">
                            <p className="text-[11px] font-medium uppercase tracking-wide text-red-400">
                                Cautionary Signals
                            </p>
                            <div className="flex items-end gap-2 mt-1">
                                <p className="text-2xl font-bold text-red-600">{negativeCount}</p>
                                <p className="text-xs text-red-400 pb-0.5">companies</p>
                            </div>
                        </div>
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-5 py-4">
                            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-400">
                                Improvement Signals
                            </p>
                            <div className="flex items-end gap-2 mt-1">
                                <p className="text-2xl font-bold text-emerald-600">{positiveCount}</p>
                                <p className="text-xs text-emerald-400 pb-0.5">companies</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Filter bar ──────────────────────────────────────────────── */}
                {!loading && signals.length > 0 && (
                    <div className="flex items-center gap-3 mb-4">
                        <Filter size={14} className="text-gray-400" />

                        {/* Category pills */}
                        <div className="flex gap-1.5">
                            {ALL_CATEGORIES.map((cat) => (
                                <button
                                    key={cat}
                                    onClick={() => setSelectedCategory(cat)}
                                    className={clsx(
                                        "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                                        selectedCategory === cat
                                            ? "bg-gray-900 text-white border-gray-900"
                                            : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                                    )}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Table ───────────────────────────────────────────────────── */}
                {loading ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                        <span className="ml-3 text-sm text-gray-500">Loading signals…</span>
                    </div>
                ) : error ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-8 text-center">
                        <p className="text-sm text-red-600">{error}</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-xl border border-gray-200 bg-white px-5 py-16 text-center">
                        <p className="text-gray-500 text-sm">
                            {signals.length === 0
                                ? "No analysis results yet. Run analyses from the Dashboard to populate the screener."
                                : "No signals match the current filters."}
                        </p>
                    </div>
                ) : (
                    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-200 bg-gray-50">
                                    <th className="pl-5 pr-2 py-3 w-10" />
                                    <th className="px-2 py-3 w-8" />
                                    <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                                        Company
                                    </th>
                                    <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                                        Signal
                                    </th>
                                    <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                                        Strength
                                    </th>
                                    <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                                        Category
                                    </th>
                                    <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                                        Overall
                                    </th>
                                    <th className="pr-5 py-3 w-8" />
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((s, i) => (
                                    <SignalRow key={s.ticker} signal={s} rank={i + 1} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </main>
        </div>
    );
}
