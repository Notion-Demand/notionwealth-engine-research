/**
 * Multi-quarter Insights pipeline.
 * For a given ticker, fetches all available transcripts and produces:
 *  - Per-quarter financial snapshot (Revenue, Margin, PAT, CapEx)
 *  - Common recurring themes with their evolution
 *  - Management guidance tracker (what was promised vs delivered)
 *  - Products/segments evolution across quarters
 *  - New business signals (customers, geographies, products)
 */
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { Schema } from "@google/generative-ai";
import pdfParse from "pdf-parse";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ── Progress events ───────────────────────────────────────────────────────────

export type InsightsProgressEvent =
  | { type: "start"; ticker: string; quarters: string[] }
  | { type: "quarter_done"; quarter: string }
  | { type: "synthesis_start" }
  | { type: "done"; payload: InsightsPayload }
  | { type: "error"; detail: string };

export type InsightsProgressCallback = (e: InsightsProgressEvent) => void;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuarterBrief {
  quarter: string;
  key_points: string[];
  segment_highlights: { segment: string; description: string; direction: string }[];
  guidance_statements: { statement: string; topic: string; specificity: string; timeframe?: string }[];
  new_developments: { type: string; description: string }[];
  management_tone: string;
}

export interface RecurringTheme {
  theme: string;
  appears_in: string[];      // quarter list
  evolution: string;         // narrative of how it changed
  status: "consistent" | "improving" | "declining" | "dropped" | "newly_emerging";
  signal: "Positive" | "Negative" | "Neutral";
}

export interface GuidanceTrack {
  topic: string;
  initial_quarter: string;
  initial_statement: string;
  subsequent_updates: string;
  consistency: "consistent" | "upgraded" | "downgraded" | "abandoned" | "unclear";
}

export interface InsightsPayload {
  ticker: string;
  quarters_analyzed: string[];
  quarter_briefs: QuarterBrief[];
  recurring_themes: RecurringTheme[];
  guidance_tracks: GuidanceTrack[];
  management_credibility_score: number;   // 0–10, higher = more reliable guidance
  new_business_signals: string[];         // key geographies, customers, products emerging
  key_watchpoints: string[];              // what to watch next quarter
  segment_narrative: string;             // one-paragraph segment evolution summary
}

// ── Gemini schemas ────────────────────────────────────────────────────────────

function getGenAI(): GoogleGenerativeAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
  return new GoogleGenerativeAI(apiKey);
}

const CALL_TIMEOUT_MS = 55_000;

async function invokeStructured<T>(system: string, user: string, schema: Schema): Promise<T> {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction: system,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0,
    } as any,
  });
  const timeout = new Promise<never>((_, r) =>
    setTimeout(() => r(new Error("Gemini timed out")), CALL_TIMEOUT_MS)
  );
  const result = await Promise.race([model.generateContent(user), timeout]);
  return JSON.parse(result.response.text()) as T;
}

const QUARTER_BRIEF_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    key_points: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    segment_highlights: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          segment:     { type: SchemaType.STRING },
          description: { type: SchemaType.STRING },
          direction:   { type: SchemaType.STRING },
        },
        required: ["segment", "description", "direction"],
      },
    },
    guidance_statements: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          statement:    { type: SchemaType.STRING },
          topic:        { type: SchemaType.STRING },
          specificity:  { type: SchemaType.STRING },
          timeframe:    { type: SchemaType.STRING },
        },
        required: ["statement", "topic", "specificity"],
      },
    },
    new_developments: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          type:        { type: SchemaType.STRING },
          description: { type: SchemaType.STRING },
        },
        required: ["type", "description"],
      },
    },
    management_tone: { type: SchemaType.STRING },
  },
  required: ["key_points", "segment_highlights", "guidance_statements", "new_developments", "management_tone"],
};

const QUARTER_BRIEF_SYSTEM = `You are a senior buy-side analyst building a quarterly research dossier.

Extract the following from this earnings call transcript:

1. **key_points** — 5-7 most important factual points from this quarter (not opinions — facts, numbers, decisions, specific statements).

2. **segment_highlights** — For each business segment/product line discussed: brief description + direction (growing/stable/declining/new). Only include segments explicitly discussed.

3. **guidance_statements** — Every forward-looking statement management made. Include verbatim quote as the "statement", the topic it relates to (e.g. "Revenue growth", "Margin expansion", "CapEx"), and specificity ("vague", "moderate", or "specific"). Include timeframe if stated (e.g. "FY26", "next 2 quarters").

4. **new_developments** — Any NEW developments first mentioned this quarter: new customer wins, new geographies entered, new product launches, new partnerships, new technology investments. Type must be one of: customer, geography, product, technology, partnership.

5. **management_tone** — Overall tone: "optimistic", "cautious", "neutral", or "defensive".

RULES: Never fabricate. Extract only what is explicitly stated in the transcript.`;

