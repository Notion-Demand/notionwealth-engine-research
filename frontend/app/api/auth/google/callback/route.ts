/**
 * GET /api/auth/google/callback?code=...&state=USER_ID
 *
 * Exchanges the authorization code for Gmail OAuth tokens and stores them
 * in the FastAPI backend (which writes to Supabase).
 */

import { NextRequest, NextResponse } from "next/server";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const userId = searchParams.get("state");

  if (!code || !userId) {
    return NextResponse.redirect(
      new URL("/settings/connections?error=missing_params", request.url)
    );
  }

  // Exchange code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: `${new URL(request.url).origin}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(
      new URL("/settings/connections?error=token_exchange_failed", request.url)
    );
  }

  const tokens = await tokenRes.json();

  // Fetch user email
  const userInfoRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  );
  const userInfo = await userInfoRes.json();

  // Calculate expiry ISO string
  const expiryMs = Date.now() + (tokens.expires_in ?? 3600) * 1000;
  const expiryIso = new Date(expiryMs).toISOString();

  // We need the user's Supabase JWT to call the authenticated FastAPI endpoint.
  // Pass the user_id via state; we'll call the backend using the service-role
  // pattern from a server-side route — here we forward to a server action instead.
  // Simpler approach: store directly via service-role Supabase client.
  const { createClient } = await import("@supabase/supabase-js");
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await adminClient.from("user_connections").upsert(
    {
      user_id: userId,
      provider: "gmail",
      gmail_email: userInfo.email ?? "",
      gmail_access_token: tokens.access_token ?? "",
      gmail_refresh_token: tokens.refresh_token ?? "",
      gmail_token_expiry: expiryIso,
    },
    { onConflict: "user_id,provider" }
  );

  if (error) {
    return NextResponse.redirect(
      new URL("/settings/connections?error=db_write_failed", request.url)
    );
  }

  return NextResponse.redirect(
    new URL("/settings/connections?success=gmail", request.url)
  );
}
