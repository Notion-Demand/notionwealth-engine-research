import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserId } from "@/lib/auth";

async function refreshGmailToken(
  refreshToken: string
): Promise<{ access_token: string; expiry: string }> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) throw new Error("Failed to refresh Gmail token");
  const data = await resp.json();
  const expiry = new Date(Date.now() + data.expires_in * 1000).toISOString();
  return { access_token: data.access_token, expiry };
}

function buildRawEmail(
  to: string,
  from: string,
  subject: string,
  body: string
): string {
  const lines = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { to, subject, body } = await req.json();

    const { data: conn } = await supabaseAdmin()
      .from("user_connections")
      .select(
        "gmail_email, gmail_access_token, gmail_refresh_token, gmail_token_expiry"
      )
      .eq("user_id", userId)
      .eq("provider", "gmail")
      .maybeSingle();

    if (!conn) {
      return NextResponse.json(
        { detail: "Gmail not connected. Go to Settings → Connections." },
        { status: 400 }
      );
    }

    let accessToken: string = conn.gmail_access_token;

    // Refresh access token if expired
    if (conn.gmail_token_expiry) {
      const expiry = new Date(conn.gmail_token_expiry);
      if (expiry <= new Date()) {
        const refreshed = await refreshGmailToken(conn.gmail_refresh_token);
        accessToken = refreshed.access_token;
        await supabaseAdmin()
          .from("user_connections")
          .update({
            gmail_access_token: accessToken,
            gmail_token_expiry: refreshed.expiry,
          })
          .eq("user_id", userId)
          .eq("provider", "gmail");
      }
    }

    const raw = buildRawEmail(to, conn.gmail_email, subject, body);
    const gmailResp = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      }
    );

    if (!gmailResp.ok) {
      const errText = await gmailResp.text();
      return NextResponse.json(
        { detail: `Gmail API error: ${errText}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ status: "sent", to });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Unauthorized") {
      return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ detail: `Error: ${msg}` }, { status: 500 });
  }
}
