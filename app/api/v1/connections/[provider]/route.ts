import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserId } from "@/lib/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { provider: string } }
) {
  try {
    const userId = await getUserId(req);
    const { provider } = params;

    if (!["gmail", "slack"].includes(provider)) {
      return NextResponse.json(
        { detail: "provider must be 'gmail' or 'slack'" },
        { status: 400 }
      );
    }

    await supabaseAdmin()
      .from("user_connections")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider);

    return new NextResponse(null, { status: 204 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Unauthorized") {
      return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
