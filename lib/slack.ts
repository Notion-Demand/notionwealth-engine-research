import crypto from "crypto";
import path from "path";
import fs from "fs";
import { quarterLabel } from "@/lib/nifty50";
import type { DashboardPayload } from "@/lib/pipeline";

// ── Signature verification ────────────────────────────────────────────────────

export function verifySlackSignature(
  rawBody: string,
  timestamp: string,
  signature: string
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;

  // Reject requests older than 5 minutes (replay protection)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const computed = `v0=${crypto.createHmac("sha256", secret).update(base).digest("hex")}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ── Command parser ────────────────────────────────────────────────────────────

const PDF_DIR = path.join(
  process.cwd(),
  "finance-agent",
  "multiagent_analysis",
  "all-pdfs"
);

/** Return the two most-recent available quarters for a ticker (newest first). */
function latestQuarters(ticker: string): [string, string] | null {
  try {
    const files = fs.readdirSync(PDF_DIR);
    const quarters: string[] = [];
    for (const f of files) {
      const m = f.match(/^([A-Za-z]+)_Q(\d)_(\d{4})\.pdf$/i);
      if (m && m[1].toUpperCase() === ticker.toUpperCase()) {
        quarters.push(`Q${m[2]}_${m[3]}`);
      }
    }
    quarters.sort((a, b) => b.localeCompare(a));
    if (quarters.length < 2) return null;
    return [quarters[0], quarters[1]];
  } catch {
    return null;
  }
}

export type ParsedCommand =
  | { ok: true; ticker: string; qCurr: string; qPrev: string }
  | { ok: false; error: string };

/**
 * Parse `/earnings <text>` input.
 * Supported formats:
 *   BHARTI                      → latest two quarters for that ticker
 *   BHARTI Q3_2026 Q2_2026      → explicit quarters (curr first, prev second)
 *   BHARTI Q3 Q2                → short form, year inferred from latest available
 */
export function parseEarningsCommand(text: string): ParsedCommand {
  const parts = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { ok: false, error: "Usage: `/earnings BHARTI Q3_2026 Q2_2026`" };
  }

  const ticker = parts[0];

  // Full explicit quarters: BHARTI Q3_2026 Q2_2026
  if (parts.length >= 3 && /^Q\d_\d{4}$/.test(parts[1]) && /^Q\d_\d{4}$/.test(parts[2])) {
    return { ok: true, ticker, qCurr: parts[1], qPrev: parts[2] };
  }

  // Short quarters: BHARTI Q3 Q2 — infer year from latest available
  if (parts.length >= 3 && /^Q\d$/.test(parts[1]) && /^Q\d$/.test(parts[2])) {
    const latest = latestQuarters(ticker);
    const year = latest ? latest[0].split("_")[1] : new Date().getFullYear().toString();
    return { ok: true, ticker, qCurr: `${parts[1]}_${year}`, qPrev: `${parts[2]}_${year}` };
  }

  // Ticker only: default to latest two
  const latest = latestQuarters(ticker);
  if (!latest) {
    return {
      ok: false,
      error: `No transcripts found for *${ticker}*. Try: \`/earnings BHARTI Q3_2026 Q2_2026\``,
    };
  }
  return { ok: true, ticker, qCurr: latest[0], qPrev: latest[1] };
}

// ── Slack Block Kit formatter ─────────────────────────────────────────────────

const SIGNAL_EMOJI: Record<string, string> = {
  Positive: "🟢",
  Negative: "🔴",
  Mixed:    "🟡",
  Noise:    "⚪",
};

function sectionSignal(insight: DashboardPayload["insights"][number]): string {
  if (!insight.metrics.length) return "⚪";
  const avg = insight.metrics.reduce((s, m) => s + m.signal_score, 0) / insight.metrics.length;
  if (avg > 0.5) return "🟢";
  if (avg < -0.5) return "🔴";
  return "🟡";
}

export function formatSlackBlocks(payload: DashboardPayload): object[] {
  const scoreStr = `${payload.overall_score > 0 ? "+" : ""}${payload.overall_score.toFixed(1)}`;
  const signal = SIGNAL_EMOJI[payload.overall_signal] ?? "⚪";

  const sectionFields = payload.insights.map((ins) => ({
    type: "mrkdwn",
    text: `${sectionSignal(ins)} *${ins.section_name}*\n${ins.key_takeaways[0] ?? "—"}`,
  }));

  const metrics = [
    `🎭 Evasiveness: *${payload.executive_evasiveness_score.toFixed(1)}*/10`,
    `✅ Validation: *${payload.validation_score.toFixed(0)}%*`,
    `📊 Market Alignment: *${payload.market_alignment_pct.toFixed(0)}%*`,
    payload.stock_price_change !== 0
      ? `💹 Stock ${quarterLabel(payload.quarter)}: *${payload.stock_price_change > 0 ? "+" : ""}${payload.stock_price_change.toFixed(1)}%*`
      : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const blocks: object[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${payload.company_ticker} · ${quarterLabel(payload.quarter_previous)} → ${quarterLabel(payload.quarter)}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${signal} *${payload.overall_signal}* (${scoreStr})\n_${payload.summary}_`,
      },
    },
    { type: "divider" },
  ];

  // Section fields — Slack allows max 10 fields; split into rows of 2
  for (let i = 0; i < sectionFields.length; i += 2) {
    blocks.push({
      type: "section",
      fields: sectionFields.slice(i, i + 2),
    });
  }

  blocks.push(
    { type: "divider" },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: metrics }],
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: "_Powered by Quantalyze_" }],
    }
  );

  return blocks;
}

/** Post a message back to Slack via response_url (no token needed). */
export async function postToSlack(
  responseUrl: string,
  payload: { response_type: "in_channel" | "ephemeral"; text?: string; blocks?: object[] }
) {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
