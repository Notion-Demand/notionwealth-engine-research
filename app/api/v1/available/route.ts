import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BUCKET = "transcripts";

/** GET /api/v1/available — returns { TICKER: ["Q3_2026", "Q2_2026", ...] } */
export async function GET() {
  const { data, error } = await supabaseAdmin()
    .storage.from(BUCKET)
    .list("", { limit: 1000 });

  if (error || !data) return NextResponse.json({});

  const available: Record<string, string[]> = {};
  for (const file of data) {
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

  return NextResponse.json(available, {
    headers: { "Cache-Control": "no-store" },
  });
}
