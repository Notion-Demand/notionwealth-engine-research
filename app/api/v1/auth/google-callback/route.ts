/**
 * GET /api/v1/auth/google-callback
 *
 * Receives the Google OAuth code, exchanges it with Google server-side,
 * then signs the user in to Supabase via signInWithIdToken — all from
 * Vercel servers. Browser never contacts *.supabase.co.
 *
 * Requires env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError || !code) {
    console.error("[google-callback] Google returned error:", oauthError);
    return NextResponse.redirect(`${origin}/login?error=oauth_cancelled`);
  }

  const cookieStore = await cookies();

  // Validate CSRF state
  const savedState = cookieStore.get("google-oauth-state")?.value;
  cookieStore.delete("google-oauth-state");
  if (!savedState || savedState !== state) {
    console.error("[google-callback] State mismatch");
    return NextResponse.redirect(`${origin}/login?error=oauth_state_mismatch`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[google-callback] Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
    return NextResponse.redirect(`${origin}/login?error=oauth_misconfigured`);
  }

  // Exchange code for Google tokens (Vercel → Google, no ISP block)
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${origin}/api/v1/auth/google-callback`,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.id_token) {
    console.error("[google-callback] Token exchange failed:", tokens);
    return NextResponse.redirect(`${origin}/login?error=oauth_token_failed`);
  }

  // Sign in to Supabase using the Google ID token (Vercel → Supabase, no ISP block)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: object }>) {
          cookiesToSet.forEach(({ name, value, options }) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cookieStore.set(name, value, options as any)
          );
        },
      },
    }
  );

  const { error: signInError } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: tokens.id_token,
  });

  if (signInError) {
    console.error("[google-callback] signInWithIdToken error:", signInError.message);
    return NextResponse.redirect(`${origin}/login?error=oauth_signin_failed`);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
