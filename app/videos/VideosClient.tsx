"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { LISTED_COMPANIES, type ListedCompany } from "@/lib/listed-companies";
import { QUARTERS, quarterLabel } from "@/lib/nifty50";
import { Youtube, BarChart2, Search, ChevronLeft, ChevronRight, X } from "lucide-react";
import clsx from "clsx";
import type { ConcallResult } from "@/app/api/v1/concall/route";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = ["All", "Large Cap", "Mid Cap", "Small Cap"] as const;
const SECTORS = Array.from(new Set(LISTED_COMPANIES.map((c) => c.sector).filter(Boolean))).sort();
const PAGE_SIZE = 50;

function concallSearchUrl(companyName: string, quarter: string) {
    const ql = quarterLabel(quarter);
    const fy = quarter.match(/\d{4}/)?.[0] ?? "";
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `${companyName} ${ql} FY${fy} earnings concall`
    )}`;
}

// ── Fetch with concurrency cap ────────────────────────────────────────────────

async function fetchConcurrent<T>(tasks: (() => Promise<T>)[], limit = 10): Promise<T[]> {
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

// ── Video modal ──────────────────────────────────────────────────────────────

function VideoModal({ name, quarter, videoId, title, onClose }: {
    name: string; quarter: string; videoId: string; title: string | null; onClose: () => void;
}) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 sm:p-8" onClick={onClose}>
            <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
                <button onClick={onClose} className="absolute -top-9 right-0 flex items-center gap-1.5 text-gray-300 hover:text-white text-xs">
                    <X size={16} /> Close
                </button>
                <div className="aspect-video w-full rounded-xl overflow-hidden bg-black shadow-2xl">
                    <iframe
                        src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
                        title={title ?? name}
                        allow="autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full"
                    />
                </div>
                <p className="mt-3 text-white font-semibold text-sm">
                    {name} <span className="ml-2 text-gray-400 font-normal">{quarterLabel(quarter)}</span>
                </p>
                {title && <p className="text-gray-400 text-xs mt-0.5">{title}</p>}
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VideosClient() {
    const router = useRouter();
    const [activeCategory, setActiveCategory] = useState<typeof CATEGORIES[number]>("All");
    const [activeSector, setActiveSector] = useState("All");
    const [quarter, setQuarter] = useState(QUARTERS[0]);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [videoData, setVideoData] = useState<Record<string, ConcallResult>>({});
    const [activeModal, setActiveModal] = useState<{ name: string; videoId: string; title: string | null } | null>(null);
    const fetchedRef = useRef(new Set<string>());

    const filtered = useMemo(() => {
        let list: ListedCompany[] = LISTED_COMPANIES;
        if (activeCategory !== "All") list = list.filter((c) => c.category === activeCategory);
        if (activeSector !== "All") list = list.filter((c) => c.sector === activeSector);
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter((c) => c.name.toLowerCase().includes(q) || c.nse.toLowerCase().includes(q));
        }
        return list;
    }, [activeCategory, activeSector, search]);

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const pageItems = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

    // Reset page when filters change
    useEffect(() => { setPage(1); }, [activeCategory, activeSector, search]);

    // Fetch concall data for visible page
    useEffect(() => {
        const toFetch = pageItems.filter((c) => !fetchedRef.current.has(`${c.nse}::${quarter}`));
        if (toFetch.length === 0) return;
        toFetch.forEach((c) => fetchedRef.current.add(`${c.nse}::${quarter}`));

        const tasks = toFetch.map((c) => async () => {
            try {
                const res = await fetch(`/api/v1/concall?ticker=${c.nse}&quarter=${quarter}`);
                if (!res.ok) return;
                const data: ConcallResult = await res.json();
                setVideoData((prev) => ({ ...prev, [`${c.nse}::${quarter}`]: data }));
            } catch { /* silent */ }
        });
        fetchConcurrent(tasks, 10);
    }, [pageItems, quarter]);

    return (
        <>
            <Nav />

            {activeModal && (
                <VideoModal
                    name={activeModal.name}
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
                            Top 500 listed companies by market cap — watch concall recordings inline.
                        </p>
                    </div>
                    <select
                        value={quarter}
                        onChange={(e) => setQuarter(e.target.value)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                    >
                        {QUARTERS.slice(0, 6).map((q) => (
                            <option key={q} value={q}>{quarterLabel(q)}</option>
                        ))}
                    </select>
                </div>

                {/* Filters */}
                <div className="mb-4 flex flex-wrap items-center gap-3">
                    {/* Category tabs */}
                    <div className="flex gap-1.5">
                        {CATEGORIES.map((cat) => (
                            <button
                                key={cat}
                                onClick={() => setActiveCategory(cat)}
                                className={clsx(
                                    "rounded-full px-3 py-1.5 text-xs font-medium border transition-colors",
                                    activeCategory === cat
                                        ? "bg-gray-900 text-white border-gray-900"
                                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                                )}
                            >
                                {cat}
                                <span className={clsx("ml-1 text-[10px]", activeCategory === cat ? "text-gray-300" : "text-gray-400")}>
                                    {cat === "All" ? LISTED_COMPANIES.length : LISTED_COMPANIES.filter((c) => c.category === cat).length}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Sector filter */}
                    <select
                        value={activeSector}
                        onChange={(e) => setActiveSector(e.target.value)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
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
                                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 w-8">#</th>
                                <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Company</th>
                                <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Ticker</th>
                                <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Sector</th>
                                <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Category</th>
                                <th className="text-center px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Quarter</th>
                                <th className="text-center px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Concall</th>
                                <th className="text-center px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Analyse</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {pageItems.map((c) => {
                                const key = `${c.nse}::${quarter}`;
                                const result = videoData[key] ?? null;
                                const hasVideo = !!result?.videoId;
                                const url = result?.url ?? concallSearchUrl(c.name, quarter);

                                return (
                                    <tr key={c.nse + c.rank} className="hover:bg-gray-50/50">
                                        <td className="px-4 py-2 text-[11px] text-gray-400">{c.rank}</td>
                                        <td className="px-3 py-2 font-medium text-gray-800 text-xs">{c.name}</td>
                                        <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{c.nse}</td>
                                        <td className="px-3 py-2 text-[11px] text-gray-500">{c.sector || "—"}</td>
                                        <td className="px-3 py-2">
                                            <span className={clsx(
                                                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                                                c.category === "Large Cap" ? "bg-blue-50 text-blue-700"
                                                : c.category === "Mid Cap" ? "bg-violet-50 text-violet-700"
                                                : "bg-gray-100 text-gray-600"
                                            )}>
                                                {c.category}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-center text-[11px] text-gray-500">{quarterLabel(quarter)}</td>
                                        <td className="px-3 py-2 text-center">
                                            {hasVideo ? (
                                                <button
                                                    onClick={() => setActiveModal({ name: c.name, videoId: result!.videoId!, title: result!.title })}
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
                                                onClick={() => router.push(`/dashboard?ticker=${c.nse}`)}
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

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="mt-4 flex items-center justify-between">
                        <p className="text-xs text-gray-400">
                            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                            >
                                <ChevronLeft size={14} />
                            </button>
                            <span className="text-xs text-gray-600 font-medium">Page {page} of {totalPages}</span>
                            <button
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                            >
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                )}

                {filtered.length === 0 && (
                    <div className="py-12 text-center text-sm text-gray-400">No companies match your search.</div>
                )}
            </main>
        </>
    );
}
