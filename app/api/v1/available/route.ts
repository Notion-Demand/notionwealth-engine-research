import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BUCKET = "transcripts";

/** GET /api/v1/available — returns { TICKER: ["Q3_2026", "Q2_2026", ...] } */
export async function GET(req: Request) {
  const debug = new URL(req.url).searchParams.has("debug");
  // Supabase Storage offset-based pagination has a hard cap (~359 files) and
  // silently stops returning results beyond it. Work around this by doing 26
  // parallel prefix searches (one per letter A–Z): the search param uses a
  // different code path that isn't affected by the cap.
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const pages = await Promise.all(
    LETTERS.map((letter) =>
      supabaseAdmin()
        .storage.from(BUCKET)
        .list("", { limit: 500, search: letter })
    )
  );
  const allFiles: { name: string }[] = pages.flatMap(({ data }) => data ?? []);
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
