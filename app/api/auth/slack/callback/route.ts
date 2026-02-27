/**
 * GET /api/auth/slack/callback?code=...&state=USER_ID
 *
 * Exchanges the Slack authorization code for a bot token and stores it.
 */

import { NextRequest, NextResponse } from "next/server";

const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const userId = searchParams.get("state");

  if (!code || !userId) {
    return NextResponse.redirect(
      new URL("/settings/connections?error=missing_params", request.url)
    );
  }

  // Exchange code for bot token
  const tokenRes = await fetch(SLACK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      redirect_uri: `${new URL(request.url).origin}/api/auth/slack/callback`,
    }),
  });

  const slackData = await tokenRes.json();

  if (!slackData.ok) {
    return NextResponse.redirect(
      new URL(
        `/settings/connections?error=${slackData.error ?? "slack_auth_failed"}`,
        request.url
      )
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await adminClient.from("user_connections").upsert(
    {
      user_id: userId,
      provider: "slack",
      slack_team_id: slackData.team?.id ?? "",
      slack_team_name: slackData.team?.name ?? "",
      slack_bot_token: slackData.access_token ?? "",
    },
    { onConflict: "user_id,provider" }
  );

  if (error) {
    return NextResponse.redirect(
      new URL("/settings/connections?error=db_write_failed", request.url)
    );
  }

  return NextResponse.redirect(
    new URL("/settings/connections?success=slack", request.url)
  );
}
