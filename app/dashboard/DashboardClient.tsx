"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import EarningsReport from "@/components/EarningsReport";
import AgentPanel, {
  makeInitialAgentState,
  type AgentPanelState,
  type AgentStatus,
} from "@/components/AgentPanel";
import { runAnalysisStream } from "@/lib/api";
import { NIFTY50_LIST, quarterLabel, SECTION_NAMES } from "@/lib/nifty50";
import { BarChart2, ChevronDown, RefreshCw } from "lucide-react";
import clsx from "clsx";

const DEFAULT_SECTIONS = [...SECTION_NAMES];

// ── Company autocomplete ──────────────────────────────────────────────────────

function CompanySearch({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { ticker: string; name: string }[];
  value: string;
  onChange: (ticker: string) => void;
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
        <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-400 shadow-lg">
          No matches
        </div>
      )}
    </div>
  );
}

export default function DashboardClient() {
  const searchParams = useSearchParams();
  const tickerParam = searchParams.get("ticker")?.toUpperCase() ?? null;

  // ── Available PDFs ──────────────────────────────────────────────────────────
  const [available, setAvailable] = useState<Record<string, string[]>>({});

  useEffect(() => {
    fetch("/api/v1/available")
      .then((r) => r.json())
      .then((data: Record<string, string[]>) => {
        setAvailable(data);
        // Prefer ticker from URL query param (e.g. after Request upload)
        const preferred = tickerParam && data[tickerParam] ? tickerParam : null;
        const tickers = Object.keys(data);
        const selected = preferred ?? (tickers.length > 0 ? tickers[0] : null);
        if (selected) {
          const quarters = data[selected] ?? [];
          setTicker(selected);
          if (quarters.length >= 2) {
            setQCurr(quarters[0]);
            setQPrev(quarters[1]);
          } else if (quarters.length === 1) {
            setQCurr(quarters[0]);
            setQPrev(quarters[0]);
          }
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredList = useMemo(() => {
    if (Object.keys(available).length === 0) return NIFTY50_LIST;
    const niftyTickers = new Set(NIFTY50_LIST.map((c) => c.ticker));
    const niftyInStorage = NIFTY50_LIST.filter(({ ticker }) => available[ticker]);
    const extras = Object.keys(available)
      .filter((t) => !niftyTickers.has(t))
      .sort()
      .map((t) => ({ ticker: t, bse: 0, nse: t, name: t }));
    return [...niftyInStorage, ...extras];
  }, [available]);

  // ── Picker state ────────────────────────────────────────────────────────────
  const [ticker, setTicker] = useState("BHARTI");
  const [qCurr, setQCurr] = useState("Q3_2026");
  const [qPrev, setQPrev] = useState("Q2_2026");

  const quartersForTicker = available[ticker] ?? [];

  function handleTickerChange(newTicker: string) {
    setTicker(newTicker);
    const quarters = available[newTicker] ?? [];
    if (quarters.length >= 2) {
      setQCurr(quarters[0]);
      setQPrev(quarters[1]);
    }
    setResult(null);
    setError(null);
    setAgentState(null);
  }

  // ── Analysis state ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [agentState, setAgentState] = useState<AgentPanelState | null>(null);

  async function handleAnalyze(e: React.FormEvent, force = false) {
    e.preventDefault();
    if (!ticker || !qPrev || !qCurr || qPrev === qCurr) return;

    setError(null);
    setResult(null);
    setLoading(true);
    setAgentState(null); // will be set on "start" event (cache hits skip this)

    try {
      const res = await runAnalysisStream(
        { ticker, q_prev: qPrev, q_curr: qCurr, ...(force ? { force: true } : {}) },
        (event) => {
          setAgentState((prev) => {
            // "start" always initialises fresh state (prev is null at this point)
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

            // All other events need existing state — skip if panel not yet initialised
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
                // Once both prev+curr are done for a section, start its delta
                const prevDone = next.prevStatus[event.section] === "done";
                const currDone = next.currStatus[event.section] === "done";
                if (prevDone && currDone) {
                  next.deltaStatus[event.section] = "running";
                }
                // Check if ALL thematic agents done → enter delta phase
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

  const selectCls =
    "appearance-none rounded-md border border-gray-300 bg-white px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl px-4 py-10">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <BarChart2 size={18} className="text-brand-500" />
            Earnings Disclosure Analysis
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Compare management language shift quarter-over-quarter for any Nifty 50 company.
          </p>
        </div>

        {/* ── Picker form ──────────────────────────────────────────────── */}
        <form
          data-no-print
          onSubmit={handleAnalyze}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4"
        >
          {/* Company */}
          <div className="flex flex-col gap-1 min-w-[200px] flex-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Company
            </label>
            <CompanySearch
              options={filteredList}
              value={ticker}
              onChange={handleTickerChange}
              disabled={loading}
            />
          </div>

          {/* Previous quarter */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Previous Quarter
            </label>
            <div className="relative">
              <select
                value={qPrev}
                onChange={(e) => setQPrev(e.target.value)}
                className={selectCls}
                disabled={loading}
              >
                {quartersForTicker.map((q) => (
                  <option key={q} value={q}>
                    {quarterLabel(q)}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
            </div>
          </div>

          <span className="pb-2 text-gray-400 text-sm">→</span>

          {/* Current quarter */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Current Quarter
            </label>
            <div className="relative">
              <select
                value={qCurr}
                onChange={(e) => setQCurr(e.target.value)}
                className={selectCls}
                disabled={loading}
              >
                {quartersForTicker.map((q) => (
                  <option key={q} value={q}>
                    {quarterLabel(q)}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || qPrev === qCurr}
            className="rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </form>

        {/* ── Error ────────────────────────────────────────────────────── */}
        {error && (
          <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
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

        {/* ── Final report ─────────────────────────────────────────────── */}
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
