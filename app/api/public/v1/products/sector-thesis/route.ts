import { NextRequest, NextResponse } from "next/server";
import { sectorThesisService } from "@/lib/services";
import { toSectorThesisResponseV1 } from "@/lib/api-contracts/v1/sectorThesis";
import { isDomainError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sector = req.nextUrl.searchParams.get("sector");
  if (!sector) {
    return NextResponse.json({ error: "sector query param required" }, { status: 400 });
  }

  try {
    const result = await sectorThesisService.getSectorThesis(sector);
    return NextResponse.json(toSectorThesisResponseV1(result, new Date().toISOString()));
  } catch (err) {
    if (isDomainError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
