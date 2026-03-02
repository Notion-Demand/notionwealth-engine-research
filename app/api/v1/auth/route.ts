/**
 * POST /api/v1/auth — server-side proxy for Supabase Auth.
 *
 * Routes all browser→Supabase auth calls through Vercel servers so Indian
 * users behind ISPs (Jio, Airtel, ACT) that block *.supabase.co under
 * Section 69A (Feb 2026) can still authenticate via email/password.
 *
 * Note: Google OAuth still requires the browser to navigate to supabase.co
 * (the authorize redirect) which cannot be proxied without a full OAuth
 * relay. Indian users should use email/password sign-in.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

async function makeSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
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
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    action: string;
    email?: string;
    password?: string;
    redirectTo?: string;
  };

  const supabase = await makeSupabase();

  switch (body.action) {
    case "signin": {
      const { error } = await supabase.auth.signInWithPassword({
        email: body.email!,
        password: body.password!,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 401 });
      return NextResponse.json({ ok: true });
    }

    case "signup": {
      const { data, error } = await supabase.auth.signUp({
        email: body.email!,
        password: body.password!,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, needsConfirmation: !data.session });
    }

    case "reset": {
      const { error } = await supabase.auth.resetPasswordForEmail(body.email!, {
        redirectTo: body.redirectTo,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case "update-password": {
      const { error } = await supabase.auth.updateUser({ password: body.password! });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case "session": {
      const { data } = await supabase.auth.getSession();
      return NextResponse.json({ session: data.session });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
