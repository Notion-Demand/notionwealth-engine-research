import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runPipeline, resolvePdfKey } from "@/lib/pipeline";
import { analysisRepo } from "@/lib/repositories";
import { toDashboardPayload, fromDashboardPayload } from "@/lib/repositories/analysis";
import { checkAndDeduct } from "@/lib/credits";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Validate auth + params before opening the stream
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  const userId = user.id;

  let body: { ticker?: string; q_prev?: string; q_curr?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON" }, { status: 400 });
  }

  const { ticker, q_prev, q_curr, force } = body as typeof body & { force?: boolean };
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
  const cached = force ? null : await analysisRepo.getCachedAnalysis(tickerUp, q_prev, q_curr);
  if (cached) {
    console.log(`[Cache] HIT for ${tickerUp} ${q_prev}→${q_curr}`);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: "done", payload: toDashboardPayload(cached), id: "cached", fromCache: true }) + "\n"
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

  // ── Credit check (only on cache miss — cache hits are free) ───────────────
  const { allowed, remaining } = await checkAndDeduct(userId, "delta");
  if (!allowed) {
    return NextResponse.json(
      { detail: `Monthly credit limit reached (${remaining} credits remaining). Top up to continue.` },
      { status: 429 }
    );
  }

  // ── Cache miss: run pipeline, stream progress, save result ────────────────
  console.log(`[Cache] MISS for ${tickerUp} ${q_prev}→${q_curr} — running pipeline`);
  const PIPELINE_TIMEOUT_MS = 270_000; // Must finish before maxDuration kills the function
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (data: object) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        } catch {
          closed = true;
        }
      };

      const timeout = setTimeout(() => {
        send({ type: "error", detail: "Pipeline timed out — try again or use a smaller transcript" });
        closed = true;
        controller.close();
      }, PIPELINE_TIMEOUT_MS);

      try {
        const payload = await runPipeline(qPrevKey, qCurrKey, send);
        const savedId = await analysisRepo.saveAnalysis(userId, tickerUp, q_prev, q_curr, fromDashboardPayload(tickerUp, q_prev, q_curr, payload));
        send({ type: "done", payload, id: savedId });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Pipeline error:", e);
        send({ type: "error", detail: `Pipeline error: ${msg}` });
      } finally {
        clearTimeout(timeout);
        if (!closed) controller.close();
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
