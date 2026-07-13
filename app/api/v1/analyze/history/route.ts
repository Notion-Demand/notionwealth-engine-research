import { NextRequest, NextResponse } from "next/server";
import { analysisRepo } from "@/lib/repositories";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });

  try {
    const history = await analysisRepo.listUserHistory(user.id, 20);
    return NextResponse.json(history);
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
