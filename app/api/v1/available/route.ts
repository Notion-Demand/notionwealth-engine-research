import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BUCKET = "transcripts";

/** GET /api/v1/available — returns { TICKER: ["Q3_2026", "Q2_2026", ...] } */
export async function GET(req: Request) {
  const debug = new URL(req.url).searchParams.has("debug");

  // Strategy: combine two approaches to guarantee all files are discovered.
  //
  // 1. Offset pagination — fast, but Supabase silently caps at ~359 files.
  // 2. A–Z prefix searches — catches files beyond the offset cap.
  //
  // Deduplicate by filename to merge both result sets.

  // Pass 1: offset-based pagination (covers up to ~359 files reliably)
  const offsetFiles: { name: string }[] = [];
  {
    let offset = 0;
    while (true) {
      const { data } = await supabaseAdmin()
        .storage.from(BUCKET)
        .list("", { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
      if (!data || data.length === 0) break;
      offsetFiles.push(...data);
      if (data.length < 100) break; // last page
      offset += data.length;
    }
  }

  // Pass 2: A–Z prefix searches (catches files beyond offset cap)
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const pages = await Promise.all(
    LETTERS.map((letter) =>
      supabaseAdmin()
        .storage.from(BUCKET)
        .list("", { limit: 500, search: letter })
    )
  );
  const letterFiles: { name: string }[] = pages.flatMap(({ data }) => data ?? []);

  // Merge + deduplicate by filename
  const seen = new Set<string>();
  const allFiles: { name: string }[] = [];
  for (const f of [...offsetFiles, ...letterFiles]) {
    if (!seen.has(f.name)) {
      seen.add(f.name);
      allFiles.push(f);
    }
  }
  console.log(`[available] offsetFiles=${offsetFiles.length} letterFiles=${letterFiles.length} merged=${allFiles.length}`);

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
