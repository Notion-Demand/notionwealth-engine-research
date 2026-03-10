/**
 * KPI Extractor — fetches quarterly financials from screener.in and extracts
 * top KPI changes. For sector-specific KPIs, uses Gemini to extract from transcripts.
 */
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { Schema } from "@google/generative-ai";
import { NIFTY50 } from "./nifty50";

// ── Screener.in headers (same as request/route.ts) ────────────────────────────

const SCREENER_HEADERS: Record<string, string> = {
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: "https://www.screener.in/",
    Accept: "text/html,application/json,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KPIEntry {
    name: string;
    current: number | null;
    previous: number | null;
    change_pct: number | null;
    change_abs: number | null;
    change_bps: number | null;
    unit: string;
    category: "topline" | "profitability" | "efficiency" | "quality" | "valuation";
    is_highlight: boolean;
}

export interface KPISnapshot {
    ticker: string;
    company: string;
    sector: string;
    quarter: string;
    quarter_previous: string;
    kpis: KPIEntry[];
}

// ── Sector-specific KPI prompts ───────────────────────────────────────────────

const SECTOR_KPI_PROMPT: Record<string, string> = {
    IT: `Extract these IT-specific KPIs from the earnings transcript:
- Deal Wins (total contract value in USD millions or INR crore)
- Utilization Rate (%)
- Attrition Rate / LTM Attrition (%)
- Headcount Change (absolute number)
- Digital Revenue Share (%)
Return null if a metric is not mentioned.`,

    Banking: `Extract these Banking-specific KPIs from the earnings transcript:
- Net Interest Margin / NIM (%)
- Gross NPA / GNPA (%)
- Net NPA / NNPA (%)
- Credit Growth (%)
- CASA Ratio (%)
- Provision Coverage Ratio (%)
- Cost to Income Ratio (%)
Return null if a metric is not mentioned.`,

    NBFC: `Extract these NBFC-specific KPIs from the earnings transcript:
- Net Interest Margin / NIM (%)
- Gross NPA / GNPA (%)
- AUM Growth (%)
- Cost to Income Ratio (%)
- Disbursement Growth (%)
Return null if a metric is not mentioned.`,

    Pharma: `Extract these Pharma-specific KPIs from the earnings transcript:
- R&D Spend as % of Revenue
- ANDA Filings (count)
- US Revenue Share (%)
- API Revenue Growth (%)
Return null if a metric is not mentioned.`,

    Auto: `Extract these Auto-specific KPIs from the earnings transcript:
- Volume Growth (% or units)
- Realization per unit (₹)
- Market Share (%)
- EV Sales Mix (%)
- Export Growth (%)
Return null if a metric is not mentioned.`,

    FMCG: `Extract these FMCG-specific KPIs from the earnings transcript:
- Volume Growth (%)
- Rural vs Urban Growth split
- Market Share gain/loss
- Distribution Reach (outlets)
- Price Hike (%)
Return null if a metric is not mentioned.`,
};

// ── Gemini schema for sector KPIs ─────────────────────────────────────────────

const SECTOR_KPI_SCHEMA: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        kpis: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    name: { type: SchemaType.STRING, description: "KPI name" },
                    value: { type: SchemaType.NUMBER, nullable: true, description: "Numeric value" },
                    unit: { type: SchemaType.STRING, description: "Unit (%, ₹ Cr, count, etc.)" },
                    context: { type: SchemaType.STRING, description: "Brief context from the transcript" },
                },
                required: ["name", "unit"],
            },
        },
    },
    required: ["kpis"],
};

// ── Screener.in data fetching ─────────────────────────────────────────────────

interface ScreenerSearchResult {
    id?: number;
    name?: string;
    url?: string;
}

