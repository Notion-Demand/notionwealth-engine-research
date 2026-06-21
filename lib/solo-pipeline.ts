/**
 * Single-quarter deep-dive analysis pipeline.
 * Produces a comprehensive earnings brief (like Tijori/Screener but richer)
 * for one quarter — no delta comparison needed.
 */
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { Schema } from "@google/generative-ai";
import { resolvePdfKey, parseFilename } from "./pipeline";
import { supabaseAdmin } from "@/lib/supabase/admin";
import pdfParse from "pdf-parse";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SoloSection {
  title: string;
  bullets: string[];
}

export interface SoloPayload {
  company_ticker: string;
  quarter: string;
  headline: string;
  management_tone: string;
  sections: SoloSection[];
}

export type SoloProgressEvent =
  | { type: "start" }
  | { type: "extracting" }
  | { type: "analyzing" }
  | { type: "done"; payload: SoloPayload; id: string }
  | { type: "error"; detail: string };

export type SoloProgressCallback = (e: SoloProgressEvent) => void;

// ── Gemini ───────────────────────────────────────────────────────────────────

function getGenAI(): GoogleGenerativeAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
  return new GoogleGenerativeAI(apiKey);
}

const TIMEOUT_MS = 55_000;

const SOLO_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    headline: { type: SchemaType.STRING },
    management_tone: { type: SchemaType.STRING },
    sections: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          bullets: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
        required: ["title", "bullets"],
      },
    },
  },
  required: ["headline", "management_tone", "sections"],
};

const SOLO_SYSTEM = `You are a senior sell-side equity research analyst writing a comprehensive earnings call brief for institutional investors.

Given a full earnings call transcript, produce a structured analysis that captures EVERYTHING material discussed — this should be significantly more detailed than a basic screener summary.

Output:
1. **headline** — One-line summary of the quarter's performance vs prior year (e.g. "Loan growth re-accelerated to 12% vs 5.5% last year; NIM compressed but ROA stable on operating leverage")

2. **management_tone** — One of: "confident", "cautious", "defensive", "mixed", "optimistic"

3. **sections** — 8-14 thematic sections covering every material topic discussed. Each section has a title and 5-15 detailed bullets.

REQUIRED SECTIONS (always include if discussed):
- "Performance Snapshot" — Revenue/PAT/EPS with YoY comparison, what moved vs last year, volume vs realisation decomposition, key financial ratios (ROE/ROCE/ROA)
- "Segment Deep Dive" — EACH business segment/product line in detail: revenue + YoY growth, margin, volume vs realization split, capacity utilization, strategic posture (invest/maintain/exit), specific challenges or recovery stories, any plant shutdowns or technology changes. This is the MOST important section — be exhaustive per segment.
- "Margins & Profitability" — EBITDA/operating margin by segment where available, margin expansion/contraction drivers, pricing strategy (protect vs expand margins), cost pass-through mechanics and lag effects, one-time items
- "Pricing, Raw Materials & Input Costs" — Specific price hikes taken (% and timing), raw material trends (commodity, chemicals, timber, crude etc.), pricing philosophy ("protect margins" vs "expand"), lag between cost inflation and price pass-through, supplier dynamics
- "Growth Outlook & Drivers" — Management's forward view, growth levers, demand pipeline, sector tailwinds, revenue/volume targets, capacity expansion timelines
- "Capex & Capacity" — Expansion plans (greenfield/brownfield/debottlenecking), capacity utilization per segment/plant, commissioning timelines, capex quantum and funding, balance sheet discipline (debt/EBITDA targets)
- "Balance Sheet & Capital" — Debt levels, leverage ratios, working capital, free cash flow, capital adequacy (for financials), asset quality

OPTIONAL SECTIONS (include if substantively discussed):
- "Distribution & Channel Strategy" — Go-to-market changes, dealer/retailer dynamics, channel stocking, secondary sales trends, distribution expansion, geographic penetration
- "Customer & Market Position" — Market share, customer wins/concentration, competitive dynamics, organized vs unorganized market shifts, import substitution
- "Risk Factors & Macro" — Geopolitical, FX, commodity, freight disruptions, regulatory, industry headwinds/tailwinds, channel inventory build-up
- "Strategic Initiatives" — New products/technologies, digital adoption, AI/automation, M&A integration, leadership changes, organizational restructuring
- "Management Credibility & Outlook Clarity" — Guidance delivery vs past promises, changed stances, contradictions between prepared remarks and Q&A, level of specificity in forward guidance

BULLET FORMAT:
- Each bullet should be a complete, specific, information-dense statement
- Include exact numbers, percentages, and quotes where management provided them
- Use management's own language in quotes for key claims: "quote here"
- Show causation: "X happened because Y" or "X led to Y"
- Show contrast where relevant: "despite X, Y held because Z"
- For guidance/outlook bullets, include the specific timeframe
- For segment bullets, always include: revenue, growth rate, margin, and management's strategic intent

RULES:
- This must be COMPREHENSIVE — cover every material topic from the call
- Do NOT summarize vaguely — be as specific as the transcript allows
- Include Q&A insights — analysts often surface information management avoids in prepared remarks
- Flag any contradictions between prepared remarks and Q&A answers
- For multi-segment companies, dedicate substantial coverage to EACH segment individually — do not just list them
- Capture pricing philosophy and raw material dynamics as a separate section — this is critical for understanding margin sustainability
- Distribution/channel changes and dealer behavior are often leading indicators — capture them
- Never fabricate data. If you cannot find a number, describe qualitatively.`;

