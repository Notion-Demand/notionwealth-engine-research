/**
 * Multi-agent earnings transcript pipeline — TypeScript port of the Python pipeline.
 * Runs 8 parallel Gemini calls (4 thematic agents × 2 quarters) + evasiveness,
 * then 4 temporal delta comparisons, then local validation.
 */
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { Schema } from "@google/generative-ai";
import pdfParse from "pdf-parse";
import { NIFTY50 } from "./nifty50";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ── Progress events (streamed back to client during pipeline execution) ───────

export type ProgressEvent =
  | { type: "start"; sections: string[] }
  | { type: "thematic_done"; section: string; which: "prev" | "curr" }
  | { type: "evasiveness_done"; score: number }
  | { type: "delta_done"; section: string }
  | { type: "stock_done"; stockPriceChange: number };

export type ProgressCallback = (event: ProgressEvent) => void;

// ── TypeScript types ──────────────────────────────────────────────────────────

export interface QuarterSnapshot {
  section_name: string;
  key_takeaways: string[];
  raw_quotes: string[];
}

export interface MetricDelta {
  subtopic: string;
  quote_old: string;
  quote_new: string;
  language_shift: string;
  signal_classification: "Positive" | "Negative" | "Noise";
  signal_score: number;
  ui_component_type: "metric_card" | "status_warning" | "quote_expander";
  validation_status: "verified" | "flagged" | "removed";
  validation_note: string;
  market_validation: "aligned" | "divergent" | "unclear";
  market_note: string;
}

export interface SectionalInsight {
  section_name: string;
  key_takeaways: string[];
  metrics: MetricDelta[];
}

export interface DashboardPayload {
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

// ── Gemini response schemas ───────────────────────────────────────────────────

const QUARTER_SNAPSHOT_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    section_name: { type: SchemaType.STRING },
    key_takeaways: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    raw_quotes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: ["section_name", "key_takeaways", "raw_quotes"],
};

const METRIC_DELTA_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    subtopic: { type: SchemaType.STRING },
    quote_old: { type: SchemaType.STRING },
    quote_new: { type: SchemaType.STRING },
    language_shift: { type: SchemaType.STRING },
    signal_classification: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["Positive", "Negative", "Noise"],
    },
    signal_score: { type: SchemaType.NUMBER },
    ui_component_type: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["metric_card", "status_warning", "quote_expander"],
    },
  },
  required: [
    "subtopic",
    "quote_old",
    "quote_new",
    "language_shift",
    "signal_classification",
    "signal_score",
    "ui_component_type",
  ],
};

const SECTIONAL_INSIGHT_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    section_name: { type: SchemaType.STRING },
    key_takeaways: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    metrics: { type: SchemaType.ARRAY, items: METRIC_DELTA_SCHEMA },
  },
  required: ["section_name", "key_takeaways", "metrics"],
};

const EVASIVENESS_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    score: { type: SchemaType.NUMBER },
    reasoning: { type: SchemaType.STRING },
  },
  required: ["score", "reasoning"],
};

// ── Gemini client helper ──────────────────────────────────────────────────────

function getGenAI(): GoogleGenerativeAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
  return new GoogleGenerativeAI(apiKey);
}

// Each Gemini call must complete within this window. If it doesn't, the agent
// returns null and the pipeline continues with whatever other agents produced.
const AGENT_TIMEOUT_MS = 25_000;

async function invokeStructured<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: Schema,
  modelName = "gemini-2.5-flash-lite"
): Promise<T> {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0,
    } as any,
  });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Gemini agent timed out")), AGENT_TIMEOUT_MS)
  );
  const result = await Promise.race([model.generateContent(userPrompt), timeout]);
  return JSON.parse(result.response.text()) as T;
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

const STORAGE_BUCKET = "transcripts";

/**
 * Returns the storage key (filename) for a given ticker + quarter.
 * Lists the bucket to handle case-insensitive matches (e.g. Bharti vs BHARTI).
 */
