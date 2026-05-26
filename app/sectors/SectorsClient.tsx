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

// ── Constants ─────────────────────────────────────────────────────────────────

const DIMENSION_META: Record<
    string,
    { icon: string; label: string; why: string }
> = {
    "Demand Momentum": {
        icon: "📈",
        label: "Demand Momentum",
        why: "Volume & order flow signals — often leads revenue upgrades by 1–2 quarters.",
    },
    "Pricing Power": {
        icon: "💰",
        label: "Pricing Power",
        why: "ARPU, realisation, and tariff direction — determines earnings resilience during slowdowns.",
    },
    "Margin Trajectory": {
        icon: "📊",
        label: "Margin Trajectory",
        why: "EBITDA/PAT margin shifts and operating leverage — directly drives earnings surprises.",
    },
    "Cost Pressure": {
        icon: "🏭",
        label: "Cost Pressure",
        why: "Raw material, energy, and freight cost evolution — leading indicator of margin compression or relief.",
    },
    "CapEx & Allocation": {
        icon: "🏗️",
        label: "CapEx & Allocation",
        why: "Capex intensity vs. historical norms and FCF signals — determines capacity cycle and ROIC trajectory.",
    },
    "Macro & Cycle Risk": {
        icon: "🌐",
        label: "Macro & Cycle Risk",
        why: "FX, rates, and regulatory headwinds — quantifies external risk not captured in margins.",
    },
    "Management Confidence": {
        icon: "🎯",
        label: "Management Confidence",
        why: "Evasiveness-adjusted guidance tone — executives signal cycle turns before numbers do.",
    },
    "Earnings Quality": {
        icon: "🔍",
        label: "Earnings Quality",
        why: "Flagged signals and validation score — detects one-time adjustments and accounting red flags.",
    },
    // Legacy aliases kept for backward compat with old cached data
    "Capex Cycle": {
        icon: "🏗️",
        label: "CapEx Cycle",
        why: "Capex cycles drive multi-year earnings growth.",
    },
};

// ── Direction helpers ─────────────────────────────────────────────────────────

function DirectionBadge({ direction }: { direction: string }) {
    const config = {
        strengthening: {
            bg: "bg-emerald-50",
            text: "text-emerald-700",
            border: "border-emerald-200",
            icon: <TrendingUp className="h-3.5 w-3.5" />,
            label: "Strengthening",
        },
        stable: {
            bg: "bg-gray-50",
            text: "text-gray-600",
            border: "border-gray-200",
            icon: <Minus className="h-3.5 w-3.5" />,
            label: "Stable",
        },
        weakening: {
            bg: "bg-red-50",
            text: "text-red-700",
            border: "border-red-200",
            icon: <TrendingDown className="h-3.5 w-3.5" />,
            label: "Weakening",
        },
    }[direction] ?? {
        bg: "bg-gray-50",
        text: "text-gray-600",
        border: "border-gray-200",
        icon: <Minus className="h-3.5 w-3.5" />,
        label: direction,
    };

    return (
        <span
            className={clsx(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                config.bg,
                config.text,
                config.border
            )}
        >
            {config.icon}
            {config.label}
        </span>
    );
}

function ScoreBadge({ score }: { score: number }) {
    const s = score ?? 0;
    const color = s > 1.5
        ? "text-emerald-700 bg-emerald-50"
        : s < -1.5
            ? "text-red-700 bg-red-50"
            : "text-gray-600 bg-gray-50";
    const sign = s > 0 ? "+" : "";
    return (
        <span className={clsx("rounded px-1.5 py-0.5 text-xs font-mono font-semibold", color)}>
            {sign}{s.toFixed(2)}
        </span>
    );
}

function CompanyDirectionDot({ direction }: { direction: string }) {
    const color = {
        positive: "bg-emerald-500",
        neutral: "bg-gray-400",
        negative: "bg-red-500",
    }[direction] ?? "bg-gray-400";

    return <span className={clsx("inline-block h-2 w-2 rounded-full", color)} />;
}

// ── Dimension Card ────────────────────────────────────────────────────────────

