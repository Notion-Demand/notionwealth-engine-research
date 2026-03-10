"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import {
    BarChart3,
    TrendingUp,
    TrendingDown,
    RefreshCw,
    ChevronDown,
    ChevronUp,
    ArrowRight,
    Loader2,
    Search,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface KPIEntry {
    name: string;
    current: number | null;
    previous: number | null;
    change_pct: number | null;
    change_abs: number | null;
    change_bps: number | null;
    unit: string;
    category: string;
    is_highlight: boolean;
}

interface KPISnapshot {
    ticker: string;
    company: string;
    sector: string;
    quarter: string;
    quarter_previous: string;
    kpis: KPIEntry[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SECTORS = [
    "All",
    "IT",
    "Banking",
    "NBFC",
    "FMCG",
    "Auto",
    "Pharma",
    "Metals",
    "Oil & Gas",
    "Infra",
    "Power",
    "Telecom",
    "Insurance",
    "Consumer",
    "Conglomerate",
    "Healthcare",
    "Cement",
    "Mining",
];

const SECTOR_COLORS: Record<string, string> = {
    IT: "bg-blue-100 text-blue-700",
    Banking: "bg-emerald-100 text-emerald-700",
    NBFC: "bg-teal-100 text-teal-700",
    FMCG: "bg-orange-100 text-orange-700",
    Auto: "bg-purple-100 text-purple-700",
    Pharma: "bg-pink-100 text-pink-700",
    Metals: "bg-slate-100 text-slate-700",
    "Oil & Gas": "bg-amber-100 text-amber-700",
    Infra: "bg-cyan-100 text-cyan-700",
    Power: "bg-yellow-100 text-yellow-700",
    Telecom: "bg-indigo-100 text-indigo-700",
    Insurance: "bg-rose-100 text-rose-700",
    Consumer: "bg-violet-100 text-violet-700",
    Conglomerate: "bg-gray-100 text-gray-700",
    Healthcare: "bg-red-100 text-red-700",
    Cement: "bg-stone-100 text-stone-700",
    Mining: "bg-lime-100 text-lime-700",
    Other: "bg-gray-100 text-gray-600",
};

type SortMode = "biggest_gain" | "biggest_drop" | "alphabetical";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatChange(kpi: KPIEntry): string {
    if (kpi.change_bps != null) {
        const sign = kpi.change_bps >= 0 ? "+" : "";
        return `${sign}${kpi.change_bps} bps`;
    }
    if (kpi.change_pct != null) {
        const sign = kpi.change_pct >= 0 ? "+" : "";
        return `${sign}${kpi.change_pct}%`;
    }
    return "—";
}

function isPositive(kpi: KPIEntry): boolean {
    // For most metrics, increase is good. For costs/GNPA, decrease is good.
    const inversed = /expense|cost|gnpa|nnpa|attrition|npa/i.test(kpi.name);
    const val = kpi.change_pct ?? kpi.change_bps ?? 0;
    return inversed ? val < 0 : val > 0;
}

function formatValue(val: number | null, unit: string): string {
    if (val == null) return "—";
    if (unit === "%") return `${val.toFixed(1)}%`;
    if (Math.abs(val) >= 1000) return `₹${(val / 100).toFixed(0)}K Cr`;
    return `${unit === "₹ Cr" ? "₹" : ""}${val.toLocaleString("en-IN")} ${unit === "₹ Cr" ? "Cr" : unit}`;
}

function maxAbsChange(snapshot: KPISnapshot): number {
    return Math.max(
        ...snapshot.kpis.map((k) => Math.abs(k.change_pct ?? 0) + Math.abs(k.change_bps ?? 0)),
        0
    );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KPICard({
    snapshot,
    onDeepDive,
}: {
    snapshot: KPISnapshot;
    onDeepDive: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const highlights = snapshot.kpis.filter((k) => k.is_highlight);
    const others = snapshot.kpis.filter((k) => !k.is_highlight);

    return (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <div className="flex items-center gap-3">
                    <div>
                        <h3 className="text-base font-semibold text-gray-900">
                            {snapshot.company}
                        </h3>
                        <div className="mt-0.5 flex items-center gap-2">
                            <span className="font-mono text-xs text-gray-400">
                                {snapshot.ticker}
                            </span>
                            <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${SECTOR_COLORS[snapshot.sector] ?? SECTOR_COLORS.Other
                                    }`}
                            >
                                {snapshot.sector}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="text-right">
                    <span className="text-xs text-gray-400">
                        {snapshot.quarter_previous} → {snapshot.quarter}
                    </span>
                </div>
            </div>

            {/* Highlighted KPIs */}
            <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
                {highlights.map((kpi) => {
                    const positive = isPositive(kpi);
                    return (
                        <div
                            key={kpi.name}
                            className="group rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2.5 transition-colors hover:bg-gray-50"
                        >
                            <p className="text-[11px] font-medium text-gray-500 line-clamp-1">
                                {kpi.name}
                            </p>
                            <p className="mt-1 text-lg font-bold text-gray-900">
                                {formatValue(kpi.current, kpi.unit)}
                            </p>
                            <div
                                className={`mt-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold ${positive
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-red-50 text-red-600"
                                    }`}
                            >
                                {positive ? (
                                    <TrendingUp className="h-3 w-3" />
                                ) : (
                                    <TrendingDown className="h-3 w-3" />
                                )}
                                {formatChange(kpi)}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Expandable full table */}
            {others.length > 0 && (
                <>
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="flex w-full items-center justify-center gap-1 border-t border-gray-100 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    >
                        {expanded ? (
                            <>
                                <ChevronUp className="h-3.5 w-3.5" /> Hide details
                            </>
                        ) : (
                            <>
                                <ChevronDown className="h-3.5 w-3.5" /> View all {snapshot.kpis.length} KPIs
                            </>
                        )}
                    </button>

                    {expanded && (
                        <div className="border-t border-gray-100 px-5 py-3">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs text-gray-400">
                                        <th className="pb-2 font-medium">Metric</th>
                                        <th className="pb-2 font-medium text-right">Previous</th>
                                        <th className="pb-2 font-medium text-right">Current</th>
                                        <th className="pb-2 font-medium text-right">Change</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {snapshot.kpis.map((kpi) => {
                                        const positive = isPositive(kpi);
                                        return (
                                            <tr
                                                key={kpi.name}
                                                className="border-t border-gray-50"
                                            >
                                                <td className="py-1.5 text-gray-700">{kpi.name}</td>
                                                <td className="py-1.5 text-right text-gray-500">
                                                    {formatValue(kpi.previous, kpi.unit)}
                                                </td>
                                                <td className="py-1.5 text-right font-medium text-gray-900">
                                                    {formatValue(kpi.current, kpi.unit)}
                                                </td>
                                                <td
                                                    className={`py-1.5 text-right font-semibold ${positive ? "text-emerald-600" : "text-red-500"
                                                        }`}
                                                >
                                                    {formatChange(kpi)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {/* Footer */}
            <div className="border-t border-gray-100 px-5 py-3">
                <button
                    onClick={onDeepDive}
                    className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                    Deep Dive <ArrowRight className="h-3 w-3" />
                </button>
            </div>
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function KPIsClient() {
    const router = useRouter();
    const [snapshots, setSnapshots] = useState<KPISnapshot[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sector, setSector] = useState("All");
    const [sortMode, setSortMode] = useState<SortMode>("biggest_gain");
    const [searchQuery, setSearchQuery] = useState("");
    const [refreshing, setRefreshing] = useState(false);

    // Single-ticker extraction
    const [extractTicker, setExtractTicker] = useState("");
    const [extracting, setExtracting] = useState(false);

    // ── Fetch all cached KPI snapshots ────────────────────────────────────────
    useEffect(() => {
        setLoading(true);
        fetch("/api/v1/kpis?all=1")
            .then((r) => r.json())
            .then((data: { snapshots: KPISnapshot[] }) => {
                setSnapshots(data.snapshots ?? []);
            })
            .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
            .finally(() => setLoading(false));
    }, []);

    // ── Extract KPIs for a single ticker ──────────────────────────────────────
    async function handleExtract() {
        if (!extractTicker.trim()) return;
        setExtracting(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/v1/kpis?ticker=${encodeURIComponent(extractTicker.trim().toUpperCase())}&force=1`
            );
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.detail || `Failed (${res.status})`);
            }
            const snapshot: KPISnapshot = await res.json();
            // Add or replace in list
            setSnapshots((prev) => {
                const filtered = prev.filter((s) => s.ticker !== snapshot.ticker);
                return [snapshot, ...filtered];
            });
            setExtractTicker("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Extraction failed");
        } finally {
            setExtracting(false);
        }
    }