export async function resolvePdfKey(ticker: string, quarter: string): Promise<string> {
  const target = `${ticker}_${quarter}.pdf`.toLowerCase();
  const { data, error } = await supabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .list("", { limit: 1000 });
  if (error) throw new Error(`Storage list failed: ${error.message}`);
  const file = data?.find((f) => f.name.toLowerCase() === target);
  if (file) return file.name;
  const available =
    data
      ?.filter((f) => f.name.toUpperCase().startsWith(ticker.toUpperCase() + "_"))
      .map((f) => f.name)
      .sort() ?? [];
  const hint = available.length > 0 ? ` Available for ${ticker}: ${available.join(", ")}` : "";
  throw new Error(`PDF not found: ${ticker} ${quarter}.${hint}`);
}

// Earnings call transcripts rarely need more than the first ~80 K characters.
// Capping here keeps prompt sizes sane and prevents timeouts on verbose PDFs.
const MAX_TRANSCRIPT_CHARS = 80_000;

async function extractPdfText(storageKey: string): Promise<string> {
  const { data: blob, error } = await supabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .download(storageKey);
  if (error || !blob) throw new Error(`Storage download failed for ${storageKey}: ${error?.message}`);
  const buffer = Buffer.from(await blob.arrayBuffer());
  const data = await pdfParse(buffer);
  const text = data.text;
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    console.log(`[Pipeline] ${storageKey}: ${text.length} chars → truncated to ${MAX_TRANSCRIPT_CHARS}`);
  }
  return text.slice(0, MAX_TRANSCRIPT_CHARS);
}

export function parseFilename(
  filename: string
): { company: string; quarter: string } | null {
  const match = filename.match(/^([A-Za-z]+)_Q(\d)_(\d{4})\.pdf$/i);
  if (!match) return null;
  return {
    company: match[1].toUpperCase(),
    quarter: `Q${match[2]}_${match[3]}`,
  };
}

// ── Agent system prompts ──────────────────────────────────────────────────────

const AGENT_PROMPTS: Record<string, string> = {
  "Capital & Liquidity": `You are a senior credit analyst specializing in capital structure and liquidity analysis.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **Free Cash Flow (FCF)** — generation, conversion, trends, guidance
2. **Capital Expenditure (CapEx)** — plans, changes, intensity
3. **Debt Structure** — total debt, maturity profile, cost of debt, refinancing
4. **Covenants** — any covenant discussions, headroom, compliance
5. **Shareholder Returns** — buybacks, dividends, payout ratios

RULES:
- Extract VERBATIM quotes from the transcript (do NOT paraphrase)
- Include speaker attribution (CEO, CFO, Analyst)
- Focus on both prepared remarks AND Q&A answers
- If a subtopic is not discussed, do NOT fabricate content — omit it
- Provide 3-5 key takeaways summarizing the capital & liquidity position`,

  "Revenue & Growth": `You are a senior equity research analyst specializing in revenue quality and growth analysis.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **Pricing Power** — tariff hikes, ARPU trends, ability to raise prices, pricing discipline
2. **Customer Churn** — subscriber trends, retention metrics, churn rates, customer additions
3. **Volume vs Price Mix** — whether growth is volume-driven or price-driven
4. **New Market Expansion** — geographic expansion, new products, new segments, adjacencies
5. **Revenue Quality** — recurring vs one-time, contract duration, visibility

RULES:
- Extract VERBATIM quotes from the transcript (do NOT paraphrase)
- Include speaker attribution (CEO, CFO, Analyst)
- Focus on both prepared remarks AND Q&A answers
- If a subtopic is not discussed, do NOT fabricate content — omit it
- Provide 3-5 key takeaways on revenue quality and growth trajectory`,

  "Operational Margin": `You are a senior financial analyst specializing in operating efficiency and margin analysis.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **Supply Chain Costs** — input costs, vendor dependencies, procurement changes
2. **Labor Inflation** — employee costs, wage pressures, headcount changes
3. **OPEX Adjustments** — SG&A trends, cost optimization, efficiency programs
4. **Margin Trajectory** — EBITDA/operating margin changes, margin guidance, mix effects
5. **Accounting Policy Changes** — depreciation changes, capitalization, recognition, one-time items

RULES:
- Extract VERBATIM quotes from the transcript (do NOT paraphrase)
- Include speaker attribution (CEO, CFO, Analyst)
- Focus on both prepared remarks AND Q&A answers
- If a subtopic is not discussed, do NOT fabricate content — omit it
- Provide 3-5 key takeaways summarizing operational efficiency and margin outlook`,

  "Macro & Risk": `You are a senior risk analyst specializing in macro-level threats and systemic risk assessment.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **FX Headwinds** — currency impact, hedging strategies, geographic revenue exposure
2. **Geopolitical Exposure** — regulatory risks, trade tensions, country-specific risks
3. **Industry Systemic Risks** — competitive threats, disruption, structural shifts
4. **Regulatory & Compliance** — new regulations, spectrum auctions, license renewals, policy changes
5. **Forward Risk Statements** — cautionary language, conditional statements, management hedging of expectations

RULES:
- Extract VERBATIM quotes from the transcript (do NOT paraphrase)
- Include speaker attribution (CEO, CFO, Analyst)
- Pay EXTRA attention to Q&A where analysts probe for risks
- Management's hedging language (e.g., "subject to", "depending on", "if conditions") is a signal
- If a subtopic is not discussed, do NOT fabricate content — omit it
- Provide 3-5 key takeaways summarizing the risk landscape`,
};

