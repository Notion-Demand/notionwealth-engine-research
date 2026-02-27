import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserId } from "@/lib/auth";
import { runPipeline, resolvePdfPath } from "@/lib/pipeline";

// Allow up to 60 seconds (Vercel Hobby limit; set to 300 on Pro)
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const body = await req.json();
    const { ticker, q_prev, q_curr } = body as {
      ticker?: string;
      q_prev?: string;
      q_curr?: string;
    };

    if (!ticker || !q_prev || !q_curr) {
      return NextResponse.json(
        { detail: "Required fields: ticker, q_prev, q_curr" },
        { status: 422 }
      );
    }
    if (q_prev === q_curr) {
      return NextResponse.json(
        { detail: "q_prev and q_curr must be different quarters" },
        { status: 422 }
      );
    }

    const tickerUp = ticker.toUpperCase();

    let qPrevPath: string, qCurrPath: string;
    try {
      qPrevPath = resolvePdfPath(tickerUp, q_prev);
      qCurrPath = resolvePdfPath(tickerUp, q_curr);
    } catch (e) {
      return NextResponse.json({ detail: String(e) }, { status: 422 });
    }

    const payload = await runPipeline(qPrevPath, qCurrPath);

    const { data } = await supabaseAdmin()
      .from("analysis_results")
      .insert({
        user_id: userId,
        company_ticker: tickerUp,
        q_prev,
        q_curr,
        payload: JSON.stringify(payload),
      })
      .select("id")
      .single();

    return NextResponse.json({ id: data?.id ?? "unknown", payload });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Unauthorized") {
      return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }
    console.error("Pipeline error:", e);
    return NextResponse.json({ detail: `Pipeline error: ${msg}` }, { status: 500 });
  }
}
