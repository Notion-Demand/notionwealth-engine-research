import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BUCKET = "transcripts";

/** GET /api/v1/available — returns { TICKER: ["Q3_2026", "Q2_2026", ...] } */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.has("debug");
  const hintTicker = url.searchParams.get("ticker")?.toUpperCase() ?? null;

  // ── Step 1: Offset pagination to discover most files (~359 cap) ────────
  const offsetFiles: { name: string }[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabaseAdmin()
      .storage.from(BUCKET)
      .list("", { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (!data || data.length === 0) break;
    offsetFiles.push(...data);
    if (data.length < 100) break;
    offset += data.length;
  }

  // Build initial available map + collect known ticker prefixes
  const available: Record<string, string[]> = {};
  const FILE_RE = /^([A-Za-z]+)_Q(\d)_(\d{4})\.pdf$/i;
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

  // ── Step 2: Targeted per-ticker searches to catch files beyond the cap ──
  // Supabase `search: "TICKER"` reliably finds files regardless of bucket size.
  // This is cheap (~50 parallel requests) and guarantees completeness.
  const tickerSearches = await Promise.all(
    Array.from(knownTickers).map(async (ticker) => {
      const { data } = await supabaseAdmin()
        .storage.from(BUCKET)
        .list("", { limit: 50, search: ticker });
      return { ticker, files: data ?? [] };
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

  for (const ticker in available) {
    available[ticker] = Array.from(new Set(available[ticker])).sort((a, b) => b.localeCompare(a));
  }

  if (debug) {
    const search = new URL(req.url).searchParams.get("ticker")?.toLowerCase() ?? "";
    const unmatchedFiles = allFiles
      .filter((f) => !f.name.match(/^([A-Za-z]+)_Q(\d)_(\d{4})\.pdf$/i))
      .map((f) => f.name);

    // Also do a direct prefix search via Supabase (independent of pagination)
    let directSearchFiles: string[] = [];
    if (search) {
      const { data: sd } = await supabaseAdmin().storage.from(BUCKET).list("", { search, limit: 20 });
      directSearchFiles = sd?.map((f) => f.name) ?? [];
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
