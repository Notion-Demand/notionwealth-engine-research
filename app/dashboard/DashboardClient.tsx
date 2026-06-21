"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import EarningsReport from "@/components/EarningsReport";
import AgentPanel, {
  makeInitialAgentState,
  type AgentPanelState,
  type AgentStatus,
} from "@/components/AgentPanel";
import { runAnalysisStream, runSoloAnalysisStream, getTranscriptDownloadUrl } from "@/lib/api";
import { quarterLabel, SECTION_NAMES, QUARTERS } from "@/lib/nifty50";
import { NIFTY200_LIST, NIFTY200 } from "@/lib/nifty200";
import {
  BarChart2, RefreshCw, Bookmark, BookmarkCheck, X, PlusCircle,
  Upload, ChevronLeft, ChevronRight, Download, FileText,
} from "lucide-react";
import clsx from "clsx";

const DEFAULT_SECTIONS = [...SECTION_NAMES];

// Module-level set for O(1) Nifty 200 coverage checks
const NIFTY200_TICKERS = new Set(Object.keys(NIFTY200));

// Fixed global quarter pair — always the two most recent quarters
const GLOBAL_CURR = QUARTERS[0]; // e.g. Q4_2026
const GLOBAL_PREV = QUARTERS[1]; // e.g. Q3_2026

const WATCHLIST_KEY = "quantalyze_watchlist";
const MAX_WATCHLIST = 20;
const DEFAULT_WATCHLIST_TICKERS = [
  "RELIANCE", "HDFC", "ICICI", "INFOSYS", "TCS",
  "KOTAKBANK", "AXISBANK", "SBI", "BHARTI", "ITC",
];

// ── Company autocomplete ──────────────────────────────────────────────────────

