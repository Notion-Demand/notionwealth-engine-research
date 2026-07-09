import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { storageRepo } from "@/lib/repositories";

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

  // Verify file exists. storageRepo.list() throws on a Storage error; this
  // originally swallowed such errors (list would just be undefined, falling
  // through to the same 404 as a genuine not-found) — preserved here.
  let list: { name: string }[] = [];
  try {
    list = await storageRepo.list({ search: ticker.toLowerCase(), limit: 50 });
  } catch {
    // fall through to the 404 below, matching original swallowed-error behavior
  }

  const found = list?.find((f) => f.name.toLowerCase() === filename.toLowerCase());
  if (!found) {
    return NextResponse.json({ detail: `Transcript not found: ${filename}` }, { status: 404 });
  }

  // Generate a signed URL valid for 5 minutes
  try {
    const signedUrl = await storageRepo.createSignedUrl(found.name, 300);
    return NextResponse.json({ url: signedUrl, filename: found.name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ detail: `Could not generate download URL: ${msg}` }, { status: 500 });
  }
}
