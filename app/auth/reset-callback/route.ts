/**
 * GET /auth/reset-callback
 *
 * Dedicated callback for password-reset emails. Supabase appends ?code=...
 * to the redirectTo URL. We exchange the code for a session here, then send
 * the user to /auth/reset-password where they set their new password.
 *
 * Using a dedicated route (rather than /auth/callback?next=...) avoids
 * Supabase dropping query params from the redirectTo during email construction.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const cookieStore = await cookies();
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

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/auth/reset-password`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
