/**
 * Shared transcript fetching utilities — extracted from request/route.ts
 * for reuse by the sector intelligence seed endpoint.
 */
import pdfParse from "pdf-parse";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ── HTTP headers ──────────────────────────────────────────────────────────────

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

const BSE_API_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: "https://www.bseindia.com/",
    Origin: "https://www.bseindia.com",
    Accept: "application/json, */*",
};

const BUCKET = "transcripts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScreenerResult {
    id?: number;
    name?: string;
    url?: string;
}

export interface TranscriptLink {
    url: string;
    /** Up to 800 chars of HTML before the link — often contains the quarter label */
    htmlContext: string;
}

interface CompanyPageResult {
    transcriptLinks: TranscriptLink[];
    bseCode: string | null;
}

interface BseAnnouncement {
    DT_TM: string;
    HEADLINE: string;
    ATTACHMENTNAME: string;
    SUBCATNAME: string;
}

export interface FetchTranscriptsResult {
    uploaded: string[];
    skipped: string[];
    errors: string[];
}

// ── Screener.in lookup ────────────────────────────────────────────────────────

export async function getCompanyPageUrl(ticker: string): Promise<string | null> {
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

// ── Transcript link extraction ────────────────────────────────────────────────

const TRANSCRIPT_PREFIXES = [
    'href="https://nsearchives.nseindia.com/corporate/',
    'href="https://www.bseindia.com/xml-data/corpfiling/AttachHis/',
];

function extractRawTranscriptUrls(html: string): TranscriptLink[] {
    const links: TranscriptLink[] = [];
    const marker = 'title="Raw Transcript"';
    const segments = html.split(marker);
    let lastRichContext = "";
    for (const seg of segments.slice(0, -1)) {
        let bestPos = -1;
        for (const prefix of TRANSCRIPT_PREFIXES) {
            const pos = seg.lastIndexOf(prefix);
            if (pos > bestPos) bestPos = pos;
        }
        if (bestPos === -1) continue;
        const start = bestPos + 6;
        const end = seg.indexOf('"', start);
        if (end === -1) continue;
        const url = seg.slice(start, end);
        if (url.endsWith(".pdf")) {
            const rawCtx = seg.slice(0, bestPos).slice(-800);
            const stripped = rawCtx.replace(/<[^>]*>/g, " ").trim();
            const htmlContext = stripped.length > 40 ? rawCtx : lastRichContext;
            if (stripped.length > 40) lastRichContext = rawCtx;
            links.push({ url, htmlContext });
        }
    }
    return links;
}

function extractBseCode(html: string): string | null {
    const m = /bseindia\.com\/stock-share-price\/[^"]*?\/(\d{4,6})\//i.exec(html);
    return m ? m[1] : null;
}

export async function fetchCompanyPage(companyPageUrl: string): Promise<CompanyPageResult> {
    try {
        const resp = await fetch(companyPageUrl, {
            headers: SCREENER_HEADERS,
            signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) return { transcriptLinks: [], bseCode: null };
        const html = await resp.text();
        return {
            transcriptLinks: extractRawTranscriptUrls(html),
            bseCode: extractBseCode(html),
        };
    } catch {
        return { transcriptLinks: [], bseCode: null };
    }
}

// ── BSE announcement API ──────────────────────────────────────────────────────

const BSE_TRANSCRIPT_KEYWORDS = [
    "transcript", "concall", "conference call", "earnings call",
    "analyst meet", "investor meet",
];

const BSE_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function fetchBseTranscripts(bseCode: string): Promise<TranscriptLink[]> {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 548); // ~18 months back
    const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const apiUrl =
        `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w` +
        `?strCat=-1&strPrevDate=${fmt(fromDate)}&strScrip=${bseCode}` +
        `&strSearch=P&strToDate=${fmt(toDate)}&strType=C&subcategory=-1`;
    try {
        const resp = await fetch(apiUrl, {
            headers: BSE_API_HEADERS,
            signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        const rows: BseAnnouncement[] = data?.Table ?? [];
        return rows
            .filter((r) => {
                const text = `${r.HEADLINE} ${r.SUBCATNAME}`.toLowerCase();
                return BSE_TRANSCRIPT_KEYWORDS.some((k) => text.includes(k));
            })
            .filter((r) => r.ATTACHMENTNAME?.toLowerCase().endsWith(".pdf"))
            .map((r) => {
                const pdfUrl = `https://www.bseindia.com/xml-data/corpfiling/AttachHis/${r.ATTACHMENTNAME}`;
                const parts = r.DT_TM.split(/[-\s]/);
                const mo = parseInt(parts[1]);
                const yr = parseInt(parts[0]);
                const monthLabel = mo >= 1 && mo <= 12 ? `${BSE_MONTH_LABELS[mo - 1]} ${yr}` : "";
                return { url: pdfUrl, htmlContext: `${monthLabel} ${r.HEADLINE}` };
            });
    } catch {
        return [];
    }
}

// ── Quarter inference ─────────────────────────────────────────────────────────

export function inferQuarterFromNseUrl(url: string): [number, number] | null {
    const filename = url.split("/").pop() ?? "";
    const m = /[_](\d{14})[_]/.exec(filename);
    if (!m) return null;
    const ts = m[1];
    const mo = parseInt(ts.slice(2, 4));
    const y = parseInt(ts.slice(4, 8));
    return quarterFromMonthYear(mo, y);
}

export function inferQuarterFromText(text: string): [number, number] | null {
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

export function inferQuarterFromHtml(html: string, debugLabel = ""): [number, number] | null {
    const text = html.replace(/<[^>]*>/g, " ");
    const fromText = inferQuarterFromText(text);
    if (fromText) return fromText;

    const fyRangeRe = /Q([1-4])\s+(\d{4})-(\d{2})/gi;
    let m: RegExpExecArray | null;
    while ((m = fyRangeRe.exec(text)) !== null) {
        const q = parseInt(m[1]);
        const startYear = parseInt(m[2]);
        const fyEndYear = startYear + 1;
        if (fyEndYear >= 2020 && fyEndYear <= 2035) return [q, fyEndYear];
    }

    const monthWordRe = /quarter\s+ended\s+(\w+)\s+(\d{4})/gi;
    while ((m = monthWordRe.exec(text)) !== null) {
        const mo = MONTH_NUM[m[1].toLowerCase()];
        const year = parseInt(m[2]);
        if (mo && year >= 2020 && year <= 2035) return quarterFromMonthYear(mo, year);
    }

    const monthNames = Object.keys(MONTH_NUM).join("|");
    const dateMonthRe = new RegExp(
        `(?:(\\d{1,2})\\s+(${monthNames}),?\\s+(\\d{4})|(${monthNames})\\s+(\\d{1,2}),?\\s+(\\d{4}))`,
        "gi"
    );
    while ((m = dateMonthRe.exec(text)) !== null) {
        const monthStr = (m[2] ?? m[4]).toLowerCase();
        const year = parseInt(m[3] ?? m[6]);
        const mo = MONTH_NUM[monthStr];
        if (mo && year >= 2020 && year <= 2035) return quarterFromMonthYear(mo, year);
    }

    const numDateRe = /(\d{1,2})[/\-](\d{1,2})[/\-](20\d{2})/g;
    while ((m = numDateRe.exec(text)) !== null) {
        const dd = parseInt(m[1]);
        const mm = parseInt(m[2]);
        const yyyy = parseInt(m[3]);
        if (dd <= 31 && mm >= 1 && mm <= 12) {
            const result = quarterFromMonthYear(mm, yyyy);
            if (result) return result;
        }
    }

    const bareMonthRe = new RegExp(`\\b(${monthNames})\\b[,\\s]+(\\d{4})\\b`, "gi");
    while ((m = bareMonthRe.exec(text)) !== null) {
        const mo = MONTH_NUM[m[1].toLowerCase()];
        const year = parseInt(m[2]);
        if (mo && year >= 2020 && year <= 2035) return quarterFromMonthYear(mo, year);
    }

    if (debugLabel) {
        console.log(`[transcript-fetcher] inferQuarterFromHtml(${debugLabel}): no match in: ${text.slice(-300)}`);
    }
    return null;
}

export function quarterFromMonthYear(mo: number, y: number): [number, number] | null {
    if (mo < 1 || mo > 12 || y < 2020 || y > 2035) return null;
    if (mo >= 4 && mo <= 7) return [4, y];
    if (mo >= 8 && mo <= 10) return [1, y + 1];
    if (mo >= 11) return [2, y + 1];
    if (mo === 1) return [2, y];
    return [3, y];
}

// ── PDF download ──────────────────────────────────────────────────────────────

export async function downloadPdf(url: string): Promise<Buffer> {
    const headers = url.includes("bseindia.com") ? BSE_HEADERS : NSE_HEADERS;
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) throw new Error(`Download returned ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.slice(0, 4).toString().startsWith("%PDF")) throw new Error("Not a valid PDF");
    return buf;
}

// ── High-level: fetch & upload transcripts for a ticker ───────────────────────

/**
 * Fetch up to `maxTranscripts` earnings call transcripts for a ticker
 * from Screener.in and BSE, upload them to Supabase storage.
 * Returns lists of uploaded, skipped, and errored filenames.
 */
export async function fetchAndUploadTranscripts(
    ticker: string,
    maxTranscripts = 4
): Promise<FetchTranscriptsResult> {
    const tickerClean = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const uploaded: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    // 1. Resolve company page via Screener.in
    const companyPageUrl = await getCompanyPageUrl(tickerClean);
    if (!companyPageUrl) {
        errors.push(`not_found:${tickerClean}`);
        return { uploaded, skipped, errors };
    }

    // 2. Fetch Screener company page + BSE API
    const { transcriptLinks: screenerLinks, bseCode } = await fetchCompanyPage(companyPageUrl);
    const bseApiLinks = bseCode ? await fetchBseTranscripts(bseCode) : [];
    console.log(`[transcript-fetcher] ${tickerClean}: screener=${screenerLinks.length} bse=${bseApiLinks.length}`);

    // Merge
    const screenerUrls = new Set(screenerLinks.map((l) => l.url));
    const allLinks = [
        ...screenerLinks,
        ...bseApiLinks.filter((l) => !screenerUrls.has(l.url)),
    ];

    if (!allLinks.length) {
        errors.push(`no_transcripts:${tickerClean}`);
        return { uploaded, skipped, errors };
    }

    // 3. Get already-uploaded files to skip duplicates
    const allExisting: { name: string }[] = [];
    let off = 0;
    while (true) {
        const { data: page } = await supabaseAdmin().storage.from(BUCKET).list("", { limit: 100, offset: off });
        if (!page || page.length === 0) break;
        allExisting.push(...page);
        off += page.length;
    }
    const existingNames = new Set(allExisting.map((f) => f.name.toLowerCase()));

    // 4. Download and upload
    for (const { url, htmlContext } of allLinks.slice(0, maxTranscripts)) {
        const urlFile = url.split("/").pop() ?? url;
        try {
            // Fast pre-check using filename-inferred quarter
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

            // Infer quarter
            let quarterInfo: [number, number] | null = null;
            try {
                const parsed = await pdfParse(pdf, { max: 3 });
                quarterInfo = inferQuarterFromText(parsed.text);
            } catch { /* ignore */ }
            if (!quarterInfo) quarterInfo = inferQuarterFromNseUrl(url);
            if (!quarterInfo) quarterInfo = inferQuarterFromHtml(htmlContext, urlFile);
            if (!quarterInfo) {
                errors.push(`no_quarter:${urlFile}`);
                continue;
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

            if (uploadError) {
                errors.push(`upload_failed:${filename}:${uploadError.message}`);
                continue;
            }

            existingNames.add(filename.toLowerCase());
            uploaded.push(filename);
            console.log(`[transcript-fetcher] ${tickerClean}: UPLOADED ${filename}`);
        } catch (e) {
            errors.push(`error:${e instanceof Error ? e.message : String(e)}`);
        }
    }

    return { uploaded, skipped, errors };
}
