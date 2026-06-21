import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { runSoloPipeline } from "@/lib/solo-pipeline";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  let body: { ticker?: string; quarter?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON" }, { status: 400 });
  }

  const { ticker, quarter, force } = body;
  if (!ticker || !quarter) {
    return NextResponse.json({ detail: "Required: ticker, quarter" }, { status: 422 });
  }

  const tickerUp = ticker.toUpperCase();
  const encoder = new TextEncoder();

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
        send({ type: "error", detail: "Analysis timed out — try again" });
        closed = true;
        controller.close();
      }, 110_000);

      try {
        const { payload, id } = await runSoloPipeline(
          tickerUp,
          quarter,
          (event) => send(event),
          { force: !!force }
        );
        send({ type: "done", payload, id });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Solo analysis error:", e);
        send({ type: "error", detail: msg });
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
