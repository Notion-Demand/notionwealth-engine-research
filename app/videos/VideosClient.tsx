"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { NIFTY200 } from "@/lib/nifty200";
import { QUARTERS, quarterLabel } from "@/lib/nifty50";
import { Youtube, BarChart2, Search, X } from "lucide-react";
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
    company: Company;
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
    const [activeSector, setActiveSector] = useState(SECTORS[0]);
    const [quarter, setQuarter] = useState(QUARTERS[0]);
    const [search, setSearch] = useState("");
    const [videoData, setVideoData] = useState<Record<string, ConcallResult>>({});
    const [activeModal, setActiveModal] = useState<{ company: Company; videoId: string; title: string | null } | null>(null);
    const fetchedRef = useRef(new Set<string>());

    const companies = SECTOR_MAP.get(activeSector) ?? [];
    const filtered = useMemo(() => {
        if (!search.trim()) return companies;
        const q = search.toLowerCase();
        return companies.filter(c =>
            c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)
        );
    }, [companies, search]);

    // Fetch concall data for active sector
    useEffect(() => {
        const list = SECTOR_MAP.get(activeSector) ?? [];
        const toFetch = list.filter((c) => !fetchedRef.current.has(`${c.ticker}::${quarter}`));
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
    }, [activeSector, quarter]);

    return (
        <>
            <Nav />

            {activeModal && (
                <VideoModal
                    company={activeModal.company}
                    quarter={quarter}
                    videoId={activeModal.videoId}
                    title={activeModal.title}
                    onClose={() => setActiveModal(null)}
                />
            )}

            <main className="mx-auto max-w-5xl px-4 py-8">
                {/* Header */}
                <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
                    <div>
                        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                            <Youtube size={20} className="text-red-600" />
                            Earnings Concall Videos
                        </h1>
                        <p className="text-sm text-gray-500 mt-1">
                            Concall recordings for Nifty 200 — click the YouTube icon to watch inline.
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

                {/* Sector tabs */}
                <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
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
                                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                                )}
                            >
                                {sector}
                                <span className={clsx("ml-1 text-[10px]", active ? "text-gray-300" : "text-gray-400")}>{count}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Search */}
                <div className="mb-4 relative max-w-xs">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={`Search in ${activeSector}…`}
                        className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                </div>

                {/* Table */}
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Company</th>
                                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Ticker</th>
                                <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Concall</th>
                                <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Analyse</th>
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
                                        <td className="px-4 py-2.5 font-medium text-gray-800">{c.name}</td>
                                        <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{c.ticker}</td>
                                        <td className="px-4 py-2.5 text-center">
                                            {hasVideo ? (
                                                <button
                                                    onClick={() => setActiveModal({ company: c, videoId: result!.videoId!, title: result!.title })}
                                                    title="Watch inline"
                                                    className="inline-flex items-center justify-center text-red-600 hover:text-red-700 transition-colors"
                                                >
                                                    <Youtube size={18} />
                                                </button>
                                            ) : (
                                                <a
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="Search on YouTube"
                                                    className="inline-flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors"
                                                >
                                                    <Youtube size={18} />
                                                </a>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-center">
                                            <button
                                                onClick={() => router.push(`/dashboard?ticker=${c.ticker}`)}
                                                title="Concall Analysis"
                                                className="inline-flex items-center justify-center text-gray-400 hover:text-brand-600 transition-colors"
                                            >
                                                <BarChart2 size={16} />
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
                        No companies match &ldquo;{search}&rdquo; in {activeSector}.
                    </div>
                )}
            </main>
        </>
    );
}
