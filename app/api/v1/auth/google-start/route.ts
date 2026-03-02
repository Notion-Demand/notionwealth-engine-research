/**
 * GET /api/v1/auth/google-start
 *
 * Initiates Google OAuth entirely through Vercel servers — browser never
 * contacts *.supabase.co. Required for Indian ISPs (Jio/Airtel/ACT) that
 * block supabase.co under Section 69A (Feb 2026).
 *
 * Requires env vars: GOOGLE_CLIENT_ID
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { origin: reqOrigin } = new URL(req.url);
  // NEXT_PUBLIC_APP_URL pins the canonical domain so the redirect_uri is
  // always predictable regardless of which Vercel URL the request arrives on.
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? reqOrigin;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.error("[google-start] GOOGLE_CLIENT_ID not set");
    return NextResponse.redirect(`${origin}/login?error=oauth_misconfigured`);
  }

  // CSRF state nonce
  const state = crypto.randomBytes(16).toString("hex");

  const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleUrl.searchParams.set("client_id", clientId);
  googleUrl.searchParams.set("redirect_uri", `${origin}/api/v1/auth/google-callback`);
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "openid email profile");
  googleUrl.searchParams.set("state", state);
  googleUrl.searchParams.set("access_type", "online");

  const cookieStore = await cookies();
  cookieStore.set("google-oauth-state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300,
    path: "/",
  });

  return NextResponse.redirect(googleUrl.toString());
}