const SYNTHESIS_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    recurring_themes: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          theme:       { type: SchemaType.STRING },
          appears_in:  { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          evolution:   { type: SchemaType.STRING },
          status:      { type: SchemaType.STRING },
          signal:      { type: SchemaType.STRING },
        },
        required: ["theme", "appears_in", "evolution", "status", "signal"],
      },
    },
    guidance_tracks: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          topic:               { type: SchemaType.STRING },
          initial_quarter:     { type: SchemaType.STRING },
          initial_statement:   { type: SchemaType.STRING },
          subsequent_updates:  { type: SchemaType.STRING },
          consistency:         { type: SchemaType.STRING },
        },
        required: ["topic", "initial_quarter", "initial_statement", "subsequent_updates", "consistency"],
      },
    },
    management_credibility_score: { type: SchemaType.NUMBER },
    new_business_signals:         { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    key_watchpoints:              { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    segment_narrative:            { type: SchemaType.STRING },
  },
  required: ["recurring_themes", "guidance_tracks", "management_credibility_score", "new_business_signals", "key_watchpoints", "segment_narrative"],
};

const SYNTHESIS_SYSTEM = `You are a senior fund manager synthesizing quarterly earnings call research across multiple quarters.

You are given structured briefs from earnings calls across several consecutive quarters for the same company.

Your job:

1. **recurring_themes** — Topics that appear in 2 or more quarters. For each: describe how the theme evolved (e.g., "CEO mentioned efficiency initiatives in Q1, locked in solar plant in Q2, reported ₹14cr savings in Q3"). Status must be one of: consistent/improving/declining/dropped/newly_emerging. Signal: Positive/Negative/Neutral.

2. **guidance_tracks** — Track management guidance across quarters. For each tracked topic: what did they first say, how did it change each quarter, and was it delivered (consistency: consistent/upgraded/downgraded/abandoned/unclear)?

3. **management_credibility_score** — Score 0–10. 10 = management consistently delivers on specific guidance. 0 = guidance frequently abandoned, vague, or contradicted. Base this on how many guidance_statements were specific vs vague, and whether delivered guidance was confirmed in later quarters.

4. **new_business_signals** — List all new customers, geographies, product lines, technology investments first mentioned across all quarters. Keep each item concise (one line).

5. **key_watchpoints** — 4-6 items to watch in the next quarter, based on pending guidance, nascent trends, or unanswered analyst questions.

6. **segment_narrative** — 2-3 sentence paragraph describing how the business segment mix and focus has shifted across the quarters analyzed.

RULES:
- Be specific. Name the quarters when things changed.
- Flag when management said something in Q1 but changed tack by Q3.
- Do NOT make up data not in the briefs.`;

// ── Cache helpers ─────────────────────────────────────────────────────────────

/** Stable cache key: sorted comma-joined quarter list */
function makeQuartersKey(quarters: string[]): string {
  return [...quarters].sort().join(",");
}

const CACHE_TTL_DAYS = 30;

