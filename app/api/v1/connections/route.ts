import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserId } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);

    const { data } = await supabaseAdmin()
      .from("user_connections")
      .select("provider, connected_at, gmail_email, slack_team_id, slack_team_name")
      .eq("user_id", userId);

    return NextResponse.json(data ?? []);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Unauthorized") {
      return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
