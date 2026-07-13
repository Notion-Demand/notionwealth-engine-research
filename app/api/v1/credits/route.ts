import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCreditStatus } from "@/lib/credits";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });

  const status = await getCreditStatus(user.id);
  return NextResponse.json(status);
}
