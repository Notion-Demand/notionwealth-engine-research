import { PostgresAnalysisRepository } from "@/lib/repositories/analysis";

async function main() {
  const repo = new PostgresAnalysisRepository();
  const id = await repo.saveAnalysis(null, "TESTCO", "Q3_2026", "Q4_2026", {
    ticker: "TESTCO",
    quarter: "Q4_2026",
    quarterPrevious: "Q3_2026",
    evasivenessScore: 3,
    sections: [{ section_name: "Test", key_takeaways: ["ok"], metrics: {} } as any],
    overallScore: 7,
    overallSignal: "Positive",
    summary: "test",
    validationScore: 8,
    flaggedCount: 0,
    marketAlignmentPct: 90,
    stockPriceChange: 1.2,
    marketSources: [],
    earningsDelta: ["test delta"],
    fcfImplications: [],
  });
  console.log("saved id:", id);
  const cached = await repo.getCachedAnalysis("TESTCO", "Q3_2026", "Q4_2026");
  console.log("round-trip ticker:", cached?.ticker, "summary:", cached?.summary);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verify failed:", err);
    process.exit(1);
  });