function CompanySearch({
  options,
  value,
  onChange,
  onAdd,
  disabled,
}: {
  options: { ticker: string; name: string }[];
  value: string;
  onChange: (ticker: string) => void;
  onAdd?: (ticker: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedName = options.find((o) => o.ticker === value)?.name ?? value;

  const filtered = query.trim()
    ? options.filter(
      (o) =>
        o.name.toLowerCase().includes(query.toLowerCase()) ||
        o.ticker.toLowerCase().includes(query.toLowerCase())
    )
    : options;

  // Candidate ticker to add when no match found
  const addCandidate = (() => {
    if (!query.trim() || filtered.length > 0) return null;
    const t = query.trim().toUpperCase();
    return /^[A-Z0-9&.-]{1,20}$/.test(t) ? t : null;
  })();

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    const item = listRef.current?.children[highlighted] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  function select(ticker: string) {
    onChange(ticker);
    setOpen(false);
    setQuery("");
  }

  function handleAdd() {
    if (!addCandidate) return;
    onAdd?.(addCandidate);
    select(addCandidate);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        setHighlighted(0);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlighted]) select(filtered[highlighted].ticker);
      else if (addCandidate) handleAdd();
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        type="text"
        disabled={disabled}
        value={open ? query : selectedName}
        placeholder="Search company or ticker…"
        onFocus={() => { setOpen(true); setQuery(""); setHighlighted(0); }}
        onChange={(e) => { setQuery(e.target.value); setHighlighted(0); }}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
        autoComplete="off"
        spellCheck={false}
      />
      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {filtered.map((o, i) => (
            <li
              key={o.ticker}
              onMouseDown={() => select(o.ticker)}
              onMouseEnter={() => setHighlighted(i)}
              className={clsx(
                "flex cursor-pointer items-center justify-between px-3 py-2 text-sm",
                i === highlighted
                  ? "bg-brand-50 text-brand-700"
                  : "text-gray-700 hover:bg-gray-50"
              )}
            >
              <span>{o.name}</span>
              <span className="ml-3 shrink-0 font-mono text-xs text-gray-400">
                {o.ticker}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden">
          {addCandidate ? (
            <button
              onMouseDown={(e) => { e.preventDefault(); handleAdd(); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-blue-50 transition-colors"
            >
              <PlusCircle size={14} className="text-blue-500 shrink-0" />
              <span className="text-gray-700">Add <span className="font-semibold font-mono">{addCandidate}</span> to my list</span>
              <span className="ml-auto text-[11px] text-gray-400">visible only to you</span>
            </button>
          ) : (
            <p className="px-3 py-2 text-sm text-gray-400">No matches</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Watchlist hook ────────────────────────────────────────────────────────────

function useWatchlist(options: { ticker: string; name: string }[]) {
  const [watchlist, setWatchlist] = useState<{ ticker: string; name: string }[]>([]);

  // Load from localStorage on mount; seed defaults if empty
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      if (raw) {
        setWatchlist(JSON.parse(raw));
      } else {
        // Seed with top-10 popular stocks
        const defaults = DEFAULT_WATCHLIST_TICKERS.map((t) => ({
          ticker: t,
          name: options.find((o) => o.ticker === t)?.name ?? t,
        }));
        setWatchlist(defaults);
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(defaults));
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback((ticker: string) => {
    setWatchlist((prev) => {
      const exists = prev.find((w) => w.ticker === ticker);
      let next: { ticker: string; name: string }[];
      if (exists) {
        next = prev.filter((w) => w.ticker !== ticker);
      } else {
        if (prev.length >= MAX_WATCHLIST) return prev; // cap at 20
        const name = options.find((o) => o.ticker === ticker)?.name ?? ticker;
        next = [...prev, { ticker, name }];
      }
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      return next;
    });
  }, [options]);

  const bulkAdd = useCallback((tickers: string[]): number => {
    let added = 0;
    setWatchlist((prev) => {
      const existing = new Set(prev.map((w) => w.ticker));
      const remaining = MAX_WATCHLIST - prev.length;
      const toAdd = tickers.filter((t) => !existing.has(t)).slice(0, remaining);
      added = toAdd.length;
      if (added === 0) return prev;
      const next = [
        ...prev,
        ...toAdd.map((t) => ({
          ticker: t,
          name: options.find((o) => o.ticker === t)?.name ?? t,
        })),
      ];
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      return next;
    });
    return added;
  }, [options]);

  const cycleNext = useCallback((currentTicker: string): string | null => {
    if (watchlist.length === 0) return null;
    const idx = watchlist.findIndex((w) => w.ticker === currentTicker);
    const nextIdx = (idx + 1) % watchlist.length;
    return watchlist[nextIdx].ticker;
  }, [watchlist]);

  const cyclePrev = useCallback((currentTicker: string): string | null => {
    if (watchlist.length === 0) return null;
    const idx = watchlist.findIndex((w) => w.ticker === currentTicker);
    const prevIdx = (idx - 1 + watchlist.length) % watchlist.length;
    return watchlist[prevIdx].ticker;
  }, [watchlist]);

  const isWatched = useCallback(
    (ticker: string) => watchlist.some((w) => w.ticker === ticker),
    [watchlist]
  );

  return { watchlist, toggle, bulkAdd, cycleNext, cyclePrev, isWatched };
}

// ── User custom tickers hook ──────────────────────────────────────────────────

function useUserTickers() {
  const [userTickers, setUserTickers] = useState<{ ticker: string; name: string; sector: string }[]>([]);

  useEffect(() => {
    fetch("/api/v1/user-tickers")
      .then((r) => r.ok ? r.json() : [])
      .then(setUserTickers)
      .catch(() => {});
  }, []);

  const add = useCallback(async (ticker: string) => {
    // Optimistic add
    setUserTickers((prev) => {
      if (prev.some((t) => t.ticker === ticker)) return prev;
      return [{ ticker, name: ticker, sector: "Custom" }, ...prev];
    });
    await fetch("/api/v1/user-tickers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker }),
    }).catch(() => {});
  }, []);

  const remove = useCallback(async (ticker: string) => {
    setUserTickers((prev) => prev.filter((t) => t.ticker !== ticker));
    await fetch(`/api/v1/user-tickers?ticker=${ticker}`, { method: "DELETE" }).catch(() => {});
  }, []);

  return { userTickers, add, remove };
}

export default function DashboardClient() {
  const searchParams = useSearchParams();
  const tickerParam = searchParams.get("ticker")?.toUpperCase() ?? null;

  // ── Available PDFs ──────────────────────────────────────────────────────────
  const [available, setAvailable] = useState<Record<string, string[]>>({});
  const [availableLoading, setAvailableLoading] = useState(true);

  const fetchAvailable = useRef<(selectTicker?: string | null) => void>();
  fetchAvailable.current = (selectTicker?: string | null) => {
    setAvailableLoading(true);
    fetch("/api/v1/available")
      .then((r) => r.json())
      .then((data: Record<string, string[]>) => {
        setAvailable(data);
        if (selectTicker && data[selectTicker]) {
          setTicker(selectTicker);
        }
      })
      .catch(() => { })
      .finally(() => setAvailableLoading(false));
  };

  useEffect(() => {
    fetchAvailable.current?.(tickerParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { userTickers, add: addUserTicker } = useUserTickers();

  const filteredList = useMemo(() => {
    const userTickerSet = new Set(userTickers.map((t) => t.ticker));
    const extras = Object.keys(available)
      .filter((t) => !NIFTY200_TICKERS.has(t) && !userTickerSet.has(t))
      .sort()
      .map((t) => ({ ticker: t, bse: 0, nse: t, name: t, sector: "" }));
    const custom = userTickers.map((t) => ({ ticker: t.ticker, bse: 0, nse: t.ticker, name: t.name || t.ticker, sector: t.sector }));
    return [...NIFTY200_LIST, ...custom, ...extras];
  }, [available, userTickers]);

  const { watchlist, toggle: toggleWatchlist, bulkAdd: watchlistBulkAdd, cycleNext, cyclePrev, isWatched } = useWatchlist(filteredList);

  // ── Picker state ────────────────────────────────────────────────────────────
  const [ticker, setTicker] = useState(tickerParam ?? "RELIANCE");

  // Quarters are globally fixed — always the two most recent across all stocks
  const qCurr = GLOBAL_CURR;
  const qPrev = GLOBAL_PREV;

  // ── CSV upload for watchlist ────────────────────────────────────────────────
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);

  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const tokens = text.split(/[\s,;|\t\r\n]+/);
      const tickers = Array.from(
        new Set(
          tokens
            .map((t) => t.replace(/[^A-Za-z0-9&]/g, "").toUpperCase())
            .filter((t) => t.length >= 2 && t.length <= 12 && /^[A-Z]/.test(t))
        )
      );
      const added = watchlistBulkAdd(tickers);
      setCsvMsg(`Added ${added} ticker${added !== 1 ? "s" : ""} from ${file.name}`);
      setTimeout(() => setCsvMsg(null), 4000);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // ── Keyboard cycling (← → when not in an input) ────────────────────────────
  const cycleRef = useRef({ cycleNext, cyclePrev, ticker, handleTickerChange: (t: string) => { } });
  useEffect(() => {
    cycleRef.current.cycleNext = cycleNext;
    cycleRef.current.cyclePrev = cyclePrev;
    cycleRef.current.ticker = ticker;
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") {
        const next = cycleRef.current.cycleNext(cycleRef.current.ticker);
        if (next) cycleRef.current.handleTickerChange(next);
      } else if (e.key === "ArrowLeft") {
        const prev = cycleRef.current.cyclePrev(cycleRef.current.ticker);
        if (prev) cycleRef.current.handleTickerChange(prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Auto-fetch state ─────────────────────────────────────────────────────────
  const [fetchingTranscripts, setFetchingTranscripts] = useState(false);
  const [coverageMsg, setCoverageMsg] = useState<string | null>(null);
  const fetchAttempted = useRef(new Set<string>());

  function handleTickerChange(newTicker: string) {
    setTicker(newTicker);
    setResult(null);
    setError(null);
    setAgentState(null);
    setCoverageMsg(null);
  }

  // Wire handleTickerChange into cycleRef after it's defined
  cycleRef.current.handleTickerChange = handleTickerChange;

  // ── Auto-fetch transcripts when required quarters are missing ────────────────
  useEffect(() => {
    if (!ticker || availableLoading) return;
    const quarters = available[ticker] ?? [];
    const hasBothQuarters = quarters.includes(qCurr) && quarters.includes(qPrev);
    if (hasBothQuarters) { setCoverageMsg(null); return; }
    if (fetchAttempted.current.has(ticker)) {
      // Already pulled — if quarters are still missing, surface a message
      const missing = [qPrev, qCurr].filter((q) => !quarters.includes(q));
      if (missing.length > 0) {
        setCoverageMsg(
          `${missing.map(quarterLabel).join(" & ")} transcript${missing.length > 1 ? "s" : ""} not yet available`
        );
      }
      return;
    }

    fetchAttempted.current.add(ticker);
    setFetchingTranscripts(true);
    setCoverageMsg(null);
    fetch("/api/v1/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Request API error ${r.status}`);
        return r.json();
      })
      .then(() => {
        fetchAvailable.current?.();
      })
      .catch((e) => {
        setError(`Failed to fetch transcripts for ${ticker}: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => setFetchingTranscripts(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, available, availableLoading]);

  // ── Analysis state ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [agentState, setAgentState] = useState<AgentPanelState | null>(null);
  const [soloResult, setSoloResult] = useState<Record<string, unknown> | null>(null);
  const [soloLoading, setSoloLoading] = useState(false);
  const [soloPhase, setSoloPhase] = useState<string | null>(null);

  async function handleAnalyze(e: React.FormEvent, force = false) {
    e.preventDefault();
    if (!ticker || !qPrev || !qCurr || qPrev === qCurr) return;

    setError(null);
    setResult(null);
    setSoloResult(null);
    setLoading(true);
    setAgentState(null);

    try {
      const res = await runAnalysisStream(
        { ticker, q_prev: qPrev, q_curr: qCurr, ...(force ? { force: true } : {}) },
        (event) => {
          setAgentState((prev) => {
            if (event.type === "start") {
              const running = Object.fromEntries(
                event.sections.map((s) => [s, "running" as AgentStatus])
              );
              const fresh = makeInitialAgentState(event.sections);
              return {
                ...fresh,
                prevStatus: { ...running },
                currStatus: { ...running },
                deltaStatus: Object.fromEntries(
                  event.sections.map((s) => [s, "idle" as AgentStatus])
                ),
                evasivenessStatus: "running",
                phase: "thematic",
              };
            }

            if (!prev) return prev;
            const next: AgentPanelState = {
              ...prev,
              prevStatus: { ...prev.prevStatus },
              currStatus: { ...prev.currStatus },
              deltaStatus: { ...prev.deltaStatus },
            };

            switch (event.type) {
              case "thematic_done": {
                if (event.which === "prev") {
                  next.prevStatus[event.section] = "done";
                } else {
                  next.currStatus[event.section] = "done";
                }
                const prevDone = next.prevStatus[event.section] === "done";
                const currDone = next.currStatus[event.section] === "done";
                if (prevDone && currDone) {
                  next.deltaStatus[event.section] = "running";
                }
                const allThematic = DEFAULT_SECTIONS.every(
                  (s) => next.prevStatus[s] === "done" && next.currStatus[s] === "done"
                );
                if (allThematic) next.phase = "delta";
                break;
              }
              case "evasiveness_done": {
                next.evasivenessStatus = "done";
                next.evasivenessScore = event.score;
                break;
              }
              case "delta_done": {
                next.deltaStatus[event.section] = "done";
                const allDelta = DEFAULT_SECTIONS.every(
                  (s) => next.deltaStatus[s] === "done"
                );
                if (allDelta) next.phase = "finalizing";
                break;
              }
              case "stock_done": {
                next.stockStatus = "done";
                next.stockChange = event.stockPriceChange;
                break;
              }
            }
            return next;
          });
        }
      );

      setResult(res.payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
      setAgentState(null);
    }
  }

  async function handleSoloAnalyze(force = false) {
    if (!ticker || !qCurr) return;

    setError(null);
    setResult(null);
    setSoloResult(null);
    setSoloLoading(true);
    setSoloPhase("Starting…");

    try {
      const res = await runSoloAnalysisStream(
        ticker,
        qCurr,
        (event) => {
          if (event.type === "extracting") setSoloPhase("Extracting transcript…");
          else if (event.type === "analyzing") setSoloPhase("Running deep analysis…");
        },
        { force }
      );
      setSoloResult(res.payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setSoloLoading(false);
      setSoloPhase(null);
    }
  }


  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl px-4 py-10">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <BarChart2 size={18} className="text-brand-500" />
            Concall Analysis
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Track what management says — not the numbers. Detect language shifts, evasiveness, and narrative changes quarter-over-quarter. Covers all <span className="font-medium text-gray-700">Nifty 200</span> companies.
          </p>
          <p className="mt-1.5 text-xs text-gray-400 flex items-center gap-1.5">
            <span className="inline-block h-1 w-1 rounded-full bg-gray-300" />
            Stock not in Nifty 200?{" "}
            <a
              href="/request"
              className="text-brand-500 hover:text-brand-600 font-medium underline underline-offset-2 transition-colors"
            >
              Request transcripts
            </a>{" "}
            to add it — or search and type any ticker to add it to your personal list.
          </p>
        </div>

        {/* ── Watchlist ──────────────────────────────────────────────────── */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Watchlist
            {watchlist.length > 0 && (
              <span className="ml-1 font-normal text-gray-300">
                {watchlist.length}/{MAX_WATCHLIST}
              </span>
            )}
          </span>

          {/* Cycle ◀ ▶ buttons */}
          {watchlist.length > 1 && (
            <>
              <button
                type="button"
                title="Previous stock (←)"
                onClick={() => { const t = cyclePrev(ticker); if (t) handleTickerChange(t); }}
                className="inline-flex items-center justify-center h-6 w-6 rounded border border-gray-200 bg-white text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-colors"
              >
                <ChevronLeft size={12} />
              </button>
              <button
                type="button"
                title="Next stock (→)"
                onClick={() => { const t = cycleNext(ticker); if (t) handleTickerChange(t); }}
                className="inline-flex items-center justify-center h-6 w-6 rounded border border-gray-200 bg-white text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-colors"
              >
                <ChevronRight size={12} />
              </button>
            </>
          )}

          {watchlist.map((w) => (
            <button
              key={w.ticker}
              type="button"
              onClick={() => handleTickerChange(w.ticker)}
              className={clsx(
                "group inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                w.ticker === ticker
                  ? "border-brand-300 bg-brand-50 text-brand-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-brand-200 hover:text-brand-600"
              )}
            >
              {w.ticker}
              <X
                size={10}
                className="opacity-40 group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); toggleWatchlist(w.ticker); }}
              />
            </button>
          ))}

          {/* CSV upload */}
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={handleCsvUpload}
          />
          <button
            type="button"
            onClick={() => csvInputRef.current?.click()}
            title={`Bulk-add tickers from CSV (max ${MAX_WATCHLIST})`}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs font-medium text-gray-400 hover:border-brand-400 hover:text-brand-600 transition-colors"
          >
            <Upload size={11} />
            CSV
          </button>

          {csvMsg && (
            <span className="text-[11px] text-emerald-600 font-medium">{csvMsg}</span>
          )}
        </div>

        {/* ── Picker form ──────────────────────────────────────────────── */}
        <form
          data-no-print
          onSubmit={handleAnalyze}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4"
        >
          {/* Company */}
          <div className="flex flex-col gap-1 min-w-[200px] flex-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Company
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleWatchlist(ticker)}
                  disabled={loading}
                  title={isWatched(ticker) ? "Remove from watchlist" : `Add to watchlist (${watchlist.length}/${MAX_WATCHLIST})`}
                  className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-brand-600 disabled:opacity-40"
                >
                  {isWatched(ticker)
                    ? <BookmarkCheck size={12} className="text-brand-500" />
                    : <Bookmark size={12} />}
                </button>
                <button
                  type="button"
                  onClick={() => fetchAvailable.current?.(tickerParam)}
                  disabled={availableLoading || loading}
                  className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 disabled:opacity-40"
                  title="Refresh company list"
                >
                  <RefreshCw size={11} className={availableLoading ? "animate-spin" : ""} />
                  Refresh
                </button>
              </div>
            </div>
            {fetchingTranscripts && (
              <p className="text-[11px] text-blue-600 flex items-center gap-1">
                <RefreshCw size={10} className="animate-spin" />
                Fetching transcripts for {ticker}…
              </p>
            )}
            {!fetchingTranscripts && coverageMsg && (
              <p className="text-[11px] text-amber-600">
                {coverageMsg}{" "}
                <a href="/request" className="underline underline-offset-2 font-medium">
                  Request transcripts →
                </a>
              </p>
            )}
            {tickerParam && !available[tickerParam] && !availableLoading && !fetchingTranscripts && (
              <p className="text-[11px] text-amber-600">
                {tickerParam} not found — try refreshing or wait a moment after uploading.
              </p>
            )}
            <CompanySearch
              options={filteredList}
              value={ticker}
              onChange={handleTickerChange}
              onAdd={addUserTicker}
              disabled={loading || fetchingTranscripts}
            />
          </div>

          {/* Fixed global quarter comparison label */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Comparing
            </label>
            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
              <span className="font-medium">{quarterLabel(qPrev)}</span>
              <span className="text-gray-400">→</span>
              <span className="font-medium">{quarterLabel(qCurr)}</span>
            </div>
          </div>

          {/* Submit buttons */}
          <div className="flex flex-col gap-2">
            <button
              type="submit"
              disabled={loading || soloLoading || fetchingTranscripts || !!coverageMsg}
              className="rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? "Analyzing…" : "Delta Analysis"}
            </button>
            <button
              type="button"
              onClick={() => handleSoloAnalyze()}
              disabled={loading || soloLoading || fetchingTranscripts || !ticker || !qCurr}
              className="rounded-md border border-brand-300 bg-white px-5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
            >
              {soloLoading ? "Analyzing…" : `Deep Dive (${quarterLabel(qCurr)})`}
            </button>
          </div>
        </form>

        {/* ── Error ────────────────────────────────────────────────────── */}
        {error && (
          <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}

        {/* ── Solo loading ─────────────────────────────────────────────── */}
        {soloLoading && soloPhase && (
          <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5 flex items-center gap-3">
            <RefreshCw size={16} className="text-brand-500 animate-spin" />
            <span className="text-sm font-medium text-gray-700">{soloPhase}</span>
          </div>
        )}

        {/* ── Solo result ──────────────────────────────────────────────── */}
        {soloResult && !soloLoading && (
          <div className="mt-8 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {(soloResult as { company_ticker?: string }).company_ticker} — {quarterLabel((soloResult as { quarter?: string }).quarter ?? qCurr)} Deep Dive
              </h3>
              <button
                onClick={() => handleSoloAnalyze(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              >
                <RefreshCw size={12} />
                Re-analyse
              </button>
            </div>

            {/* Headline */}
            {(soloResult as { headline?: string }).headline && (
              <div className="rounded-xl border border-brand-100 bg-brand-50/40 px-5 py-4">
                <p className="text-sm font-medium text-brand-900">
                  {(soloResult as { headline?: string }).headline}
                </p>
                <p className="mt-1 text-xs text-brand-600 capitalize">
                  Tone: {(soloResult as { management_tone?: string }).management_tone}
                </p>
              </div>
            )}

            {/* Sections */}
            {((soloResult as { sections?: { title: string; bullets: string[] }[] }).sections ?? []).map((section, idx) => (
              <div key={idx} className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-800">{section.title}</h4>
                </div>
                <ul className="px-4 py-3 space-y-2">
                  {section.bullets.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {/* Actions row */}
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={async () => {
                  try {
                    const q = (soloResult as { quarter?: string }).quarter ?? qCurr;
                    const { url, filename } = await getTranscriptDownloadUrl(ticker, q);
                    const a = document.createElement("a");
                    a.href = url; a.download = filename; a.target = "_blank";
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                  } catch (err) { alert(`Download failed: ${err}`); }
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <FileText size={14} />
                Quantalyze — Download Transcript
              </button>
              <button
                onClick={async () => {
                  const { jsPDF } = await import("jspdf");
                  const sections = (soloResult as { sections?: { title: string; bullets: string[] }[] }).sections ?? [];
                  const headline = (soloResult as { headline?: string }).headline ?? "";
                  const tone = (soloResult as { management_tone?: string }).management_tone ?? "";
                  const company = (soloResult as { company_ticker?: string }).company_ticker ?? ticker;
                  const q = (soloResult as { quarter?: string }).quarter ?? qCurr;

                  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
                  const pageW = pdf.internal.pageSize.getWidth();
                  const pageH = pdf.internal.pageSize.getHeight();
                  const margin = 15;
                  const maxW = pageW - margin * 2;
                  let y = margin;

                  const checkPage = (needed: number) => {
                    if (y + needed > pageH - 20) { pdf.addPage(); y = margin; }
                  };

                  // Header
                  pdf.setFontSize(8);
                  pdf.setTextColor(120);
                  pdf.text("Quantalyze by Demandion | support@demandion.ai", margin, y);
                  y += 8;

                  // Title
                  pdf.setFontSize(16);
                  pdf.setTextColor(30);
                  pdf.text(`${company} — ${quarterLabel(q)} Deep Dive`, margin, y);
                  y += 8;

                  // Headline
                  pdf.setFontSize(10);
                  pdf.setTextColor(60);
                  const headlineLines = pdf.splitTextToSize(headline, maxW);
                  checkPage(headlineLines.length * 5 + 4);
                  pdf.text(headlineLines, margin, y);
                  y += headlineLines.length * 5 + 2;
                  pdf.text(`Management Tone: ${tone}`, margin, y);
                  y += 8;

                  // Sections
                  sections.forEach((s) => {
                    checkPage(12);
                    pdf.setFontSize(12);
                    pdf.setTextColor(30);
                    pdf.text(s.title, margin, y);
                    y += 7;

                    pdf.setFontSize(9);
                    pdf.setTextColor(50);
                    s.bullets.forEach((b) => {
                      const lines = pdf.splitTextToSize(`• ${b}`, maxW - 4);
                      checkPage(lines.length * 4.5 + 2);
                      pdf.text(lines, margin + 2, y);
                      y += lines.length * 4.5 + 1.5;
                    });
                    y += 4;
                  });

                  // Footer
                  checkPage(10);
                  pdf.setFontSize(7);
                  pdf.setTextColor(140);
                  pdf.text("Generated by Quantalyze (quantalyze.demandion.ai) | Contact: support@demandion.ai", margin, pageH - 8);

                  pdf.save(`Quantalyze_${company}_${q}_Deep_Dive.pdf`);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Download size={14} />
                Quantalyze — Download Deep Dive
              </button>
            </div>
          </div>
        )}

        {/* ── Live agent panel ─────────────────────────────────────────── */}
        {loading && agentState && (
          <div className="mt-8">
            <AgentPanel
              state={agentState}
              ticker={ticker}
              qPrev={qPrev}
              qCurr={qCurr}
            />
          </div>
        )}

        {/* ── Final report (delta) ────────────────────────────────────── */}
        {result && !loading && (
          <div className="mt-8 space-y-2">
            <div className="flex justify-end">
              <button
                onClick={(e) => handleAnalyze(e, true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              >
                <RefreshCw size={12} />
                Clear cache &amp; re-analyze
              </button>
            </div>
            <EarningsReport payload={result} />
          </div>
        )}
      </main>
    </>
  );
}
