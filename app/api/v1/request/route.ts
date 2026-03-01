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

function extractRawTranscriptUrls(html: string): string[] {
  const urls: string[] = [];
  const marker = 'title="Raw Transcript"';
  const segments = html.split(marker);
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
    if (url.endsWith(".pdf")) urls.push(url);
  }
  return urls;
}

async function fetchTranscriptUrls(companyPageUrl: string): Promise<string[]> {
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
  const regex = /Q([1-4])\s*[-\u2013]?\s*FY\s*['"]?(\d{2,4})/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const q = parseInt(m[1]);
    let year = parseInt(m[2]);
    if (year < 100) year += 2000;
    if (year >= 2020 && year <= 2035) return [q, year];
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

  // 3. Get already-uploaded files to skip duplicates
  const { data: existing } = await supabaseAdmin().storage.from(BUCKET).list("", { limit: 2000 });
  const existingNames = new Set((existing ?? []).map((f) => f.name.toLowerCase()));

  // 4. Download up to 4 most recent transcripts
  const uploaded: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const url of transcriptUrls.slice(0, 4)) {
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

      // Prefer quarter from PDF text; fall back to URL timestamp (NSE only)
      let quarterInfo: [number, number] | null = null;
      try {
        const parsed = await pdfParse(pdf, { max: 3 });
        quarterInfo = inferQuarterFromText(parsed.text);
      } catch {}
      if (!quarterInfo) quarterInfo = inferQuarterFromNseUrl(url);
      if (!quarterInfo) { errors.push(`no_quarter:${url.split("/").pop()}`); continue; }

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
