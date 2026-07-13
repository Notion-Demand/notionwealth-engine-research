import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runInsightsPipeline } from "@/lib/insights-pipeline";
import { checkAndDeduct } from "@/lib/credits";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  const userId = user.id;

  let body: { ticker?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON" }, { status: 400 });
  }

  const { ticker, force } = body;
  if (!ticker?.trim()) {
    return NextResponse.json({ detail: "ticker is required" }, { status: 422 });
  }

  const { allowed, remaining } = await checkAndDeduct(userId, "insights");
  if (!allowed) {
    return NextResponse.json(
      { detail: `Monthly credit limit reached (${remaining} credits remaining). Top up to continue.` },
      { status: 429 }
    );
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
        }, { force: !!force });
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
