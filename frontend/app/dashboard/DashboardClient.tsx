"use client";

import { useState } from "react";
import Nav from "@/components/Nav";
import EarningsReport from "@/components/EarningsReport";
import { runAnalysis } from "@/lib/api";
import { Search } from "lucide-react";

export default function DashboardClient() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await runAnalysis(query);
      setResult(res.payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h2 className="mb-6 text-xl font-semibold">Earnings Analysis</h2>

        <form onSubmit={handleAnalyze} className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Analyze Bharti Airtel Q3 FY25 earnings"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Search size={14} />
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </form>

        {error && (
          <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {result && (
          <div className="mt-6">
            <EarningsReport payload={result} />
          </div>
        )}
      </main>
    </>
  );
}
