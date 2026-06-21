"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import { runInsightsStream } from "@/lib/api";
import { NIFTY200 } from "@/lib/nifty200";
import { quarterLabel } from "@/lib/nifty50";
import type {
  InsightsPayload,
  QuarterBrief,
  RecurringTheme,
  GuidanceTrack,
} from "@/lib/insights-pipeline";
import {
  Layers,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Target,
  Globe,
  Users,
  Package,
  Bookmark,
  BookmarkCheck,
  X,
  Upload,
  RefreshCw,
} from "lucide-react";
import clsx from "clsx";

// ── Watchlist (shared with Dashboard via same localStorage key) ───────────────

const WATCHLIST_KEY = "quantalyze_watchlist";
const MAX_WATCHLIST = 20;
const DEFAULT_WATCHLIST_TICKERS = [
  "RELIANCE", "HDFC", "ICICI", "INFOSYS", "TCS",
  "KOTAKBANK", "AXISBANK", "SBI", "BHARTI", "ITC",
];

function useInsightsWatchlist() {
  const [watchlist, setWatchlist] = useState<{ ticker: string; name: string }[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      if (raw) {
        setWatchlist(JSON.parse(raw));
      } else {
        // Seed with top-10 popular stocks
        const defaults = DEFAULT_WATCHLIST_TICKERS.map((t) => ({ ticker: t, name: t }));
        setWatchlist(defaults);
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(defaults));
      }
    } catch { /* ignore */ }
  }, []);

  const toggle = useCallback((ticker: string) => {
    setWatchlist((prev) => {
      const exists = prev.find((w) => w.ticker === ticker);
      let next: { ticker: string; name: string }[];
      if (exists) {
        next = prev.filter((w) => w.ticker !== ticker);
      } else {
        if (prev.length >= MAX_WATCHLIST) return prev; // cap at 20
        next = [...prev, { ticker, name: ticker }];
      }
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  /** Add multiple tickers at once — skips duplicates, respects max 20. Returns count added. */
  const bulkAdd = useCallback((tickers: string[]): number => {
    let added = 0;
    setWatchlist((prev) => {
      const existing = new Set(prev.map((w) => w.ticker));
      const remaining = MAX_WATCHLIST - prev.length;
      const toAdd = tickers.filter((t) => !existing.has(t)).slice(0, remaining);
      added = toAdd.length;
      if (added === 0) return prev;
      const next = [...prev, ...toAdd.map((t) => ({ ticker: t, name: t }))];
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      return next;
    });
    return added;
  }, []);

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

  const isWatched = useCallback((ticker: string) => watchlist.some((w) => w.ticker === ticker), [watchlist]);

  return { watchlist, toggle, bulkAdd, cycleNext, cyclePrev, isWatched };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  consistent:      "bg-emerald-50 text-emerald-700 border-emerald-200",
  improving:       "bg-emerald-50 text-emerald-700 border-emerald-200",
  declining:       "bg-red-50 text-red-700 border-red-200",
  dropped:         "bg-gray-100 text-gray-500 border-gray-200",
  newly_emerging:  "bg-blue-50 text-blue-700 border-blue-200",
} as const;

const CONSISTENCY_STYLES = {
  consistent:  "text-emerald-600",
  upgraded:    "text-emerald-600",
  downgraded:  "text-amber-600",
  abandoned:   "text-red-600",
  unclear:     "text-gray-400",
} as const;

const CONSISTENCY_ICONS = {
  consistent: CheckCircle2,
  upgraded:   TrendingUp,
  downgraded: TrendingDown,
  abandoned:  XCircle,
  unclear:    Minus,
} as const;

/** Numeric sort key: Q3_2026 → 20263, Q4_2025 → 20254 (year dominates) */
function qKey(q: string): number {
  const m = q.match(/^Q(\d)_(\d{4})$/);
  return m ? parseInt(m[2]) * 10 + parseInt(m[1]) : 0;
}

function SignalDot({ signal }: { signal: string }) {
  return (
    <span className={clsx(
      "inline-block h-2 w-2 rounded-full shrink-0",
      signal === "Positive" ? "bg-emerald-500"
      : signal === "Negative" ? "bg-red-500"
      : "bg-gray-400"
    )} />
  );
}

// ── Financials table ──────────────────────────────────────────────────────────


// ── Recurring themes ──────────────────────────────────────────────────────────

function RecurringThemeCard({ theme }: { theme: RecurringTheme }) {
  const [open, setOpen] = useState(true);
  const style = STATUS_STYLES[theme.status] ?? STATUS_STYLES.consistent;
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left"
      >
        <SignalDot signal={theme.signal} />
        <span className="flex-1 text-sm font-semibold text-gray-900">{theme.theme}</span>
        <span className={clsx("rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize", style)}>
          {theme.status.replace("_", " ")}
        </span>
        <span className="text-[11px] text-gray-400">{theme.appears_in.length}Q</span>
        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
      </button>
      {open && (
        <div className="px-4 py-3 bg-white space-y-2">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {theme.appears_in.map((q) => (
              <span key={q} className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-mono text-gray-500">
                {quarterLabel(q)}
              </span>
            ))}
          </div>
          <ul className="space-y-1.5">
            {theme.evolution.split(/(?<=[.!?])\s+/).filter(Boolean).map((sentence, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
                {sentence}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Guidance tracker ──────────────────────────────────────────────────────────

function GuidanceTrackCard({ track }: { track: GuidanceTrack }) {
  const [open, setOpen] = useState(false);
  const Icon = CONSISTENCY_ICONS[track.consistency] ?? Minus;
  const color = CONSISTENCY_STYLES[track.consistency] ?? "text-gray-400";
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left"
      >
        <Icon size={14} className={clsx("shrink-0", color)} />
        <span className="flex-1 text-sm font-semibold text-gray-900">{track.topic}</span>
        <span className={clsx("text-xs font-medium capitalize", color)}>
          {track.consistency}
        </span>
        <span className="text-[11px] text-gray-400 ml-2">{quarterLabel(track.initial_quarter)}</span>
        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
      </button>
      {open && (
        <div className="px-4 py-3 bg-white space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
              Initially stated ({quarterLabel(track.initial_quarter)})
            </p>
            <p className="text-sm text-gray-700 italic leading-relaxed">&ldquo;{track.initial_statement}&rdquo;</p>
          </div>
          {track.subsequent_updates && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                Subsequent updates
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">{track.subsequent_updates}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── New business signals ──────────────────────────────────────────────────────

const SIGNAL_TYPE_ICONS: Record<string, typeof Globe> = {
  geography: Globe,
  customer: Users,
  product: Package,
  technology: Target,
  partnership: Users,
};

// ── Segments table ────────────────────────────────────────────────────────────

function SegmentsTable({ briefs }: { briefs: QuarterBrief[] }) {
  const sorted = [...briefs].sort((a, b) => qKey(a.quarter) - qKey(b.quarter)); // oldest → newest
  // Collect all unique segment names
  const allSegments = Array.from(new Set(sorted.flatMap((b) => b.segment_highlights.map((s) => s.segment))));
  if (allSegments.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400 w-36">Segment</th>
            {sorted.map((b) => (
              <th key={b.quarter} className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {quarterLabel(b.quarter)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {allSegments.map((seg) => (
            <tr key={seg} className="hover:bg-gray-50/50">
              <td className="px-4 py-3 font-medium text-gray-700 text-xs">{seg}</td>
              {sorted.map((b) => {
                const sh = b.segment_highlights.find((s) => s.segment === seg);
                return (
                  <td key={b.quarter} className="px-4 py-3 text-xs text-gray-600 align-top max-w-[160px]">
                    {sh ? (
                      <div className="space-y-1">
                        <span className={clsx(
                          "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium capitalize",
                          sh.direction === "growing" || sh.direction === "new" ? "bg-emerald-50 text-emerald-700"
                          : sh.direction === "declining" ? "bg-red-50 text-red-700"
                          : "bg-gray-100 text-gray-500"
                        )}>
                          {sh.direction}
                        </span>
                        <p className="leading-relaxed text-gray-600">{sh.description}</p>
                      </div>
                    ) : <span className="text-gray-200">—</span>}
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

// ── Quarter pointers panel (per-category, grouped by quarter) ────────────────

function QuarterPointersPanel({ briefs, field }: { briefs: QuarterBrief[]; field: keyof QuarterBrief }) {
  const sorted = [...briefs].sort((a, b) => qKey(b.quarter) - qKey(a.quarter));
  const hasAny = sorted.some((b) => ((b[field] as string[]) ?? []).length > 0);
  if (!hasAny) return <p className="text-sm text-gray-400">No data available for this category.</p>;

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
      {sorted.filter((b) => ((b[field] as string[]) ?? []).length > 0).map((b) => (
        <div key={b.quarter} className="px-4 py-3">
          <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 mb-2">
            {quarterLabel(b.quarter)}
          </span>
          <ul className="space-y-1.5">
            {((b[field] as string[]) ?? []).map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── Key points timeline ───────────────────────────────────────────────────────

function KeyPointsTimeline({ briefs }: { briefs: QuarterBrief[] }) {
  const sorted = [...briefs].sort((a, b) => qKey(b.quarter) - qKey(a.quarter)); // newest first
  return (
    <div className="space-y-4">
      {sorted.map((b) => (
        <div key={b.quarter} className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700">{quarterLabel(b.quarter)}</span>
            <span className={clsx(
              "text-[11px] font-medium capitalize",
              b.management_tone === "optimistic" ? "text-emerald-600"
              : b.management_tone === "cautious" || b.management_tone === "defensive" ? "text-amber-600"
              : "text-gray-400"
            )}>
              {b.management_tone}
            </span>
          </div>
          <ul className="px-4 py-3 space-y-1.5">
            {b.key_points.map((pt, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-brand-400 shrink-0" />
                {pt}
              </li>
            ))}
            {b.new_developments.length > 0 && (
              <li className="pt-2 space-y-1">
                {b.new_developments.map((d, i) => {
                  const Icon = SIGNAL_TYPE_ICONS[d.type] ?? Package;
                  return (
                    <div key={i} className="flex items-start gap-2 rounded-md bg-blue-50 px-2.5 py-1.5">
                      <Icon size={12} className="mt-0.5 shrink-0 text-blue-500" />
                      <p className="text-xs text-blue-800">
                        <span className="font-semibold capitalize">{d.type}:</span> {d.description}
                      </p>
                    </div>
                  );
                })}
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── Progress panel ────────────────────────────────────────────────────────────

function ProgressPanel({
  quarters,
  doneQuarters,
  synthesizing,
}: {
  quarters: string[];
  doneQuarters: Set<string>;
  synthesizing: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Loader2 size={16} className="text-brand-500 animate-spin" />
        <span className="text-sm font-semibold text-gray-800">
          {synthesizing ? "Synthesizing across quarters…" : "Downloading & analysing transcripts…"}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {quarters.map((q) => {
          const done = doneQuarters.has(q);
          return (
            <div
              key={q}
              className={clsx(
                "rounded-lg border px-3 py-2 text-xs font-medium text-center transition-all",
                done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-gray-200 bg-gray-50 text-gray-400"
              )}
            >
              {done ? "✓ " : ""}{quarterLabel(q)}
            </div>
          );
        })}
      </div>
      {synthesizing && (
        <p className="text-xs text-gray-400">
          Running cross-quarter synthesis, guidance tracker, and theme detection…
        </p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InsightsClient() {
  const searchParams = useSearchParams();
  const paramTicker = searchParams.get("ticker")?.toUpperCase() ?? "";

  const [ticker, setTicker] = useState(paramTicker || "RELIANCE");
  const [inputTicker, setInputTicker] = useState(paramTicker || "RELIANCE");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<InsightsPayload | null>(null);

  // Progress state
  const [quarters, setQuarters] = useState<string[]>([]);
  const [doneQuarters, setDoneQuarters] = useState<Set<string>>(new Set());
  const [synthesizing, setSynthesizing] = useState(false);

  // Active tab
  const [tab, setTab] = useState<"financials" | "growth" | "margins" | "capex" | "customers" | "segments" | "products" | "themes" | "guidance">("financials");

  // Watchlist
  const { watchlist, toggle: toggleWatchlist, bulkAdd, cycleNext, cyclePrev, isWatched } = useInsightsWatchlist();
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);

  // Keyboard cycling (← → when not in an input)
  const cycleRef = useRef({ cycleNext, cyclePrev, inputTicker: paramTicker || "RELIANCE" });
  useEffect(() => {
    cycleRef.current.cycleNext = cycleNext;
    cycleRef.current.cyclePrev = cyclePrev;
    cycleRef.current.inputTicker = inputTicker;
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") {
        const next = cycleRef.current.cycleNext(cycleRef.current.inputTicker);
        if (next) { setInputTicker(next); setTicker(next); }
      } else if (e.key === "ArrowLeft") {
        const prev = cycleRef.current.cyclePrev(cycleRef.current.inputTicker);
        if (prev) { setInputTicker(prev); setTicker(prev); }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      // Split into tokens on any whitespace, comma, semicolon, pipe, newline, tab
      const tokens = text.split(/[\s,;|\t\r\n]+/);
      // Keep tokens that look like NSE tickers: 1–12 uppercase alphanumeric chars
      const tickers = Array.from(
        new Set(
          tokens
            .map((t) => t.replace(/[^A-Za-z0-9&]/g, "").toUpperCase())
            .filter((t) => t.length >= 2 && t.length <= 12 && /^[A-Z]/.test(t))
        )
      );
      const added = bulkAdd(tickers);
      setCsvMsg(`Added ${added} ticker${added !== 1 ? "s" : ""} from ${file.name}`);
      setTimeout(() => setCsvMsg(null), 4000);
    };
    reader.readAsText(file);
    // Reset so the same file can be re-uploaded if needed
    e.target.value = "";
  }

  async function run(t: string, force = false) {
    if (!t.trim()) return;
    setLoading(true);
    setError(null);
    setPayload(null);
    setQuarters([]);
    setDoneQuarters(new Set());
    setSynthesizing(false);

    try {
      const result = await runInsightsStream(
        t.trim().toUpperCase(),
        (event) => {
          if (event.type === "start") {
            setQuarters(event.quarters);
          } else if (event.type === "quarter_done") {
            setDoneQuarters((prev) => { const s = new Set(prev); s.add(event.quarter); return s; });
          } else if (event.type === "synthesis_start") {
            setSynthesizing(true);
          }
        },
        { force }
      );
      setPayload(result as unknown as InsightsPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  // Auto-run if ticker is in URL
  useEffect(() => {
    if (paramTicker) run(paramTicker);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const TABS = [
    { key: "financials", label: "Financials" },
    { key: "growth",     label: "Growth Outlook" },
    { key: "margins",    label: "Margins & Costs" },
    { key: "capex",      label: "Capex & Capacity" },
    { key: "customers",  label: "Customers & Market" },
    { key: "segments",   label: "Segments" },
    { key: "products",   label: "Product Updates" },
    { key: "themes",     label: `Themes${payload ? ` (${payload.recurring_themes.length})` : ""}` },
    { key: "guidance",   label: `Guidance${payload ? ` (${payload.guidance_tracks.length})` : ""}` },
  ] as const;

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl px-4 py-10">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Layers size={18} className="text-brand-500" />
            Multi-Quarter Insights
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Cross-quarter synthesis — recurring themes, guidance tracking, segment evolution, and new business signals. Covers all <span className="font-medium text-gray-700">Nifty 200</span> companies.
          </p>
          <p className="mt-1.5 text-xs text-gray-400 flex items-center gap-1.5">
            <span className="inline-block h-1 w-1 rounded-full bg-gray-300" />
            Stock not in Nifty 200?{" "}
            <a href="/request" className="text-brand-500 hover:text-brand-600 font-medium underline underline-offset-2 transition-colors">
              Request transcripts
            </a>{" "}
            to add it.
          </p>
        </div>

        {/* Watchlist row: chips + cycle + Upload CSV */}
        <div className="mb-3 flex flex-wrap items-center gap-2 min-h-[28px]">
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
                onClick={() => {
                  const t = cyclePrev(inputTicker);
                  if (t) { setInputTicker(t); setTicker(t); }
                }}
                className="inline-flex items-center justify-center h-6 w-6 rounded border border-gray-200 bg-white text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-colors"
              >
                <ChevronLeft size={12} />
              </button>
              <button
                type="button"
                title="Next stock (→)"
                onClick={() => {
                  const t = cycleNext(inputTicker);
                  if (t) { setInputTicker(t); setTicker(t); }
                }}
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
              onClick={() => { setInputTicker(w.ticker); setTicker(w.ticker); }}
              className={clsx(
                "group inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                inputTicker === w.ticker
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
            accept=".csv,.txt,.xlsx"
            className="hidden"
            onChange={handleCsvUpload}
          />
          <button
            type="button"
            onClick={() => csvInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs font-medium text-gray-400 hover:border-brand-400 hover:text-brand-600 transition-colors"
            title={`Upload a CSV of tickers to bulk-add (max ${MAX_WATCHLIST})`}
          >
            <Upload size={11} />
            CSV
          </button>

          {/* Success toast */}
          {csvMsg && (
            <span className="text-[11px] text-emerald-600 font-medium">{csvMsg}</span>
          )}
        </div>

        {/* Search bar */}
        <form
          onSubmit={(e) => { e.preventDefault(); setTicker(inputTicker); run(inputTicker); }}
          className="flex flex-wrap items-center gap-2 mb-8"
        >
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inputTicker}
                onChange={(e) => setInputTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder="Ticker (e.g. RELIANCE)"
                maxLength={12}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 w-44"
              />
              <button
                type="submit"
                disabled={loading || !inputTicker.trim()}
                className="rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {loading ? "Analysing…" : "Analyse"}
              </button>
              {inputTicker && (
                <button
                  type="button"
                  onClick={() => toggleWatchlist(inputTicker)}
                  title={isWatched(inputTicker) ? "Remove from watchlist" : "Add to watchlist"}
                  className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-500 hover:text-brand-600 hover:border-brand-300"
                >
                  {isWatched(inputTicker)
                    ? <BookmarkCheck size={14} className="text-brand-500" />
                    : <Bookmark size={14} />}
                </button>
              )}
            </div>
            {/* Company name display */}
            {inputTicker && (NIFTY200[inputTicker]?.name
              ? <p className="text-xs text-gray-500 pl-0.5 mt-0.5">{NIFTY200[inputTicker].name}</p>
              : <p className="text-xs text-gray-400 pl-0.5 mt-0.5">Outside Nifty 200 — <a href="/request" className="text-brand-500 hover:underline">request transcripts</a></p>
            )}
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700 mb-6">
            {error}
          </div>
        )}

        {/* Progress */}
        {loading && quarters.length > 0 && (
          <div className="mb-6">
            <ProgressPanel quarters={quarters} doneQuarters={doneQuarters} synthesizing={synthesizing} />
          </div>
        )}

        {/* Results */}
        {payload && (
          <div className="space-y-6">
            {/* Re-analyse toolbar */}
            <div className="flex justify-end">
              <button
                type="button"
                disabled={loading}
                onClick={() => run(ticker, true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-40"
              >
                <RefreshCw size={12} />
                Clear cache &amp; re-analyse
              </button>
            </div>

            {/* Hero bar */}
            <div className="rounded-xl border border-gray-200 bg-white px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{payload.ticker}</h3>
                <p className="text-sm text-gray-400">
                  {payload.quarters_analyzed.length} quarters analysed ·{" "}
                  {payload.quarters_analyzed.map((q) => quarterLabel(q)).join(", ")}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Mgmt Credibility</p>
                  <p className={clsx(
                    "text-2xl font-semibold mt-0.5",
                    payload.management_credibility_score >= 7 ? "text-emerald-600"
                    : payload.management_credibility_score >= 4 ? "text-amber-600"
                    : "text-red-600"
                  )}>
                    {payload.management_credibility_score.toFixed(1)}
                    <span className="text-sm text-gray-400">/10</span>
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Themes</p>
                  <p className="text-2xl font-semibold text-gray-900 mt-0.5">{payload.recurring_themes.length}</p>
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Guidance Tracks</p>
                  <p className="text-2xl font-semibold text-gray-900 mt-0.5">{payload.guidance_tracks.length}</p>
                </div>
              </div>
            </div>

            {/* Segment narrative */}
            {payload.segment_narrative && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/40 px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-400 mb-1">Segment Narrative</p>
                <p className="text-sm text-blue-900 leading-relaxed">{payload.segment_narrative}</p>
              </div>
            )}

            {/* Key watchpoints */}
            {payload.key_watchpoints.length > 0 && (
              <div className="rounded-xl border border-amber-100 bg-amber-50/40 px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-500 mb-2">Watch Next Quarter</p>
                <ul className="space-y-1.5">
                  {payload.key_watchpoints.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-amber-900">
                      <AlertCircle size={13} className="mt-0.5 shrink-0 text-amber-500" />
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Tabs */}
            <div className="border-b border-gray-200 flex gap-0 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={clsx(
                    "px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                    tab === t.key
                      ? "border-brand-500 text-brand-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="space-y-4">
              {/* FINANCIALS */}
              {tab === "financials" && (
                <QuarterPointersPanel briefs={payload.quarter_briefs} field="financials" />
              )}

              {/* GROWTH OUTLOOK */}
              {tab === "growth" && (
                <QuarterPointersPanel briefs={payload.quarter_briefs} field="growth_outlook" />
              )}

              {/* MARGINS & COSTS */}
              {tab === "margins" && (
                <QuarterPointersPanel briefs={payload.quarter_briefs} field="margins_and_costs" />
              )}

              {/* CAPEX & CAPACITY */}
              {tab === "capex" && (
                <QuarterPointersPanel briefs={payload.quarter_briefs} field="capex_and_capacity" />
              )}

              {/* CUSTOMERS & MARKET */}
              {tab === "customers" && (
                <QuarterPointersPanel briefs={payload.quarter_briefs} field="customer_and_market" />
              )}

              {/* SEGMENTS */}
              {tab === "segments" && (
                <SegmentsTable briefs={payload.quarter_briefs} />
              )}

              {/* PRODUCT UPDATES / NEW LAUNCHES */}
              {tab === "products" && (
                <div className="space-y-3">
                  {[...payload.quarter_briefs]
                    .sort((a, b) => qKey(b.quarter) - qKey(a.quarter))
                    .filter((b) => b.new_developments.length > 0)
                    .map((b) => (
                      <div key={b.quarter} className="rounded-xl border border-gray-200 overflow-hidden">
                        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                          <span className="text-xs font-semibold text-gray-700">{quarterLabel(b.quarter)}</span>
                        </div>
                        <ul className="px-4 py-3 space-y-2">
                          {b.new_developments.map((d, i) => {
                            const Icon = SIGNAL_TYPE_ICONS[d.type] ?? Package;
                            return (
                              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                                <Icon size={14} className="mt-0.5 shrink-0 text-brand-500" />
                                <span><span className="font-medium capitalize text-gray-900">{d.type}:</span> {d.description}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  {payload.quarter_briefs.every((b) => b.new_developments.length === 0) && (
                    <p className="text-sm text-gray-400">No product updates or new launches found across quarters.</p>
                  )}
                </div>
              )}

              {/* THEMES */}
              {tab === "themes" && (
                <div className="space-y-3">
                  {payload.recurring_themes.length === 0 ? (
                    <p className="text-sm text-gray-400">No recurring themes detected.</p>
                  ) : (
                    payload.recurring_themes.map((t, i) => (
                      <RecurringThemeCard key={i} theme={t} />
                    ))
                  )}
                </div>
              )}

              {/* GUIDANCE */}
              {tab === "guidance" && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 grid grid-cols-2 md:grid-cols-5 gap-4">
                    {(["consistent", "upgraded", "downgraded", "abandoned", "unclear"] as const).map((c) => {
                      const count = payload.guidance_tracks.filter((t) => t.consistency === c).length;
                      const Icon = CONSISTENCY_ICONS[c];
                      const color = CONSISTENCY_STYLES[c];
                      return (
                        <div key={c} className="text-center">
                          <Icon size={16} className={clsx("mx-auto mb-1", color)} />
                          <p className={clsx("text-xl font-semibold", color)}>{count}</p>
                          <p className="text-[11px] text-gray-400 capitalize">{c}</p>
                        </div>
                      );
                    })}
                  </div>
                  {payload.guidance_tracks.length === 0 ? (
                    <p className="text-sm text-gray-400">No guidance tracks found.</p>
                  ) : (
                    payload.guidance_tracks.map((t, i) => (
                      <GuidanceTrackCard key={i} track={t} />
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
