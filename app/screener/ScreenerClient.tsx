"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
    TrendingDown, TrendingUp, Minus, ChevronRight,
    Filter, Loader2, AlertTriangle, ShieldCheck, ShieldAlert,
    ArrowUpDown,
} from "lucide-react";
import Nav from "@/components/Nav";
import clsx from "clsx";

// ── Types ────────────────────────────────────────────────────────────────────

type SignalFlag =
    | "DISCLOSURE INFLATION"
    | "EARNINGS QUALITY"
    | "ONE-TIME ITEMS"
    | "MANAGEMENT EVASION"
    | "NARRATIVE TRAP"
    | "INDUSTRY CONSENSUS";  // added by frontend peer-analysis

interface ScreenerSignal {
    ticker: string;
    subtopic: string;
    language_shift: string;
    score: number;
    signal: "Positive" | "Negative" | "Mixed" | "Noise";
    section: string;
    overall_score: number;
    overall_signal: "Positive" | "Negative" | "Mixed" | "Noise";
    summary: string;
    quarter: string;
    quarter_previous: string;
    earnings_delta: string[];
    // Confidence layer
    confidence_pct: number;
    adjusted_score: number;
    flags: SignalFlag[];
    is_current_quarter: boolean;
    is_nifty50: boolean;
}

// ── Section → Category mapping (current pipeline section names) ───────────────

const CATEGORY_MAP: Record<string, string> = {
    "Revenue & Growth": "Growth",
    "Margins & Profitability": "Profitability",
    "Cost Structure": "Cost",
    "CapEx & Balance Sheet": "Capital",
    "Macro & Risk": "Risk",
    // Legacy names (for older stored rows)
    "Operational Margin": "Profitability",
    "Capital & Liquidity": "Capital",
};
const ALL_CATEGORIES = ["All", "Growth", "Profitability", "Cost", "Capital", "Risk"];

// ── Peer consensus detection ──────────────────────────────────────────────────

const CONSENSUS_THEMES: { name: string; pattern: RegExp }[] = [
    { name: "AI/Digital", pattern: /\b(ai|artificial intelligence|generative|machine learning|digital transform|automation)\b/i },
    { name: "Infra/CapEx", pattern: /\b(infrastructure|government.*spend|capex|capacity.*expan|project.*pipeline)\b/i },
    { name: "Deleveraging", pattern: /\b(debt.*reduc|deleverage|zero debt|balance sheet.*improv|net.*debt)\b/i },
    { name: "Margin Expansion", pattern: /\b(margin.*expan|ebitda.*improv|profitability.*improv|cost.*efficien)\b/i },
    { name: "Inorganic Growth", pattern: /\b(acquisition|m&a|inorganic|merger|strategic.*acqui)\b/i },
    { name: "Defense/PLI", pattern: /\b(defense|pli|production.*linked|government.*contract|order.*book)\b/i },
];

const CONSENSUS_THRESHOLD = 4; // 4+ companies sharing a theme = industry consensus

function addConsensusFlags(signals: ScreenerSignal[]): ScreenerSignal[] {
    if (signals.length < CONSENSUS_THRESHOLD) return signals;

    // Count theme occurrences across all positive signals
    const themeCount = new Map<string, Set<string>>();
    for (const theme of CONSENSUS_THEMES) {
        themeCount.set(theme.name, new Set<string>());
    }

    for (const s of signals) {
        if (s.signal !== "Positive") continue;
        const text = `${s.subtopic} ${s.language_shift}`;
        for (const theme of CONSENSUS_THEMES) {
            if (theme.pattern.test(text)) {
                themeCount.get(theme.name)?.add(s.ticker);
            }
        }
    }

    // Build set of tickers in consensus themes
    const consensusTickers = new Set<string>();
    for (const [, tickers] of Array.from(themeCount)) {
        if (tickers.size >= CONSENSUS_THRESHOLD) {
            for (const t of Array.from(tickers)) consensusTickers.add(t);
        }
    }

    return signals.map((s) => {
        if (!consensusTickers.has(s.ticker)) return s;
        if (s.flags.includes("INDUSTRY CONSENSUS")) return s;
        return { ...s, flags: [...s.flags, "INDUSTRY CONSENSUS"] as SignalFlag[] };
    });
}

