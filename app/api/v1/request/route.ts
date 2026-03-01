import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import pdfParse from "pdf-parse";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

const BSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.bseindia.com/",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const TRANSCRIPT_KEYWORDS = ["transcript", "conference call", "earnings call", "analyst meet", "concall"];

const BUCKET = "transcripts";

// ── Quarter inference ─────────────────────────────────────────────────────────

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

function inferQuarterFromDateStr(dtTm: string): [number, number] | null {
  if (!dtTm) return null;
  const d = new Date(dtTm.slice(0, 10));
  if (isNaN(d.getTime())) return null;
  const m = d.getMonth() + 1;
  const y = d.getFullYear();
  if (m >= 4 && m <= 7) return [4, y];
  if (m >= 8 && m <= 10) return [1, y + 1];
  if (m >= 11) return [2, y + 1];
  if (m === 1) return [2, y];
  return [3, y];
}

// ── BSE helpers ───────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

interface Announcement {
  dt_tm: string;
  headline: string;
  attachment_name: string;
  subcategory: string;
}

async function fetchAnnouncements(bseCode: number, months = 18): Promise<Announcement[]> {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - months);

  const url = new URL("https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w");
  url.searchParams.set("strCat", "-1");
  url.searchParams.set("strPrevDate", fmtDate(fromDate));
  url.searchParams.set("strScrip", String(bseCode));
  url.searchParams.set("strSearch", "P");
  url.searchParams.set("strToDate", fmtDate(toDate));
  url.searchParams.set("strType", "C");
  url.searchParams.set("subcategory", "-1");

  const resp = await fetch(url.toString(), {
    headers: BSE_HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`BSE API returned ${resp.status}`);

  const json = await resp.json();
  const rows: Record<string, string>[] = json?.Table ?? [];

  return rows
    .filter((r) => (r.ATTACHMENTNAME || "").trim())
    .map((r) => ({
      dt_tm: r.DT_TM || "",
      headline: r.HEADLINE || "",
      attachment_name: (r.ATTACHMENTNAME || "").trim(),
      subcategory: r.SUBCATNAME || "",
    }))
    .filter((a) => {
      const hay = (a.headline + " " + a.subcategory).toLowerCase();
      return TRANSCRIPT_KEYWORDS.some((kw) => hay.includes(kw));
    });
}

async function downloadPdf(attachmentName: string): Promise<Buffer> {
  const url = `https://www.bseindia.com/xml-data/corpfiling/AttachHis/${attachmentName}`;
  const resp = await fetch(url, {
    headers: BSE_HEADERS,
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Error(`PDF download returned ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.slice(0, 4).toString().startsWith("%PDF"))
    throw new Error("Downloaded file is not a valid PDF");
  return buf;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  let body: { bse_code?: number; ticker?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON" }, { status: 400 });
  }

  const { bse_code, ticker } = body;
  if (!bse_code || !ticker) {
    return NextResponse.json({ detail: "bse_code and ticker are required" }, { status: 422 });
  }

  const tickerClean = ticker.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!tickerClean) {
    return NextResponse.json({ detail: "ticker must contain at least one letter" }, { status: 422 });
  }

  // Fetch already-uploaded files so we can skip duplicates
  const { data: existing } = await supabaseAdmin().storage.from(BUCKET).list("", { limit: 2000 });
  const existingNames = new Set((existing ?? []).map((f) => f.name.toLowerCase()));

  // Query BSE
  let announcements: Announcement[];
  try {
    announcements = await fetchAnnouncements(bse_code);
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: `BSE lookup failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 200 }
    );
  }

  if (!announcements.length) {
    return NextResponse.json({ ok: false, reason: "no_transcripts" }, { status: 200 });
  }

  // Try up to 3 most recent transcripts
  const uploaded: string[] = [];
  const skipped: string[] = [];

  for (const ann of announcements.slice(0, 3)) {
    try {
      const quarterFromDate = inferQuarterFromDateStr(ann.dt_tm);
      if (quarterFromDate) {
        const [q, y] = quarterFromDate;
        const candidateName = `${tickerClean}_Q${q}_${y}.pdf`;
        if (existingNames.has(candidateName.toLowerCase())) {
          skipped.push(candidateName);
          continue;
        }
      }

      const pdf = await downloadPdf(ann.attachment_name);

      // Infer quarter from PDF text (first 3 pages worth of text)
      let quarterInfo: [number, number] | null = null;
      try {
        const parsed = await pdfParse(pdf, { max: 3 });
        quarterInfo = inferQuarterFromText(parsed.text);
      } catch {}
      if (!quarterInfo) quarterInfo = inferQuarterFromDateStr(ann.dt_tm);
      if (!quarterInfo) continue;

      const [q, y] = quarterInfo;
      const filename = `${tickerClean}_Q${q}_${y}.pdf`;

      if (existingNames.has(filename.toLowerCase())) {
        skipped.push(filename);
        continue;
      }

      await supabaseAdmin()
        .storage.from(BUCKET)
        .upload(filename, pdf, { contentType: "application/pdf", upsert: true });

      existingNames.add(filename.toLowerCase());
      uploaded.push(filename);
    } catch {
      // Skip this PDF and continue
    }
  }

  return NextResponse.json({ ok: true, uploaded, skipped });
}
