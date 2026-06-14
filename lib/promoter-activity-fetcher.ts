/**
 * Promoter/insider activity fetcher — BSE "Insider Trading / SAST" feed.
 * Reuses the same AnnSubCategoryGetData/w endpoint as transcript discovery,
 * filtered to SEBI SAST disclosures (promoter pledge/encumbrance, Reg 29
 * substantial-acquisition filings).
 */

const BSE_API_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.bseindia.com/",
  Origin: "https://www.bseindia.com",
  Accept: "application/json, */*",
};

interface BseInsiderRow {
  NEWSID: string;
  DT_TM: string;
  HEADLINE: string;
  SUBCATNAME: string;
  ATTACHMENTNAME: string;
}

export type PromoterEventType = "pledge" | "institutional" | "other";

export interface PromoterActivityEvent {
  newsId: string;
  disclosureDate: string; // YYYY-MM-DD
  subcatName: string;
  headline: string;
  attachmentName: string | null;
  eventType: PromoterEventType;
}

// Quarterly "Closure of Trading Window" notices — boilerplate, not signal.
const BOILERPLATE_RE = /closure of trading window/i;

// SEBI (SAST) Reg. 31(1)/31(2) — promoter pledge/encumbrance disclosures.
// Validated as an unambiguous, zero-false-positive substring across both
// chronically-pledged (VEDL) and clean (RELIANCE/TATAMOTORS) companies.
const PLEDGE_RE = /encumbrance.{0,40}promoter|promoter.{0,40}encumbrance/i;

// SEBI (SAST) Reg. 29(1)/29(2) — substantial acquisition/disposal disclosures.
// Often filed by unrelated institutional trustees (mutual funds) crossing
// ownership thresholds, not promoter actions — kept as secondary/informational.
const REG29_RE = /reg\.?\s*29/i;

/**
 * Fetch and classify promoter/insider SAST disclosures for a BSE scrip code
 * over an ~18-month lookback window.
 */
export async function fetchPromoterActivity(bseCode: number): Promise<PromoterActivityEvent[]> {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 548); // ~18 months back
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

  const apiUrl =
    `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w` +
    `?strCat=${encodeURIComponent("Insider Trading / SAST")}` +
    `&strPrevDate=${fmt(fromDate)}&strScrip=${bseCode}` +
    `&strSearch=P&strToDate=${fmt(toDate)}&strType=C&subcategory=-1`;

  try {
    const resp = await fetch(apiUrl, {
      headers: BSE_API_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const rows: BseInsiderRow[] = data?.Table ?? [];

    const events: PromoterActivityEvent[] = [];
    for (const r of rows) {
      const text = `${r.HEADLINE} ${r.SUBCATNAME}`;
      if (BOILERPLATE_RE.test(text)) continue;

      const eventType: PromoterEventType = PLEDGE_RE.test(text)
        ? "pledge"
        : REG29_RE.test(text)
        ? "institutional"
        : "other";

      events.push({
        newsId: r.NEWSID,
        disclosureDate: r.DT_TM.slice(0, 10),
        subcatName: r.SUBCATNAME,
        headline: r.HEADLINE,
        attachmentName: r.ATTACHMENTNAME || null,
        eventType,
      });
    }
    return events;
  } catch {
    return [];
  }
}