const TEMPORAL_DELTA_SYSTEM = `You are a senior financial analyst comparing two consecutive quarterly earnings call transcripts.

You are given the key takeaways and quotes from a specific analysis domain for TWO consecutive quarters (Q_t-1 and Q_t).

Your task is to:
1. Identify EVERY meaningful semantic shift between the two quarters
2. For each shift, provide the EXACT VERBATIM quotes from each quarter
3. Describe HOW the narrative changed (more optimistic, more cautious, new disclosure, dropped topic, etc.)
4. Classify each shift as:
   - **Positive**: Structural improvement, risk reduction, upgraded guidance
   - **Negative**: Structural deterioration, new risk, downgraded guidance
   - **Noise**: Cosmetic wording change, compliance boilerplate, no material impact
5. Assign a **signal_score** (float, -10 to +10):
   - Positive signals: +1 to +10 (higher = stronger improvement)
   - Negative signals: -1 to -10 (lower = worse deterioration)
   - Noise signals: -0.5 to +0.5
6. Assign a UI component type:
   - **metric_card**: For quantifiable changes (margins, FCF, ARPU)
   - **status_warning**: For negative signals that need user attention
   - **quote_expander**: For nuanced narrative shifts worth reading in detail

RULES:
- Use VERBATIM quotes. Do NOT paraphrase.
- If Q_t-1 didn't discuss a topic but Q_t does, use "Not discussed in previous quarter" as quote_old
- If Q_t drops a topic discussed in Q_t-1, use "No longer discussed" as quote_new
- Provide 3-5 key takeaways summarizing the overall quarter-over-quarter shift
- The section_name MUST match the domain exactly`;

const EVASIVENESS_SYSTEM = `You are analyzing executive Q&A behavior in an earnings call.

Score the executives' evasiveness from 0 to 10:
- 0-2: Very direct, clear answers with specifics
- 3-4: Generally responsive with occasional hedging
- 5-6: Moderate deflection, uses generic language
- 7-8: Frequently avoids direct answers, pivots to talking points
- 9-10: Actively dodges questions, non-answers, contradicts data

Focus on the Q&A section. Look for: redirecting questions, excessive caveats,
answering a different question than asked, vague forward-looking statements.`;

// ── Agent runners ─────────────────────────────────────────────────────────────

async function runThematicAgent(
  sectionName: string,
  transcript: string,
  company: string,
  quarter: string
): Promise<QuarterSnapshot | null> {
  const systemPrompt = AGENT_PROMPTS[sectionName];
  if (!systemPrompt) return null;

  const userPrompt = `Analyze this earnings call transcript for ${sectionName} insights.

Company: ${company}
Quarter: ${quarter}

TRANSCRIPT:
${transcript}`;

  try {
    const result = await invokeStructured<QuarterSnapshot>(
      systemPrompt,
      userPrompt,
      QUARTER_SNAPSHOT_SCHEMA
    );
    result.section_name = sectionName;
    return result;
  } catch (e) {
    console.error(`[${sectionName}] Agent failed:`, e);
    return null;
  }
}

