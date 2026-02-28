"use client";

import { useState, useRef } from "react";
import { Mail, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Download } from "lucide-react";
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
  earnings_delta?: string[];
  fcf_implications?: string[];
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

// ── Earnings Delta panel ───────────────────────────────────────────────────

function EarningsDeltaPanel({
  bullets,
  qPrev,
  qCurr,
}: {
  bullets: string[];
  qPrev: string;
  qCurr: string;
}) {
  if (!bullets.length) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800">What Changed This Quarter</span>
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
          {quarterLabel(qPrev)} → {quarterLabel(qCurr)}
        </span>
      </div>
      <ul className="px-5 py-4 space-y-2.5">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-3 text-sm text-gray-700 leading-relaxed">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-brand-400 shrink-0" />
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── FCF Implications panel ─────────────────────────────────────────────────

function FCFImplicationsPanel({ bullets }: { bullets: string[] }) {
  if (!bullets.length) return null;
  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 overflow-hidden">
      <div className="px-5 py-3 bg-indigo-50 border-b border-indigo-100">
        <span className="text-sm font-semibold text-indigo-900">What This Means Financially</span>
      </div>
      <ul className="px-5 py-4 space-y-2.5">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-3 text-sm text-indigo-800 leading-relaxed">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0" />
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Full metrics panel (always open) ──────────────────────────────────────

function MetricsPanel({
  evasiveness,
  validationScore,
  flaggedCount,
  marketAlignmentPct,
  stockPriceChange,
  quarter,
}: {
  evasiveness: number;
  validationScore: number;
  flaggedCount: number;
  marketAlignmentPct: number;
  stockPriceChange: number;
  quarter: string;
}) {
  const evasLabel =
    evasiveness <= 2 ? "Very direct"
    : evasiveness <= 4 ? "Mostly direct"
    : evasiveness <= 6 ? "Some hedging"
    : evasiveness <= 8 ? "Frequently evasive"
    : "Actively evasive";

  const stockUp = stockPriceChange > 0;
  const stockZero = stockPriceChange === 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-600">
          Signal Quality &amp; Market Metrics
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-gray-100 px-0">

        {/* Evasiveness */}
        <div className="px-5 py-4 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Executive Evasiveness
          </p>
          <div className="flex items-end gap-1.5">
            <span className="text-2xl font-semibold text-gray-900">
              {evasiveness.toFixed(1)}
            </span>
            <span className="text-sm text-gray-400 pb-0.5">/ 10</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-100">
            <div
              className={clsx(
                "h-1.5 rounded-full",
                evasiveness <= 3 ? "bg-emerald-400"
                : evasiveness <= 6 ? "bg-amber-400"
                : "bg-red-400"
              )}
              style={{ width: `${evasiveness * 10}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">{evasLabel}</p>
        </div>

        {/* Validation */}
        <div className="px-5 py-4 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Signal Validation
          </p>
          <div className="flex items-end gap-1.5">
            <span className="text-2xl font-semibold text-gray-900">
              {validationScore.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-100">
            <div
              className={clsx(
                "h-1.5 rounded-full",
                validationScore >= 90 ? "bg-emerald-400"
                : validationScore >= 70 ? "bg-amber-400"
                : "bg-red-400"
              )}
              style={{ width: `${validationScore}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">
            {flaggedCount > 0
              ? `${flaggedCount} metric${flaggedCount > 1 ? "s" : ""} flagged`
              : "All metrics verified"}
          </p>
        </div>

        {/* Market Alignment */}
        <div className="px-5 py-4 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Market Alignment
          </p>
          <div className="flex items-end gap-1.5">
            <span className="text-2xl font-semibold text-gray-900">
              {marketAlignmentPct.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-100">
            <div
              className={clsx(
                "h-1.5 rounded-full",
                marketAlignmentPct >= 70 ? "bg-emerald-400"
                : marketAlignmentPct >= 40 ? "bg-amber-400"
                : "bg-red-400"
              )}
              style={{ width: `${marketAlignmentPct}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">
            {marketAlignmentPct >= 70 ? "Signals align with market"
            : marketAlignmentPct >= 40 ? "Partial market alignment"
            : stockZero ? "No price data available"
            : "Signals diverge from market"}
          </p>
        </div>

        {/* Stock Price Change */}
        <div className="px-5 py-4 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Stock Price · {quarterLabel(quarter)}
          </p>
          <div className="flex items-end gap-1.5">
            <span
              className={clsx(
                "text-2xl font-semibold",
                stockZero ? "text-gray-400"
                : stockUp ? "text-emerald-600"
                : "text-red-600"
              )}
            >
              {stockZero ? "—" : `${stockUp ? "+" : ""}${stockPriceChange.toFixed(1)}%`}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-100">
            {!stockZero && (
              <div
                className={clsx(
                  "h-1.5 rounded-full",
                  stockUp ? "bg-emerald-400" : "bg-red-400"
                )}
                style={{ width: `${Math.min(Math.abs(stockPriceChange) * 4, 100)}%` }}
              />
            )}
          </div>
          <p className="text-xs text-gray-500">
            {stockZero ? "Price data unavailable" : `Quarterly return vs open`}
          </p>
        </div>
      </div>
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
  const [exporting, setExporting] = useState(false);
  const [emailTarget, setEmailTarget] = useState("");
  const reportRef = useRef<HTMLDivElement>(null);

  async function handleExportPDF() {
    if (!reportRef.current) return;
    setExporting(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const { jsPDF } = await import("jspdf");

      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;

      // Split across pages if needed
      let yOffset = 0;
      while (yOffset < imgH) {
        if (yOffset > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, -yOffset, imgW, imgH);
        yOffset += pageH;
      }

      const d = payload as unknown as { company_ticker?: string; quarter?: string };
      const filename = `${d.company_ticker ?? "report"}_${d.quarter ?? "analysis"}.pdf`;
      pdf.save(filename);
    } catch (err) {
      alert(`PDF export failed: ${err}`);
    } finally {
      setExporting(false);
    }
  }

  // Detect structured DashboardPayload vs legacy plain text
  const isStructured = Array.isArray(payload.insights);

  if (!isStructured) {
    // Legacy fallback — raw text dump
    const result =
      (payload.result as string | undefined) ?? JSON.stringify(payload, null, 2);
    const query = (payload.query as string | undefined) ?? "Analysis";

    const handleSendEmail = async () => {
      if (!emailTarget) return alert("Enter a recipient email.");
      setSending(true);
      try {
        await sendEmail({ to: emailTarget, subject: `Quantalyze: ${query}`, body: result });
        setSent(true);
      } catch (err) {
        alert(`Failed to send: ${err}`);
      } finally {
        setSending(false);
      }
    };

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

    const signalColor = {
      Positive: "#059669", Negative: "#dc2626", Mixed: "#d97706", Noise: "#9ca3af",
    }[d.overall_signal] ?? "#9ca3af";

    const signalBg = {
      Positive: "#ecfdf5", Negative: "#fef2f2", Mixed: "#fffbeb", Noise: "#f9fafb",
    }[d.overall_signal] ?? "#f9fafb";

    const scoreStr = `${d.overall_score > 0 ? "+" : ""}${d.overall_score.toFixed(1)}`;

    const insightRows = d.insights.map((ins) => {
      const takeaways = ins.key_takeaways
        .map((t) => `<li style="margin:0 0 6px 0;color:#374151;font-size:14px;line-height:1.6;">${t}</li>`)
        .join("");
      return `
        <tr>
          <td style="padding:0 0 24px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr>
                <td style="background:#f9fafb;padding:12px 20px;border-bottom:1px solid #e5e7eb;">
                  <span style="font-size:13px;font-weight:600;color:#111827;">${ins.section_name}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 20px;">
                  <ul style="margin:0;padding:0 0 0 16px;">${takeaways}</ul>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
    }).join("");

    const metricCell = (label: string, value: string, sub: string) => `
      <td style="padding:16px;text-align:center;border-right:1px solid #f3f4f6;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;margin-bottom:6px;">${label}</div>
        <div style="font-size:22px;font-weight:700;color:#111827;margin-bottom:4px;">${value}</div>
        <div style="font-size:12px;color:#6b7280;">${sub}</div>
      </td>`;

    const evasLabel = d.executive_evasiveness_score <= 3 ? "Very direct"
      : d.executive_evasiveness_score <= 6 ? "Some hedging" : "Frequently evasive";
    const stockStr = d.stock_price_change === 0 ? "—"
      : `${d.stock_price_change > 0 ? "+" : ""}${d.stock_price_change.toFixed(1)}%`;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#111827;border-radius:12px 12px 0 0;padding:24px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">Quantalyze</div>
                  <div style="font-size:12px;color:#9ca3af;margin-top:2px;">Earnings Intelligence Engine</div>
                </td>
                <td align="right">
                  <div style="font-size:13px;color:#9ca3af;">${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Hero -->
        <tr>
          <td style="background:#ffffff;padding:28px 32px 24px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:24px;font-weight:700;color:#111827;margin-bottom:4px;">${d.company_ticker}</div>
                  <div style="font-size:14px;color:#6b7280;margin-bottom:16px;">${quarterLabel(d.quarter_previous)} &rarr; ${quarterLabel(d.quarter)}</div>
                  <p style="margin:0;font-size:15px;color:#374151;line-height:1.7;">${d.summary}</p>
                </td>
                <td width="120" valign="top" align="right" style="padding-left:16px;">
                  <div style="display:inline-block;background:${signalBg};border:1px solid ${signalColor}33;border-radius:20px;padding:8px 16px;text-align:center;">
                    <div style="font-size:14px;font-weight:700;color:${signalColor};">${d.overall_signal}</div>
                    <div style="font-size:12px;color:${signalColor};opacity:0.8;margin-top:2px;">${scoreStr}</div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Section divider -->
        <tr>
          <td style="background:#f9fafb;padding:12px 32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;border-top:1px solid #e5e7eb;">
            <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;">Section Insights</span>
          </td>
        </tr>

        <!-- Insights -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${insightRows}
            </table>
          </td>
        </tr>

        <!-- Metrics -->
        <tr>
          <td style="border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-top:1px solid #e5e7eb;">
              <tr>
                <td style="padding:12px 32px;border-bottom:1px solid #e5e7eb;">
                  <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;">Signal Metrics</span>
                </td>
              </tr>
              <tr>
                <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
                  <tr>
                    ${metricCell("Evasiveness", `${d.executive_evasiveness_score.toFixed(1)}/10`, evasLabel)}
                    ${metricCell("Validation", `${d.validation_score.toFixed(0)}%`, d.flagged_count > 0 ? `${d.flagged_count} flagged` : "All verified")}
                    ${metricCell("Market Alignment", `${d.market_alignment_pct.toFixed(0)}%`, d.market_alignment_pct >= 70 ? "Aligned" : "Divergent")}
                    ${metricCell(`Stock · ${quarterLabel(d.quarter)}`, stockStr, d.stock_price_change === 0 ? "No data" : "Quarterly return")}
                  </tr>
                </table>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#111827;border-radius:0 0 12px 12px;padding:16px 32px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#6b7280;">Powered by <span style="color:#a5b4fc;font-weight:600;">Quantalyze</span> &nbsp;&middot;&nbsp; This report is AI-generated and for informational purposes only.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // Plain text fallback
    const body = [
      `${d.company_ticker} | ${quarterLabel(d.quarter_previous)} → ${quarterLabel(d.quarter)}`,
      `Overall: ${d.overall_signal} (${scoreStr})`,
      "",
      d.summary,
      "",
      ...d.insights.flatMap((ins) => [
        `${ins.section_name}`,
        ...ins.key_takeaways.map((t) => `• ${t}`),
        "",
      ]),
      `Evasiveness: ${d.executive_evasiveness_score.toFixed(1)}/10 | Validation: ${d.validation_score.toFixed(0)}% | Market Alignment: ${d.market_alignment_pct.toFixed(0)}%`,
      "",
      "Powered by Quantalyze",
    ].join("\n");

    try {
      await sendEmail({
        to: emailTarget,
        subject: `${d.company_ticker} ${quarterLabel(d.quarter)} Earnings Analysis — Quantalyze`,
        body,
        html,
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
      <div ref={reportRef} className="space-y-4">
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
        {d.insights.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-700">
            No section insights were generated. The analysis agents may have encountered an error — check server logs.
          </div>
        ) : (
          d.insights.map((insight, i) => (
            <Section
              key={i}
              insight={insight}
              qPrev={d.quarter_previous}
              qCurr={d.quarter}
            />
          ))
        )}
      </div>

      {/* ── Institutional sections ───────────────────────────────────────── */}
      {(d.earnings_delta?.length || d.fcf_implications?.length) ? (
        <div className="space-y-3">
          <EarningsDeltaPanel
            bullets={d.earnings_delta ?? []}
            qPrev={d.quarter_previous}
            qCurr={d.quarter}
          />
          <FCFImplicationsPanel bullets={d.fcf_implications ?? []} />
        </div>
      ) : null}

      {/* ── Metrics panel ───────────────────────────────────────────────── */}
      <MetricsPanel
        evasiveness={d.executive_evasiveness_score}
        validationScore={d.validation_score}
        flaggedCount={d.flagged_count}
        marketAlignmentPct={d.market_alignment_pct}
        stockPriceChange={d.stock_price_change}
        quarter={d.quarter}
      />
      </div>

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <div data-no-print className="flex items-center gap-2 pt-1">
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
        <button
          onClick={handleExportPDF}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Download size={14} />
          {exporting ? "Exporting…" : "Export PDF"}
        </button>
      </div>
    </div>
  );
}
