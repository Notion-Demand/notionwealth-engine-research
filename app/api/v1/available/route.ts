import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const PDF_DIR = path.join(
  process.cwd(),
  "finance-agent",
  "multiagent_analysis",
  "all-pdfs"
);

/** GET /api/v1/available — returns { TICKER: ["Q3_2026", "Q2_2026", ...] } */
export async function GET() {
  try {
    const files = fs.readdirSync(PDF_DIR);
    const available: Record<string, string[]> = {};

    for (const f of files) {
      const match = f.match(/^([A-Za-z]+)_Q(\d)_(\d{4})\.pdf$/i);
      if (!match) continue;
      const ticker = match[1].toUpperCase();
      const quarter = `Q${match[2]}_${match[3]}`;
      if (!available[ticker]) available[ticker] = [];
      available[ticker].push(quarter);
    }

    // Sort quarters newest-first within each ticker
    for (const ticker in available) {
      available[ticker].sort((a, b) => b.localeCompare(a));
    }

    return NextResponse.json(available);
  } catch {
    return NextResponse.json({});
  }
}
