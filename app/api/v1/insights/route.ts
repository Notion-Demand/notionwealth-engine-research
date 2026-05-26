import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { runInsightsPipeline } from "@/lib/insights-pipeline";

export const maxDuration = 300; // Vercel Pro — allow up to 5 min for multi-quarter analysis

export async function POST(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  let body: { ticker?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON" }, { status: 400 });
  }

  const { ticker } = body;
  if (!ticker?.trim()) {
    return NextResponse.json({ detail: "ticker is required" }, { status: 422 });
  }

  const tickerUp = ticker.trim().toUpperCase();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      };

      try {
        const payload = await runInsightsPipeline(tickerUp, (event) => {
          send(event);
        });
        send({ type: "done", payload });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[Insights] Pipeline error:", e);
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
