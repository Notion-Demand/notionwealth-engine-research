"use client";

import { useState, useEffect, useMemo } from "react";
import Nav from "@/components/Nav";
import {
    Loader2,
    ChevronDown,
    ChevronUp,
    TrendingUp,
    TrendingDown,
    Minus,
    Layers,
    BarChart3,
    Wind,
    AlertTriangle,
    Zap,
    Globe,
    Shuffle,
    Building2,
} from "lucide-react";
import clsx from "clsx";

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface SectorNarrative {
    competitive_structure: string;
    strategic_theme: string;
    tailwinds: string[];
    headwinds: string[];
    key_triggers: string[];
    macro_sensitivity: string;
    transformation_signal: string;
}

interface SectorIntelligence {
    sector: string;
    sector_label: string;
    company_count: number;
    quarter: string;
    quarter_previous: string;
    dimensions: SectorDimension[];
    narrative?: SectorNarrative | null;
    parent_sector?: string;
    thesis?: string;
    is_sub_sector?: boolean;
}

// ── Dimension display order & metadata ────────────────────────────────────────

const DIM_ORDER = [
    "Demand Momentum",
    "Pricing Power",
    "Margin Trajectory",
    "Cost Pressure",
    "CapEx & Allocation",
    "Macro & Cycle Risk",
    "Management Confidence",
    "Earnings Quality",
];

const DIMENSION_META: Record<string, { icon: string; label: string; short: string; why: string }> = {
    "Demand Momentum":    { icon: "📈", label: "Demand Momentum",    short: "Demand",   why: "Volume & order flow — often leads revenue upgrades by 1–2 quarters." },
    "Pricing Power":      { icon: "💰", label: "Pricing Power",      short: "Pricing",  why: "ARPU, realisation, and tariff direction — determines earnings resilience during slowdowns." },
    "Margin Trajectory":  { icon: "📊", label: "Margin Trajectory",  short: "Margins",  why: "EBITDA/PAT margin shifts — directly drives earnings surprises." },
    "Cost Pressure":      { icon: "🏭", label: "Cost Pressure",      short: "Costs",    why: "Raw material & energy cost evolution — leading indicator of margin compression or relief." },
    "CapEx & Allocation": { icon: "🏗️", label: "CapEx & Allocation", short: "CapEx",    why: "Capex intensity vs. historical norms — determines capacity cycle and ROIC trajectory." },
    "Macro & Cycle Risk": { icon: "🌐", label: "Macro & Cycle Risk", short: "Macro",    why: "FX, rates, and regulatory headwinds — quantifies external risk not captured in margins." },
    "Management Confidence": { icon: "🎯", label: "Management Confidence", short: "Mgmt",  why: "Evasiveness-adjusted guidance tone — executives signal cycle turns before numbers do." },
    "Earnings Quality":   { icon: "🔍", label: "Earnings Quality",   short: "EQ",       why: "Flagged signals and validation score — detects one-time adjustments and red flags." },
    // Legacy
    "Capex Cycle":        { icon: "🏗️", label: "CapEx Cycle",        short: "CapEx",    why: "Capex cycles drive multi-year earnings growth." },
};

// ── Signal quality helpers ────────────────────────────────────────────────────

/**
 * Returns true if a company signal contains a real business observation.
 * Filters out:
 *   - "Insufficient data" placeholders
 *   - Transcript metadata ("transitioned from scheduling to uploading", etc.)
 *   - Score-0 neutral noise that adds nothing to the weighted average
 */
function hasRealSignal(cs: CompanySignal): boolean {
    const lower = (cs.signal ?? "").toLowerCase();
    if (lower.includes("insufficient data"))      return false;
    if (lower.includes("no data"))                return false;
    if (lower.includes("no transcript"))          return false;
    if (lower.includes("no earnings"))            return false;
    // Metadata about transcript availability — not a business observation
    if (
        lower.includes("transcript") &&
        (
            lower.includes("upload") ||
            lower.includes("schedul") ||
            lower.includes("transition") ||
            lower.includes("earnings call")
        )
    ) return false;
    return true;
}

/** Sum of weight_pct for companies with real signals → 0–100 */
function coveragePct(signals: CompanySignal[]): number {
    return signals
        .filter(hasRealSignal)
        .reduce((sum, cs) => sum + (cs.weight_pct ?? 0), 0);
}

/** Color class for coverage badge */
function coverageCls(pct: number): string {
    if (pct >= 60) return "text-emerald-600";
    if (pct >= 30) return "text-amber-500";
    return "text-red-500";
}