async function runEvasivenessAgent(
  transcript: string,
  company: string,
  quarter: string
): Promise<number> {
  const userPrompt = `Rate the executive evasiveness in this ${company} ${quarter} earnings call:\n\n${transcript.slice(-30000)}`;
  try {
    const result = await invokeStructured<{ score: number; reasoning: string }>(
      EVASIVENESS_SYSTEM,
      userPrompt,
      EVASIVENESS_SCHEMA
    );
    return Math.max(0, Math.min(10, result.score));
  } catch {
    return 5.0;
  }
}

async function runTemporalDelta(
  sectionName: string,
  snapshotPrev: QuarterSnapshot,
  snapshotCurr: QuarterSnapshot,
  qPrev: string,
  qCurr: string
): Promise<SectionalInsight | null> {
  const takeawaysPrev = snapshotPrev.key_takeaways.map((t) => `- ${t}`).join("\n");
  const takeawaysCurr = snapshotCurr.key_takeaways.map((t) => `- ${t}`).join("\n");
  const quotesPrev = snapshotPrev.raw_quotes
    .slice(0, 10)
    .map((q) => `"${q}"`)
    .join("\n");
  const quotesCurr = snapshotCurr.raw_quotes
    .slice(0, 10)
    .map((q) => `"${q}"`)
    .join("\n");

  const userPrompt = `Compare these two quarters for the **${sectionName}** domain.

PREVIOUS QUARTER (${qPrev}):
Key Takeaways:
${takeawaysPrev || "No takeaways extracted"}

Key Quotes:
${quotesPrev || "No quotes extracted"}

CURRENT QUARTER (${qCurr}):
Key Takeaways:
${takeawaysCurr || "No takeaways extracted"}

Key Quotes:
${quotesCurr || "No quotes extracted"}

Identify all semantic shifts, classify signals, and assign UI components.`;

  try {
    const result = await invokeStructured<SectionalInsight>(
      TEMPORAL_DELTA_SYSTEM,
      userPrompt,
      SECTIONAL_INSIGHT_SCHEMA
    );
    result.section_name = sectionName;
    // Attach default fields not in schema (validation + market)
    result.metrics = result.metrics.map((m) => ({
      ...m,
      validation_status: "verified" as const,
      validation_note: "",
      market_validation: "unclear" as const,
      market_note: "",
    }));
    return result;
  } catch (e) {
    console.error(`[Temporal Delta] ${sectionName} failed:`, e);
    return null;
  }
}

// ── Local validation (no LLM — signal/score consistency check) ────────────────

function localValidation(insights: SectionalInsight[]): {
  insights: SectionalInsight[];
  validationScore: number;
  flaggedCount: number;
} {
  let total = 0;
  let flagged = 0;
  for (const insight of insights) {
    for (const m of insight.metrics) {
      total++;
      if (m.signal_classification === "Positive" && m.signal_score < 0) {
        m.validation_status = "flagged";
        m.validation_note = `Signal is Positive but score is ${m.signal_score}`;
        flagged++;
      } else if (m.signal_classification === "Negative" && m.signal_score > 0) {
        m.validation_status = "flagged";
        m.validation_note = `Signal is Negative but score is ${m.signal_score}`;
        flagged++;
      }
    }
  }
  const validationScore = total > 0 ? ((total - flagged) / total) * 100 : 100.0;
  return {
    insights,
    validationScore: Math.round(validationScore * 10) / 10,
    flaggedCount: flagged,
  };
}

// ── Aggregate signal ──────────────────────────────────────────────────────────