async function getScreenerSlug(ticker: string): Promise<string | null> {
    try {
        const url = `https://www.screener.in/api/company/search/?q=${encodeURIComponent(ticker)}&field=name&limit=5`;
        const resp = await fetch(url, {
            headers: SCREENER_HEADERS,
            signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) return null;
        const items: ScreenerSearchResult[] = await resp.json();
        if (!Array.isArray(items) || !items.length || !items[0].url) return null;
        // url is like "/company/TCS/consolidated/"
        return items[0].url!;
    } catch {
        return null;
    }
}

/**
 * Parse quarterly P&L data from screener.in HTML page.
 * The page contains a table with quarters as columns and metrics as rows.
 */
async function fetchScreenerFinancials(
    companyUrl: string
): Promise<{ headers: string[]; rows: { label: string; values: (number | null)[] }[] } | null> {
    try {
        const resp = await fetch(`https://www.screener.in${companyUrl}`, {
            headers: SCREENER_HEADERS,
            signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) return null;
        const html = await resp.text();

        // Find the quarterly results section
        const quarterlyMatch = html.match(
            /id="quarters"[\s\S]*?<table[\s\S]*?<\/table>/i
        );
        if (!quarterlyMatch) return null;
        const tableHtml = quarterlyMatch[0];

        // Parse headers (quarter labels)
        const headerMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
        const headers: string[] = [];
        if (headerMatch) {
            const thMatches = Array.from(headerMatch[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi));
            for (const m of thMatches) {
                const text = m[1].replace(/<[^>]*>/g, "").trim();
                if (text) headers.push(text);
            }
        }

        // Parse rows
        const rows: { label: string; values: (number | null)[] }[] = [];
        const rowMatches = Array.from(tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi));
        for (const rowMatch of rowMatches) {
            const row = rowMatch[0];
            // Skip header rows
            if (row.includes("<th")) continue;
            const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi));
            if (cells.length < 2) continue;

            const rawLabel = (cells[0][1] ?? "").replace(/<[^>]*>/g, "").trim();
            // Strip screener.in artifacts: "Sales\u00a0+" → "Sales", "Net Profit +" → "Net Profit"
            const label = rawLabel.replace(/[\s\u00a0]*\+\s*$/, "").trim();
            const values = cells.slice(1).map((c: RegExpExecArray) => {
                const text = (c[1] ?? "").replace(/<[^>]*>/g, "").replace(/,/g, "").trim();
                const num = parseFloat(text);
                return isNaN(num) ? null : num;
            });
            if (label) rows.push({ label, values });
        }

        return { headers, rows };
    } catch (e) {
        console.error("[KPI] Failed to fetch screener financials:", e);
        return null;
    }
}

// ── KPI computation ───────────────────────────────────────────────────────────

/** Map screener row labels to our KPI names + categories */
const METRIC_MAP: {
    patterns: RegExp[];
    name: string;
    unit: string;
    category: KPIEntry["category"];
    isMargin?: boolean;
}[] = [
        {
            patterns: [/^sales/i, /^revenue/i, /^net sales/i, /^total income/i],
            name: "Revenue", unit: "₹ Cr", category: "topline"
        },
        {
            patterns: [/^expenses/i, /^total expenses/i],
            name: "Total Expenses", unit: "₹ Cr", category: "topline"
        },
        {
            patterns: [/^operating profit/i, /^ebitda/i],
            name: "EBITDA", unit: "₹ Cr", category: "profitability"
        },
        {
            patterns: [/^opm/i, /^operating profit margin/i],
            name: "EBITDA Margin", unit: "%", category: "profitability", isMargin: true
        },
        {
            patterns: [/^net profit/i, /^profit after tax/i, /^pat$/i],
            name: "Net Profit (PAT)", unit: "₹ Cr", category: "profitability"
        },
        {
            patterns: [/^eps/i, /^earnings per share/i],
            name: "EPS", unit: "₹", category: "valuation"
        },
        {
            patterns: [/^interest$/i, /^finance cost/i],
            name: "Finance Costs", unit: "₹ Cr", category: "profitability"
        },
        {
            patterns: [/^depreciation/i],
            name: "Depreciation", unit: "₹ Cr", category: "profitability"
        },
        {
            patterns: [/^tax/i],
            name: "Tax Rate", unit: "%", category: "profitability", isMargin: true
        },
        {
            patterns: [/^other income/i],
            name: "Other Income", unit: "₹ Cr", category: "topline"
        },
        {
            patterns: [/^net interest income/i, /^nii$/i],
            name: "Net Interest Income", unit: "₹ Cr", category: "topline"
        },
    ];