function DimensionCard({ dim }: { dim: SectorDimension }) {
    const [expanded, setExpanded] = useState(false);
    const meta = DIMENSION_META[dim.dimension] ?? {
        icon: "📌",
        label: dim.dimension,
        why: "",
    };

    return (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md">
            {/* Card header */}
            <button
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-start justify-between px-5 py-4 text-left"
            >
                <div className="flex items-start gap-3">
                    <span className="mt-0.5 text-xl">{meta.icon}</span>
                    <div>
                        <h4 className="text-sm font-semibold text-gray-900">{meta.label}</h4>
                        <p className="mt-1 text-sm text-gray-600 leading-relaxed">
                            {dim.signal}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                    <ScoreBadge score={dim.weighted_score} />
                    <DirectionBadge direction={dim.direction} />
                    {dim.company_signals.length > 0 && (
                        expanded ? (
                            <ChevronUp className="h-4 w-4 text-gray-400" />
                        ) : (
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                        )
                    )}
                </div>
            </button>

            {/* Details */}
            {dim.details.length > 0 && (
                <div className="border-t border-gray-100 px-5 py-3">
                    <ul className="space-y-1.5">
                        {dim.details.map((d, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
                                {d}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Why it matters */}
            {meta.why && (
                <div className="border-t border-gray-50 px-5 py-2.5">
                    <p className="text-[11px] text-gray-400 italic">
                        Why it matters: {meta.why}
                    </p>
                </div>
            )}

            {/* Expanded company breakdown */}
            {expanded && dim.company_signals.length > 0 && (
                <div className="border-t border-gray-100 px-5 py-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        Company Breakdown (Market-Cap Weighted)
                    </p>
                    <div className="overflow-hidden rounded-lg border border-gray-100">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50 text-left text-[11px] font-medium uppercase tracking-wide text-gray-400">
                                    <th className="px-3 py-2">Company</th>
                                    <th className="px-3 py-2">Signal</th>
                                    <th className="px-3 py-2 text-center">Score</th>
                                    <th className="px-3 py-2 text-right">Weight</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dim.company_signals.map((cs) => (
                                    <tr
                                        key={cs.ticker}
                                        className="border-t border-gray-50 hover:bg-gray-50/50"
                                    >
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-1.5">
                                                <CompanyDirectionDot direction={cs.direction} />
                                                <span className="font-mono text-xs font-semibold text-gray-900">
                                                    {cs.ticker}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-gray-600 max-w-xs truncate">
                                            {cs.signal}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <span
                                                className={clsx(
                                                    "rounded px-1.5 py-0.5 text-xs font-mono font-medium",
                                                    (cs.score ?? 0) > 1.5 && "text-emerald-700 bg-emerald-50",
                                                    (cs.score ?? 0) < -1.5 && "text-red-700 bg-red-50",
                                                    (cs.score ?? 0) >= -1.5 && (cs.score ?? 0) <= 1.5 && "text-gray-600 bg-gray-50"
                                                )}
                                            >
                                                {(cs.score ?? 0) > 0 ? "+" : ""}{(cs.score ?? 0).toFixed(1)}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <div className="h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full bg-gray-400"
                                                        style={{ width: `${Math.min(cs.weight_pct ?? 0, 100)}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs text-gray-500 font-mono w-12 text-right">
                                                    {(cs.weight_pct ?? 0).toFixed(1)}%
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Cross-sector scorecard matrix ────────────────────────────────────────────

function SectorMatrix({ sectors }: { sectors: SectorIntelligence[] }) {
    if (sectors.length === 0) return null;

    // Collect all unique dimension names in display order
    const dimOrder = [
        "Demand Momentum", "Pricing Power", "Margin Trajectory",
        "Cost Pressure", "CapEx & Allocation", "Macro & Cycle Risk",
        "Management Confidence", "Earnings Quality",
        // legacy
        "Capex Cycle",
    ];
    const allDims = dimOrder.filter((d) =>
        sectors.some((s) => s.dimensions.find((dim) => dim.dimension === d))
    );

    function scoreColor(score: number) {
        if (score > 1.5)  return "bg-emerald-500";
        if (score > 0.5)  return "bg-emerald-200";
        if (score > -0.5) return "bg-gray-200";
        if (score > -1.5) return "bg-red-200";
        return "bg-red-500";
    }
    function scoreText(score: number) {
        if (score > 1.5)  return "text-emerald-900";
        if (score > 0.5)  return "text-emerald-800";
        if (score > -0.5) return "text-gray-600";
        if (score > -1.5) return "text-red-800";
        return "text-red-900";
    }

    return (
        <div className="mb-8 overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sector Scorecard</span>
                <span className="text-[11px] text-gray-400">— market-cap weighted signal per dimension</span>
                <div className="ml-auto flex items-center gap-3 text-[10px] text-gray-400">
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-emerald-500" /> Strong</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-emerald-200" /> Positive</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-gray-200" /> Neutral</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-red-200" /> Weak</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-red-500" /> Risk</span>
                </div>
            </div>
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="text-left px-4 py-2 font-medium text-gray-500 w-32">Sector</th>
                        {allDims.map((d) => (
                            <th key={d} className="px-2 py-2 text-center font-medium text-gray-500 max-w-[72px]">
                                <span title={(DIMENSION_META[d]?.why ?? "")} className="cursor-help">
                                    {DIMENSION_META[d]?.icon ?? "📌"}{" "}
                                    <span className="hidden lg:inline">{DIMENSION_META[d]?.label ?? d}</span>
                                </span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {sectors.map((s) => (
                        <tr key={s.sector} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-2 font-semibold text-gray-800 text-[11px]">
                                {s.sector_label || s.sector}
                            </td>
                            {allDims.map((d) => {
                                const dim = s.dimensions.find((dim) => dim.dimension === d);
                                if (!dim) return (
                                    <td key={d} className="px-2 py-2 text-center">
                                        <span className="text-gray-200">—</span>
                                    </td>
                                );
                                return (
                                    <td key={d} className="px-2 py-2 text-center">
                                        <span
                                            title={`${dim.direction} (${dim.weighted_score > 0 ? "+" : ""}${dim.weighted_score.toFixed(1)})`}
                                            className={clsx(
                                                "inline-flex items-center justify-center rounded px-1.5 py-0.5 font-mono font-semibold cursor-default",
                                                scoreColor(dim.weighted_score),
                                                scoreText(dim.weighted_score)
                                            )}
                                        >
                                            {dim.weighted_score > 0 ? "+" : ""}{dim.weighted_score.toFixed(1)}
                                        </span>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Sector Card ───────────────────────────────────────────────────────────────

function SectorCard({ sector }: { sector: SectorIntelligence }) {
    const dirCounts = sector.dimensions.reduce(
        (acc, d) => {
            acc[d.direction] = (acc[d.direction] || 0) + 1;
            return acc;
        },
        {} as Record<string, number>
    );

    return (
        <div className="space-y-4">
            {/* Sector header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-gray-900">{sector.sector_label || sector.sector}</h2>
                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] font-medium text-gray-600">
                        {sector.company_count} companies
                    </span>
                </div>
                <span className="text-xs text-gray-400">
                    {sector.quarter_previous?.replace("_", " FY")} → {sector.quarter?.replace("_", " FY")}
                </span>
            </div>

            {/* Direction summary strip */}
            <div className="flex gap-3">
                {dirCounts["strengthening"] && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                        <TrendingUp className="h-3.5 w-3.5" />
                        {dirCounts["strengthening"]} strengthening
                    </div>
                )}
                {dirCounts["stable"] && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                        <Minus className="h-3.5 w-3.5" />
                        {dirCounts["stable"]} stable
                    </div>
                )}
                {dirCounts["weakening"] && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-red-600">
                        <TrendingDown className="h-3.5 w-3.5" />
                        {dirCounts["weakening"]} weakening
                    </div>
                )}
            </div>

            {/* Dimension cards */}
            {sector.dimensions.length > 0 ? (
                <div className="grid gap-3">
                    {sector.dimensions.map((dim) => (
                        <DimensionCard key={dim.dimension} dim={dim} />
                    ))}
                </div>
            ) : (
                <div className="rounded-xl border border-dashed border-gray-300 py-8 text-center">
                    <p className="text-sm text-gray-500">
                        No data available — run the seed script to populate.
                    </p>
                </div>
            )}
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SectorsClient() {
    const [sectors, setSectors] = useState<SectorIntelligence[]>([]);
    const [availableSectors, setAvailableSectors] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedSector, setSelectedSector] = useState<string>("All");

    useEffect(() => {
        setLoading(true);
        fetch("/api/v1/sectors")
            .then((res) => {
                if (!res.ok) throw new Error(`Failed (${res.status})`);
                return res.json();
            })
            .then((data) => {
                setSectors(data.sectors ?? []);
                setAvailableSectors(data.available_sectors ?? []);
            })
            .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
            .finally(() => setLoading(false));
    }, []);

    const filtered = useMemo(() => {
        if (selectedSector === "All") return sectors;
        return sectors.filter((s) => s.sector === selectedSector);
    }, [sectors, selectedSector]);

    const totalCompanies = sectors.reduce((sum, s) => sum + s.company_count, 0);

    return (
        <div className="min-h-screen bg-gray-50">
            <Nav />

            <main className="mx-auto max-w-5xl px-6 py-8">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3">
                        <Layers className="h-7 w-7 text-brand-600" />
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                            Sector Intelligence
                        </h1>
                    </div>
                    <p className="mt-2 text-sm text-gray-500 max-w-2xl">
                        Market-cap weighted sector signals synthesized from management commentary.
                        Scores are deterministically computed as weighted averages across the top
                        companies in each sector.
                    </p>
                </div>

                {/* Stats */}
                {!loading && sectors.length > 0 && (
                    <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-gray-500">
                        <span>
                            <strong className="text-gray-900">{sectors.length}</strong> sectors
                        </span>
                        <span>·</span>
                        <span>
                            <strong className="text-gray-900">{totalCompanies}</strong> companies
                        </span>
                    </div>
                )}

                {/* Cross-sector scorecard — only show on "All" view */}
                {!loading && selectedSector === "All" && sectors.length > 0 && (
                    <SectorMatrix sectors={sectors} />
                )}

                {/* Sector tabs */}
                {!loading && availableSectors.length > 0 && (
                    <div className="mb-6 flex flex-wrap gap-1.5">
                        <button
                            onClick={() => setSelectedSector("All")}
                            className={clsx(
                                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                                selectedSector === "All"
                                    ? "bg-gray-900 text-white"
                                    : "bg-white text-gray-600 border border-gray-200 hover:border-gray-300"
                            )}
                        >
                            All Sectors
                        </button>
                        {availableSectors.map((s) => (
                            <button
                                key={s}
                                onClick={() => setSelectedSector(s)}
                                className={clsx(
                                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                                    selectedSector === s
                                        ? "bg-gray-900 text-white"
                                        : "bg-white text-gray-600 border border-gray-200 hover:border-gray-300"
                                )}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error}
                    </div>
                )}

                {/* Loading / Empty / Content */}
                {loading ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                        <span className="ml-3 text-sm text-gray-500">Loading sector intelligence…</span>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center">
                        <Layers className="mx-auto h-10 w-10 text-gray-300" />
                        <p className="mt-3 text-sm text-gray-500">
                            {sectors.length === 0
                                ? "No sector data available. Run the seed script to populate sector intelligence."
                                : "No sectors match the current filter."}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-10">
                        {filtered.map((sector) => (
                            <SectorCard key={sector.sector} sector={sector} />
                        ))}
                    </div>
                )}

                {/* Footer context */}
                {!loading && sectors.length > 0 && (
                    <div className="mt-12 rounded-xl border border-gray-200 bg-white px-6 py-5">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                            Who uses this
                        </p>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                            {[
                                { role: "PMs", use: "Sector allocation" },
                                { role: "AMCs", use: "Thematic ideas" },
                                { role: "Brokerage", use: "Upgrades/downgrades" },
                                { role: "Wealth Mgrs", use: "Portfolio positioning" },
                                { role: "Family Offices", use: "Long-term bets" },
                            ].map((item) => (
                                <div
                                    key={item.role}
                                    className="rounded-lg bg-gray-50 px-3 py-2 text-center"
                                >
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
