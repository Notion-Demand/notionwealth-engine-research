import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BUCKET = "transcripts";

/** GET /api/v1/available — returns { TICKER: ["Q3_2026", "Q2_2026", ...] } */
export async function GET(req: Request) {
  const debug = new URL(req.url).searchParams.has("debug");

  // Strategy: three passes to guarantee ALL files are discovered.
  //
  // Supabase Storage offset pagination silently caps at ~359 files.
  // Single-letter search also misses files at the boundary.
  //
  // 1. Offset pagination A→Z (catches first ~359 alphabetically)
  // 2. Offset pagination Z→A (catches last ~359 alphabetically)
  // 3. A–Z letter searches (safety net for anything still missed)
  //
  // Together the two offset passes overlap in the middle, covering all files.
  // Deduplicate by filename to merge.

  async function paginateAll(order: "asc" | "desc"): Promise<{ name: string }[]> {
    const files: { name: string }[] = [];
    let offset = 0;
    while (true) {
      const { data } = await supabaseAdmin()
        .storage.from(BUCKET)
        .list("", { limit: 100, offset, sortBy: { column: "name", order } });
      if (!data || data.length === 0) break;
      files.push(...data);
      if (data.length < 100) break;
      offset += data.length;
    }
    return files;
  }

  // Passes 1+2 run in parallel (asc + desc offset pagination)
  const [ascFiles, descFiles] = await Promise.all([
    paginateAll("asc"),
    paginateAll("desc"),
  ]);

  // Pass 3: A-Z letter searches (safety net)
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const letterPages = await Promise.all(
    LETTERS.map((letter) =>
      supabaseAdmin()
        .storage.from(BUCKET)
        .list("", { limit: 500, search: letter })
    )
  );
  const letterFiles: { name: string }[] = letterPages.flatMap(({ data }) => data ?? []);

  // Merge + deduplicate by filename
  const seen = new Set<string>();
  const allFiles: { name: string }[] = [];
  for (const f of [...ascFiles, ...descFiles, ...letterFiles]) {
    if (!seen.has(f.name)) {
      seen.add(f.name);
      allFiles.push(f);
    }
  }
  console.log(`[available] asc=${ascFiles.length} desc=${descFiles.length} letters=${letterFiles.length} merged=${allFiles.length}`);

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
