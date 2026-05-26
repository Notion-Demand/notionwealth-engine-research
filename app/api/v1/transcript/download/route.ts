import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

const BUCKET = "transcripts";

/**
 * GET /api/v1/transcript/download?ticker=RELIANCE&quarter=Q4_2026
 * Returns a short-lived signed URL for the raw transcript PDF.
 */
export async function GET(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker")?.toUpperCase();
  const quarter = searchParams.get("quarter");

  if (!ticker || !quarter) {
    return NextResponse.json({ detail: "ticker and quarter are required" }, { status: 422 });
  }

  const filename = `${ticker}_${quarter}.pdf`;

  // Verify file exists
  const { data: list } = await supabaseAdmin()
    .storage.from(BUCKET)
    .list("", { search: ticker.toLowerCase(), limit: 50 });

  const found = list?.find((f) => f.name.toLowerCase() === filename.toLowerCase());
  if (!found) {
    return NextResponse.json({ detail: `Transcript not found: ${filename}` }, { status: 404 });
  }

  // Generate a signed URL valid for 5 minutes
  const { data: signed, error } = await supabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrl(found.name, 300);

  if (error || !signed) {
    return NextResponse.json({ detail: `Could not generate download URL: ${error?.message}` }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl, filename: found.name });
}