    // ── Refresh all ───────────────────────────────────────────────────────────
    async function handleRefreshAll() {
        setRefreshing(true);
        try {
            const res = await fetch("/api/v1/kpis?all=1");
            const data = await res.json();
            setSnapshots(data.snapshots ?? []);
        } catch {
            // ignore
        } finally {
            setRefreshing(false);
        }
    }

    // ── Filter and sort ───────────────────────────────────────────────────────
    const filtered = useMemo(() => {
        let list = snapshots;
        if (sector !== "All") {
            list = list.filter((s) => s.sector === sector);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(
                (s) =>
                    s.company.toLowerCase().includes(q) ||
                    s.ticker.toLowerCase().includes(q)
            );
        }
        switch (sortMode) {
            case "biggest_gain":
                list = [...list].sort((a, b) => maxAbsChange(b) - maxAbsChange(a));
                break;
            case "biggest_drop":
                list = [...list].sort((a, b) => {
                    const aMin = Math.min(
                        ...a.kpis.map((k) => k.change_pct ?? 0),
                        0
                    );
                    const bMin = Math.min(
                        ...b.kpis.map((k) => k.change_pct ?? 0),
                        0
                    );
                    return aMin - bMin;
                });
                break;
            case "alphabetical":
                list = [...list].sort((a, b) => a.company.localeCompare(b.company));
                break;
        }
        return list;
    }, [snapshots, sector, sortMode, searchQuery]);

