/**
 * Sector Narrative Generator
 *
 * Uses Gemini to synthesise PM-grade sector intelligence from aggregated
 * company earnings signals:
 *   - Competitive structure (consolidated vs fragmented)
 *   - Strategic theme (growth vs profitability this cycle)
 *   - Tailwinds / headwinds (2-3 each, sector-specific)
 *   - Key triggers (events that could re-rate the sector)
 *   - Macro sensitivity (specific factors: rates, FX, oil, budget)
 *   - Transformation signal (structural shift underway, if any)
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { DashboardPayload } from "./pipeline";
import type { CompactSignal } from "./nifty200-sampler";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SectorNarrative {
  competitive_structure: string;  // 1-2 sentences: consolidation vs fragmentation
  strategic_theme: string;        // 1-2 sentences: growth vs profitability cycle
  tailwinds: string[];            // 2-3 specific structural tailwinds
  headwinds: string[];            // 2-3 specific structural headwinds
  key_triggers: string[];         // 2-3 events/risks that could re-rate sector
  macro_sensitivity: string;      // 1-2 sentences: which macro factors, how
  transformation_signal: string;  // 1-2 sentences: structural shift underway
}

// ── Gemini schema ─────────────────────────────────────────────────────────────

const NARRATIVE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    competitive_structure: { type: SchemaType.STRING },
    strategic_theme:       { type: SchemaType.STRING },
    tailwinds:             { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    headwinds:             { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    key_triggers:          { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    macro_sensitivity:     { type: SchemaType.STRING },
    transformation_signal: { type: SchemaType.STRING },
  },
  required: [
    "competitive_structure",
    "strategic_theme",
    "tailwinds",
    "headwinds",
    "key_triggers",
    "macro_sensitivity",
    "transformation_signal",
  ],
};

// ── Brief builders ────────────────────────────────────────────────────────────

/**
 * Compress one company's DashboardPayload into a compact brief for the Gemini prompt.
 * Keeps it under ~120 tokens per company so the prompt stays fast.
 */
