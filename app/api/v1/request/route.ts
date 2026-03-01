import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import pdfParse from "pdf-parse";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

const SCREENER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.screener.in/",
  Accept: "text/html,application/json,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
};

const NSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://nsearchives.nseindia.com/",
  Accept: "application/pdf,*/*",
};

const BSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.bseindia.com/",
  Accept: "application/pdf,*/*",
};

const BUCKET = "transcripts";

// ── Screener.in lookup ────────────────────────────────────────────────────────

interface ScreenerResult {
  id?: number;
  name?: string;
  url?: string;
}

async function getCompanyPageUrl(ticker: string): Promise<string | null> {
  try {
    const url = `https://www.screener.in/api/company/search/?q=${encodeURIComponent(ticker)}&field=name&limit=5`;
    const resp = await fetch(url, {
      headers: SCREENER_HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const items: ScreenerResult[] = await resp.json();
    if (!Array.isArray(items) || !items.length || !items[0].url) return null;
    return `https://www.screener.in${items[0].url}`;
  } catch {
    return null;
  }
}

// Extract hrefs tagged title="Raw Transcript" on Screener company pages.
// Screener links to either NSE archives or BSE AttachHis depending on the company.
// HTML structure: href="..." \n title="Raw Transcript">Transcript</a>
// Split on the title marker and look backwards for the nearest transcript href.
const TRANSCRIPT_PREFIXES = [
  'href="https://nsearchives.nseindia.com/corporate/',
  'href="https://www.bseindia.com/xml-data/corpfiling/AttachHis/',
];

interface TranscriptLink {
  url: string;
  /** Up to 800 chars of HTML before the link — often contains the quarter label */
  htmlContext: string;
}

function extractRawTranscriptUrls(html: string): TranscriptLink[] {
  const links: TranscriptLink[] = [];
  const marker = 'title="Raw Transcript"';
  const segments = html.split(marker);
  // When a quarter has both NSE and BSE raw links, the segment between them is
  // nearly empty (just `>Transcript</a>  <a href="..."`). Carry the last rich
  // context forward so the BSE link can inherit the quarter label from the NSE entry.
  let lastRichContext = "";
  for (const seg of segments.slice(0, -1)) {
    let bestPos = -1;
    for (const prefix of TRANSCRIPT_PREFIXES) {
      const pos = seg.lastIndexOf(prefix);
      if (pos > bestPos) bestPos = pos;
    }
    if (bestPos === -1) continue;
    const start = bestPos + 6; // skip 'href="'
    const end = seg.indexOf('"', start);
    if (end === -1) continue;
    const url = seg.slice(start, end);
    if (url.endsWith(".pdf")) {
      // Slice from BEFORE the <a href="..."> — the URL itself sits inside an
      // unclosed tag so tag-stripping won't remove it, making the context look
      // "rich" when it's actually just the URL with no quarter/date info.
      const rawCtx = seg.slice(0, bestPos).slice(-800);
      const stripped = rawCtx.replace(/<[^>]*>/g, " ").trim();
      const htmlContext = stripped.length > 40 ? rawCtx : lastRichContext;
      if (stripped.length > 40) lastRichContext = rawCtx;
      links.push({ url, htmlContext });
    }
  }
  return links;
}

async function fetchTranscriptUrls(companyPageUrl: string): Promise<TranscriptLink[]> {
  try {
    const resp = await fetch(companyPageUrl, {
      headers: SCREENER_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    return extractRawTranscriptUrls(html);
  } catch {
    return [];
  }
}

// ── Quarter inference ─────────────────────────────────────────────────────────

// NSE filenames embed a DDMMYYYYHHMMSS timestamp, e.g. ALPEXSOLAR_12022026180147_...pdf
function inferQuarterFromNseUrl(url: string): [number, number] | null {
  const filename = url.split("/").pop() ?? "";
  const m = /[_](\d{14})[_]/.exec(filename);
  if (!m) return null;
  const ts = m[1];
  const mo = parseInt(ts.slice(2, 4));
  const y = parseInt(ts.slice(4, 8));
  return quarterFromMonthYear(mo, y);
}

function inferQuarterFromText(text: string): [number, number] | null {
  const regex = /Q([1-4])\s*[-\u2013]?\s*FY\s*['"]?\s*(\d{2,4})/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const q = parseInt(m[1]);
    let year = parseInt(m[2]);
    if (year < 100) year += 2000;
    if (year >= 2020 && year <= 2035) return [q, year];
  }
  return null;
}

const MONTH_NUM: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

// Infer quarter from Screener.in HTML context surrounding a transcript link.
// Handles "Q3 FY2026", "Q3 2025-26", "quarter ended December 2025",
// and date formats like "14 Feb, 2026" or "14-02-2026" (Indian DD/MM/YYYY).
function inferQuarterFromHtml(html: string, debugLabel = ""): [number, number] | null {
  // Strip HTML tags for cleaner text matching
  const text = html.replace(/<[^>]*>/g, " ");

  // Try standard "Q# FY##" pattern first (reuses existing logic)
  const fromText = inferQuarterFromText(text);
  if (fromText) return fromText;

  // Try "Q# YYYY-YY" Indian FY range format, e.g. "Q3 2025-26" → Q3 FY2026
  const fyRangeRe = /Q([1-4])\s+(\d{4})-(\d{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = fyRangeRe.exec(text)) !== null) {
    const q = parseInt(m[1]);
    const startYear = parseInt(m[2]);
    const fyEndYear = startYear + 1; // 2025-26 → FY end = 2026
    if (fyEndYear >= 2020 && fyEndYear <= 2035) return [q, fyEndYear];
  }

  // Try "quarter ended [Month] [Year]" — e.g. "quarter ended December 2025"
  const monthWordRe = /quarter\s+ended\s+(\w+)\s+(\d{4})/gi;
  while ((m = monthWordRe.exec(text)) !== null) {
    const mo = MONTH_NUM[m[1].toLowerCase()];
    const year = parseInt(m[2]);
    if (mo && year >= 2020 && year <= 2035) return quarterFromMonthYear(mo, year);
  }

  // Try date with month name: "14 Feb, 2026" or "Feb 14, 2026" or "14 February 2026"
  // Screener.in shows the BSE filing date, from which we infer the quarter.
  const monthNames = Object.keys(MONTH_NUM).join("|");
  const dateMonthRe = new RegExp(
    `(?:(\\d{1,2})\\s+(${monthNames}),?\\s+(\\d{4})|(${monthNames})\\s+(\\d{1,2}),?\\s+(\\d{4}))`,
    "gi"
  );
  while ((m = dateMonthRe.exec(text)) !== null) {
    // Group 1+2+3: DD Mon YYYY; Group 4+5+6: Mon DD YYYY
    const monthStr = (m[2] ?? m[4]).toLowerCase();
    const year = parseInt(m[3] ?? m[6]);
    const mo = MONTH_NUM[monthStr];
    if (mo && year >= 2020 && year <= 2035) return quarterFromMonthYear(mo, year);
  }

  // Try numeric date: DD/MM/YYYY or DD-MM-YYYY (Indian convention)
  const numDateRe = /(\d{1,2})[/\-](\d{1,2})[/\-](20\d{2})/g;
  while ((m = numDateRe.exec(text)) !== null) {
    const dd = parseInt(m[1]);
    const mm = parseInt(m[2]);
    const yyyy = parseInt(m[3]);
    // Indian DD/MM/YYYY: day ≤ 31, month ≤ 12
    if (dd <= 31 && mm >= 1 && mm <= 12) {
      const result = quarterFromMonthYear(mm, yyyy);
      if (result) return result;
    }
  }

  if (debugLabel) {
    console.log(`[request] inferQuarterFromHtml(${debugLabel}): no match in: ${text.slice(-300)}`);
  }
  return null;
}

// Indian FY quarter inferred from the month results are announced
function quarterFromMonthYear(mo: number, y: number): [number, number] | null {
  if (mo < 1 || mo > 12 || y < 2020 || y > 2035) return null;
  if (mo >= 4 && mo <= 7) return [4, y];      // Apr-Jul  → Q4 results
  if (mo >= 8 && mo <= 10) return [1, y + 1]; // Aug-Oct  → Q1 results
  if (mo >= 11) return [2, y + 1];            // Nov-Dec  → Q2 results
  if (mo === 1) return [2, y];                // Jan      → Q2 results (late)
  return [3, y];                              // Feb-Mar  → Q3 results
}

// ── PDF download ──────────────────────────────────────────────────────────────

async function downloadPdf(url: string): Promise<Buffer> {
  const headers = url.includes("bseindia.com") ? BSE_HEADERS : NSE_HEADERS;
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!resp.ok) throw new Error(`Download returned ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.slice(0, 4).toString().startsWith("%PDF")) throw new Error("Not a valid PDF");
  return buf;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  let body: { ticker?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON" }, { status: 400 });
  }

  const { ticker } = body;
  if (!ticker?.trim()) {
    return NextResponse.json({ detail: "ticker is required" }, { status: 422 });
  }

  const tickerClean = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!tickerClean) {
    return NextResponse.json({ detail: "ticker must contain letters or numbers" }, { status: 422 });
  }

  // 1. Resolve company page via Screener.in
  const companyPageUrl = await getCompanyPageUrl(tickerClean);
  if (!companyPageUrl) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 200 });
  }

  // 2. Extract transcript links from the company page
  const transcriptUrls = await fetchTranscriptUrls(companyPageUrl);
  if (!transcriptUrls.length) {
    return NextResponse.json({ ok: false, reason: "no_transcripts" }, { status: 200 });
  }

  // 3. Get already-uploaded files to skip duplicates (paginate to catch all)
  const allExisting: { name: string }[] = [];
  {
    let off = 0;
    while (true) {
      const { data: page } = await supabaseAdmin().storage.from(BUCKET).list("", { limit: 100, offset: off });
      if (!page || page.length === 0) break;
      allExisting.push(...page);
      off += page.length;
    }
  }
  const existingNames = new Set(allExisting.map((f) => f.name.toLowerCase()));

  // 4. Download up to 4 most recent transcripts
  const uploaded: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const { url, htmlContext } of transcriptUrls.slice(0, 4)) {
    try {
      // Fast pre-check using filename-inferred quarter (works for NSE URLs, not BSE UUIDs)
      const quarterFromUrl = inferQuarterFromNseUrl(url);
      if (quarterFromUrl) {
        const [q, y] = quarterFromUrl;
        const candidateName = `${tickerClean}_Q${q}_${y}.pdf`;
        if (existingNames.has(candidateName.toLowerCase())) {
          skipped.push(candidateName);
          continue;
        }
      }

      const pdf = await downloadPdf(url);

      // Prefer quarter from PDF text; fall back to NSE URL timestamp; then Screener HTML context
      let quarterInfo: [number, number] | null = null;
      let pdfText = "";
      try {
        const parsed = await pdfParse(pdf, { max: 3 });
        pdfText = parsed.text;
        quarterInfo = inferQuarterFromText(pdfText);
      } catch {}
      if (!quarterInfo) quarterInfo = inferQuarterFromNseUrl(url);
      if (!quarterInfo) quarterInfo = inferQuarterFromHtml(htmlContext, url.split("/").pop());
      if (!quarterInfo) { errors.push(`no_quarter:${url.split("/").pop()}`); continue; }

      // Validate the PDF is actually parseable before storing it.
      // If pdfParse failed above and we only have a URL-inferred quarter,
      // do a full parse now to confirm the file is usable.
      if (!pdfText) {
        try {
          const validated = await pdfParse(pdf);
          pdfText = validated.text;
        } catch (e) {
          errors.push(`unparseable:${url.split("/").pop()}:${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
      }

      const [q, y] = quarterInfo;
      const filename = `${tickerClean}_Q${q}_${y}.pdf`;

      if (existingNames.has(filename.toLowerCase())) {
        skipped.push(filename);
        continue;
      }

      const { error: uploadError } = await supabaseAdmin()
        .storage.from(BUCKET)
        .upload(filename, pdf, { contentType: "application/pdf", upsert: true });

      if (uploadError) { errors.push(`upload_failed:${filename}:${uploadError.message}`); continue; }

      existingNames.add(filename.toLowerCase());
      uploaded.push(filename);
    } catch (e) {
      errors.push(`error:${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: true, uploaded, skipped, errors });
}
