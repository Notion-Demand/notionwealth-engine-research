import { NextRequest, NextResponse } from "next/server";
import { analysisRepo } from "@/lib/repositories";
import { toCompanyResponseV1 } from "@/lib/api-contracts/v1/company";
import { NotFoundError, isDomainError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();

  try {
    const analysis = await analysisRepo.getLatestByTicker(ticker);
    if (!analysis) {
      throw new NotFoundError(`no analysis available for ticker '${ticker}'`);
    }
    return NextResponse.json(toCompanyResponseV1(analysis, new Date().toISOString()));
  } catch (err) {
    if (isDomainError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
