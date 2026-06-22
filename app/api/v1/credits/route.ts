import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getCreditStatus } from "@/lib/credits";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const status = await getCreditStatus(userId);
  return NextResponse.json(status);
}
