/**
 * Multi-agent earnings transcript pipeline — TypeScript port of the Python pipeline.
 * Runs 8 parallel Gemini calls (4 thematic agents × 2 quarters) + evasiveness,
 * then 4 temporal delta comparisons, then local validation.
 */
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { Schema } from "@google/generative-ai";
import pdfParse from "pdf-parse";
import { NIFTY50 } from "./nifty50";
import { NIFTY200 } from "./nifty200";
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

export interface KeyMetrics {
  revenue?: string;           // e.g. "₹98,000 cr"
  revenue_growth?: string;    // e.g. "+11% YoY"
  ebitda_margin?: string;     // e.g. "28.8%"
  ebitda_change?: string;     // e.g. "+150 bps YoY"
  pat?: string;               // e.g. "₹19,260 cr"
  pat_growth?: string;        // e.g. "+15% YoY"
  product_highlight?: string; // e.g. "Digital: 55% of EBITDA mix"
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
  earnings_delta: string[];      // "What Changed" bullets (8-10 directional shifts)
  fcf_implications: string[];    // "What This Means Financially" bullets (5-6)
  key_metrics?: KeyMetrics;      // Quick-read top-line numbers from current quarter
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

const BULLETS_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    bullets: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: ["bullets"],
};

const KEY_METRICS_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    revenue:           { type: SchemaType.STRING },
    revenue_growth:    { type: SchemaType.STRING },
    ebitda_margin:     { type: SchemaType.STRING },
    ebitda_change:     { type: SchemaType.STRING },
    pat:               { type: SchemaType.STRING },
    pat_growth:        { type: SchemaType.STRING },
    product_highlight: { type: SchemaType.STRING },
  },
  required: [],
};

const KEY_METRICS_SYSTEM = `You are a financial data extractor. Extract exactly these numbers from the earnings call transcript — nothing more.

For each field:
- revenue: consolidated revenue/sales figure for the current quarter (e.g. "₹98,000 cr" or "$4.2bn")
- revenue_growth: YoY growth stated or implied (e.g. "+11% YoY")
- ebitda_margin: EBITDA margin % for the quarter (e.g. "28.8%")
- ebitda_change: change in EBITDA margin vs same quarter last year (e.g. "+150 bps YoY")
- pat: net profit / PAT for the quarter (e.g. "₹19,260 cr")
- pat_growth: PAT YoY growth (e.g. "+15% YoY")
- product_highlight: one-line segment/product mix signal (e.g. "Digital: 55% of EBITDA" or "Exports: 62% of revenue")

Rules:
- If a figure is NOT explicitly stated, leave the field as an empty string — do NOT estimate.
- Use the exact number management cited, not analyst questions.
- Prefer consolidated figures over standalone.
- Keep values short (under 20 chars each).`;

// ── Gemini client helper ──────────────────────────────────────────────────────

function getGenAI(): GoogleGenerativeAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
  return new GoogleGenerativeAI(apiKey);
}

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
 * Paginates the bucket list to handle >1000 files and Supabase's
 * quirk of returning fewer than `limit` items even when more exist.
 */
export async function resolvePdfKey(ticker: string, quarter: string): Promise<string> {
  const target = `${ticker}_${quarter}.pdf`.toLowerCase();
  const allFiles: { name: string }[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .list("", { limit: 100, offset });
    if (error) throw new Error(`Storage list failed: ${error.message}`);
    if (!data || data.length === 0) break;
    allFiles.push(...data);
    offset += data.length;
  }
  const file = allFiles.find((f) => f.name.toLowerCase() === target);
  if (file) return file.name;
  const available = allFiles
    .filter((f) => f.name.toUpperCase().startsWith(ticker.toUpperCase() + "_"))
    .map((f) => f.name)
    .sort();
  const hint = available.length > 0 ? ` Available for ${ticker}: ${available.join(", ")}` : "";
  throw new Error(`PDF not found: ${ticker} ${quarter}.${hint}`);
}

// Large conglomerate calls (e.g. Reliance, TCS) run 2-3+ hours — cap at 120 K
// to ensure all segments and Q&A are captured without hitting Gemini context limits.
const MAX_TRANSCRIPT_CHARS = 120_000;

