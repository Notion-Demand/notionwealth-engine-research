import crypto from "crypto";
import { quarterLabel, NIFTY50 } from "@/lib/nifty50";
import { supabaseAdmin } from "@/lib/supabase/admin";
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

// ── Ticker resolution ─────────────────────────────────────────────────────────

/** Common short-names / aliases → internal ticker key */
const TICKER_ALIASES: Record<string, string> = {
  "airtel": "BHARTI", "bharti airtel": "BHARTI",
  "hdfc bank": "HDFC", "hdfcbank": "HDFC",
  "icici bank": "ICICI", "icicibank": "ICICI",
  "state bank": "SBI", "state bank of india": "SBI",
  "bajaj finance": "BAJAJ", "bajajfinance": "BAJAJ",
  "larsen": "LT", "larsen toubro": "LT", "l&t": "LT",
  "hindustan unilever": "HUL", "hul": "HUL",
  "kotak": "KOTAKBANK", "kotak bank": "KOTAKBANK", "kotak mahindra": "KOTAKBANK",
  "axis bank": "AXISBANK",
  "hcl": "HCLTECH", "hcl tech": "HCLTECH", "hcl technologies": "HCLTECH",
  "ultratech": "ULTRACEMCO", "ultra tech": "ULTRACEMCO", "ultratech cement": "ULTRACEMCO",
  "adani enterprises": "ADANIENT",
  "adani ports": "ADANIPORTS", "adaniports": "ADANIPORTS",
  "maruti suzuki": "MARUTI", "maruti": "MARUTI",
  "power grid": "POWERGRID",
  "tata motors": "TATAMOTORS",
  "tata steel": "TATASTEEL",
  "sbi life": "SBILIFE", "sbilife": "SBILIFE",
  "hdfc life": "HDFCLIFE", "hdfclife": "HDFCLIFE",
  "icici pru": "ICICIPRULI", "icici prudential": "ICICIPRULI",
  "sun pharma": "SUNPHARMA", "sunpharma": "SUNPHARMA",
  "dr reddy": "DRREDDY", "dr reddys": "DRREDDY", "dr. reddy": "DRREDDY",
  "asian paints": "ASIANPAINT", "asianpaint": "ASIANPAINT",
  "nestle": "NESTLEIND", "nestle india": "NESTLEIND",
  "bajaj finserv": "BAJAJFINSV", "bajajfinserv": "BAJAJFINSV",
  "jsw steel": "JSWSTEEL", "jswsteel": "JSWSTEEL",
  "coal india": "COALINDIA", "coalindia": "COALINDIA",
  "indusind": "INDUSINDBK", "indusind bank": "INDUSINDBK",
  "tech mahindra": "TECHM", "techmahindra": "TECHM",
  "eicher": "EICHERMOT", "royal enfield": "EICHERMOT", "eicher motors": "EICHERMOT",
  "hero motocorp": "HEROMOTOCO", "hero moto": "HEROMOTOCO", "hero": "HEROMOTOCO",
  "tata consumer": "TATACONSUM", "tataconsum": "TATACONSUM",
  "apollo hospitals": "APOLLOHOSP", "apollo": "APOLLOHOSP",
  "divis": "DIVISLAB", "divi's": "DIVISLAB", "divi": "DIVISLAB",
  "ltimindtree": "LTIM", "lti mindtree": "LTIM", "lti": "LTIM",
  "mahindra": "MM", "m&m": "MM",
  "bajaj auto": "BAJAJAUTO", "bajajauto": "BAJAJAUTO",
  "infy": "INFOSYS",
  "titan": "TITAN",
  "ntpc": "NTPC",
  "ongc": "ONGC",
  "bpcl": "BPCL",
  "cipla": "CIPLA",
  "wipro": "WIPRO",
  "britannia": "BRITANNIA",
  "hindalco": "HINDALCO",
  "grasim": "GRASIM",
};

