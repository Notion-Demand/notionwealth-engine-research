import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BUCKET = "transcripts";

/** GET /api/v1/available — returns { TICKER: ["Q3_2026", "Q2_2026", ...] } */
export async function GET(req: Request) {
  const debug = new URL(req.url).searchParams.has("debug");
  // Use a small page size — Supabase Storage has a quirk where large limit
  // values (e.g. 1000) cap results at ~350 even when more files exist, and
  // subsequent offset calls return 0. Smaller pages paginate correctly.
  const PAGE = 100;
  const allFiles: { name: string }[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabaseAdmin()
      .storage.from(BUCKET)
      .list("", { limit: PAGE, offset });
    // Don't break on error — Supabase sometimes returns a non-fatal error alongside
    // valid data (e.g. on later pages). Breaking early causes files to be silently missed.
    if (!data || data.length === 0) break;
    allFiles.push(...data);
    offset += data.length;
  }
  console.log(`[available] totalFiles=${allFiles.length}`);

  const available: Record<string, string[]> = {};
  for (const file of allFiles) {
    const match = file.name.match(/^([A-Za-z]+)_Q(\d)_(\d{4})\.pdf$/i);
    if (!match) continue;
    const ticker = match[1].toUpperCase();
    const quarter = `Q${match[2]}_${match[3]}`;
    if (!available[ticker]) available[ticker] = [];
    available[ticker].push(quarter);
  }

  for (const ticker in available) {
    available[ticker].sort((a, b) => b.localeCompare(a));
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
