import { NextRequest, NextResponse } from "next/server";
import { sectorRepo } from "@/lib/repositories";
import { toSectorResponseV1 } from "@/lib/api-contracts/v1/sector";
import { NotFoundError, isDomainError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { sector: string } }) {
  try {
    const sector = await sectorRepo.getBySector(params.sector);
    if (!sector) {
      throw new NotFoundError(`no sector data available for '${params.sector}'`);
    }
    return NextResponse.json(toSectorResponseV1(sector, new Date().toISOString()));
  } catch (err) {
    if (isDomainError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
