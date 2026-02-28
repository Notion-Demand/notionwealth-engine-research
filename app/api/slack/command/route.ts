import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import {
  verifySlackSignature,
  parseEarningsCommand,
  formatSlackBlocks,
  postToSlack,
} from "@/lib/slack";
import { runPipeline, resolvePdfPath } from "@/lib/pipeline";
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

  // Parse the command text
  const parsed = parseEarningsCommand(text);
  if (!parsed.ok) {
    return NextResponse.json({ response_type: "ephemeral", text: parsed.error });
  }

  const { ticker, qCurr, qPrev } = parsed;

  // Verify PDFs exist before ACKing (fast, local FS check)
  let qPrevPath: string, qCurrPath: string;
  try {
    qPrevPath = resolvePdfPath(ticker, qPrev);
    qCurrPath = resolvePdfPath(ticker, qCurr);
  } catch (e) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: `❌ ${String(e).replace("Error: ", "")}`,
    });
  }

  // Check cache before ACKing — if cached, post result immediately
  const cached = await getCachedAnalysis(ticker, qPrev, qCurr);
  if (cached) {
    console.log(`[Slack] Cache HIT for ${ticker} ${qPrev}→${qCurr}`);
    waitUntil(
      postToSlack(responseUrl, {
        response_type: "in_channel",
        blocks: formatSlackBlocks(cached),
      })
    );
    return NextResponse.json({
      response_type: "ephemeral",
      text: `⚡ Results for *${ticker}* (${qPrev} → ${qCurr}) — served from cache.`,
    });
  }

  // Cache miss — kick off analysis in background
  waitUntil(runAndPost(ticker, qPrev, qCurr, qPrevPath, qCurrPath, conn.user_id, responseUrl));

  // Immediately ACK to Slack (must respond within 3 s)
  return NextResponse.json({
    response_type: "ephemeral",
    text: `🔍 Analyzing *${ticker}* (${qPrev} → ${qCurr})… results will appear here shortly.`,
  });
}

async function runAndPost(
  ticker: string,
  qPrev: string,
  qCurr: string,
  qPrevPath: string,
  qCurrPath: string,
  userId: string,
  responseUrl: string
) {
  console.log("[Slack] runAndPost started", { ticker, qPrev, qCurr });
  try {
    const payload = await runPipeline(qPrevPath, qCurrPath);
    console.log("[Slack] Pipeline done, insights:", payload.insights.length, "signal:", payload.overall_signal);

    // Save to cache so next request (web or Slack) is instant
    await saveAnalysis(userId, ticker, qPrev, qCurr, payload);

    const blocks = formatSlackBlocks(payload);
    console.log("[Slack] Posting to Slack response_url...");
    await postToSlack(responseUrl, { response_type: "in_channel", blocks });
    console.log("[Slack] Posted successfully");
  } catch (e) {
    console.error("[Slack] runAndPost error:", e);
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