    // Stats
    const totalCompanies = snapshots.length;
    const sectorsPresent = new Set(snapshots.map((s) => s.sector)).size;

    return (
        <>
            <Nav />
            <main className="mx-auto max-w-6xl px-4 py-10">
                {/* ── Header ─────────────────────────────────────────────────── */}
                <div className="mb-8">
                    <div className="flex items-center gap-3">
                        <BarChart3 className="h-7 w-7 text-brand-600" />
                        <h1 className="text-2xl font-bold text-gray-900">KPI Tracker</h1>
                    </div>
                    <p className="mt-2 text-sm text-gray-500">
                        Scan top financial metric changes across quarterly earnings — revenue
                        growth, margin shifts, sector-specific drivers.
                    </p>
                </div>

                {/* ── Stats strip ────────────────────────────────────────────── */}
                <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-gray-500">
                    <span>
                        <strong className="text-gray-900">{totalCompanies}</strong> companies
                        tracked
                    </span>
                    <span>·</span>
                    <span>
                        <strong className="text-gray-900">{sectorsPresent}</strong> sectors
                    </span>
                    <div className="flex-1" />
                    <button
                        onClick={handleRefreshAll}
                        disabled={refreshing}
                        className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
                    >
                        <RefreshCw
                            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                        />
                        Refresh
                    </button>
                </div>

                {/* ── Extract new ticker ──────────────────────────────────────── */}
                <div className="mb-6 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-4">
                    <p className="mb-2 text-xs font-medium text-gray-500">
                        Extract KPIs for a new company
                    </p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={extractTicker}
                            onChange={(e) => setExtractTicker(e.target.value.toUpperCase())}
                            onKeyDown={(e) => e.key === "Enter" && handleExtract()}
                            placeholder="Enter ticker (e.g. TCS, HDFC, RELIANCE)"
                            className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                            disabled={extracting}
                        />
                        <button
                            onClick={handleExtract}
                            disabled={extracting || !extractTicker.trim()}
                            className="flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                        >
                            {extracting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" /> Extracting…
                                </>
                            ) : (
                                <>
                                    <BarChart3 className="h-4 w-4" /> Extract
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* ── Error ──────────────────────────────────────────────────── */}
                {error && (
                    <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error}
                    </div>
                )}

                {/* ── Sector tabs + sort + search ─────────────────────────────── */}
                <div className="mb-6 flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap gap-1">
                        {SECTORS.filter(
                            (s) => s === "All" || snapshots.some((sn) => sn.sector === s)
                        ).map((s) => (
                            <button
                                key={s}
                                onClick={() => setSector(s)}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${sector === s
                                    ? "bg-brand-600 text-white"
                                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                    }`}
                            >
                                {s}
                            </button>
                        ))}
                    </div>

                    <div className="flex-1" />

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search…"
                            className="rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                    </div>

                    {/* Sort */}
                    <select
                        value={sortMode}
                        onChange={(e) => setSortMode(e.target.value as SortMode)}
                        className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                        <option value="biggest_gain">Biggest Changes</option>
                        <option value="biggest_drop">Biggest Declines</option>
                        <option value="alphabetical">A → Z</option>
                    </select>
                </div>

                {/* ── Loading state ──────────────────────────────────────────── */}
                {loading ? (
                    <div className="flex items-center justify-center py-20 text-gray-400">
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Loading KPI snapshots…
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center">
                        <BarChart3 className="mx-auto h-10 w-10 text-gray-300" />
                        <p className="mt-3 text-sm text-gray-500">
                            {snapshots.length === 0
                                ? "No KPI data yet. Extract KPIs for a company above."
                                : "No companies match the current filter."}
                        </p>
                    </div>
                ) : (
                    /* ── KPI Cards grid ─────────────────────────────────────────── */
                    <div className="grid gap-4 md:grid-cols-2">
                        {filtered.map((snapshot) => (
                            <KPICard
                                key={snapshot.ticker}
                                snapshot={snapshot}
                                onDeepDive={() =>
                                    router.push(`/dashboard?ticker=${snapshot.ticker}`)
                                }
                            />
                        ))}
                    </div>
                )}
            </main>
        </>
    );
}
