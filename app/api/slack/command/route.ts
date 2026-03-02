import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import {
  verifySlackSignature,
  parseEarningsCommand,
  formatSlackBlocks,
  postToSlack,
} from "@/lib/slack";
import { runPipeline, resolvePdfKey } from "@/lib/pipeline";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCachedAnalysis, saveAnalysis } from "@/lib/analysis-cache";

// Give the background analysis time to complete
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Must read body as text first for signature verification
  const rawBody = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
  const signature = req.headers.get("x-slack-signature") ?? "";

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const teamId = params.get("team_id") ?? "";
  const responseUrl = params.get("response_url") ?? "";
  const text = params.get("text") ?? "";

  // Verify this workspace has been connected via OAuth
  const { data: conn } = await supabaseAdmin()
    .from("user_connections")
    .select("user_id")
    .eq("provider", "slack")
    .eq("slack_team_id", teamId)
    .single();

  if (!conn) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "❌ This Slack workspace hasn't been connected to Quantalyze yet. Visit your account settings to connect it.",
    });
  }

  // ACK immediately — Slack requires a response within 3 seconds.
  // All slow work (command parsing, PDF resolution, cache check, pipeline)
  // runs in the background and posts results via response_url.
  waitUntil(resolveAndRun(text, conn.user_id, responseUrl));

  return NextResponse.json({
    response_type: "ephemeral",
    text: `🔍 Processing your request… results will appear here shortly.`,
  });
}

async function resolveAndRun(
  text: string,
  userId: string,
  responseUrl: string
) {
  try {
    // 1. Parse the command text
    const parsed = await parseEarningsCommand(text);
    if (!parsed.ok) {
      await postToSlack(responseUrl, { response_type: "ephemeral", text: parsed.error });
      return;
    }

    const { ticker, qCurr, qPrev } = parsed;

    // 2. Resolve PDF storage keys
    let qPrevKey: string, qCurrKey: string;
    try {
      [qPrevKey, qCurrKey] = await Promise.all([
        resolvePdfKey(ticker, qPrev),
        resolvePdfKey(ticker, qCurr),
      ]);
    } catch (e) {
      await postToSlack(responseUrl, {
        response_type: "ephemeral",
        text: `❌ ${String(e).replace("Error: ", "")}`,
      });
      return;
    }

    // 3. Check cache — if hit, post result immediately
    const cached = await getCachedAnalysis(ticker, qPrev, qCurr);
    if (cached) {
      console.log(`[Slack] Cache HIT for ${ticker} ${qPrev}→${qCurr}`);
      await postToSlack(responseUrl, {
        response_type: "in_channel",
        blocks: formatSlackBlocks(cached),
      });
      return;
    }

    // 4. Cache miss — run the full pipeline
    console.log(`[Slack] Cache MISS for ${ticker} ${qPrev}→${qCurr} — running pipeline`);
    const payload = await runPipeline(qPrevKey, qCurrKey);
    console.log("[Slack] Pipeline done, insights:", payload.insights.length, "signal:", payload.overall_signal);

    // 5. Save to cache
    await saveAnalysis(userId, ticker, qPrev, qCurr, payload);

    // 6. Post result to Slack
    const blocks = formatSlackBlocks(payload);
    console.log("[Slack] Posting to Slack response_url...");
    await postToSlack(responseUrl, { response_type: "in_channel", blocks });
    console.log("[Slack] Posted successfully");
  } catch (e) {
    console.error("[Slack] resolveAndRun error:", e);
    try {
      await postToSlack(responseUrl, {
        response_type: "ephemeral",
        text: `❌ Analysis failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    } catch (postErr) {
      console.error("[Slack] Failed to post error back to Slack:", postErr);
    }
  }
}

