"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { NIFTY200 } from "@/lib/nifty200";
import { QUARTERS, quarterLabel } from "@/lib/nifty50";
import { Youtube, BarChart2, Search, Play, Loader2, X } from "lucide-react";
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

// ── Video modal ───────────────────────────────────────────────────────────────

function VideoModal({
    company,
    quarter,
    result,
    onClose,
    onAnalyse,
}: {
    company: Company;
    quarter: string;
    result: ConcallResult;
    onClose: () => void;
    onAnalyse: (t: string) => void;
}) {
    useEffect(() => {
        function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    // Prevent body scroll while modal is open
    useEffect(() => {
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = ""; };
    }, []);

    const embedUrl = result.videoId
        ? `https://www.youtube.com/embed/${result.videoId}?autoplay=1&rel=0&modestbranding=1`
        : null;

    const fallbackUrl = result.url ?? concallSearchUrl(company.name, quarter);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 sm:p-8"
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-4xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute -top-9 right-0 flex items-center gap-1.5 text-gray-300 hover:text-white text-xs transition-colors"
                >
                    <X size={16} />
                    <span>Close</span>
                </button>

                {/* Video embed */}
                <div className="aspect-video w-full rounded-xl overflow-hidden bg-black shadow-2xl">
                    {embedUrl ? (
                        <iframe
                            src={embedUrl}
                            title={result.title ?? company.name}
                            allow="autoplay; encrypted-media; picture-in-picture"
                            allowFullScreen
                            className="w-full h-full"
                        />
                    ) : (
                        // No direct video ID — show YouTube search in an iframe
                        <iframe
                            src={fallbackUrl}
                            title={`${company.name} concall search`}
                            className="w-full h-full"
                        />
                    )}
                </div>

                {/* Info bar */}
                <div className="mt-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <p className="text-white font-semibold text-base leading-snug">
                            {company.name}
                            <span className="ml-2 text-sm font-normal text-gray-400">
                                {quarterLabel(quarter)}
                            </span>
                        </p>
                        {result.title && (
                            <p className="text-gray-400 text-sm mt-0.5 line-clamp-1">{result.title}</p>
                        )}
                        {result.channel && (
                            <p className="text-gray-500 text-xs mt-0.5">{result.channel}</p>
                        )}
                    </div>

                    <button
                        onClick={() => { onClose(); onAnalyse(company.ticker); }}
                        className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 transition-colors shrink-0"
                    >
                        <BarChart2 size={12} />
                        View Analysis
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Company card ──────────────────────────────────────────────────────────────

function CompanyCard({
    company,
    quarter,
    result,
    loading,
    onPlay,
    onAnalyse,
}: {
    company: Company;
    quarter: string;
    result: ConcallResult | null;
    loading: boolean;
    onPlay: () => void;
    onAnalyse: (t: string) => void;
}) {
    const hasThumb = !!result?.videoId;
    const fallbackUrl = result?.url ?? concallSearchUrl(company.name, quarter);

    return (
        <div className="group rounded-xl border border-gray-200 bg-white overflow-hidden hover:shadow-md hover:border-gray-300 transition-all flex flex-col">

            {/* Thumbnail / play button */}
            <button
                type="button"
                onClick={result ? onPlay : undefined}
                className="relative block w-full bg-gray-100 aspect-video overflow-hidden cursor-pointer"
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
                        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-red-600 rounded-full p-3 shadow-lg">
                                <Play size={18} className="text-white fill-white" />
                            </span>
                        </div>
                    </>
                )}
                {!loading && !hasThumb && (
                    <a
                        href={fallbackUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-50 hover:bg-gray-100 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Youtube size={28} className="text-gray-300" />
                        <p className="text-[11px] text-gray-400 text-center px-3">Search on YouTube</p>
                    </a>
                )}
            </button>

            {/* Card body */}
            <div className="p-3 flex flex-col gap-2 flex-1">
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
                    <button
                        type="button"
                        onClick={result ? onPlay : undefined}
                        className={clsx(
                            "flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-white transition-colors",
                            result ? "bg-red-600 hover:bg-red-700" : "bg-gray-200 text-gray-400 cursor-default"
                        )}
                    >
                        <Play size={11} className="fill-current" />
                        {result?.direct ? "Watch" : "Search"}
                    </button>
                    <button
                        onClick={() => onAnalyse(company.ticker)}
                        title="Concall Analysis"
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

    // Active modal
    const [activeVideo, setActiveVideo] = useState<{ company: Company; result: ConcallResult } | null>(null);

    const companies = SECTOR_MAP.get(activeSector) ?? [];

    const filtered = useMemo(() => {
        if (!search.trim()) return companies;
        const q = search.toLowerCase();
        return companies.filter(c =>
            c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)
        );
    }, [companies, search]);

    // Fetch concall data for active sector (higher concurrency, no stale closure)
    const fetchedRef = useRef(new Set<string>());

    useEffect(() => {
        const list = SECTOR_MAP.get(activeSector) ?? [];
        const toFetch = list.filter((c) => !fetchedRef.current.has(`${c.ticker}::${quarter}`));
        if (toFetch.length === 0) return;

        toFetch.forEach((c) => fetchedRef.current.add(`${c.ticker}::${quarter}`));

        const tasks = toFetch.map((c) => async () => {
            try {
                const res = await fetch(`/api/v1/concall?ticker=${c.ticker}&quarter=${quarter}`);
                const data: ConcallResult = await res.json();
                setVideoData((prev) => ({ ...prev, [`${c.ticker}::${quarter}`]: data }));
            } catch { /* card shows search fallback */ }
        });

        fetchConcurrent(tasks, 10);
    }, [activeSector, quarter]);

    function handleSectorChange(sector: string) {
        setActiveSector(sector);
        setSearch("");
    }

    function handleAnalyse(ticker: string) {
        router.push(`/dashboard?ticker=${ticker}`);
    }

    function handlePlay(company: Company, result: ConcallResult) {
        setActiveVideo({ company, result });
    }

    return (
        <>
            <Nav />

            {/* Inline video modal */}
            {activeVideo && (
                <VideoModal
                    company={activeVideo.company}
                    quarter={quarter}
                    result={activeVideo.result}
                    onClose={() => setActiveVideo(null)}
                    onAnalyse={handleAnalyse}
                />
            )}

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
                                    onPlay={() => result && handlePlay(c, result)}
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
