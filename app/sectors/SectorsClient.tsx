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

interface SectorIntelligence {
    sector: string;
    sector_label: string;
    company_count: number;
    quarter: string;
    quarter_previous: string;
    dimensions: SectorDimension[];
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

    return (
        <button
            onClick={onClick}
            className={clsx(
                "rounded-xl border p-3.5 text-left transition-all hover:shadow-sm",
                active ? "ring-2 ring-brand-400 ring-offset-1" : "",
                scoreBorder(s),
                scoreBg(s),
            )}
        >
            <div className="flex items-start justify-between mb-2">
                <span className="text-base leading-none">{meta.icon}</span>
                <span className={clsx("text-base font-bold font-mono leading-none", scoreTextColor(s))}>
                    {s > 0 ? "+" : ""}{s.toFixed(1)}
                </span>
            </div>
            <p className="text-[11px] font-semibold text-gray-700 truncate mb-2">{meta.label}</p>
            {/* Gauge bar */}
            <div className="relative h-1.5 rounded-full bg-gray-200">
                <div
                    className={clsx(
                        "absolute top-0 h-full rounded-full",
                        isPos ? "left-1/2 bg-emerald-500" : "right-1/2 bg-red-500"
                    )}
                    style={{ width: `${barPct}%` }}
                />
                <div className="absolute left-1/2 top-0 h-full w-px bg-gray-400" />
            </div>
            <div className={clsx("flex items-center gap-1 mt-2 text-[10px] font-medium", dir.cls)}>
                {dir.icon}
                {dir.text}
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
                m.set(`${cs.ticker}::${dim.dimension}`, cs.score);
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

    return (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50/50 transition-colors"
            >
                <div className="flex items-center gap-2.5">
                    <span className="text-base">{meta.icon}</span>
                    <span className="text-sm font-semibold text-gray-800">{meta.label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className={clsx(
                        "rounded px-1.5 py-0.5 text-xs font-mono font-semibold",
                        dim.weighted_score > 0 ? "bg-emerald-100 text-emerald-700" : dim.weighted_score < 0 ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
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
                    {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                </div>
            </button>

            {open && (
                <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {/* Signal summary */}
                    <div className="px-4 py-2.5 bg-gray-50/50">
                        <p className="text-sm text-gray-600 leading-relaxed">{dim.signal}</p>
                    </div>

                    {/* Company-level details */}
                    {dim.details.length > 0 && (
                        <div className="px-4 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Company signals</p>
                            <ul className="space-y-1.5">
                                {dim.details.map((d, i) => (
                                    <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
                                        {d}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Company scores table */}
                    {dim.company_signals.length > 0 && (
                        <div className="px-4 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Market-cap weighted breakdown</p>
                            <div className="space-y-1">
                                {dim.company_signals.map((cs) => (
                                    <div key={cs.ticker} className="flex items-center gap-2 text-xs">
                                        <span className={clsx(
                                            "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                                            cs.direction === "positive" ? "bg-emerald-500" : cs.direction === "negative" ? "bg-red-500" : "bg-gray-400"
                                        )} />
                                        <span className="font-mono font-semibold text-gray-800 w-20 shrink-0">{cs.ticker}</span>
                                        <span className="flex-1 text-gray-500 truncate text-[11px]">{cs.signal}</span>
                                        <span className={clsx(
                                            "rounded px-1 py-0.5 font-mono text-[10px] font-semibold shrink-0",
                                            (cs.score ?? 0) > 1.5 ? "bg-emerald-100 text-emerald-700"
                                            : (cs.score ?? 0) < -1.5 ? "bg-red-100 text-red-700"
                                            : "bg-gray-100 text-gray-600"
                                        )}>
                                            {(cs.score ?? 0) > 0 ? "+" : ""}{(cs.score ?? 0).toFixed(1)}
                                        </span>
                                        {/* Weight bar */}
                                        <div className="flex items-center gap-1 shrink-0 w-20">
                                            <div className="h-1 flex-1 rounded-full bg-gray-100 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-gray-400"
                                                    style={{ width: `${Math.min(cs.weight_pct ?? 0, 100)}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] text-gray-400 w-8 text-right font-mono">
                                                {(cs.weight_pct ?? 0).toFixed(0)}%
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

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

// ── Sector dashboard (per-sector view) ────────────────────────────────────────

function SectorDashboard({ sector }: { sector: SectorIntelligence }) {
    const [activeDim, setActiveDim] = useState<string | null>(null);

    const dims = DIM_ORDER
        .map((d) => sector.dimensions.find((dim) => dim.dimension === d))
        .filter((d): d is SectorDimension => !!d);

    const dirCounts = dims.reduce((acc, d) => {
        acc[d.direction] = (acc[d.direction] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    // Overall sector health (average of dimension scores)
    const avgScore = dims.length > 0
        ? dims.reduce((sum, d) => sum + d.weighted_score, 0) / dims.length
        : 0;

    return (
        <div className="space-y-5">
            {/* Sector header */}
            <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">{sector.sector_label || sector.sector}</h2>
                    <p className="text-sm text-gray-400 mt-0.5">
                        {sector.company_count} companies ·{" "}
                        {sector.quarter_previous?.replace("_", " FY")} → {sector.quarter?.replace("_", " FY")}
                    </p>
                </div>
                {/* Overall health pill */}
                <div className={clsx(
                    "flex items-center gap-2 rounded-xl border px-4 py-2",
                    scoreBorder(avgScore), scoreBg(avgScore)
                )}>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Overall</span>
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

            {/* Dimension detail panels — all visible, collapsed by default */}
            <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 pt-1">
                    Dimension Details
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
    const seededCount = sectors.length;
    const totalSectors = availableSectors.length;

    // Sector tab labels — show seeded count as a dot indicator
    const seededSet = useMemo(() => new Set(sectors.map((s) => s.sector)), [sectors]);

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
                    <div className="mb-6 flex flex-wrap gap-1.5">
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
                        {/* Seeded sectors first, then unseeded */}
                        {availableSectors.map((s) => {
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
                            /* All Sectors — scorecard matrix only */
                            sectors.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center">
                                    <Layers className="mx-auto h-10 w-10 text-gray-300" />
                                    <p className="mt-3 text-sm text-gray-500">No sector data yet. Run the seed script to populate.</p>
                                </div>
                            ) : (
                                <SectorMatrix
                                    sectors={sectors}
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
