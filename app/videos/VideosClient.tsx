"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { NIFTY200 } from "@/lib/nifty200";
import { QUARTERS, quarterLabel } from "@/lib/nifty50";
import { Youtube, ExternalLink, BarChart2, Search } from "lucide-react";
import clsx from "clsx";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Company {
    ticker: string;
    name: string;
    sector: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build grouped sector → companies map, sorted by company name within each sector */
function buildSectorMap(): Map<string, Company[]> {
    const map = new Map<string, Company[]>();
    for (const [ticker, info] of Object.entries(NIFTY200)) {
        const list = map.get(info.sector) ?? [];
        list.push({ ticker, name: info.name, sector: info.sector });
        map.set(info.sector, list);
    }
    // Sort sectors by descending size, then alphabetically within same size
    const sorted = Array.from(map.entries()).sort(
        (a: [string, Company[]], b: [string, Company[]]) =>
            b[1].length - a[1].length || a[0].localeCompare(b[0])
    );
    sorted.forEach(([, list]) => list.sort((a, b) => a.name.localeCompare(b.name)));
    return new Map(sorted);
}

const SECTOR_MAP = buildSectorMap();
const SECTORS = Array.from(SECTOR_MAP.keys());

/** Build YouTube search URL for a company's earnings concall */
function concallSearchUrl(companyName: string, quarter: string): string {
    // e.g. "Reliance Industries Q4 FY26 FY2026 earnings concall"
    const ql = quarterLabel(quarter); // "Q4 FY26"
    const fyFull = quarter.match(/\d{4}/)?.[0] ?? "";
    const q = `${companyName} ${ql} FY${fyFull} earnings concall`;
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

/** Sector colour accents */
const SECTOR_COLOURS: Record<string, string> = {
    Banking:            "bg-blue-50 border-blue-200 text-blue-700",
    "Financial Services": "bg-indigo-50 border-indigo-200 text-indigo-700",
    IT:                 "bg-violet-50 border-violet-200 text-violet-700",
    Auto:               "bg-orange-50 border-orange-200 text-orange-700",
    FMCG:               "bg-yellow-50 border-yellow-200 text-yellow-700",
    Pharma:             "bg-teal-50 border-teal-200 text-teal-700",
    "Oil & Gas":        "bg-amber-50 border-amber-200 text-amber-700",
    Metals:             "bg-stone-50 border-stone-200 text-stone-700",
    "Capital Goods":    "bg-cyan-50 border-cyan-200 text-cyan-700",
    Consumer:           "bg-pink-50 border-pink-200 text-pink-700",
    Power:              "bg-lime-50 border-lime-200 text-lime-700",
    Infra:              "bg-emerald-50 border-emerald-200 text-emerald-700",
    NBFC:               "bg-sky-50 border-sky-200 text-sky-700",
    Insurance:          "bg-purple-50 border-purple-200 text-purple-700",
    Telecom:            "bg-rose-50 border-rose-200 text-rose-700",
    Realty:             "bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700",
    Chemicals:          "bg-green-50 border-green-200 text-green-700",
    Cement:             "bg-gray-50 border-gray-200 text-gray-700",
    Healthcare:         "bg-red-50 border-red-200 text-red-700",
    Mining:             "bg-zinc-50 border-zinc-200 text-zinc-700",
    Conglomerate:       "bg-slate-50 border-slate-200 text-slate-700",
};

// ── Company card ──────────────────────────────────────────────────────────────

function CompanyCard({
    company,
    quarter,
    onAnalyse,
}: {
    company: Company;
    quarter: string;
    onAnalyse: (ticker: string) => void;
}) {
    const ql = quarterLabel(quarter);
    const youtubeUrl = concallSearchUrl(company.name, quarter);
    const accent = SECTOR_COLOURS[company.sector] ?? "bg-gray-50 border-gray-200 text-gray-700";

    return (
        <div className="group rounded-xl border border-gray-200 bg-white p-4 hover:shadow-sm hover:border-gray-300 transition-all flex flex-col gap-3">
            {/* Top row */}
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{company.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5 font-mono">{company.ticker}</p>
                </div>
                <span className={clsx(
                    "shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 border",
                    accent
                )}>
                    {ql}
                </span>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-auto">
                {/* YouTube — primary action */}
                <a
                    href={youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-red-700 transition-colors"
                >
                    <Youtube size={13} />
                    Watch Concall
                </a>

                {/* Analyse — secondary action */}
                <button
                    onClick={() => onAnalyse(company.ticker)}
                    title="Open in Earnings Analysis"
                    className="flex items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
                >
                    <BarChart2 size={12} />
                    Analyse
                </button>
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VideosClient() {
    const router = useRouter();
    const [activeSector, setActiveSector] = useState(SECTORS[0]);
    const [quarter, setQuarter] = useState(QUARTERS[0]);
    const [search, setSearch] = useState("");

    const companies = SECTOR_MAP.get(activeSector) ?? [];

    const filtered = useMemo(() => {
        if (!search.trim()) return companies;
        const q = search.toLowerCase();
        return companies.filter(
            (c) => c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)
        );
    }, [companies, search]);

    function handleAnalyse(ticker: string) {
        router.push(`/dashboard?ticker=${ticker}`);
    }

    return (
        <>
            <Nav />
            <main className="mx-auto max-w-7xl px-6 py-8">

                {/* Header */}
                <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
                            <Youtube size={22} className="text-red-600" />
                            Earnings Concall Videos
                        </h1>
                        <p className="text-sm text-gray-500 mt-1">
                            YouTube earnings concall recordings for all Nifty 200 companies, by sector.
                        </p>
                    </div>

                    {/* Quarter picker */}
                    <select
                        value={quarter}
                        onChange={(e) => setQuarter(e.target.value)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {QUARTERS.slice(0, 6).map((q) => (
                            <option key={q} value={q}>{quarterLabel(q)}</option>
                        ))}
                    </select>
                </div>

                {/* Sector tabs — scrollable row */}
                <div className="mb-6 flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                    {SECTORS.map((sector) => {
                        const count = SECTOR_MAP.get(sector)?.length ?? 0;
                        const active = sector === activeSector;
                        return (
                            <button
                                key={sector}
                                onClick={() => { setActiveSector(sector); setSearch(""); }}
                                className={clsx(
                                    "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors whitespace-nowrap",
                                    active
                                        ? "bg-gray-900 text-white border-gray-900"
                                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:text-gray-800"
                                )}
                            >
                                {sector}
                                <span className={clsx(
                                    "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                                    active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                                )}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Search within sector */}
                <div className="mb-5 relative max-w-xs">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={`Search in ${activeSector}…`}
                        className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                {/* Company grid */}
                {filtered.length === 0 ? (
                    <div className="py-20 text-center text-sm text-gray-400">
                        No companies match &ldquo;{search}&rdquo; in {activeSector}.
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {filtered.map((c) => (
                            <CompanyCard
                                key={c.ticker}
                                company={c}
                                quarter={quarter}
                                onAnalyse={handleAnalyse}
                            />
                        ))}
                    </div>
                )}

                {/* Footer note */}
                <p className="mt-8 text-xs text-gray-400 text-center">
                    "Watch Concall" opens a YouTube search for that company&apos;s earnings call.
                    Sources include AlphaStreet India, CNBCTV18, Zerodha, Motilal Oswal, and others.
                </p>

            </main>
        </>
    );
}