async function getCachedInsights(
  ticker: string,
  qKey: string
): Promise<InsightsPayload | null> {
  try {
    const cutoff = new Date(
      Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const { data, error } = await supabaseAdmin()
      .from("insights_cache")
      .select("payload")
      .eq("ticker", ticker)
      .eq("quarters_key", qKey)
      .gte("created_at", cutoff)
      .maybeSingle();
    if (error || !data) return null;
    return data.payload as InsightsPayload;
  } catch {
    return null;
  }
}

async function setCachedInsights(
  ticker: string,
  qKey: string,
  payload: InsightsPayload
): Promise<void> {
  await supabaseAdmin()
    .from("insights_cache")
    .upsert(
      { ticker, quarters_key: qKey, payload, created_at: new Date().toISOString() },
      { onConflict: "ticker,quarters_key" }
    );
}

// ── Storage helpers ───────────────────────────────────────────────────────────

const BUCKET = "transcripts";
const MAX_CHARS = 120_000;

export async function getQuartersForTicker(ticker: string): Promise<string[]> {
  // Direct ticker search — same approach as /api/v1/available (A-Z fan-out was unreliable)
  const { data } = await supabaseAdmin()
    .storage.from(BUCKET)
    .list("", { limit: 50, search: ticker });
  const quarters: string[] = [];
  for (const f of data ?? []) {
    const m = f.name.match(/^(.+?)_Q(\d)_(\d{4})\.pdf$/i);
    if (!m) continue;
    if (m[1].toUpperCase() !== ticker.toUpperCase()) continue;
    quarters.push(`Q${m[2]}_${m[3]}`);
  }
  // Sort newest-first by year then quarter (Q3_2026 > Q4_2025)
  function qKey(q: string) {
    const m = q.match(/^Q(\d)_(\d{4})$/);
    return m ? parseInt(m[2]) * 10 + parseInt(m[1]) : 0;
  }
  quarters.sort((a, b) => qKey(b) - qKey(a));
  return quarters;
}

async function fetchTranscriptText(ticker: string, quarter: string): Promise<string> {
  const filename = `${ticker}_${quarter}.pdf`;
  const { data: blob, error } = await supabaseAdmin()
    .storage.from(BUCKET)
    .download(filename);
  if (error || !blob) throw new Error(`Download failed: ${filename}`);
  const buf = Buffer.from(await blob.arrayBuffer());
  const parsed = await pdfParse(buf);
  return parsed.text.slice(0, MAX_CHARS);
}

// ── Agent runners ─────────────────────────────────────────────────────────────

async function runQuarterBriefAgent(
  ticker: string,
  quarter: string,
  text: string
): Promise<QuarterBrief> {
  const user = `Company: ${ticker}\nQuarter: ${quarter}\n\nTRANSCRIPT:\n${text}`;
  try {
    const raw = await invokeStructured<Omit<QuarterBrief, "quarter">>(
      QUARTER_BRIEF_SYSTEM,
      user,
      QUARTER_BRIEF_SCHEMA
    );
    return { quarter, ...raw };
  } catch (e) {
    console.error(`[Insights] Brief failed for ${quarter}:`, e);
    return {
      quarter,
      key_points: [],
      segment_highlights: [],
      guidance_statements: [],
      new_developments: [],
      management_tone: "neutral",
    };
  }
}

async function runSynthesisAgent(
  ticker: string,
  briefs: QuarterBrief[]
): Promise<Omit<InsightsPayload, "ticker" | "quarters_analyzed" | "quarter_briefs">> {
  // Build a compact text summary of all briefs for the synthesis prompt
  const briefTexts = briefs.map((b) => {
    const segs = b.segment_highlights.map((s) => `  • ${s.segment} (${s.direction}): ${s.description}`).join("\n");
    const guidance = b.guidance_statements.map((g) => `  • [${g.specificity}] ${g.topic}: "${g.statement}"${g.timeframe ? ` (${g.timeframe})` : ""}`).join("\n");
    const newDevs = b.new_developments.map((d) => `  • [${d.type}] ${d.description}`).join("\n");
    return `=== ${b.quarter} (tone: ${b.management_tone}) ===\nKey points:\n${b.key_points.map((p) => `  • ${p}`).join("\n")}\nSegments:\n${segs || "  none stated"}\nGuidance:\n${guidance || "  none stated"}\nNew developments:\n${newDevs || "  none"}`;
  }).join("\n\n");

  const user = `Company: ${ticker}\nQuarters analyzed (newest first): ${briefs.map((b) => b.quarter).join(", ")}\n\n${briefTexts}`;

  try {
    return await invokeStructured<Omit<InsightsPayload, "ticker" | "quarters_analyzed" | "quarter_briefs">>(
      SYNTHESIS_SYSTEM,
      user,
      SYNTHESIS_SCHEMA
    );
  } catch (e) {
    console.error("[Insights] Synthesis failed:", e);
    return {
      recurring_themes: [],
      guidance_tracks: [],
      management_credibility_score: 5,
      new_business_signals: [],
      key_watchpoints: [],
      segment_narrative: "Synthesis unavailable.",
    };
  }
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function runInsightsPipeline(
  ticker: string,
  onProgress?: InsightsProgressCallback,
  options?: { force?: boolean }
): Promise<InsightsPayload> {
  // 1. Discover quarters
  const quarters = await getQuartersForTicker(ticker);
  if (quarters.length === 0) throw new Error(`No transcripts found for ${ticker}`);

  // Use up to 8 quarters (2 full fiscal years)
  const targetQuarters = quarters.slice(0, 8);
  const cacheKey = makeQuartersKey(targetQuarters);

  // 2. Cache check (skip when force=true)
  if (!options?.force) {
    const cached = await getCachedInsights(ticker, cacheKey);
    if (cached) {
      console.log(`[Insights] Cache hit for ${ticker} (${cacheKey})`);
      // Replay progress events quickly so the UI still animates
      onProgress?.({ type: "start", ticker, quarters: targetQuarters });
      for (const q of targetQuarters) {
        onProgress?.({ type: "quarter_done", quarter: q });
      }
      onProgress?.({ type: "synthesis_start" });
      return cached;
    }
  }

  // 3. Full pipeline run
  onProgress?.({ type: "start", ticker, quarters: targetQuarters });

  // Download + parse all transcripts in parallel
  const texts = await Promise.all(
    targetQuarters.map((q) =>
      fetchTranscriptText(ticker, q).catch(() => "")
    )
  );

  // Run brief agents in parallel
  const briefs = await Promise.all(
    targetQuarters.map((q, i) =>
      runQuarterBriefAgent(ticker, q, texts[i]).then((b) => {
        onProgress?.({ type: "quarter_done", quarter: q });
        return b;
      })
    )
  );

  // Synthesis
  onProgress?.({ type: "synthesis_start" });
  const synthesis = await runSynthesisAgent(ticker, briefs);

  const payload: InsightsPayload = {
    ticker,
    quarters_analyzed: targetQuarters,
    quarter_briefs: briefs,
    ...synthesis,
  };

  // 4. Persist to cache (non-blocking — don't fail the request if this errors)
  setCachedInsights(ticker, cacheKey, payload).catch((e) =>
    console.warn("[Insights] Cache write failed:", e)
  );

  return payload;
}
