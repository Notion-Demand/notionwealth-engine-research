"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { NIFTY500_LIST, type N500Entry } from "@/lib/nifty500";
import { QUARTERS, quarterLabel } from "@/lib/nifty50";
import { Youtube, BarChart2, Search, X } from "lucide-react";
import clsx from "clsx";
import type { ConcallResult } from "@/app/api/v1/concall/route";

// ── Types & constants ─────────────────────────────────────────────────────────

const SECTORS = Array.from(new Set(NIFTY500_LIST.map((c) => c.sector))).sort();
const CATEGORIES = ["All", "Nifty 50", "Nifty Next 50", "Midcap 150"] as const;

function concallSearchUrl(companyName: string, quarter: string) {
    const ql = quarterLabel(quarter);
    const fy = quarter.match(/\d{4}/)?.[0] ?? "";
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `${companyName} ${ql} FY${fy} earnings concall`
    )}`;
}

// ── Fetch with concurrency cap ────────────────────────────────────────────────

async function fetchConcurrent<T>(
    tasks: (() => Promise<T>)[],
    limit = 10
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

// ── Video modal (only for direct embeds) ─────────────────────────────────────

function VideoModal({
    company,
    quarter,
    videoId,
    title,
    onClose,
}: {
    company: { ticker: string; name: string; sector: string };
    quarter: string;
    videoId: string;
    title: string | null;
    onClose: () => void;
}) {
    useEffect(() => {
        function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    useEffect(() => {
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = ""; };
    }, []);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 sm:p-8"
            onClick={onClose}
        >
            <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
                <button
                    onClick={onClose}
                    className="absolute -top-9 right-0 flex items-center gap-1.5 text-gray-300 hover:text-white text-xs transition-colors"
                >
                    <X size={16} />
                    Close
                </button>
                <div className="aspect-video w-full rounded-xl overflow-hidden bg-black shadow-2xl">
                    <iframe
                        src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
                        title={title ?? company.name}
                        allow="autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full"
                    />
                </div>
                <p className="mt-3 text-white font-semibold text-sm">
                    {company.name}
                    <span className="ml-2 text-gray-400 font-normal">{quarterLabel(quarter)}</span>
                </p>
                {title && <p className="text-gray-400 text-xs mt-0.5">{title}</p>}
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VideosClient() {
    const router = useRouter();
    const [activeSector, setActiveSector] = useState("All");
    const [activeCategory, setActiveCategory] = useState<typeof CATEGORIES[number]>("All");
    const [quarter, setQuarter] = useState(QUARTERS[0]);
    const [search, setSearch] = useState("");
    const [videoData, setVideoData] = useState<Record<string, ConcallResult>>({});
    const [activeModal, setActiveModal] = useState<{ entry: N500Entry; videoId: string; title: string | null } | null>(null);
    const fetchedRef = useRef(new Set<string>());

    const filtered = useMemo(() => {
        let list = NIFTY500_LIST;
        if (activeSector !== "All") list = list.filter((c) => c.sector === activeSector);
        if (activeCategory !== "All") list = list.filter((c) => c.category === activeCategory);
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter((c) => c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q));
        }
        return list;
    }, [activeSector, activeCategory, search]);

    // Fetch concall data for visible companies
    useEffect(() => {
        const toFetch = filtered.filter((c) => !fetchedRef.current.has(`${c.ticker}::${quarter}`));
        if (toFetch.length === 0) return;
        toFetch.forEach((c) => fetchedRef.current.add(`${c.ticker}::${quarter}`));

        const tasks = toFetch.map((c) => async () => {
            try {
                const res = await fetch(`/api/v1/concall?ticker=${c.ticker}&quarter=${quarter}`);
                if (!res.ok) return;
                const data: ConcallResult = await res.json();
                setVideoData((prev) => ({ ...prev, [`${c.ticker}::${quarter}`]: data }));
            } catch { /* silent */ }
        });
        fetchConcurrent(tasks, 10);
    }, [filtered, quarter]);

    return (
        <>
            <Nav />

            {activeModal && (
                <VideoModal
                    company={{ ticker: activeModal.entry.ticker, name: activeModal.entry.name, sector: activeModal.entry.sector }}
                    quarter={quarter}
                    videoId={activeModal.videoId}
                    title={activeModal.title}
                    onClose={() => setActiveModal(null)}
                />
            )}

            <main className="mx-auto max-w-6xl px-4 py-8">
                {/* Header */}
                <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
                    <div>
                        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                            <Youtube size={20} className="text-red-600" />
                            Earnings Concall Videos
                        </h1>
                        <p className="text-sm text-gray-500 mt-1">
                            Concall recordings for Nifty 500 — click the YouTube icon to watch inline.
                        </p>
                    </div>
                    <select
                        value={quarter}
                        onChange={(e) => setQuarter(e.target.value)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                        {QUARTERS.slice(0, 6).map((q) => (
                            <option key={q} value={q}>{quarterLabel(q)}</option>
                        ))}
                    </select>
                </div>

                {/* Filters row */}
                <div className="mb-4 flex flex-wrap items-center gap-3">
                    {/* Category filter */}
                    <div className="flex gap-1.5">
                        {CATEGORIES.map((cat) => (
                            <button
                                key={cat}
                                onClick={() => setActiveCategory(cat)}
                                className={clsx(
                                    "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                                    activeCategory === cat
                                        ? "bg-brand-600 text-white border-brand-600"
                                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                                )}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>

                    {/* Sector filter */}
                    <select
                        value={activeSector}
                        onChange={(e) => setActiveSector(e.target.value)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                        <option value="All">All Sectors</option>
                        {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>

                    {/* Search */}
                    <div className="relative flex-1 max-w-xs">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search company or ticker…"
                            className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                    </div>

                    <span className="text-[11px] text-gray-400">{filtered.length} companies</span>
                </div>

                {/* Table */}
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Company</th>
                                <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Ticker</th>
                                <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Sector</th>
                                <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Category</th>
                                <th className="text-center px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Quarter</th>
                                <th className="text-center px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Concall</th>
                                <th className="text-center px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Analyse</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filtered.map((c) => {
                                const key = `${c.ticker}::${quarter}`;
                                const result = videoData[key] ?? null;
                                const hasVideo = !!result?.videoId;
                                const url = result?.url ?? concallSearchUrl(c.name, quarter);

                                return (
                                    <tr key={c.ticker} className="hover:bg-gray-50/50">
                                        <td className="px-4 py-2 font-medium text-gray-800 text-xs">{c.name}</td>
                                        <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{c.ticker}</td>
                                        <td className="px-3 py-2 text-[11px] text-gray-500">{c.sector}</td>
                                        <td className="px-3 py-2">
                                            <span className={clsx(
                                                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                                                c.category === "Nifty 50" ? "bg-blue-50 text-blue-700"
                                                : c.category === "Nifty Next 50" ? "bg-violet-50 text-violet-700"
                                                : "bg-gray-100 text-gray-600"
                                            )}>
                                                {c.category}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-center text-[11px] text-gray-500">{quarterLabel(quarter)}</td>
                                        <td className="px-3 py-2 text-center">
                                            {hasVideo ? (
                                                <button
                                                    onClick={() => setActiveModal({ entry: c, videoId: result!.videoId!, title: result!.title })}
                                                    title="Watch inline"
                                                    className="inline-flex items-center justify-center text-red-600 hover:text-red-700 transition-colors"
                                                >
                                                    <Youtube size={16} />
                                                </button>
                                            ) : (
                                                <a
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="Search on YouTube"
                                                    className="inline-flex items-center justify-center text-gray-300 hover:text-red-500 transition-colors"
                                                >
                                                    <Youtube size={16} />
                                                </a>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <button
                                                onClick={() => router.push(`/dashboard?ticker=${c.ticker}`)}
                                                title="Concall Analysis"
                                                className="inline-flex items-center justify-center text-gray-400 hover:text-brand-600 transition-colors"
                                            >
                                                <BarChart2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {filtered.length === 0 && (
                    <div className="py-12 text-center text-sm text-gray-400">
                        No companies match your filters.
                    </div>
                )}
            </main>
        </>
    );
}