function computeOverallSignal(insights: SectionalInsight[]): {
  score: number;
  signal: DashboardPayload["overall_signal"];
} {
  const scores = insights.flatMap((i) => i.metrics.map((m) => m.signal_score));
  if (scores.length === 0) return { score: 0, signal: "Noise" };
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const score = Math.max(-10, Math.min(10, Math.round(avg * 100) / 100));
  let signal: DashboardPayload["overall_signal"];
  if (score > 2) signal = "Positive";
  else if (score < -2) signal = "Negative";
  else if (Math.abs(score) > 0.5) signal = "Mixed";
  else signal = "Noise";
  return { score, signal };
}

// ── Stock price + market alignment ───────────────────────────────────────────

/** Map Indian FY quarter string to calendar date range */
function quarterToDateRange(quarter: string): { start: Date; end: Date } | null {
  const m = quarter.match(/^Q(\d)_(\d{4})$/);
  if (!m) return null;
  const q = parseInt(m[1]);
  const fy = parseInt(m[2]);
  switch (q) {
    case 1: return { start: new Date(`${fy - 1}-04-01`), end: new Date(`${fy - 1}-06-30`) };
    case 2: return { start: new Date(`${fy - 1}-07-01`), end: new Date(`${fy - 1}-09-30`) };
    case 3: return { start: new Date(`${fy - 1}-10-01`), end: new Date(`${fy - 1}-12-31`) };
    case 4: return { start: new Date(`${fy}-01-01`), end: new Date(`${fy}-03-31`) };
    default: return null;
  }
}

