"use client";

import { useState } from "react";
import Nav from "@/components/Nav";
import EarningsReport from "@/components/EarningsReport";
import { runAnalysis } from "@/lib/api";
import { NIFTY50_LIST, QUARTERS, quarterLabel } from "@/lib/nifty50";
import { BarChart2, ChevronDown } from "lucide-react";

export default function DashboardClient() {
  const [ticker, setTicker] = useState("BHARTI");
  const [qCurr, setQCurr] = useState("Q3_2026");
  const [qPrev, setQPrev] = useState("Q2_2026");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker || !qPrev || !qCurr) return;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await runAnalysis({ ticker, q_prev: qPrev, q_curr: qCurr });
      setResult(res.payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
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
          onSubmit={handleAnalyze}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4"
        >
          {/* Company */}
          <div className="flex flex-col gap-1 min-w-[200px] flex-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Company
            </label>
            <div className="relative">
              <select
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                className={selectCls + " w-full"}
              >
                {NIFTY50_LIST.map(({ ticker: t, name }) => (
                  <option key={t} value={t}>
                    {name} ({t})
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
            </div>
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
              >
                {QUARTERS.map((q) => (
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
              >
                {QUARTERS.map((q) => (
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

        {error && (
          <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {loading && (
          <div className="mt-8 text-center text-sm text-gray-400">
            Running multi-agent analysis — this takes ~30–60 s…
          </div>
        )}

        {result && !loading && (
          <div className="mt-8">
            <EarningsReport payload={result} />
          </div>
        )}
      </main>
    </>
  );
}
