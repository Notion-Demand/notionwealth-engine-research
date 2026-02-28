import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { runPipeline, resolvePdfKey } from "@/lib/pipeline";
import { getCachedAnalysis, saveAnalysis } from "@/lib/analysis-cache";

// Allow up to 60 seconds (Vercel Hobby limit; set to 300 on Pro)
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Validate auth + params before opening the stream
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  let body: { ticker?: string; q_prev?: string; q_curr?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON" }, { status: 400 });
  }

  const { ticker, q_prev, q_curr } = body;
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

  // Resolve storage keys (validates files exist before opening stream)
  let qPrevKey: string, qCurrKey: string;
  try {
    [qPrevKey, qCurrKey] = await Promise.all([
      resolvePdfKey(tickerUp, q_prev),
      resolvePdfKey(tickerUp, q_curr),
    ]);
  } catch (e) {
    return NextResponse.json({ detail: String(e) }, { status: 422 });
  }

  const encoder = new TextEncoder();

  // ── Cache hit: serve instantly ────────────────────────────────────────────
  const cached = await getCachedAnalysis(tickerUp, q_prev, q_curr);
  if (cached) {
    console.log(`[Cache] HIT for ${tickerUp} ${q_prev}→${q_curr}`);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: "done", payload: cached, id: "cached", fromCache: true }) + "\n"
          )
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ── Cache miss: run pipeline, stream progress, save result ────────────────
  console.log(`[Cache] MISS for ${tickerUp} ${q_prev}→${q_curr} — running pipeline`);
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      };

      try {
        const payload = await runPipeline(qPrevKey, qCurrKey, send);

        // Save to cache (non-blocking — DB failure must not block the client)
        const savedId = await saveAnalysis(userId, tickerUp, q_prev, q_curr, payload);

        send({ type: "done", payload, id: savedId });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Pipeline error:", e);
        send({ type: "error", detail: `Pipeline error: ${msg}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