async function extractPdfText(storageKey: string): Promise<string> {
  const { data: blob, error } = await supabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .download(storageKey);
  if (error || !blob) throw new Error(`Storage download failed for ${storageKey}: ${error?.message}`);
  const buffer = Buffer.from(await blob.arrayBuffer());

  const header = buffer.slice(0, 5).toString("ascii");
  console.log(`[Pipeline] ${storageKey}: ${buffer.length} bytes, header="${header}"`);

  if (buffer.length === 0) {
    throw new Error(`${storageKey} is empty — delete it from storage and re-request the ticker`);
  }
  if (!header.startsWith("%PDF")) {
    throw new Error(`${storageKey} is not a valid PDF (header: "${header}") — delete it from storage and re-request the ticker`);
  }

  try {
    const parsed = await pdfParse(buffer);
    const text = parsed.text;
    if (text.length > MAX_TRANSCRIPT_CHARS) {
      console.log(`[Pipeline] ${storageKey}: ${text.length} chars → truncated to ${MAX_TRANSCRIPT_CHARS}`);
    }
    return text.slice(0, MAX_TRANSCRIPT_CHARS);
  } catch (e) {
    throw new Error(
      `${storageKey} could not be parsed (${e instanceof Error ? e.message : e}). ` +
      `The stored PDF appears to be corrupted. Delete it from Supabase storage and re-request the ticker.`
    );
  }
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
  "Revenue & Growth": `You are a senior equity research analyst specializing in revenue quality and growth decomposition.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **Volume vs Realisation split** — volume growth %, realisation/price per unit trends, ARPU, tonnage, CBM, per-unit economics
2. **Pricing Power & Strategy** — tariff hikes (exact % and timing), price increases taken, ability to pass costs, contract pricing, whether hikes are to "protect margins" or "expand margins", lag between cost inflation and pricing pass-through
3. **Segment-level Performance** — revenue and growth per segment/product line, which segments are driving/dragging, capacity utilization per segment, strategic posture per segment (invest/maintain/scale-back)
4. **Customer & Distribution** — additions, churn, dealer/retailer dynamics, channel stocking, secondary sales trends, go-to-market changes, geographic penetration expansion, distribution network metrics
5. **New Market Expansion** — new customers, new geographies, new products, new industries, import substitution, China+1 opportunity
6. **Revenue Visibility** — order book, backlog, demand pipeline, long-term contracts, guidance specificity, demand health in current/recent months

RULES:
- Extract VERBATIM quotes (do NOT paraphrase). Include speaker attribution.
- Separate volume-driven growth from price/realisation-driven growth wherever discussed
- For multi-segment companies, provide detail on EACH segment individually
- Capture pricing philosophy and mechanics (protect vs expand, lag effects, relationship vs list pricing)
- Flag channel/distribution changes — these are leading indicators
- Provide 3-5 key takeaways on revenue quality and growth trajectory`,

  "Margins & Profitability": `You are a senior financial analyst specializing in profitability and margin structure analysis.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **Gross / Contribution Margin** — product-level margins, spread between realisation and variable cost
2. **EBITDA Margin** — level, YoY/QoQ change, trajectory, guidance
3. **PAT Margin & Net Profitability** — PAT, PAT margin, tax rate, minority interest, EPS
4. **Operating Leverage** — how margins behave as volumes change, fixed vs variable cost structure
5. **Margin Guidance** — explicit margin targets, management's expected margin range, confidence level
6. **One-time vs Recurring** — items that inflate/deflate reported margins, normalized margin discussion

RULES:
- Extract VERBATIM quotes (do NOT paraphrase). Include speaker attribution.
- Always note the specific numbers discussed (e.g., "28.8% EBITDA vs 27.3% PY")
- Flag management's comfort zone / target range if stated
- Provide 3-5 key takeaways on profitability trajectory and margin sustainability`,

  "Cost Structure": `You are a senior industrial analyst specializing in cost structure and operational efficiency.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **Raw Material / Input Costs** — commodity prices (steel, crude, chemicals, timber, resin, freight), % of revenue, price pass-through mechanisms, lag effects between cost change and selling price adjustment, specific inflation/deflation quantified
2. **Power & Energy Costs** — energy tariffs, captive power, solar/renewable savings, fuel costs, debottlenecking for efficiency, quantified annual savings
3. **Labour & Employee Costs** — headcount, wage inflation, productivity improvements, restructuring, leadership changes impacting cost
4. **Supply Chain & Procurement** — vendor concentration, logistics/freight costs, import/export duties, geopolitical supply chain disruptions, sourcing changes
5. **Cost Reduction Initiatives** — specific programs, quantified savings, timelines, automation, technology-driven efficiency, operating leverage from higher utilization
6. **Pricing Philosophy & Pass-Through** — whether management prices to protect margins or expand them, relationship-driven vs list pricing, selective vs across-the-board hikes, timing of hikes relative to cost inflation

RULES:
- Extract VERBATIM quotes (do NOT paraphrase). Include speaker attribution.
- Quantify cost savings wherever management provides numbers
- Note whether cost pressures are structural or cyclical/temporary
- Capture the MECHANISM of cost pass-through (lag, formula-based, negotiated, relationship-driven)
- Provide 3-5 key takeaways on cost structure and efficiency trajectory`,

  "CapEx & Balance Sheet": `You are a senior credit analyst specializing in capital allocation and balance sheet analysis.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **CapEx Plans** — quantum, projects, phasing, modular/greenfield/brownfield/debottlenecking, maintenance vs growth, land acquisition, MoU vs final investment decisions, commissioning timelines per project
2. **Capacity Utilisation** — current utilization % per segment/plant, targets, timeline to full capacity, whether utilization is a constraint on growth, old plants being shut down or scrapped
3. **Debt & Leverage** — net debt, debt/EBITDA, repayment schedule, refinancing, cost of debt, stated debt discipline ("won't exceed X times EBITDA")
4. **Free Cash Flow** — FCF generation, conversion rate, working capital changes
5. **Capital Allocation** — dividends, buybacks, M&A, stated priorities for deployment, "sweating existing assets" vs new investment philosophy
6. **Balance Sheet Strength** — liquidity buffers, covenants, credit rating, contingent liabilities

RULES:
- Extract VERBATIM quotes (do NOT paraphrase). Include speaker attribution.
- Flag any capex decisions that were deferred, accelerated, or cancelled vs prior guidance
- Note both the investment and the expected return/payback period if mentioned
- Provide 3-5 key takeaways on capital allocation discipline and balance sheet trajectory`,

  "Macro & Risk": `You are a senior risk analyst specializing in macro-level threats and systemic risk assessment.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **FX & Commodity Exposure** — currency impact, hedging, geographic revenue split, commodity price risks
2. **Geopolitical & Trade Risks** — tariffs, sanctions, supply chain disruption, country concentration
3. **Regulatory & Policy** — new regulations, government schemes, spectrum/licensing, ESG compliance
4. **Competitive Dynamics** — market share shifts, new entrants, pricing wars, industry consolidation
5. **Demand Environment** — sector tailwinds/headwinds, customer industry health, macro indicators
6. **Management's Own Risk Language** — cautionary phrasing, "subject to", conditional guidance, scenario framing

RULES:
- Extract VERBATIM quotes (do NOT paraphrase). Include speaker attribution.
- Pay EXTRA attention to Q&A — analysts often surface risks management avoids in prepared remarks
- Flag any risk that was discussed in detail but NOT quantified (often the most important ones)
- Provide 3-5 key takeaways summarizing the risk landscape and management's preparedness`,
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

const EARNINGS_DELTA_SYSTEM = `You are a senior sell-side analyst writing the "What Changed This Quarter" block of an earnings flash note.

You are given key delta signals from multiple analysis domains comparing the previous quarter to the current quarter.

Write 8-10 tight bullets capturing the most important directional changes in management language, strategy, and financial posture.

FORMAT: Each bullet = "Topic: From [prior stance] → [new stance]"
Examples:
- CapEx tone: From "elevated rollout phase" → "moderation into FY26"
- Capital allocation: From growth-heavy → deleveraging + dividend intent

RULES:
- Focus on DIRECTION changes, not just facts
- Only include bullets where something materially changed
- Avoid repeating the same signal in different words
- Each bullet must be under 20 words
- If fewer than 8 meaningful changes exist, include fewer — quality over quantity
- Do NOT fabricate shifts; if a domain shows no change, skip it`;

const FCF_IMPLICATIONS_SYSTEM = `You are a fund manager writing the "What This Means Financially" section of an internal earnings brief.

You are given the key delta signals from multiple analysis domains comparing the previous quarter to the current quarter.

Write 5-6 tight bullets connecting the narrative shifts to cash flow and equity value implications.

FORMAT: Each bullet = "[Narrative shift] → [Financial implication]"
Examples:
- Lower capex guidance → expanding FCF conversion in coming quarters
- Accelerated deleveraging → equity value accretion as interest burden falls

RULES:
- Connect one narrative shift to one specific financial outcome per bullet
- Do NOT quantify unless the transcript provides specific numbers
- Focus on: FCF conversion, leverage trajectory, earnings quality, valuation framing, margin structure
- If a signal's financial impact is genuinely unclear, omit it
- Each bullet must be under 25 words
- Do NOT include bullets that are obvious or tautological`;

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

/** Build a compact multi-section delta summary to feed the synthesis agents. */
function buildDeltaSummary(insights: SectionalInsight[], qPrev: string, qCurr: string): string {
  return insights.map((ins) => {
    const takeaways = ins.key_takeaways.map((t) => `  - ${t}`).join("\n");
    const shifts = ins.metrics
      .filter((m) => m.signal_classification !== "Noise")
      .slice(0, 4)
      .map((m) => `  [${m.signal_classification}] ${m.subtopic}: ${m.language_shift}`)
      .join("\n");
    return `=== ${ins.section_name} ===\nKey takeaways (${qPrev} → ${qCurr}):\n${takeaways || "  None"}\nTop signals:\n${shifts || "  None"}`;
  }).join("\n\n");
}

async function runEarningsDeltaAgent(
  insights: SectionalInsight[],
  company: string,
  qPrev: string,
  qCurr: string
): Promise<string[]> {
  const summary = buildDeltaSummary(insights, qPrev, qCurr);
  const userPrompt = `Company: ${company}\nComparing: ${qPrev} → ${qCurr}\n\n${summary}`;
  try {
    const result = await invokeStructured<{ bullets: string[] }>(
      EARNINGS_DELTA_SYSTEM,
      userPrompt,
      BULLETS_SCHEMA
    );
    return result.bullets ?? [];
  } catch (e) {
    console.error("[EarningsDelta] Agent failed:", e);
    return [];
  }
}

async function runFCFImplicationsAgent(
  insights: SectionalInsight[],
  company: string,
  qPrev: string,
  qCurr: string
): Promise<string[]> {
  const summary = buildDeltaSummary(insights, qPrev, qCurr);
  const userPrompt = `Company: ${company}\nComparing: ${qPrev} → ${qCurr}\n\n${summary}`;
  try {
    const result = await invokeStructured<{ bullets: string[] }>(
      FCF_IMPLICATIONS_SYSTEM,
      userPrompt,
      BULLETS_SCHEMA
    );
    return result.bullets ?? [];
  } catch (e) {
    console.error("[FCFImplications] Agent failed:", e);
    return [];
  }
}

async function runKeyMetricsAgent(
  transcript: string,
  company: string,
  quarter: string
): Promise<KeyMetrics> {
  const userPrompt = `Extract key financial metrics from this ${company} ${quarter} earnings call transcript.\n\n${transcript.slice(0, 40_000)}`;
  try {
    const result = await invokeStructured<KeyMetrics>(
      KEY_METRICS_SYSTEM,
      userPrompt,
      KEY_METRICS_SCHEMA
    );
    // Strip empty strings so the UI knows what to show/hide
    return Object.fromEntries(
      Object.entries(result).filter(([, v]) => typeof v === "string" && v.trim() !== "")
    ) as KeyMetrics;
  } catch {
    return {};
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
  const info = NIFTY50[ticker] ?? NIFTY200[ticker];
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

  // Step 4: Local validation + synthesis agents in parallel
  const { insights: validatedInsights, validationScore, flaggedCount } = localValidation(rawInsights);

  const [stockPriceChange, earningsDelta, fcfImplications, keyMetrics] = await Promise.all([
    fetchStockPriceChange(company, qCurr).then((v) => {
      onProgress?.({ type: "stock_done", stockPriceChange: v });
      return v;
    }),
    runEarningsDeltaAgent(validatedInsights, company, qPrev, qCurr),
    runFCFImplicationsAgent(validatedInsights, company, qPrev, qCurr),
    runKeyMetricsAgent(textCurr, company, qCurr),
  ]);
  console.log(`[Pipeline] Synthesis done: earningsDelta=${earningsDelta.length} bullets, fcfImplications=${fcfImplications.length} bullets`);

  const { insights, marketAlignmentPct } = computeMarketAlignment(validatedInsights, stockPriceChange);

  // Step 5: Assemble
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
    earnings_delta: earningsDelta,
    fcf_implications: fcfImplications,
    key_metrics: keyMetrics,
  };
}
