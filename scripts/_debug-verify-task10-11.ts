import { PostgresInsightsRepository } from "@/lib/repositories/insights";
import { PostgresPromoterActivityRepository } from "@/lib/repositories/promoterActivity";

async function main() {
  console.log("--- Task 10: PostgresInsightsRepository ---");
  const insightsRepo = new PostgresInsightsRepository();
  await insightsRepo.saveInsights("TESTCO", "Q1_2026,Q2_2026", {
    ticker: "TESTCO",
    quartersAnalyzed: ["Q1_2026", "Q2_2026"],
    quarterBriefs: [],
    recurringThemes: [],
    guidanceTracks: [],
    managementCredibilityScore: 8,
    newBusinessSignals: [],
    keyWatchpoints: [],
    segmentNarrative: "test",
  });
  const cached = await insightsRepo.getCached("TESTCO", "Q1_2026,Q2_2026", 30);
  console.log("cached segmentNarrative:", cached?.segmentNarrative);
  const raw = await insightsRepo.getLatestRawPayload("TESTCO");
  console.log("raw has ticker field:", "ticker" in (raw ?? {}));

  console.log("--- Task 11: PostgresPromoterActivityRepository ---");
  const promoterRepo = new PostgresPromoterActivityRepository();
  await promoterRepo.saveFetchLog("TESTCO", new Date().toISOString(), 2);
  const fetchLog = await promoterRepo.getFetchLog("TESTCO");
  console.log("fetch log exists:", fetchLog !== null);
  const upsertResult = await promoterRepo.upsertEvents([
    { ticker: "TESTCO", newsId: "n1", disclosureDate: "2026-07-01", subcatName: "Pledge", headline: "h1", attachmentName: null, eventType: "pledge" },
    { ticker: "TESTCO", newsId: "n2", disclosureDate: "2026-07-02", subcatName: "Institutional", headline: "h2", attachmentName: null, eventType: "institutional" },
  ]);
  console.log("upsert error:", upsertResult.error);
  const listed = await promoterRepo.listByTicker("TESTCO");
  console.log("listed events count:", listed.events.length, "(expected: 2)");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verify failed:", err);
    process.exit(1);
  });