// ── Styling constants ─────────────────────────────────────────────────────────

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

const FLAG_STYLES: Record<SignalFlag, string> = {
    "NARRATIVE TRAP": "bg-red-100 text-red-700 border-red-300",
    "DISCLOSURE INFLATION": "bg-orange-100 text-orange-700 border-orange-300",
    "EARNINGS QUALITY": "bg-amber-100 text-amber-700 border-amber-300",
    "ONE-TIME ITEMS": "bg-yellow-100 text-yellow-700 border-yellow-300",
    "MANAGEMENT EVASION": "bg-purple-100 text-purple-700 border-purple-300",
    "INDUSTRY CONSENSUS": "bg-blue-100 text-blue-700 border-blue-300",
};

const CATEGORY_STYLES: Record<string, string> = {
    Growth: "bg-blue-50 text-blue-700 border-blue-200",
    Profitability: "bg-purple-50 text-purple-700 border-purple-200",
    Cost: "bg-yellow-50 text-yellow-700 border-yellow-200",
    Capital: "bg-cyan-50 text-cyan-700 border-cyan-200",
    Risk: "bg-orange-50 text-orange-700 border-orange-200",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StrengthBar({ score, adjusted }: { score: number; adjusted: number }) {
    const rawPct = Math.min(Math.abs(score) * 10, 100);
    const adjPct = Math.min(Math.abs(adjusted) * 10, 100);
    const isPositive = score > 0;

    return (
        <div className="flex items-center gap-2 min-w-[140px]">
            <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden relative">
                {/* Raw score (background, lighter) */}
                <div
                    className={clsx(
                        "absolute inset-y-0 left-0 rounded-full",
                        isPositive ? "bg-emerald-100" : "bg-red-100"
                    )}
                    style={{ width: `${rawPct}%` }}
                />
                {/* Adjusted score (foreground, solid) */}
                <div
                    className={clsx(
                        "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
                        isPositive ? "bg-emerald-500" : "bg-red-500"
                    )}
                    style={{ width: `${adjPct}%` }}
                />
            </div>
            <span
                className={clsx(
                    "text-sm font-mono font-semibold tabular-nums w-12 text-right",
                    isPositive ? "text-emerald-600" : "text-red-600"
                )}
            >
                {isPositive ? "+" : ""}{adjusted.toFixed(1)}
            </span>
        </div>
    );
}

function ConfidenceBadge({ pct }: { pct: number }) {
    const color =
        pct >= 75 ? "text-emerald-600 bg-emerald-50 border-emerald-200" :
        pct >= 50 ? "text-amber-600 bg-amber-50 border-amber-200" :
                    "text-red-600 bg-red-50 border-red-200";
    const Icon = pct >= 75 ? ShieldCheck : ShieldAlert;

    return (
        <span className={clsx(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums",
            color
        )}>
            <Icon size={10} />
            {pct}%
        </span>
    );
}

function SignalIcon({ score }: { score: number }) {
    if (score > 2) return <TrendingUp size={16} className="text-emerald-500" />;
    if (score < -2) return <TrendingDown size={16} className="text-red-500" />;
    return <Minus size={16} className="text-gray-400" />;
}

// ── Row with expandable detail ────────────────────────────────────────────────

function SignalRow({ signal, rank }: { signal: ScreenerSignal; rank: number }) {
    const [expanded, setExpanded] = useState(false);
    const router = useRouter();
    const category = CATEGORY_MAP[signal.section] || signal.section;
    const isNarrativeTrap = signal.flags.includes("NARRATIVE TRAP");
    const warningFlags = signal.flags.filter((f) => f !== "INDUSTRY CONSENSUS");
    const infoFlags = signal.flags.filter((f) => f === "INDUSTRY CONSENSUS");

    return (
        <>
            <tr
                className={clsx(
                    "group cursor-pointer transition-colors border-b border-gray-100 last:border-b-0",
                    isNarrativeTrap ? "bg-red-50/30 hover:bg-red-50/60" : "hover:bg-gray-50"
                )}
                onClick={() => setExpanded((v) => !v)}
            >
                {/* Rank */}
                <td className="pl-5 pr-2 py-3.5 w-10">
                    <span className="text-xs font-medium text-gray-400">{rank}</span>
                </td>

                {/* Direction icon */}
                <td className="px-2 py-3.5 w-8">
                    <SignalIcon score={signal.score} />
                </td>

                {/* Company + flags */}
                <td className="px-3 py-3.5 min-w-[140px]">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-gray-900">{signal.ticker}</span>
                            {signal.is_nifty50 && (
                                <span className="rounded bg-gray-100 px-1 py-0.5 text-[9px] font-bold text-gray-500 tracking-wide">N50</span>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-gray-400">
                                {signal.quarter_previous?.replace("_", " ")} → {signal.quarter?.replace("_", " ")}
                            </span>
                            {!signal.is_current_quarter && (
                                <span className="rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-[9px] font-semibold text-amber-600 leading-none">
                                    prev qtr
                                </span>
                            )}
                        </div>
                        {/* Flag chips */}
                        {(warningFlags.length > 0 || infoFlags.length > 0) && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                                {warningFlags.map((f) => (
                                    <span
                                        key={f}
                                        className={clsx(
                                            "inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                                            FLAG_STYLES[f]
                                        )}
                                    >
                                        {f === "NARRATIVE TRAP" && <AlertTriangle size={8} />}
                                        {f}
                                    </span>
                                ))}
                                {infoFlags.map((f) => (
                                    <span
                                        key={f}
                                        className={clsx(
                                            "inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                                            FLAG_STYLES[f]
                                        )}
                                    >
                                        {f}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </td>

                {/* Signal description */}
                <td className="px-3 py-3.5 max-w-xs">
                    <p className="text-sm text-gray-700 font-medium truncate">{signal.subtopic}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{signal.language_shift}</p>
                </td>

                {/* Adjusted strength (bar shows raw behind, adjusted in front) */}
                <td className="px-3 py-3.5">
                    <StrengthBar score={signal.score} adjusted={signal.adjusted_score} />
                </td>

                {/* Confidence */}
                <td className="px-3 py-3.5">
                    <ConfidenceBadge pct={signal.confidence_pct} />
                </td>

                {/* Category */}
                <td className="px-3 py-3.5">
                    <span
                        className={clsx(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border",
                            CATEGORY_STYLES[category] ?? "bg-gray-50 text-gray-600 border-gray-200"
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
                        <span className={clsx("h-1.5 w-1.5 rounded-full", SIGNAL_DOT[signal.overall_signal])} />
                        {signal.overall_signal}
                    </span>
                </td>

                {/* Expand */}
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
                <tr className={isNarrativeTrap ? "bg-red-50/20" : "bg-gray-50/50"}>
                    <td colSpan={9} className="px-5 py-4">
                        <div className="grid grid-cols-[1fr_auto] gap-6">
                            <div className="space-y-3">
                                {/* Confidence breakdown */}
                                {signal.flags.length > 0 && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
                                        <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1.5">
                                            Signal confidence: {signal.confidence_pct}%
                                            {signal.confidence_pct < 50 ? " — treat with caution" : ""}
                                        </p>
                                        <ul className="space-y-1">
                                            {signal.flags.map((f) => (
                                                <li key={f} className="text-xs text-amber-600 flex items-center gap-1.5">
                                                    <span className="h-1 w-1 rounded-full bg-amber-500 shrink-0" />
                                                    {f === "DISCLOSURE INFLATION" && "Previous quarter lacked transcript data — improvement reflects IR quality, not business acceleration."}
                                                    {f === "NARRATIVE TRAP" && "Raw signal is strongly positive but confidence is low. Multiple factors reduce reliability."}
                                                    {f === "EARNINGS QUALITY" && "Validation score low or high flagged signal count — reported earnings may be unreliable."}
                                                    {f === "ONE-TIME ITEMS" && "Multiple one-time adjustments detected — core operating performance may differ from headline."}
                                                    {f === "MANAGEMENT EVASION" && "High executive evasiveness score — management avoided direct questions during the call."}
                                                    {f === "INDUSTRY CONSENSUS" && "This narrative theme appears in 4+ companies this quarter — alpha is limited; likely sector consensus."}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                <p className="text-sm text-gray-600 leading-relaxed">{signal.summary}</p>

                                {signal.earnings_delta.length > 0 && (
                                    <div>
                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                            Key Narrative Shifts
                                        </p>
                                        <ul className="space-y-1.5">
                                            {signal.earnings_delta.slice(0, 5).map((b, i) => (
                                                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
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
                                        router.push(`/dashboard?ticker=${signal.ticker}`);
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

// ── Main screener ─────────────────────────────────────────────────────────────

type SortMode = "adjusted" | "raw";

export default function ScreenerClient() {
    const [signals, setSignals] = useState<ScreenerSignal[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [quarter, setQuarter] = useState("");
    const [quarterPrev, setQuarterPrev] = useState("");
    const [currentQCount, setCurrentQCount] = useState(0);

    const [selectedCategory, setSelectedCategory] = useState<string>("All");
    const [selectedSignal, setSelectedSignal] = useState<string>("All");
    const [showTrapsOnly, setShowTrapsOnly] = useState(false);
    const [sortMode, setSortMode] = useState<SortMode>("adjusted");

    useEffect(() => {
        fetch("/api/v1/screener")
            .then((r) => r.json())
            .then((data) => {
                const raw: ScreenerSignal[] = data.signals ?? [];
                // Run peer consensus detection on all signals
                setSignals(addConsensusFlags(raw));
                setQuarter(data.quarter ?? "");
                setQuarterPrev(data.quarter_previous ?? "");
                setCurrentQCount(data.current_quarter_count ?? raw.length);
            })
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    const filtered = useMemo(() => {
        let result = signals;

        if (selectedCategory !== "All") {
            result = result.filter((s) => {
                const cat = CATEGORY_MAP[s.section] || s.section;
                return cat === selectedCategory;
            });
        }

        if (selectedSignal !== "All") {
            result = result.filter((s) => s.overall_signal === selectedSignal);
        }

        if (showTrapsOnly) {
            result = result.filter((s) => s.flags.includes("NARRATIVE TRAP"));
        }

        // Sort
        if (sortMode === "adjusted") {
            result = [...result].sort((a, b) => Math.abs(b.adjusted_score) - Math.abs(a.adjusted_score));
        } else {
            result = [...result].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
        }

        return result;
    }, [signals, selectedCategory, selectedSignal, showTrapsOnly, sortMode]);

    const negativeCount = signals.filter((s) => s.overall_signal === "Negative").length;
    const positiveCount = signals.filter((s) => s.overall_signal === "Positive").length;
    const trapCount = signals.filter((s) => s.flags.includes("NARRATIVE TRAP")).length;
    const highConfidenceCount = signals.filter((s) => s.confidence_pct >= 75).length;

    return (
        <div className="min-h-screen bg-gray-50">
            <Nav />

            <main className="mx-auto max-w-7xl px-6 py-8">
                {/* ── Header ──────────────────────────────────────────────────── */}
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                        Narrative Change Screener
                    </h1>
                    <p className="text-sm text-gray-500 mt-1 max-w-2xl">
                        Confidence-adjusted narrative signals across Nifty 50 + Nifty 200.
                        Nifty 50 companies always appear using their latest available analysis.
                        Scores penalised for disclosure inflation, management evasion, earnings
                        quality, and one-time items. Peer consensus detected automatically.
                        {quarter && currentQCount > 0 && (
                            <span className="ml-1 font-medium text-gray-700">
                                {currentQCount} companies at current quarter ({quarterPrev?.replace("_", " ")} → {quarter?.replace("_", " ")}).
                            </span>
                        )}
                    </p>
                </div>

                {/* ── Stats strip ──────────────────────────────────────────────── */}
                {!loading && signals.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                        <div className="rounded-xl border border-gray-200 bg-white px-5 py-4">
                            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                                Companies Analyzed
                            </p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">{signals.length}</p>
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
                        <div className="rounded-xl border border-red-100 bg-red-50/40 px-5 py-4">
                            <p className="text-[11px] font-medium uppercase tracking-wide text-red-400">
                                Cautionary Signals
                            </p>
                            <div className="flex items-end gap-2 mt-1">
                                <p className="text-2xl font-bold text-red-600">{negativeCount}</p>
                                <p className="text-xs text-red-400 pb-0.5">companies</p>
                            </div>
                        </div>
                        <div className="rounded-xl border border-orange-100 bg-orange-50/40 px-5 py-4">
                            <p className="text-[11px] font-medium uppercase tracking-wide text-orange-400">
                                Narrative Traps
                            </p>
                            <div className="flex items-end gap-2 mt-1">
                                <p className="text-2xl font-bold text-orange-600">{trapCount}</p>
                                <p className="text-[11px] text-orange-400 pb-0.5">
                                    · {highConfidenceCount} high-confidence
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Filter & sort bar ─────────────────────────────────────────── */}
                {!loading && signals.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                        <Filter size={14} className="text-gray-400 shrink-0" />

                        {/* Category */}
                        <div className="flex gap-1.5 flex-wrap">
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

                        <div className="w-px h-4 bg-gray-200 shrink-0" />

                        {/* Overall signal filter */}
                        {["All", "Positive", "Negative", "Mixed"].map((sig) => (
                            <button
                                key={sig}
                                onClick={() => setSelectedSignal(sig)}
                                className={clsx(
                                    "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                                    selectedSignal === sig
                                        ? "bg-gray-900 text-white border-gray-900"
                                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                                )}
                            >
                                {sig}
                            </button>
                        ))}

                        <div className="w-px h-4 bg-gray-200 shrink-0" />

                        {/* Narrative traps toggle */}
                        <button
                            onClick={() => setShowTrapsOnly((v) => !v)}
                            className={clsx(
                                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                                showTrapsOnly
                                    ? "bg-red-600 text-white border-red-600"
                                    : "bg-white text-red-600 border-red-300 hover:border-red-400"
                            )}
                        >
                            <AlertTriangle size={11} />
                            Narrative Traps
                        </button>

                        {/* Sort mode */}
                        <button
                            onClick={() => setSortMode((m) => m === "adjusted" ? "raw" : "adjusted")}
                            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border bg-white text-gray-600 border-gray-200 hover:border-gray-300 transition-colors"
                            title="Toggle sort between adjusted (confidence-weighted) and raw signal strength"
                        >
                            <ArrowUpDown size={11} />
                            Sort: {sortMode === "adjusted" ? "Adjusted" : "Raw"}
                        </button>
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
                                ? "No concall analyses yet. Run analyses from Concall Analysis to populate the screener."
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
                                        {sortMode === "adjusted" ? "Adj. Strength" : "Raw Strength"}
                                    </th>
                                    <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                                        Confidence
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

                        {/* Legend */}
                        <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-3 flex flex-wrap gap-x-6 gap-y-1">
                            <p className="text-[11px] text-gray-400">
                                <span className="font-semibold text-gray-500">Adj. Strength</span> = raw signal × confidence multiplier.
                                The bar shows raw (light) vs adjusted (solid) side-by-side.
                            </p>
                            <p className="text-[11px] text-gray-400">
                                <span className="font-semibold text-gray-500">Confidence</span> penalises for:
                                disclosure inflation, one-time items, management evasion, validation score.
                            </p>
                            <p className="text-[11px] text-gray-400">
                                <span className="font-semibold text-gray-500">Industry Consensus</span> = same narrative theme in 4+ companies → limited alpha.
                            </p>
                            <p className="text-[11px] text-gray-400">
                                <span className="font-semibold text-amber-600">prev qtr</span> badge = Nifty 50 company shown at their most recent analyzed quarter (not the latest global quarter yet).
                            </p>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