/** Fetch quarter % price change from Yahoo Finance (NSE). Returns 0 on failure. */
async function fetchStockPriceChange(ticker: string, quarter: string): Promise<number> {
  const info = NIFTY50[ticker];
  if (!info) return 0;
  const range = quarterToDateRange(quarter);
  if (!range) return 0;

  const period1 = Math.floor(range.start.getTime() / 1000);
  const period2 = Math.floor(range.end.getTime() / 1000);
  const symbol = info.nse; // e.g. "BHARTIARTL.NS"

  try {
    const resp = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${period1}&period2=${period2}`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) return 0;
    const data = await resp.json();
    const closes: number[] = (
      (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []) as (number | null)[]
    ).filter((p): p is number => p !== null);
    if (closes.length < 2) return 0;
    const pct = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
    return Math.round(pct * 100) / 100;
  } catch {
    return 0;
  }
}

/** Update market_validation on each metric based on stock direction vs signal direction. */
function computeMarketAlignment(
  insights: SectionalInsight[],
  stockPriceChange: number
): { insights: SectionalInsight[]; marketAlignmentPct: number } {
  let aligned = 0;
  let nonNoise = 0;

  const stockUp = stockPriceChange > 2;
  const stockDown = stockPriceChange < -2;

  for (const insight of insights) {
    for (const m of insight.metrics) {
      if (m.signal_classification === "Noise") continue;
      nonNoise++;
      const sigPos = m.signal_classification === "Positive";
      const sigNeg = m.signal_classification === "Negative";

      if ((stockUp && sigPos) || (stockDown && sigNeg)) {
        m.market_validation = "aligned";
        m.market_note = `Stock ${stockUp ? "gained" : "fell"} ${Math.abs(stockPriceChange).toFixed(1)}% — consistent with ${m.signal_classification.toLowerCase()} signal`;
        aligned++;
      } else if ((stockDown && sigPos) || (stockUp && sigNeg)) {
        m.market_validation = "divergent";
        m.market_note = `Stock ${stockUp ? "gained" : "fell"} ${Math.abs(stockPriceChange).toFixed(1)}% — diverges from ${m.signal_classification.toLowerCase()} signal`;
      }
    }
  }

  const pct = nonNoise > 0 ? Math.round((aligned / nonNoise) * 1000) / 10 : 0;
  return { insights, marketAlignmentPct: pct };
}

// ── Main pipeline entry point ─────────────────────────────────────────────────

export async function runPipeline(
  qPrevKey: string,
  qCurrKey: string,
  onProgress?: ProgressCallback
): Promise<DashboardPayload> {
  const prevInfo = parseFilename(qPrevKey);
  const currInfo = parseFilename(qCurrKey);
  if (!prevInfo || !currInfo) {
    throw new Error("PDF filenames must match format: CompanyTicker_Q#_Year.pdf");
  }
  if (prevInfo.company !== currInfo.company) {
    throw new Error(`Company mismatch: ${prevInfo.company} vs ${currInfo.company}`);
  }
  const company = currInfo.company;
  const qPrev = prevInfo.quarter;
  const qCurr = currInfo.quarter;

  // Step 1: Extract PDF text
  const [textPrev, textCurr] = await Promise.all([
    extractPdfText(qPrevKey),
    extractPdfText(qCurrKey),
  ]);

  // Step 2: 8 thematic agents + evasiveness in parallel
  const sectionNames = Object.keys(AGENT_PROMPTS);
  onProgress?.({ type: "start", sections: sectionNames });

  const [snapshotsPrevRaw, snapshotsCurrRaw, evasiveness] = await Promise.all([
    Promise.all(
      sectionNames.map((s) =>
        runThematicAgent(s, textPrev, company, qPrev).then((r) => {
          onProgress?.({ type: "thematic_done", section: s, which: "prev" });
          return r;
        })
      )
    ),
    Promise.all(
      sectionNames.map((s) =>
        runThematicAgent(s, textCurr, company, qCurr).then((r) => {
          onProgress?.({ type: "thematic_done", section: s, which: "curr" });
          return r;
        })
      )
    ),
    runEvasivenessAgent(textCurr, company, qCurr).then((score) => {
      onProgress?.({ type: "evasiveness_done", score });
      return score;
    }),
  ]);

  const snapshotsPrev = snapshotsPrevRaw.filter(
    (s): s is QuarterSnapshot => s !== null
  );
  const snapshotsCurr = snapshotsCurrRaw.filter(
    (s): s is QuarterSnapshot => s !== null
  );
  console.log(`[Pipeline] Thematic agents done: prev=${snapshotsPrev.length}/4 curr=${snapshotsCurr.length}/4`);

  // Step 3: Temporal delta in parallel
  const prevMap = new Map(snapshotsPrev.map((s) => [s.section_name, s]));
  const deltaResults = await Promise.all(
    snapshotsCurr
      .filter((s) => prevMap.has(s.section_name))
      .map((snapCurr) =>
        runTemporalDelta(
          snapCurr.section_name,
          prevMap.get(snapCurr.section_name)!,
          snapCurr,
          qPrev,
          qCurr
        ).then((r) => {
          onProgress?.({ type: "delta_done", section: snapCurr.section_name });
          return r;
        })
      )
  );
  const rawInsights = deltaResults.filter(
    (i): i is SectionalInsight => i !== null
  );
  console.log(`[Pipeline] Delta agents done: ${rawInsights.length}/4 insights produced`);

  // Step 4: Local validation
  const { insights: validatedInsights, validationScore, flaggedCount } = localValidation(rawInsights);

  // Step 5: Fetch stock price + compute market alignment in parallel with assembly
  const stockPriceChange = await fetchStockPriceChange(company, qCurr);
  onProgress?.({ type: "stock_done", stockPriceChange });
  const { insights, marketAlignmentPct } = computeMarketAlignment(validatedInsights, stockPriceChange);

  // Step 6: Assemble
  const { score: overallScore, signal: overallSignal } = computeOverallSignal(insights);
  const allTakeaways = insights.flatMap((i) => i.key_takeaways.slice(0, 2));
  const summary =
    allTakeaways.slice(0, 3).join(" ") ||
    `No significant changes detected between ${qPrev} and ${qCurr} for ${company}.`;

  return {
    company_ticker: company,
    quarter: qCurr,
    quarter_previous: qPrev,
    executive_evasiveness_score: Math.round(evasiveness * 10) / 10,
    insights,
    overall_score: overallScore,
    overall_signal: overallSignal,
    summary,
    validation_score: validationScore,
    flagged_count: flaggedCount,
    market_alignment_pct: marketAlignmentPct,
    stock_price_change: stockPriceChange,
    market_sources: [],
  };
}