/** Background class for coverage badge pill */
function coverageBgCls(pct: number): string {
    if (pct >= 60) return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (pct >= 30) return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-red-50 text-red-600 border-red-200";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(s: number): string {
    if (s > 2)   return "bg-emerald-500 text-white";
    if (s > 0.5) return "bg-emerald-100 text-emerald-800";
    if (s > -0.5) return "bg-gray-100 text-gray-600";
    if (s > -2)  return "bg-red-100 text-red-800";
    return "bg-red-500 text-white";
}

function scoreBorder(s: number): string {
    if (s > 1.5) return "border-emerald-200";
    if (s < -1.5) return "border-red-200";
    return "border-gray-200";
}

function scoreBg(s: number): string {
    if (s > 1.5) return "bg-emerald-50";
    if (s < -1.5) return "bg-red-50";
    return "bg-white";
}

function scoreTextColor(s: number): string {
    if (s > 0.5) return "text-emerald-700";
    if (s < -0.5) return "text-red-700";
    return "text-gray-600";
}

function directionLabel(d: string) {
    const map: Record<string, { icon: React.ReactNode; text: string; cls: string }> = {
        strengthening: { icon: <TrendingUp size={12} />, text: "Strengthening", cls: "text-emerald-600" },
        stable:        { icon: <Minus size={12} />,      text: "Stable",        cls: "text-gray-500" },
        weakening:     { icon: <TrendingDown size={12} />, text: "Weakening",  cls: "text-red-600" },
    };
    return map[d] ?? map.stable;
}

// ── Dimension score tile ──────────────────────────────────────────────────────

function DimTile({
    dim,
    active,
    onClick,
}: {
    dim: SectorDimension;
    active: boolean;
    onClick: () => void;
}) {
    const meta = DIMENSION_META[dim.dimension] ?? { icon: "📌", label: dim.dimension, short: dim.dimension, why: "" };
    const s = dim.weighted_score;
    const dir = directionLabel(dim.direction);
    // Gauge bar: 50% = centre, extends left (red) or right (green)
    const barPct = Math.min(Math.abs(s) / 5 * 50, 50); // scaled: 5 → full half
    const isPos = s >= 0;
    const cov = coveragePct(dim.company_signals);
    const lowCoverage = cov < 30;

    return (
        <button
            onClick={onClick}
            className={clsx(
                "rounded-xl border p-3.5 text-left transition-all hover:shadow-sm",
                active ? "ring-2 ring-brand-400 ring-offset-1" : "",
                lowCoverage ? "opacity-60" : "",
                scoreBorder(s),
                scoreBg(s),
            )}
        >
            <div className="flex items-start justify-between mb-2">
                <span className="text-base leading-none">{meta.icon}</span>
                <span className={clsx("text-base font-bold font-mono leading-none", lowCoverage ? "text-gray-400" : scoreTextColor(s))}>
                    {s > 0 ? "+" : ""}{s.toFixed(1)}
                </span>
            </div>
            <p className="text-[11px] font-semibold text-gray-700 truncate mb-2">{meta.label}</p>
            {/* Gauge bar — greyed out if low coverage */}
            <div className="relative h-1.5 rounded-full bg-gray-200">
                <div
                    className={clsx(
                        "absolute top-0 h-full rounded-full",
                        lowCoverage
                            ? "bg-gray-400"
                            : isPos ? "left-1/2 bg-emerald-500" : "right-1/2 bg-red-500"
                    )}
                    style={{ width: `${barPct}%`, ...(lowCoverage ? {} : isPos ? { left: "50%" } : { right: "50%" }) }}
                />
                <div className="absolute left-1/2 top-0 h-full w-px bg-gray-400" />
            </div>
            <div className="flex items-center justify-between mt-2">
                <div className={clsx("flex items-center gap-1 text-[10px] font-medium", lowCoverage ? "text-gray-400" : dir.cls)}>
                    {dir.icon}
                    {dir.text}
                </div>
                {/* Coverage pill */}
                <span className={clsx(
                    "text-[9px] font-semibold",
                    lowCoverage ? "text-gray-400" : coverageCls(cov)
                )}>
                    {cov.toFixed(0)}% cov
                </span>
            </div>
        </button>
    );
}

// ── Company heat map ──────────────────────────────────────────────────────────

