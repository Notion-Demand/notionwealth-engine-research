import { NextResponse } from "next/server";
import { storageRepo } from "@/lib/repositories";
import { NIFTY200 } from "@/lib/nifty200";

export const dynamic = "force-dynamic";

/** GET /api/v1/available — returns { TICKER: ["Q3_2026", "Q2_2026", ...] } */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.has("debug");
  const hintTicker = url.searchParams.get("ticker")?.toUpperCase() ?? null;

  // ── Step 1: Offset pagination to discover all files ────────────────────
  const offsetFiles: { name: string }[] = [];
  let offset = 0;
  while (true) {
    // storageRepo.list() throws on error; this loop historically swallowed
    // Storage errors and just stopped with whatever it had — preserved here.
    let data: { name: string }[];
    try {
      data = await storageRepo.list({ limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    } catch {
      break;
    }
    if (!data || data.length === 0) break;
    offsetFiles.push(...data);
    if (data.length < 1000) break;
    offset += data.length;
  }

  // Build initial available map + collect known ticker prefixes
  const available: Record<string, string[]> = {};
  const FILE_RE = /^(.+?)_Q(\d)_(\d{4})\.pdf$/i;
  const knownTickers = new Set<string>();

  for (const file of offsetFiles) {
    const match = file.name.match(FILE_RE);
    if (!match) continue;
    const ticker = match[1].toUpperCase();
    const quarter = `Q${match[2]}_${match[3]}`;
    knownTickers.add(ticker);
    if (!available[ticker]) available[ticker] = [];
    available[ticker].push(quarter);
  }

  // Add the hint ticker (from ?ticker= param) so we always search for it
  if (hintTicker) knownTickers.add(hintTicker);

  // Always include all Nifty 200 tickers so they're discovered even if offset listing misses them
  for (const t of Object.keys(NIFTY200)) knownTickers.add(t);

  // ── Step 2: Targeted per-ticker searches to catch files beyond the cap ──
  // Supabase `search: "TICKER"` reliably finds files regardless of bucket size.
  // This is cheap (~50 parallel requests) and guarantees completeness.
  const tickerSearches = await Promise.all(
    Array.from(knownTickers).map(async (ticker) => {
      // storageRepo.list() throws on error; a single ticker's search failing
      // must not fail every other ticker's lookup in this Promise.all — treat
      // as no files found for that ticker, matching this endpoint's original
      // silent-degrade behavior.
      try {
        const data = await storageRepo.list({ limit: 50, search: ticker });
        return { ticker, files: data ?? [] };
      } catch {
        return { ticker, files: [] };
      }
    })
  );

  // Merge any newly discovered files into the available map
  const seen = new Set(offsetFiles.map((f) => f.name));
  const allFiles = [...offsetFiles];
  for (const { files } of tickerSearches) {
    for (const file of files) {
      if (seen.has(file.name)) continue;
      seen.add(file.name);
      allFiles.push(file);
      const match = file.name.match(FILE_RE);
      if (!match) continue;
      const ticker = match[1].toUpperCase();
      const quarter = `Q${match[2]}_${match[3]}`;
      if (!available[ticker]) available[ticker] = [];
      available[ticker].push(quarter);
    }
  }

  console.log(`[available] offset=${offsetFiles.length} tickers=${knownTickers.size} merged=${allFiles.length}`);

  // Sort newest-first by year then quarter (e.g. Q3_2026 > Q4_2025)
  // localeCompare on "Q4_2025" vs "Q3_2026" is wrong — '4' > '3' beats year
  function qKey(q: string) {
    const m = q.match(/^Q(\d)_(\d{4})$/);
    return m ? parseInt(m[2]) * 10 + parseInt(m[1]) : 0;
  }
  for (const ticker in available) {
    available[ticker] = Array.from(new Set(available[ticker])).sort((a, b) => qKey(b) - qKey(a));
  }

  if (debug) {
    const search = new URL(req.url).searchParams.get("ticker")?.toLowerCase() ?? "";
    const unmatchedFiles = allFiles
      .filter((f) => !f.name.match(/^(.+?)_Q(\d)_(\d{4})\.pdf$/i))
      .map((f) => f.name);

    // Also do a direct prefix search via Supabase (independent of pagination)
    let directSearchFiles: string[] = [];
    if (search) {
      try {
        const sd = await storageRepo.list({ search, limit: 20 });
        directSearchFiles = sd?.map((f) => f.name) ?? [];
      } catch {
        directSearchFiles = [];
      }
    }

    return NextResponse.json({
      ts: new Date().toISOString(),
      totalFiles: allFiles.length,
      matchedTickers: Object.keys(available).length,
      allMatchedTickers: available,
      lastTwentyFiles: allFiles.slice(-20).map((f) => f.name),
      unmatchedFiles: unmatchedFiles.slice(0, 20),
      searchFiles: search
        ? allFiles.filter((f) => f.name.toLowerCase().startsWith(search)).map((f) => f.name)
        : [],
      directSearchFiles,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(available, {
    headers: { "Cache-Control": "no-store" },
  });
}
