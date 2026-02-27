"use client";

import { useState } from "react";
import { Mail, ChevronDown, ChevronRight, AlertTriangle, CheckCircle } from "lucide-react";
import { sendEmail } from "@/lib/api";
import { quarterLabel } from "@/lib/nifty50";
import clsx from "clsx";

// ── Types (mirrors DashboardPayload from models.py) ────────────────────────

interface MetricDelta {
  subtopic: string;
  quote_old: string;
  quote_new: string;
  language_shift: string;
  signal_classification: "Positive" | "Negative" | "Noise";
  signal_score: number;
  validation_status: "verified" | "flagged" | "removed";
  validation_note: string;
}

interface SectionalInsight {
  section_name: string;
  key_takeaways: string[];
  metrics: MetricDelta[];
}

interface DashboardPayload {
  company_ticker: string;
  quarter: string;
  quarter_previous: string;
  executive_evasiveness_score: number;
  insights: SectionalInsight[];
  overall_score: number;
  overall_signal: "Positive" | "Negative" | "Mixed" | "Noise";
  summary: string;
  validation_score: number;
  flagged_count: number;
  market_alignment_pct: number;
  stock_price_change: number;
  market_sources: string[];
}

// ── Small helpers ──────────────────────────────────────────────────────────

const SIGNAL_STYLES = {
  Positive: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Negative: "bg-red-100 text-red-700 border-red-200",
  Mixed:    "bg-amber-100 text-amber-700 border-amber-200",
  Noise:    "bg-gray-100 text-gray-500 border-gray-200",
} as const;

const SIGNAL_DOT = {
  Positive: "bg-emerald-500",
  Negative: "bg-red-500",
  Mixed:    "bg-amber-500",
  Noise:    "bg-gray-400",
} as const;

function SignalBadge({
  signal,
  score,
}: {
  signal: keyof typeof SIGNAL_STYLES;
  score?: number;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        SIGNAL_STYLES[signal]
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", SIGNAL_DOT[signal])} />
      {signal}
      {score !== undefined && (
        <span className="font-mono opacity-70">
          {score > 0 ? "+" : ""}{score.toFixed(1)}
        </span>
      )}
    </span>
  );
}

// ── MetricDelta card ───────────────────────────────────────────────────────

