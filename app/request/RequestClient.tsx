"use client";

import { useState } from "react";
import Nav from "@/components/Nav";
import { createClient } from "@/lib/supabase/client";
import { Inbox, CheckCircle, XCircle, Loader2 } from "lucide-react";

type Status = "idle" | "loading" | "success" | "not_found" | "error";

export default function RequestClient() {
  const [ticker, setTicker] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [submittedTicker, setSubmittedTicker] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const tick = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!tick) return;

    setStatus("loading");
    setSubmittedTicker(tick);
    setUploaded([]);
    setSkipped([]);
    setErrorMsg("");

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const resp = await fetch("/api/v1/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ticker: tick }),
      });

      const json = await resp.json();

      if (!resp.ok) {
        setErrorMsg(json.detail ?? "Request failed");
        setStatus("error");
        return;
      }

      if (!json.ok) {
        if (json.reason === "no_transcripts" || json.reason === "not_found") {
          setStatus("not_found");
        } else {
          setErrorMsg(json.reason ?? "Could not fetch transcripts");
          setStatus("error");
        }
        return;
      }

      setUploaded(json.uploaded ?? []);
      setSkipped(json.skipped ?? []);
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unexpected error");
      setStatus("error");
    }
  }

  function reset() {
    setStatus("idle");
    setTicker("");
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-xl px-4 py-10">
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Inbox size={18} className="text-brand-500" />
            Request Transcript
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Enter a company ticker to fetch the last 4 quarters of earnings call transcripts.
            Once added, the company will appear in your Dashboard search.
          </p>
        </div>

        {status === "idle" || status === "loading" ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Ticker Symbol
              </label>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder="e.g. ZOMATO"
                maxLength={12}
                required
                disabled={status === "loading"}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={status === "loading" || !ticker.trim()}
              className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {status === "loading" ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Fetching transcripts…
                </>
              ) : (
                "Fetch Transcripts"
              )}
            </button>
          </form>
        ) : status === "success" ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-5 space-y-3">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle size={18} />
              <span className="font-semibold">
                {uploaded.length > 0
                  ? `${uploaded.length} transcript${uploaded.length > 1 ? "s" : ""} added for ${submittedTicker}`
                  : `${submittedTicker} is already up to date`}
              </span>
            </div>
            {uploaded.length > 0 && (
              <ul className="space-y-1">
                {uploaded.map((f) => (
                  <li key={f} className="text-sm text-emerald-700 font-mono">
                    {f}
                  </li>
                ))}
              </ul>
            )}
            {skipped.length > 0 && (
              <p className="text-xs text-emerald-600">
                {skipped.length} quarter{skipped.length > 1 ? "s" : ""} already in system — skipped.
              </p>
            )}
            <p className="text-sm text-emerald-700 pt-1">
              <a
                href={`/dashboard?ticker=${submittedTicker}`}
                className="font-semibold underline"
              >
                Go to Dashboard
              </a>{" "}
              to run the analysis.
            </p>
            <button onClick={reset} className="text-xs text-emerald-600 hover:underline">
              Request another
            </button>
          </div>
        ) : status === "not_found" ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-5 space-y-3">
            <div className="flex items-center gap-2 text-amber-700">
              <XCircle size={18} />
              <span className="font-semibold">No transcripts found for {submittedTicker}</span>
            </div>
            <p className="text-sm text-amber-700">
              We couldn&apos;t find any publicly available earnings call transcripts for this company.
              Drop us an email and we&apos;ll source it manually.
            </p>
            <a
              href={`mailto:team@notiondemand.com?subject=Transcript request: ${submittedTicker}&body=Please add earnings transcripts for ${submittedTicker}.`}
              className="inline-block rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
            >
              Email team@notiondemand.com
            </a>
            <div>
              <button onClick={reset} className="text-xs text-amber-600 hover:underline">
                Try another ticker
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-5 space-y-3">
            <div className="flex items-center gap-2 text-red-700">
              <XCircle size={18} />
              <span className="font-semibold">Something went wrong</span>
            </div>
            <p className="text-sm text-red-700">{errorMsg || "We couldn't complete the request."}</p>
            <a
              href={`mailto:team@notiondemand.com?subject=Transcript request: ${submittedTicker}&body=Please add earnings transcripts for ${submittedTicker}.`}
              className="inline-block rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Email team@notiondemand.com
            </a>
            <div>
              <button onClick={reset} className="text-xs text-red-600 hover:underline">
                Try again
              </button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