function computeChange(current: number | null, previous: number | null, isMargin = false) {
    if (current == null || previous == null) return { pct: null, abs: null, bps: null };
    const abs = current - previous;
    if (isMargin) {
        // For margins, express change in bps
        return { pct: null, abs: null, bps: Math.round(abs * 100) };
    }
    const pct = previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : null;
    return { pct: pct != null ? Math.round(pct * 10) / 10 : null, abs: Math.round(abs * 10) / 10, bps: null };
}

/**
 * Extract standardized KPIs from screener.in quarterly data.
 * Returns KPIs for the most recent two quarters.
 */
function extractStandardKPIs(
    data: { headers: string[]; rows: { label: string; values: (number | null)[] }[] }
): { quarter: string; quarterPrev: string; kpis: KPIEntry[] } {
    // Screener headers are ordered oldest→newest: ["", "Dec 2022", "Mar 2023", ..., "Dec 2025"]
    // We want the last two date headers (most recent quarters)
    const qHeaders = data.headers.filter((h) => /\w{3}\s+\d{4}/.test(h));
    const latestQ = qHeaders[qHeaders.length - 1] || "Latest";
    const prevQ = qHeaders[qHeaders.length - 2] || "Previous";

    // Convert "Sep 2025" → "Q2_FY26" (Indian FY)
    const toFYQuarter = (label: string): string => {
        const m = label.match(/(\w{3})\s+(\d{4})/);
        if (!m) return label;
        const monthMap: Record<string, { q: number; fyOffset: number }> = {
            Jan: { q: 3, fyOffset: 0 }, Feb: { q: 3, fyOffset: 0 }, Mar: { q: 4, fyOffset: 0 },
            Apr: { q: 1, fyOffset: 1 }, May: { q: 1, fyOffset: 1 }, Jun: { q: 1, fyOffset: 1 },
            Jul: { q: 2, fyOffset: 1 }, Aug: { q: 2, fyOffset: 1 }, Sep: { q: 2, fyOffset: 1 },
            Oct: { q: 3, fyOffset: 1 }, Nov: { q: 3, fyOffset: 1 }, Dec: { q: 3, fyOffset: 1 },
        };
        const info = monthMap[m[1]];
        if (!info) return label;
        const fy = parseInt(m[2]) + info.fyOffset;
        return `Q${info.q}_FY${String(fy).slice(-2)}`;
    };

    const quarter = toFYQuarter(latestQ);
    const quarterPrev = toFYQuarter(prevQ);

    const kpis: KPIEntry[] = [];
    for (const metric of METRIC_MAP) {
        const row = data.rows.find((r) =>
            metric.patterns.some((p) => p.test(r.label))
        );
        if (!row) continue;

        // Values array is aligned to date headers (index 0 = first date column)
        // So latest value = last element, previous = second-to-last
        const latestIdx = row.values.length - 1;
        const prevIdx = row.values.length - 2;

        const current = latestIdx >= 0 ? (row.values[latestIdx] ?? null) : null;
        const previous = prevIdx >= 0 ? (row.values[prevIdx] ?? null) : null;

        const change = computeChange(current, previous, metric.isMargin);

        kpis.push({
            name: metric.name,
            current,
            previous,
            change_pct: change.pct,
            change_abs: change.abs,
            change_bps: change.bps,
            unit: metric.unit,
            category: metric.category,
            is_highlight: false,
        });
    }

    // Mark top 5 by absolute change magnitude as highlights
    const sorted = [...kpis]
        .filter((k) => k.change_pct != null || k.change_bps != null)
        .sort((a, b) => {
            const magA = Math.abs(a.change_pct ?? 0) + Math.abs(a.change_bps ?? 0);
            const magB = Math.abs(b.change_pct ?? 0) + Math.abs(b.change_bps ?? 0);
            return magB - magA;
        });
    const topNames = new Set(sorted.slice(0, 5).map((k) => k.name));
    for (const k of kpis) {
        if (topNames.has(k.name)) k.is_highlight = true;
    }

    return { quarter, quarterPrev, kpis };
}