function MetricCard({
  metric,
  qPrev,
  qCurr,
}: {
  metric: MetricDelta;
  qPrev: string;
  qCurr: string;
}) {
  const [expanded, setExpanded] = useState(true);
  if (metric.validation_status === "removed") return null;

  return (
    <div
      className={clsx(
        "rounded-lg border bg-white overflow-hidden",
        metric.validation_status === "flagged"
          ? "border-amber-200"
          : "border-gray-200"
      )}
    >
      {/* Card header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <SignalBadge
            signal={metric.signal_classification}
            score={metric.signal_score}
          />
          <span className="font-medium text-sm text-gray-900 truncate">
            {metric.subtopic}
          </span>
          {metric.validation_status === "flagged" && (
            <AlertTriangle size={13} className="text-amber-500 shrink-0" />
          )}
        </div>
        {expanded ? (
          <ChevronDown size={15} className="text-gray-400 shrink-0" />
        ) : (
          <ChevronRight size={15} className="text-gray-400 shrink-0" />
        )}
      </button>

      {/* Card body — quotes + shift */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3">
          {/* Quote comparison */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                {quarterLabel(qPrev)}
              </p>
              <blockquote className="rounded-md bg-gray-50 border-l-2 border-gray-300 px-3 py-2 text-xs text-gray-600 italic leading-relaxed">
                &ldquo;{metric.quote_old}&rdquo;
              </blockquote>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                {quarterLabel(qCurr)}
              </p>
              <blockquote
                className={clsx(
                  "rounded-md border-l-2 px-3 py-2 text-xs italic leading-relaxed",
                  metric.signal_classification === "Positive"
                    ? "bg-emerald-50 border-emerald-400 text-emerald-800"
                    : metric.signal_classification === "Negative"
                    ? "bg-red-50 border-red-400 text-red-800"
                    : "bg-gray-50 border-gray-300 text-gray-600"
                )}
              >
                &ldquo;{metric.quote_new}&rdquo;
              </blockquote>
            </div>
          </div>

          {/* Language shift */}
          <div className="flex items-start gap-2 rounded-md bg-blue-50 px-3 py-2">
            <span className="mt-0.5 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-blue-400">
              Shift
            </span>
            <p className="text-xs text-blue-700 leading-relaxed">
              {metric.language_shift}
            </p>
          </div>

          {/* Validation note if flagged */}
          {metric.validation_status === "flagged" && metric.validation_note && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />
              <p className="text-xs text-amber-700">{metric.validation_note}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section (one thematic agent's output) ─────────────────────────────────

function Section({
  insight,
  qPrev,
  qCurr,
}: {
  insight: SectionalInsight;
  qPrev: string;
  qCurr: string;
}) {
  const [open, setOpen] = useState(true);
  const visibleMetrics = insight.metrics.filter(
    (m) => m.validation_status !== "removed"
  );
  const sectionSignal = (() => {
    if (!visibleMetrics.length) return "Noise" as const;
    const avg =
      visibleMetrics.reduce((s, m) => s + m.signal_score, 0) /
      visibleMetrics.length;
    if (avg > 0.5) return "Positive" as const;
    if (avg < -0.5) return "Negative" as const;
    return "Noise" as const;
  })();

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      {/* Section header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <SignalBadge signal={sectionSignal} />
          <span className="font-semibold text-sm text-gray-900">
            {insight.section_name}
          </span>
          <span className="text-xs text-gray-400">
            {visibleMetrics.length} signal{visibleMetrics.length !== 1 ? "s" : ""}
          </span>
        </div>
        {open ? (
          <ChevronDown size={16} className="text-gray-400" />
        ) : (
          <ChevronRight size={16} className="text-gray-400" />
        )}
      </button>

      {open && (
        <div className="px-5 py-4 space-y-3 bg-white">
          {/* Key takeaways */}
          {insight.key_takeaways.length > 0 && (
            <ul className="space-y-1 mb-4">
              {insight.key_takeaways.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-brand-500 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          )}

          {/* Metric cards */}
          <div className="space-y-2">
            {visibleMetrics.map((m, i) => (
              <MetricCard key={i} metric={m} qPrev={qPrev} qCurr={qCurr} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Collapsed secondary panel (evasiveness + validation) ──────────────────

function SecondaryPanel({
  evasiveness,
  validationScore,
  flaggedCount,
}: {
  evasiveness: number;
  validationScore: number;
  flaggedCount: number;
}) {
  const [open, setOpen] = useState(false);

  const evasLabel =
    evasiveness <= 2
      ? "Very direct"
      : evasiveness <= 4
      ? "Mostly direct"
      : evasiveness <= 6
      ? "Some hedging"
      : evasiveness <= 8
      ? "Frequently evasive"
      : "Actively evasive";

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-600">
            Executive Tone &amp; Validation
          </span>
          {!open && (
            <span className="text-xs text-gray-400">
              Evasiveness {evasiveness.toFixed(1)}/10 · Validation {validationScore.toFixed(0)}%
            </span>
          )}
        </div>
        {open ? (
          <ChevronDown size={16} className="text-gray-400" />
        ) : (
          <ChevronRight size={16} className="text-gray-400" />
        )}
      </button>

      {open && (
        <div className="px-5 py-4 bg-white grid grid-cols-2 gap-6">
          {/* Evasiveness */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Executive Evasiveness
            </p>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-semibold text-gray-900">
                {evasiveness.toFixed(1)}
              </span>
              <span className="text-sm text-gray-400 pb-0.5">/ 10</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-gray-100">
              <div
                className={clsx(
                  "h-1.5 rounded-full transition-all",
                  evasiveness <= 3
                    ? "bg-emerald-400"
                    : evasiveness <= 6
                    ? "bg-amber-400"
                    : "bg-red-400"
                )}
                style={{ width: `${evasiveness * 10}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">{evasLabel}</p>
          </div>

          {/* Validation */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Self-Validation
            </p>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-semibold text-gray-900">
                {validationScore.toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-gray-100">
              <div
                className="h-1.5 rounded-full bg-emerald-400"
                style={{ width: `${validationScore}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">
              {flaggedCount > 0
                ? `${flaggedCount} metric${flaggedCount > 1 ? "s" : ""} flagged for review`
                : "All metrics verified"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main EarningsReport ────────────────────────────────────────────────────

interface EarningsReportProps {
  payload: Record<string, unknown>;
}

export default function EarningsReport({ payload }: EarningsReportProps) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailTarget, setEmailTarget] = useState("");

  // Detect structured DashboardPayload vs legacy plain text
  const isStructured = Array.isArray(payload.insights);

  if (!isStructured) {
    // Legacy fallback — raw text dump
    const result =
      (payload.result as string | undefined) ?? JSON.stringify(payload, null, 2);
    const query = (payload.query as string | undefined) ?? "Analysis";

    async function handleSendEmail() {
      if (!emailTarget) return alert("Enter a recipient email.");
      setSending(true);
      try {
        await sendEmail({ to: emailTarget, subject: `NotionWealth: ${query}`, body: result });
        setSent(true);
      } catch (err) {
        alert(`Failed to send: ${err}`);
      } finally {
        setSending(false);
      }
    }

    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-medium text-gray-900">Analysis Result</h3>
        <pre className="whitespace-pre-wrap rounded bg-gray-50 p-4 text-sm text-gray-700 overflow-auto max-h-96">
          {result}
        </pre>
        <div className="mt-4 flex items-center gap-2">
          <input
            type="email"
            value={emailTarget}
            onChange={(e) => setEmailTarget(e.target.value)}
            placeholder="Recipient email"
            className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={handleSendEmail}
            disabled={sending || sent}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Mail size={14} />
            {sent ? "Sent!" : sending ? "Sending…" : "Send via Gmail"}
          </button>
        </div>
      </div>
    );
  }

  // ── Structured DashboardPayload rendering ─────────────────────────────
  const d = payload as unknown as DashboardPayload;

  const signalStyle = SIGNAL_STYLES[d.overall_signal] ?? SIGNAL_STYLES.Noise;
  const dotStyle = SIGNAL_DOT[d.overall_signal] ?? SIGNAL_DOT.Noise;

  async function handleSendEmail() {
    if (!emailTarget) return alert("Enter a recipient email.");
    setSending(true);
    const body = [
      `${d.company_ticker} | ${quarterLabel(d.quarter_previous)} → ${quarterLabel(d.quarter)}`,
      `Overall: ${d.overall_signal} (${d.overall_score > 0 ? "+" : ""}${d.overall_score.toFixed(1)})`,
      "",
      d.summary,
      "",
      ...d.insights.flatMap((ins) => [
        `## ${ins.section_name}`,
        ...ins.key_takeaways.map((t) => `• ${t}`),
        "",
      ]),
    ].join("\n");
    try {
      await sendEmail({
        to: emailTarget,
        subject: `NotionWealth: ${d.company_ticker} ${quarterLabel(d.quarter)} analysis`,
        body,
      });
      setSent(true);
    } catch (err) {
      alert(`Failed to send: ${err}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Hero: signal + summary ──────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-lg font-semibold text-gray-900">
                {d.company_ticker}
              </h3>
              <span className="text-sm text-gray-400">
                {quarterLabel(d.quarter_previous)} → {quarterLabel(d.quarter)}
              </span>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed max-w-2xl">
              {d.summary}
            </p>
          </div>
          <div className="shrink-0 text-right space-y-1">
            <div
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold",
                signalStyle
              )}
            >
              <span className={clsx("h-2 w-2 rounded-full", dotStyle)} />
              {d.overall_signal}
            </div>
            <p className="text-xs text-gray-400">
              Score:{" "}
              <span className="font-mono font-medium text-gray-700">
                {d.overall_score > 0 ? "+" : ""}
                {d.overall_score.toFixed(1)}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* ── Disclosure diff — LEAD ──────────────────────────────────────── */}
      <div className="space-y-3">
        {d.insights.map((insight, i) => (
          <Section
            key={i}
            insight={insight}
            qPrev={d.quarter_previous}
            qCurr={d.quarter}
          />
        ))}
      </div>

      {/* ── Collapsed: evasiveness + validation ────────────────────────── */}
      <SecondaryPanel
        evasiveness={d.executive_evasiveness_score}
        validationScore={d.validation_score}
        flaggedCount={d.flagged_count}
      />

      {/* ── Email ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 pt-1">
        <input
          type="email"
          value={emailTarget}
          onChange={(e) => setEmailTarget(e.target.value)}
          placeholder="Send to email…"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          onClick={handleSendEmail}
          disabled={sending || sent}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Mail size={14} />
          {sent ? "Sent!" : sending ? "Sending…" : "Send via Gmail"}
        </button>
      </div>
    </div>
  );
}