// ── PDF helper ───────────────────────────────────────────────────────────────

const BUCKET = "transcripts";
const MAX_CHARS = 120_000;

async function extractText(storageKey: string): Promise<string> {
  const { data: blob, error } = await supabaseAdmin()
    .storage.from(BUCKET)
    .download(storageKey);
  if (error || !blob) throw new Error(`Download failed: ${storageKey}`);
  const buf = Buffer.from(await blob.arrayBuffer());
  if (buf.length === 0) throw new Error(`${storageKey} is empty`);
  if (!buf.slice(0, 5).toString("ascii").startsWith("%PDF")) {
    throw new Error(`${storageKey} is not a valid PDF`);
  }
  const parsed = await pdfParse(buf);
  return parsed.text.slice(0, MAX_CHARS);
}

// ── Cache ────────────────────────────────────────────────────────────────────

async function getCached(ticker: string, quarter: string): Promise<SoloPayload | null> {
  const { data } = await supabaseAdmin()
    .from("solo_analysis_cache")
    .select("payload")
    .eq("ticker", ticker)
    .eq("quarter", quarter)
    .maybeSingle();
  if (!data?.payload) return null;
  const p = (typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload) as SoloPayload;
  if (!p.sections || p.sections.length === 0) return null;
  return p;
}

async function setCache(ticker: string, quarter: string, payload: SoloPayload): Promise<string> {
  try {
    await supabaseAdmin()
      .from("solo_analysis_cache")
      .delete()
      .eq("ticker", ticker)
      .eq("quarter", quarter);
    const { data } = await supabaseAdmin()
      .from("solo_analysis_cache")
      .insert({ ticker, quarter, payload })
      .select("id")
      .single();
    return data?.id ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ── Main pipeline ────────────────────────────────────────────────────────────

export async function runSoloPipeline(
  ticker: string,
  quarter: string,
  onProgress?: SoloProgressCallback,
  options?: { force?: boolean }
): Promise<{ payload: SoloPayload; id: string }> {
  // Cache check
  if (!options?.force) {
    const cached = await getCached(ticker, quarter);
    if (cached) return { payload: cached, id: "cached" };
  }

  onProgress?.({ type: "start" });

  // Resolve PDF
  const storageKey = await resolvePdfKey(ticker, quarter);
  const info = parseFilename(storageKey);
  const company = info?.company ?? ticker;

  onProgress?.({ type: "extracting" });
  const text = await extractText(storageKey);

  onProgress?.({ type: "analyzing" });

  // Run single comprehensive Gemini call (use full model for quality)
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction: SOLO_SYSTEM,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SOLO_SCHEMA,
      temperature: 0,
    } as any,
  });

  const userPrompt = `Company: ${company}\nQuarter: ${quarter}\n\nFull earnings call transcript:\n${text}`;

  const timeout = new Promise<never>((_, r) =>
    setTimeout(() => r(new Error("Analysis timed out")), TIMEOUT_MS)
  );
  const result = await Promise.race([model.generateContent(userPrompt), timeout]);
  const parsed = JSON.parse(result.response.text()) as {
    headline: string;
    management_tone: string;
    sections: SoloSection[];
  };

  const payload: SoloPayload = {
    company_ticker: company,
    quarter,
    headline: parsed.headline,
    management_tone: parsed.management_tone,
    sections: parsed.sections,
  };

  const id = await setCache(ticker, quarter, payload);
  return { payload, id };
}