function buildCompanyBrief(ticker: string, payload: DashboardPayload): string {
  const sign = payload.overall_score > 0 ? "+" : "";
  const signal = `${payload.overall_signal} (${sign}${payload.overall_score.toFixed(1)})`;

  // Prefer the summary; fall back to first earnings_delta bullet
  const summary =
    payload.summary?.trim() ||
    payload.earnings_delta?.[0] ||
    "No summary available";

  // Up to 2 delta bullets for additional colour
  const delta = (payload.earnings_delta ?? [])
    .slice(0, 2)
    .map((d) => d.replace(/^\[?\+?-?\s*/i, "").trim())
    .filter(Boolean)
    .join("; ");

  let brief = `${ticker} [${signal}]: ${summary}`;
  if (delta) brief += ` | Changes: ${delta}`;
  return brief;
}

/**
 * Build a 1-line brief from a CompactSignal (Nifty 200 extended context).
 */
function buildExtendedBrief(s: CompactSignal): string {
  const sign = s.overall_score > 0 ? "+" : "";
  return `${s.ticker} [${s.overall_signal} (${sign}${s.overall_score.toFixed(1)})]: ${s.summary}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

const NARRATIVE_TIMEOUT_MS = 22_000;

/**
 * Generate sector-level narrative for a PM audience.
 * Returns null on failure — callers should degrade gracefully.
 *
 * @param sector          e.g. "Banking"
 * @param quarter         e.g. "Q3_2026"
 * @param companyPayloads Primary company payloads (≥1 required)
 * @param extendedSignals Optional additional Nifty 200 signals for broader context
 */
export async function generateSectorNarrative(
  sector: string,
  quarter: string,
  companyPayloads: { ticker: string; payload: DashboardPayload }[],
  extendedSignals?: CompactSignal[]
): Promise<SectorNarrative | null> {
  if (companyPayloads.length === 0) return null;

  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.warn("[sector-narrative] GOOGLE_API_KEY not set — skipping narrative");
      return null;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
      systemInstruction:
        "You are a senior sector analyst at a top Indian equity fund. " +
        "Write concise, PM-grade sector intelligence that helps portfolio managers " +
        "make allocation decisions. Be specific — cite actual company names and " +
        "concrete data points from the signals provided. Avoid generic statements. " +
        "India-context only: reference RBI, SEBI, PLI, budget, INR where relevant.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: NARRATIVE_SCHEMA,
        temperature: 0.1,
      } as any,
    });

    const companyBriefs = companyPayloads
      .map(({ ticker, payload }) => buildCompanyBrief(ticker, payload))
      .join("\n");

    // Extended Nifty 200 context block — appended when sampler found additional signals
    const extendedBlock =
      extendedSignals && extendedSignals.length > 0
        ? `\nExtended Nifty 200 context (${extendedSignals.length} additional companies — use for sector-level breadth, not headline signals):\n` +
          extendedSignals.map(buildExtendedBrief).join("\n") + "\n"
        : "";

    const qLabel = quarter.replace("_", " FY");

    const prompt =
      `Sector: ${sector} (India, ${qLabel})\n` +
      `Primary companies (${companyPayloads.length}):\n` +
      `${companyBriefs}` +
      extendedBlock +
      `\n` +
      `Synthesise SECTOR-LEVEL intelligence:\n\n` +
      `competitive_structure: 1-2 sentences. Is this sector consolidating ` +
      `(few dominant profitable players taking share) or fragmented (intense price competition)? ` +
      `Name specific companies as evidence.\n\n` +
      `strategic_theme: 1-2 sentences. Are managements across this sector prioritising ` +
      `GROWTH (capex, volume, market share grab) or PROFITABILITY (margin protection, FCF, ` +
      `dividend/buyback)? What is driving this behaviour right now?\n\n` +
      `tailwinds: Exactly 2-3 specific structural tailwinds for this sector right now. ` +
      `Reference actual demand drivers, government policy, pricing environment, or cycle position.\n\n` +
      `headwinds: Exactly 2-3 specific structural headwinds. Be sector-specific — ` +
      `input costs, competitive pressure, regulatory risk, demand slowdown, etc.\n\n` +
      `key_triggers: Exactly 2-3 specific events or risk factors that could materially ` +
      `re-rate this sector — regulatory changes, policy announcements, business downcycle triggers, ` +
      `geopolitical events, credit events, election outcomes. Not generic risks.\n\n` +
      `macro_sensitivity: 1-2 sentences on which specific macro variables (RBI rate decisions, ` +
      `INR/USD move, crude oil, US tariffs, govt budget allocation, global demand) matter most ` +
      `for this sector and the direction of impact.\n\n` +
      `transformation_signal: 1-2 sentences on any structural transformation underway — ` +
      `technology disruption, business model shift, PLI-driven change, consolidation wave, ` +
      `regulatory reshaping. If no clear structural shift: write "No major structural transformation evident this cycle."`;

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Narrative timed out after ${NARRATIVE_TIMEOUT_MS}ms`)),
        NARRATIVE_TIMEOUT_MS
      )
    );

    const result = await Promise.race([model.generateContent(prompt), timeout]);
    const narrative = JSON.parse(result.response.text()) as SectorNarrative;

    // Sanitise: ensure arrays have at least 1 item
    narrative.tailwinds   = Array.isArray(narrative.tailwinds)   && narrative.tailwinds.length   > 0 ? narrative.tailwinds   : ["Data insufficient to identify tailwinds"];
    narrative.headwinds   = Array.isArray(narrative.headwinds)   && narrative.headwinds.length   > 0 ? narrative.headwinds   : ["Data insufficient to identify headwinds"];
    narrative.key_triggers = Array.isArray(narrative.key_triggers) && narrative.key_triggers.length > 0 ? narrative.key_triggers : ["No specific triggers identified"];

    return narrative;

  } catch (e) {
    console.error(
      `[sector-narrative] Failed for ${sector}:`,
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}
