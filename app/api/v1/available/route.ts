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
    if (error || !data || data.length === 0) break;
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
    return NextResponse.json({
      ts: new Date().toISOString(),
      totalFiles: allFiles.length,
      matchedTickers: Object.keys(available).length,
      lastTwentyFiles: allFiles.slice(-20).map((f) => f.name),
      iobFiles: allFiles.filter((f) => f.name.toLowerCase().startsWith("iob")).map((f) => f.name),
      zomatoFiles: allFiles.filter((f) => f.name.toLowerCase().startsWith("zomato")).map((f) => f.name),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(available, {
    headers: { "Cache-Control": "no-store" },
  });
}
