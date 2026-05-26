"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { NIFTY200 } from "@/lib/nifty200";
import { QUARTERS, quarterLabel } from "@/lib/nifty50";
import { Youtube, BarChart2, Search, Play, Loader2 } from "lucide-react";
import clsx from "clsx";
import type { ConcallResult } from "@/app/api/v1/concall/route";

// ── Types & constants ─────────────────────────────────────────────────────────

interface Company { ticker: string; name: string; sector: string }

function buildSectorMap(): Map<string, Company[]> {
    const map = new Map<string, Company[]>();
    for (const [ticker, info] of Object.entries(NIFTY200)) {
        const list = map.get(info.sector) ?? [];
        list.push({ ticker, name: info.name, sector: info.sector });
        map.set(info.sector, list);
    }
    const sorted = Array.from(map.entries()).sort(
        (a: [string, Company[]], b: [string, Company[]]) =>
            b[1].length - a[1].length || a[0].localeCompare(b[0])
    );
    sorted.forEach(([, list]) => list.sort((a, b) => a.name.localeCompare(b.name)));
    return new Map(sorted);
}

const SECTOR_MAP = buildSectorMap();
const SECTORS = Array.from(SECTOR_MAP.keys());

function concallSearchUrl(companyName: string, quarter: string) {
    const ql = quarterLabel(quarter);
    const fy = quarter.match(/\d{4}/)?.[0] ?? "";
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `${companyName} ${ql} FY${fy} earnings concall`
    )}`;
}

function thumbnailUrl(videoId: string) {
    return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

// ── Fetch with concurrency cap ────────────────────────────────────────────────

async function fetchConcurrent<T>(
    tasks: (() => Promise<T>)[],
    limit = 5
): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let idx = 0;
    async function worker() {
        while (idx < tasks.length) {
            const i = idx++;
            results[i] = await tasks[i]();
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
}

// ── Company card ──────────────────────────────────────────────────────────────

function CompanyCard({
    company,
    quarter,
    result,
    loading,
    onAnalyse,
}: {
    company: Company;
    quarter: string;
    result: ConcallResult | null;
    loading: boolean;
    onAnalyse: (t: string) => void;
}) {
    const fallbackUrl = result?.url ?? concallSearchUrl(company.name, quarter);
    const hasThumb = !!result?.videoId;

    return (
        <div className="group rounded-xl border border-gray-200 bg-white overflow-hidden hover:shadow-md hover:border-gray-300 transition-all flex flex-col">

            {/* Thumbnail / skeleton */}
            <a
                href={fallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="relative block bg-gray-100 aspect-video overflow-hidden"
            >
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-100 animate-pulse">
                        <Loader2 size={20} className="text-gray-300 animate-spin" />
                    </div>
                )}
                {hasThumb && (
                    <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={thumbnailUrl(result!.videoId!)}
                            alt={result?.title ?? company.name}
                            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                        />
                        {/* Play overlay */}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-red-600 rounded-full p-2.5 shadow-lg">
                                <Play size={16} className="text-white fill-white" />
                            </span>
                        </div>
                    </>
                )}
                {!loading && !hasThumb && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-50">
                        <Youtube size={28} className="text-gray-300" />
                        <p className="text-[11px] text-gray-400 text-center px-3">Search on YouTube</p>
                    </div>
                )}
            </a>

            {/* Card body */}
            <div className="p-3 flex flex-col gap-2 flex-1">
                {/* Company info */}
                <div>
                    <p className="text-[13px] font-bold text-gray-900 leading-snug line-clamp-1">{company.name}</p>
                    {result?.title ? (
                        <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5 leading-snug">{result.title}</p>
                    ) : (
                        <p className="text-[11px] text-gray-400 font-mono mt-0.5">{company.ticker} · {quarterLabel(quarter)}</p>
                    )}
                    {result?.channel && (
                        <p className="text-[10px] text-gray-400 mt-0.5 truncate">{result.channel}</p>
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 mt-auto">
                    <a
                        href={fallbackUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-red-700 transition-colors"
                    >
                        <Youtube size={11} />
                        {result?.direct ? "Watch" : "Search"}
                    </a>
                    <button
                        onClick={() => onAnalyse(company.ticker)}
                        title="Earnings Analysis"
                        className="flex items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
                    >
                        <BarChart2 size={11} />
                    </button>
                </div>
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

    // videoData: ticker → ConcallResult | "loading"
    const [videoData, setVideoData] = useState<Record<string, ConcallResult | "loading">>({});

    const companies = SECTOR_MAP.get(activeSector) ?? [];

    const filtered = useMemo(() => {
        if (!search.trim()) return companies;
        const q = search.toLowerCase();
        return companies.filter(c =>
            c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)
        );
    }, [companies, search]);

    // Fetch concall data for every company in the active sector
    const fetchSector = useCallback((sector: string, qtr: string) => {
        const list = SECTOR_MAP.get(sector) ?? [];

        // Mark all as loading
        setVideoData((prev) => {
            const next = { ...prev };
            for (const c of list) {
                if (!prev[`${c.ticker}::${qtr}`]) {
                    next[`${c.ticker}::${qtr}`] = "loading";
                }
            }
            return next;
        });

        // Only fetch companies not yet cached in state
        const toFetch = list.filter(
            (c) => !videoData[`${c.ticker}::${qtr}`] || videoData[`${c.ticker}::${qtr}`] === "loading"
        );

        if (toFetch.length === 0) return;

        const tasks = toFetch.map((c) => async () => {
            try {
                const res = await fetch(`/api/v1/concall?ticker=${c.ticker}&quarter=${qtr}`);
                const data: ConcallResult = await res.json();
                setVideoData((prev) => ({ ...prev, [`${c.ticker}::${qtr}`]: data }));
            } catch {
                // Leave as "loading" — card shows fallback search link
            }
        });

        fetchConcurrent(tasks, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetch when sector or quarter changes
    useEffect(() => {
        fetchSector(activeSector, quarter);
    }, [activeSector, quarter, fetchSector]);

    function handleSectorChange(sector: string) {
        setActiveSector(sector);
        setSearch("");
    }

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
                            Earnings concall recordings for all Nifty 200 companies — AlphaStreet India, CNBCTV18, Zerodha, Motilal & more.
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

                {/* Sector tabs */}
                <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
                    {SECTORS.map((sector) => {
                        const count = SECTOR_MAP.get(sector)?.length ?? 0;
                        const active = sector === activeSector;
                        return (
                            <button
                                key={sector}
                                onClick={() => handleSectorChange(sector)}
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

                {/* Grid */}
                {filtered.length === 0 ? (
                    <div className="py-20 text-center text-sm text-gray-400">
                        No companies match &ldquo;{search}&rdquo; in {activeSector}.
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {filtered.map((c) => {
                            const key = `${c.ticker}::${quarter}`;
                            const raw = videoData[key];
                            const result = raw && raw !== "loading" ? raw : null;
                            const loading = raw === "loading";
                            return (
                                <CompanyCard
                                    key={c.ticker}
                                    company={c}
                                    quarter={quarter}
                                    result={result}
                                    loading={loading}
                                    onAnalyse={handleAnalyse}
                                />
                            );
                        })}
                    </div>
                )}

            </main>
        </>
    );
}
