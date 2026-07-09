import { NextRequest, NextResponse } from "next/server";
import { analysisRepo } from "@/lib/repositories";
import { getUserId } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);

    const history = await analysisRepo.listUserHistory(userId, 20);

    return NextResponse.json(history);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Unauthorized") {
      return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
