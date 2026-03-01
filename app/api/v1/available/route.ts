import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BUCKET = "transcripts";

/** GET /api/v1/available — returns { TICKER: ["Q3_2026", "Q2_2026", ...] } */
export async function GET(req: Request) {
  const debug = new URL(req.url).searchParams.has("debug");
  // Paginate through all files — bucket may have >1000 entries
  const PAGE = 1000;
  const allFiles: { name: string }[] = [];
  let offset = 0;
  // Supabase storage list may return fewer than `limit` items mid-pagination (known quirk),
  // so we stop only when we get zero items rather than fewer-than-limit items.
  while (true) {
    const { data, error } = await supabaseAdmin()
      .storage.from(BUCKET)
      .list("", { limit: PAGE, offset });
    if (error || !data || data.length === 0) break;
    allFiles.push(...data);
    offset += PAGE;
  }

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
    const zomatoFiles = allFiles.filter((f) => f.name.toLowerCase().includes("zomato"));
    // Raw first-page re-fetch to confirm offset=0 result
    const { data: rawPage0 } = await supabaseAdmin().storage.from(BUCKET).list("", { limit: 10, offset: 346 });
    return NextResponse.json({
      ts: new Date().toISOString(),
      totalFiles: allFiles.length,
      zomatoFiles: zomatoFiles.map((f) => f.name),
      lastTenFiles: allFiles.slice(-10).map((f) => f.name),
      filesAround350: rawPage0?.map((f) => f.name),
      matchedTickers: Object.keys(available).length,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(available, {
    headers: { "Cache-Control": "no-store" },
  });
}