/** Resolve a free-text company name/ticker to a registry key, or null. */
function resolveTicker(input: string): string | null {
  const up = input.toUpperCase().trim();
  if (NIFTY50[up]) return up;

  const lo = input.toLowerCase().replace(/[^a-z0-9\s&'.]/g, "").trim();
  if (TICKER_ALIASES[lo]) return TICKER_ALIASES[lo];

  // Substring match against company names in registry
  for (const [ticker, info] of Object.entries(NIFTY50)) {
    if (info.name.toLowerCase().includes(lo) || lo.includes(ticker.toLowerCase())) {
      return ticker;
    }
  }
  return null;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

const STORAGE_BUCKET = "transcripts";

/** Return the two most-recent available quarters for a ticker (newest first). */
async function latestQuarters(ticker: string): Promise<[string, string] | null> {
  const { data, error } = await supabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .list("", { limit: 1000 });
  if (error || !data) return null;

  const quarters: string[] = [];
  for (const f of data) {
    const m = f.name.match(/^([A-Za-z]+)_Q(\d)_(\d{4})\.pdf$/i);
    if (m && m[1].toUpperCase() === ticker) quarters.push(`Q${m[2]}_${m[3]}`);
  }
  quarters.sort((a, b) => b.localeCompare(a));
  return quarters.length >= 2 ? [quarters[0], quarters[1]] : null;
}

// ── Command parser ────────────────────────────────────────────────────────────

export type ParsedCommand =
  | { ok: true; ticker: string; qCurr: string; qPrev: string }
  | { ok: false; error: string };

/**
 * Parse `/earnings <text>` input.
 * Supported formats:
 *   airtel                        → latest two quarters (name resolved)
 *   Bharti Airtel                 → same, multi-word company name
 *   BHARTI                        → exact ticker
 *   BHARTI Q3_2026 Q2_2026        → explicit quarters (curr first, prev second)
 *   Bharti Airtel Q3_2026 Q2_2026 → name + explicit quarters
 *   BHARTI Q3 Q2                  → short form, year inferred from latest available
 */
export async function parseEarningsCommand(text: string): Promise<ParsedCommand> {
  const raw = text.trim();
  if (!raw) {
    return { ok: false, error: "Usage: `/earnings Airtel Q3_2026 Q2_2026`" };
  }

  // Strip trailing quarter tokens (Q3_2026 or Q3) to isolate the company name
  const tokens = raw.split(/\s+/);
  const qTokens: string[] = [];
  const nameTokens = [...tokens];

  while (nameTokens.length > 1) {
    const last = nameTokens[nameTokens.length - 1].toUpperCase();
    if (/^Q\d(_\d{4})?$/.test(last)) {
      qTokens.unshift(nameTokens.pop()!);
    } else {
      break;
    }
  }

  // Resolve ticker — try progressively shorter substrings of name tokens
  let ticker: string | null = null;
  for (let len = nameTokens.length; len >= 1; len--) {
    ticker = resolveTicker(nameTokens.slice(0, len).join(" "));
    if (ticker) break;
  }

  if (!ticker) {
    return {
      ok: false,
      error: `Couldn't recognise *${tokens[0]}* as a Nifty 50 company. Try the ticker (e.g. \`BHARTI\`) or full name (e.g. \`Bharti Airtel\`).`,
    };
  }

  // Full explicit quarters: Q3_2026 Q2_2026
  if (
    qTokens.length >= 2 &&
    /^Q\d_\d{4}$/.test(qTokens[0]) &&
    /^Q\d_\d{4}$/.test(qTokens[1])
  ) {
    return { ok: true, ticker, qCurr: qTokens[0].toUpperCase(), qPrev: qTokens[1].toUpperCase() };
  }

  // Short quarters: Q3 Q2 — infer year from latest available
  if (qTokens.length >= 2 && /^Q\d$/.test(qTokens[0]) && /^Q\d$/.test(qTokens[1])) {
    const latest = await latestQuarters(ticker);
    const year = latest ? latest[0].split("_")[1] : new Date().getFullYear().toString();
    return {
      ok: true,
      ticker,
      qCurr: `${qTokens[0].toUpperCase()}_${year}`,
      qPrev: `${qTokens[1].toUpperCase()}_${year}`,
    };
  }

  // No quarters: default to latest two
  const latest = await latestQuarters(ticker);
  if (!latest) {
    return {
      ok: false,
      error: `No transcripts found for *${ticker}*. Try: \`/earnings ${ticker} Q3_2026 Q2_2026\``,
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