// ── Gemini sector KPI extraction ──────────────────────────────────────────────

async function extractSectorKPIs(
    sector: string,
    transcriptText: string,
    quarter: string
): Promise<KPIEntry[]> {
    const prompt = SECTOR_KPI_PROMPT[sector];
    if (!prompt) return [];

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.warn("[KPI] GOOGLE_API_KEY not set — skipping sector KPIs");
        return [];
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash-lite",
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: SECTOR_KPI_SCHEMA,
                temperature: 0.1,
            },
        });

        const result = await model.generateContent([
            `You are a financial analyst. Analyze this earnings transcript for ${quarter}.`,
            prompt,
            `TRANSCRIPT:\n${transcriptText.slice(0, 30_000)}`, // Cap at 30k chars
        ]);

        const text = result.response.text();
        const parsed = JSON.parse(text) as {
            kpis: { name: string; value: number | null; unit: string; context: string }[];
        };

        return parsed.kpis
            .filter((k) => k.value != null)
            .map((k) => ({
                name: k.name,
                current: k.value,
                previous: null,
                change_pct: null,
                change_abs: null,
                change_bps: null,
                unit: k.unit,
                category: "efficiency" as const,
                is_highlight: true,
            }));
    } catch (e) {
        console.error("[KPI] Gemini sector extraction failed:", e);
        return [];
    }
}

// ── Main extraction function ──────────────────────────────────────────────────

export async function extractKPIs(ticker: string): Promise<KPISnapshot | null> {
    const company = NIFTY50[ticker.toUpperCase()];
    const companyName = company?.name ?? ticker;
    const sector = company?.sector ?? "Other";

    console.log(`[KPI] Extracting KPIs for ${ticker} (${companyName}, ${sector})`);

    // Step 1: Get company page from screener.in
    const slug = await getScreenerSlug(ticker);
    if (!slug) {
        console.error(`[KPI] Could not find ${ticker} on screener.in`);
        return null;
    }

    // Step 2: Fetch quarterly financials
    const data = await fetchScreenerFinancials(slug);
    if (!data || data.rows.length === 0) {
        console.error(`[KPI] No financial data for ${ticker}`);
        return null;
    }

    // Step 3: Extract standardized KPIs
    const { quarter, quarterPrev, kpis } = extractStandardKPIs(data);

    // Step 4: Try to extract sector-specific KPIs from transcripts (optional)
    // This uses transcripts already in Supabase storage
    if (SECTOR_KPI_PROMPT[sector]) {
        try {
            const { supabaseAdmin } = await import("@/lib/supabase/admin");
            // Find the latest transcript for this ticker
            const { data: files } = await supabaseAdmin()
                .storage.from("transcripts")
                .list("", { search: ticker.toUpperCase(), limit: 5 });

            if (files && files.length > 0) {
                const latest = files.sort((a, b) => b.name.localeCompare(a.name))[0];
                const { data: pdfData } = await supabaseAdmin()
                    .storage.from("transcripts")
                    .download(latest.name);

                if (pdfData) {
                    const pdfParse = (await import("pdf-parse")).default;
                    const buffer = Buffer.from(await pdfData.arrayBuffer());
                    const parsed = await pdfParse(buffer);
                    const sectorKPIs = await extractSectorKPIs(sector, parsed.text, quarter);
                    kpis.push(...sectorKPIs);
                }
            }
        } catch (e) {
            console.warn("[KPI] Sector KPI extraction skipped:", e);
        }
    }

    return {
        ticker: ticker.toUpperCase(),
        company: companyName,
        sector,
        quarter,
        quarter_previous: quarterPrev,
        kpis,
    };
}