function CompanyHeatMap({ sector }: { sector: SectorIntelligence }) {
    const dims = DIM_ORDER.filter((d) => sector.dimensions.some((dim) => dim.dimension === d));
    // Companies come from the first dimension's company_signals (sorted by weight)
    const companies = (sector.dimensions[0]?.company_signals ?? []).map((cs) => cs.ticker);

    // ⚠️ useMemo must come before any conditional return (Rules of Hooks)
    const scoreMap = useMemo(() => {
        const m = new Map<string, number | null>();
        for (const dim of sector.dimensions) {
            for (const cs of dim.company_signals) {
                // Only store a real score if the company has a genuine signal
                m.set(`${cs.ticker}::${dim.dimension}`, hasRealSignal(cs) ? cs.score : null);
            }
        }
        return m;
    }, [sector]);

    if (companies.length === 0) return null;

    return (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                <BarChart3 size={13} className="text-gray-400" />
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Company Heat Map</span>
                <span className="text-[11px] text-gray-400">market-cap weighted · hover for detail</span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/50">
                            <th className="text-left px-3 py-2 font-medium text-gray-500 min-w-[80px]">Company</th>
                            {dims.map((d) => (
                                <th key={d} className="px-1.5 py-2 text-center font-medium text-gray-400 min-w-[48px]"
                                    title={DIMENSION_META[d]?.label ?? d}>
                                    <span className="text-sm">{DIMENSION_META[d]?.icon ?? "📌"}</span>
                                    <span className="block text-[9px] font-medium text-gray-400 mt-0.5">
                                        {DIMENSION_META[d]?.short ?? d}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {companies.map((ticker) => {
                            // Overall row color from average score
                            const scores = dims.map((d) => scoreMap.get(`${ticker}::${d}`) ?? null).filter((s): s is number => s !== null);
                            const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
                            return (
                                <tr key={ticker} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                                    <td className="px-3 py-1.5">
                                        <div className="flex items-center gap-1.5">
                                            <span className={clsx(
                                                "inline-block h-1.5 w-1.5 rounded-full",
                                                avg > 0.5 ? "bg-emerald-500" : avg < -0.5 ? "bg-red-500" : "bg-gray-400"
                                            )} />
                                            <span className="font-mono font-semibold text-gray-800 text-[11px]">{ticker}</span>
                                        </div>
                                    </td>
                                    {dims.map((d) => {
                                        const s = scoreMap.get(`${ticker}::${d}`) ?? null;
                                        return (
                                            <td key={d} className="px-1.5 py-1.5 text-center">
                                                <span
                                                    className={clsx(
                                                        "inline-flex items-center justify-center rounded px-1.5 py-0.5 font-mono font-semibold text-[10px] min-w-[36px]",
                                                        s !== null ? scoreColor(s) : "bg-gray-50 text-gray-300"
                                                    )}
                                                    title={s !== null ? `${d}: ${s > 0 ? "+" : ""}${s.toFixed(2)}` : "No data"}
                                                >
                                                    {s !== null ? `${s > 0 ? "+" : ""}${s.toFixed(1)}` : "—"}
                                                </span>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Dimension detail panel (expandable) ───────────────────────────────────────

function DimDetail({ dim }: { dim: SectorDimension }) {
    const [open, setOpen] = useState(false);
    const meta = DIMENSION_META[dim.dimension] ?? { icon: "📌", label: dim.dimension, short: "", why: "" };

    // Only show companies with real business signals — filter out "Insufficient data" noise
    const realSignals = dim.company_signals.filter(hasRealSignal);
    const cov = coveragePct(dim.company_signals);
    const hasAnySignal = realSignals.length > 0;

    return (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <button
                onClick={() => hasAnySignal && setOpen((v) => !v)}
                className={clsx(
                    "flex w-full items-center justify-between px-4 py-3 text-left transition-colors",
                    hasAnySignal ? "hover:bg-gray-50/50 cursor-pointer" : "cursor-default opacity-50"
                )}
            >
                <div className="flex items-center gap-2.5">
                    <span className="text-base">{meta.icon}</span>
                    <span className="text-sm font-semibold text-gray-800">{meta.label}</span>
                    {/* Coverage badge */}
                    <span className={clsx(
                        "rounded border px-1.5 py-0.5 text-[10px] font-semibold",
                        hasAnySignal ? coverageBgCls(cov) : "bg-gray-50 text-gray-400 border-gray-200"
                    )}>
                        {hasAnySignal ? `${cov.toFixed(0)}% mkt cap` : "No data"}
                    </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {hasAnySignal && (
                        <>
                            <span className={clsx(
                                "rounded px-1.5 py-0.5 text-xs font-mono font-semibold",
                                dim.weighted_score > 0 ? "bg-emerald-100 text-emerald-700"
                                : dim.weighted_score < 0 ? "bg-red-100 text-red-700"
                                : "bg-gray-100 text-gray-600"
                            )}>
                                {dim.weighted_score > 0 ? "+" : ""}{dim.weighted_score.toFixed(2)}
                            </span>
                            <span className={clsx(
                                "text-[11px] font-medium flex items-center gap-1",
                                directionLabel(dim.direction).cls
                            )}>
                                {directionLabel(dim.direction).icon}
                                {directionLabel(dim.direction).text}
                            </span>
                        </>
                    )}
                    {hasAnySignal && (
                        open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />
                    )}
                </div>
            </button>

            {open && hasAnySignal && (
                <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {/* Signal summary — only show if it doesn't just say "Mixed signals" generically */}
                    {dim.signal && !dim.signal.toLowerCase().startsWith("mixed signals") && (
                        <div className="px-4 py-2.5 bg-gray-50/50">
                            <p className="text-sm text-gray-600 leading-relaxed">{dim.signal}</p>
                        </div>
                    )}

                    {/* Company breakdown — ONLY real signals, no "Insufficient data" rows */}
                    <div className="px-4 py-3">
                        <div className="space-y-2">
                            {realSignals.map((cs) => (
                                <div key={cs.ticker} className="flex items-start gap-2.5 text-xs">
                                    <span className={clsx(
                                        "mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0",
                                        cs.direction === "positive" ? "bg-emerald-500"
                                        : cs.direction === "negative" ? "bg-red-500"
                                        : "bg-gray-400"
                                    )} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 mb-0.5">
                                            <span className="font-mono font-bold text-gray-900 text-[11px]">{cs.ticker}</span>
                                            <span className={clsx(
                                                "rounded px-1 py-0.5 font-mono text-[10px] font-semibold",
                                                (cs.score ?? 0) > 1.5 ? "bg-emerald-100 text-emerald-700"
                                                : (cs.score ?? 0) < -1.5 ? "bg-red-100 text-red-700"
                                                : "bg-gray-100 text-gray-600"
                                            )}>
                                                {(cs.score ?? 0) > 0 ? "+" : ""}{(cs.score ?? 0).toFixed(1)}
                                            </span>
                                            <span className="text-[10px] text-gray-400 font-mono">
                                                {(cs.weight_pct ?? 0).toFixed(0)}% wt
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-gray-500 leading-relaxed">{cs.signal}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Why it matters */}
                    {meta.why && (
                        <div className="px-4 py-2 bg-gray-50/50">
                            <p className="text-[11px] text-gray-400 italic">💡 {meta.why}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Sector Narrative card ─────────────────────────────────────────────────────

function NarrativeCard({ narrative, sector }: { narrative: SectorNarrative; sector: string }) {
    const [open, setOpen] = useState(true);

    return (
        <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-white overflow-hidden shadow-sm">
            {/* Header */}
            <button
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-indigo-50/50 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">
                        Sector Intelligence
                    </span>
                    <span className="text-[10px] text-indigo-300 font-medium">· {sector}</span>
                </div>
                {open
                    ? <ChevronUp size={13} className="text-indigo-400 shrink-0" />
                    : <ChevronDown size={13} className="text-indigo-400 shrink-0" />
                }
            </button>

            {open && (
                <div className="px-4 pb-4 space-y-3.5">

                    {/* Structure + Strategy — two short statements up top */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="flex items-start gap-2.5 rounded-lg bg-white border border-indigo-100 px-3 py-2.5">
                            <Building2 size={13} className="text-indigo-400 mt-0.5 shrink-0" />
                            <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 mb-0.5">Structure</p>
                                <p className="text-[11.5px] text-gray-700 leading-relaxed">{narrative.competitive_structure}</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-2.5 rounded-lg bg-white border border-indigo-100 px-3 py-2.5">
                            <Shuffle size={13} className="text-violet-400 mt-0.5 shrink-0" />
                            <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-violet-400 mb-0.5">Strategic Theme</p>
                                <p className="text-[11.5px] text-gray-700 leading-relaxed">{narrative.strategic_theme}</p>
                            </div>
                        </div>
                    </div>

                    {/* Tailwinds / Headwinds / Triggers — three-column */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {/* Tailwinds */}
                        <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5">
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <Wind size={11} className="text-emerald-500 shrink-0" />
                                <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-600">Tailwinds</p>
                            </div>
                            <ul className="space-y-1">
                                {narrative.tailwinds.map((t, i) => (
                                    <li key={i} className="flex items-start gap-1.5 text-[11px] text-emerald-800 leading-snug">
                                        <span className="text-emerald-400 font-bold shrink-0 mt-0.5">↑</span>
                                        {t}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Headwinds */}
                        <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2.5">
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <AlertTriangle size={11} className="text-red-400 shrink-0" />
                                <p className="text-[9px] font-bold uppercase tracking-widest text-red-500">Headwinds</p>
                            </div>
                            <ul className="space-y-1">
                                {narrative.headwinds.map((h, i) => (
                                    <li key={i} className="flex items-start gap-1.5 text-[11px] text-red-800 leading-snug">
                                        <span className="text-red-400 font-bold shrink-0 mt-0.5">↓</span>
                                        {h}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Triggers to Watch */}
                        <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5">
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <Zap size={11} className="text-amber-500 shrink-0" />
                                <p className="text-[9px] font-bold uppercase tracking-widest text-amber-600">Triggers to Watch</p>
                            </div>
                            <ul className="space-y-1">
                                {narrative.key_triggers.map((tr, i) => (
                                    <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-900 leading-snug">
                                        <span className="text-amber-500 font-bold shrink-0 mt-0.5">⚡</span>
                                        {tr}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* Macro + Transformation — two sentences each */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="flex items-start gap-2.5 rounded-lg bg-white border border-indigo-100 px-3 py-2.5">
                            <Globe size={13} className="text-sky-400 mt-0.5 shrink-0" />
                            <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-sky-500 mb-0.5">Macro Sensitivity</p>
                                <p className="text-[11.5px] text-gray-700 leading-relaxed">{narrative.macro_sensitivity}</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-2.5 rounded-lg bg-white border border-indigo-100 px-3 py-2.5">
                            <TrendingUp size={13} className="text-purple-400 mt-0.5 shrink-0" />
                            <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-purple-500 mb-0.5">Transformation</p>
                                <p className="text-[11.5px] text-gray-700 leading-relaxed">{narrative.transformation_signal}</p>
                            </div>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
}

// ── Sub-sector thesis card ────────────────────────────────────────────────────

function ThesisCard({ thesis, parentSector, label }: { thesis: string; parentSector?: string; label: string }) {
    return (
        <div className="flex items-start gap-2.5 rounded-xl border border-violet-100 bg-gradient-to-r from-violet-50/70 to-white px-4 py-3">
            <Shuffle size={14} className="text-violet-400 mt-0.5 shrink-0" />
            <div>
                <div className="flex items-center gap-2 mb-1">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-violet-500">Investment Thesis</p>
                    {parentSector && (
                        <span className="rounded border border-violet-200 bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-600">
                            sub-sector of {parentSector}
                        </span>
                    )}
                </div>
                <p className="text-[12px] text-gray-700 leading-relaxed">{thesis}</p>
            </div>
        </div>
    );
}

// ── Sector dashboard (per-sector view) ────────────────────────────────────────

function SectorDashboard({ sector }: { sector: SectorIntelligence }) {
    const [activeDim, setActiveDim] = useState<string | null>(null);

    const dims = DIM_ORDER
        .map((d) => sector.dimensions.find((dim) => dim.dimension === d))
        .filter((d): d is SectorDimension => !!d);

    // Only count dimensions with real signal in direction tallies
    const dimsWithSignal = dims.filter((d) => coveragePct(d.company_signals) > 0);

    const dirCounts = dimsWithSignal.reduce((acc, d) => {
        acc[d.direction] = (acc[d.direction] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    // Overall score — average of dims WITH real coverage only (no coverage = no signal)
    const avgScore = dimsWithSignal.length > 0
        ? dimsWithSignal.reduce((sum, d) => sum + d.weighted_score, 0) / dimsWithSignal.length
        : 0;

    // Overall signal coverage: what % of companies (by count) have ≥1 real data point
    const allTickers = new Set(
        dims.flatMap((d) => d.company_signals.filter(hasRealSignal).map((cs) => cs.ticker))
    );
    const totalTickers = new Set(
        dims.flatMap((d) => d.company_signals.map((cs) => cs.ticker))
    );
    const companyCoverageStr = totalTickers.size > 0
        ? `${allTickers.size}/${totalTickers.size} companies with data`
        : "";

    return (
        <div className="space-y-5">
            {/* Sector header */}
            <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">{sector.sector_label || sector.sector}</h2>
                    <p className="text-sm text-gray-400 mt-0.5">
                        {sector.company_count} companies ·{" "}
                        {sector.quarter_previous?.replace("_", " FY")} → {sector.quarter?.replace("_", " FY")}
                        {companyCoverageStr && (
                            <> · <span className="font-medium text-gray-500">{companyCoverageStr}</span></>
                        )}
                    </p>
                </div>
                {/* Overall health pill */}
                <div className={clsx(
                    "flex items-center gap-2 rounded-xl border px-4 py-2",
                    scoreBorder(avgScore), scoreBg(avgScore)
                )}>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Signal</span>
                    <span className={clsx("text-xl font-bold font-mono", scoreTextColor(avgScore))}>
                        {avgScore > 0 ? "+" : ""}{avgScore.toFixed(1)}
                    </span>
                    <div className="flex flex-col gap-0.5 text-[10px]">
                        {dirCounts["strengthening"] ? <span className="text-emerald-600">↑ {dirCounts["strengthening"]}</span> : null}
                        {dirCounts["stable"] ? <span className="text-gray-500">→ {dirCounts["stable"]}</span> : null}
                        {dirCounts["weakening"] ? <span className="text-red-600">↓ {dirCounts["weakening"]}</span> : null}
                    </div>
                </div>
            </div>

            {/* Sub-sector thesis — shown for sub-sectors */}
            {sector.is_sub_sector && sector.thesis && (
                <ThesisCard
                    thesis={sector.thesis}
                    parentSector={sector.parent_sector}
                    label={sector.sector_label || sector.sector}
                />
            )}

            {/* Sector narrative — shown when available */}
            {sector.narrative && (
                <NarrativeCard narrative={sector.narrative} sector={sector.sector_label || sector.sector} />
            )}

            {/* Dimension score tiles — 4 per row on desktop */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {dims.map((dim) => (
                    <DimTile
                        key={dim.dimension}
                        dim={dim}
                        active={activeDim === dim.dimension}
                        onClick={() => setActiveDim(activeDim === dim.dimension ? null : dim.dimension)}
                    />
                ))}
            </div>

            {/* Company heat map */}
            <CompanyHeatMap sector={sector} />

            {/* Dimension detail panels */}
            <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 pt-1">
                    Dimension Details
                    <span className="ml-2 normal-case font-normal text-gray-400">
                        — grayed rows have no data this quarter, click to expand where available
                    </span>
                </p>
                {dims.map((dim) => (
                    <DimDetail key={dim.dimension} dim={dim} />
                ))}
            </div>
        </div>
    );
}

// ── Cross-sector scorecard matrix (All view) ──────────────────────────────────

function SectorMatrix({ sectors, onSelectSector }: { sectors: SectorIntelligence[]; onSelectSector: (s: string) => void }) {
    if (sectors.length === 0) return null;
    const dims = DIM_ORDER.filter((d) => sectors.some((s) => s.dimensions.find((dim) => dim.dimension === d)));

    function cellColor(score: number) {
        if (score > 1.5)  return "bg-emerald-500 text-white";
        if (score > 0.5)  return "bg-emerald-200 text-emerald-900";
        if (score > -0.5) return "bg-gray-100 text-gray-600";
        if (score > -1.5) return "bg-red-200 text-red-900";
        return "bg-red-500 text-white";
    }

    return (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sector Scorecard</span>
                <span className="text-[11px] text-gray-400">market-cap weighted · click a sector to drill down</span>
                <div className="ml-auto flex items-center gap-2.5 text-[10px] text-gray-400">
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-emerald-500" /> Strong</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-emerald-200" /> Positive</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-gray-100" /> Neutral</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-red-200" /> Weak</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-red-500" /> Risk</span>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/50">
                            <th className="text-left px-4 py-2 font-medium text-gray-500 w-36">Sector</th>
                            {dims.map((d) => (
                                <th key={d} className="px-1.5 py-2 text-center font-medium text-gray-400 min-w-[56px]">
                                    <span title={DIMENSION_META[d]?.why ?? ""} className="cursor-help">
                                        <span className="block text-sm">{DIMENSION_META[d]?.icon ?? "📌"}</span>
                                        <span className="block text-[9px] font-medium mt-0.5">{DIMENSION_META[d]?.short ?? d}</span>
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sectors.map((s) => {
                            const avg = s.dimensions.length > 0
                                ? s.dimensions.reduce((sum, d) => sum + d.weighted_score, 0) / s.dimensions.length
                                : 0;
                            return (
                                <tr
                                    key={s.sector}
                                    className="border-b border-gray-50 hover:bg-brand-50/30 cursor-pointer transition-colors"
                                    onClick={() => onSelectSector(s.sector)}
                                >
                                    <td className="px-4 py-2">
                                        <span className="font-semibold text-gray-800 text-[11px]">{s.sector_label || s.sector}</span>
                                        <span className={clsx(
                                            "ml-1.5 text-[10px] font-mono font-semibold",
                                            avg > 0.5 ? "text-emerald-600" : avg < -0.5 ? "text-red-600" : "text-gray-400"
                                        )}>
                                            {avg > 0 ? "+" : ""}{avg.toFixed(1)}
                                        </span>
                                    </td>
                                    {dims.map((d) => {
                                        const dim = s.dimensions.find((dim) => dim.dimension === d);
                                        if (!dim) return (
                                            <td key={d} className="px-1.5 py-2 text-center">
                                                <span className="text-gray-200 text-[10px]">—</span>
                                            </td>
                                        );
                                        return (
                                            <td key={d} className="px-1.5 py-2 text-center">
                                                <span
                                                    title={`${dim.direction}: ${dim.weighted_score > 0 ? "+" : ""}${dim.weighted_score.toFixed(1)}`}
                                                    className={clsx(
                                                        "inline-flex items-center justify-center rounded px-1.5 py-0.5 font-mono font-semibold text-[10px] min-w-[32px] cursor-default",
                                                        cellColor(dim.weighted_score)
                                                    )}
                                                >
                                                    {dim.weighted_score > 0 ? "+" : ""}{dim.weighted_score.toFixed(1)}
                                                </span>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SectorsClient() {
    const [sectors, setSectors] = useState<SectorIntelligence[]>([]);
    const [availableSectors, setAvailableSectors] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedSector, setSelectedSector] = useState<string | null>(null);
    const [showSubSectors, setShowSubSectors] = useState(false);

    useEffect(() => {
        setLoading(true);
        fetch("/api/v1/sectors")
            .then((res) => {
                if (!res.ok) throw new Error(`Failed (${res.status})`);
                return res.json();
            })
            .then((data) => {
                const loaded: SectorIntelligence[] = data.sectors ?? [];
                setSectors(loaded);
                setAvailableSectors(data.available_sectors ?? []);
                // Default to first seeded sector
                if (loaded.length > 0) {
                    setSelectedSector(loaded[0].sector);
                }
            })
            .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
            .finally(() => setLoading(false));
    }, []);

    const activeSector = useMemo(
        () => selectedSector ? sectors.find((s) => s.sector === selectedSector) ?? null : null,
        [sectors, selectedSector]
    );

    const totalCompanies = sectors.reduce((sum, s) => sum + s.company_count, 0);
    const seededCount = sectors.filter((s) => !s.is_sub_sector).length;
    const totalSectors = availableSectors.length;

    // Separate top-level sectors from sub-sectors for tab display
    const seededSet = useMemo(() => new Set(sectors.map((s) => s.sector)), [sectors]);
    const subSectorKeys = useMemo(
        () => new Set(sectors.filter((s) => s.is_sub_sector).map((s) => s.sector)),
        [sectors]
    );
    // Build set from API-provided available list — need to know which are sub-sectors
    // We use the seeded sectors' is_sub_sector flag as proxy; unseeded ones show as top-level tabs
    const seededSubSectorSet = subSectorKeys;

    return (
        <div className="min-h-screen bg-gray-50">
            <Nav />
            <main className="mx-auto max-w-6xl px-6 py-8">

                {/* Header */}
                <div className="mb-6">
                    <div className="flex items-center gap-3">
                        <Layers className="h-6 w-6 text-brand-600" />
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Sector Intelligence</h1>
                    </div>
                    <p className="mt-1.5 text-sm text-gray-500 max-w-2xl">
                        Market-cap weighted signals synthesized from management commentary across {totalSectors} sectors.
                        {seededCount > 0 && <> <strong className="text-gray-700">{seededCount} seeded</strong> · <strong className="text-gray-700">{totalCompanies} companies</strong>.</>}
                    </p>
                </div>

                {/* Sector tabs */}
                {!loading && (
                    <div className="mb-6 space-y-2">
                        {/* Row 1: All + top-level sectors */}
                        <div className="flex flex-wrap gap-1.5">
                            {/* All Sectors overview */}
                            <button
                                onClick={() => setSelectedSector(null)}
                                className={clsx(
                                    "rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors",
                                    selectedSector === null
                                        ? "bg-gray-900 text-white border-gray-900"
                                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                                )}
                            >
                                All Sectors
                                <span className={clsx(
                                    "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                                    selectedSector === null ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                                )}>
                                    {totalSectors}
                                </span>
                            </button>

                            {/* Top-level sectors only */}
                            {availableSectors.filter((s) => !seededSubSectorSet.has(s)).map((s) => {
                                const seeded = seededSet.has(s);
                                const sectorData = sectors.find((sec) => sec.sector === s);
                                const active = selectedSector === s;
                                return (
                                    <button
                                        key={s}
                                        onClick={() => seeded && setSelectedSector(s)}
                                        className={clsx(
                                            "rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors",
                                            active
                                                ? "bg-gray-900 text-white border-gray-900"
                                                : seeded
                                                    ? "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                                                    : "bg-white text-gray-300 border-gray-100 cursor-default"
                                        )}
                                        title={seeded ? sectorData?.sector_label ?? s : `${s} — not yet seeded`}
                                    >
                                        {s}
                                        {seeded && (
                                            <span className={clsx(
                                                "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                                                active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                                            )}>
                                                {sectorData?.company_count ?? 0}
                                            </span>
                                        )}
                                        {!seeded && (
                                            <span className="ml-1.5 text-[10px] text-gray-300">·</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Row 2: Sub-sectors (collapsible) */}
                        {seededSubSectorSet.size > 0 && (
                            <div>
                                <button
                                    onClick={() => setShowSubSectors((v) => !v)}
                                    className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-500 hover:text-violet-700 transition-colors mb-1.5"
                                >
                                    <Layers size={11} />
                                    Sub-sectors ({seededSubSectorSet.size})
                                    {showSubSectors
                                        ? <ChevronUp size={10} />
                                        : <ChevronDown size={10} />
                                    }
                                </button>
                                {showSubSectors && (
                                    <div className="flex flex-wrap gap-1.5 pl-1">
                                        {availableSectors.filter((s) => seededSubSectorSet.has(s)).map((s) => {
                                            const seeded = seededSet.has(s);
                                            const sectorData = sectors.find((sec) => sec.sector === s);
                                            const active = selectedSector === s;
                                            return (
                                                <button
                                                    key={s}
                                                    onClick={() => seeded && setSelectedSector(s)}
                                                    className={clsx(
                                                        "rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors",
                                                        active
                                                            ? "bg-violet-600 text-white border-violet-600"
                                                            : seeded
                                                                ? "bg-violet-50 text-violet-700 border-violet-200 hover:border-violet-400"
                                                                : "bg-white text-gray-300 border-gray-100 cursor-default"
                                                    )}
                                                    title={seeded
                                                        ? `${sectorData?.sector_label ?? s}${sectorData?.parent_sector ? ` (sub-sector of ${sectorData.parent_sector})` : ""}`
                                                        : `${s} — not yet seeded`
                                                    }
                                                >
                                                    {s}
                                                    {seeded && (
                                                        <span className={clsx(
                                                            "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                                                            active ? "bg-white/20 text-white" : "bg-violet-100 text-violet-600"
                                                        )}>
                                                            {sectorData?.company_count ?? 0}
                                                        </span>
                                                    )}
                                                    {!seeded && (
                                                        <span className="ml-1.5 text-[10px] text-gray-300">·</span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error}
                    </div>
                )}

                {/* Loading */}
                {loading && (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                        <span className="ml-3 text-sm text-gray-500">Loading sector intelligence…</span>
                    </div>
                )}

                {/* Content */}
                {!loading && !error && (
                    <>
                        {selectedSector === null ? (
                            /* All Sectors — scorecard matrix (top-level sectors only) */
                            sectors.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center">
                                    <Layers className="mx-auto h-10 w-10 text-gray-300" />
                                    <p className="mt-3 text-sm text-gray-500">No sector data yet. Run the seed script to populate.</p>
                                </div>
                            ) : (
                                <SectorMatrix
                                    sectors={sectors.filter((s) => !s.is_sub_sector)}
                                    onSelectSector={(s) => setSelectedSector(s)}
                                />
                            )
                        ) : activeSector ? (
                            /* Single sector — full dashboard */
                            <SectorDashboard sector={activeSector} />
                        ) : (
                            <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center">
                                <Layers className="mx-auto h-10 w-10 text-gray-300" />
                                <p className="mt-3 text-sm text-gray-500">
                                    {selectedSector} has not been seeded yet. Run the sector seed script.
                                </p>
                            </div>
                        )}
                    </>
                )}

                {/* Footer */}
                {!loading && sectors.length > 0 && (
                    <div className="mt-10 rounded-xl border border-gray-200 bg-white px-6 py-4">
                        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Who uses this</p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                            {[
                                { role: "PMs", use: "Sector allocation" },
                                { role: "AMCs", use: "Thematic ideas" },
                                { role: "Brokerage", use: "Upgrades/downgrades" },
                                { role: "Wealth Mgrs", use: "Portfolio positioning" },
                                { role: "Family Offices", use: "Long-term bets" },
                            ].map((item) => (
                                <div key={item.role} className="rounded-lg bg-gray-50 px-3 py-2 text-center">
                                    <p className="text-xs font-semibold text-gray-900">{item.role}</p>
                                    <p className="text-[11px] text-gray-500">{item.use}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
