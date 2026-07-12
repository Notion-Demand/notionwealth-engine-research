import { PostgresCreditsRepository } from "@/lib/repositories/credits";
import { PostgresSoloAnalysisRepository } from "@/lib/repositories/soloAnalysis";

async function main() {
  console.log("--- Task 8: PostgresCreditsRepository ---");
  const creditsRepo = new PostgresCreditsRepository();
  const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
  const status = await creditsRepo.getOrCreateStatus(TEST_USER_ID, "2026-07", 2500);
  console.log("status:", status);
  await creditsRepo.setUsed(TEST_USER_ID, "2026-07", 100);
  const updated = await creditsRepo.getOrCreateStatus(TEST_USER_ID, "2026-07", 2500);
  console.log("updated used:", updated.used, "(expected: 100)");

  console.log("--- Task 9: PostgresSoloAnalysisRepository ---");
  const soloRepo = new PostgresSoloAnalysisRepository();
  const id = await soloRepo.saveAnalysis("Test Company", "Q4_2026", {
    ticker: "Test Company",
    quarter: "Q4_2026",
    headline: "test headline",
    managementTone: "confident",
    sections: [{ title: "T", bullets: ["b"] }],
  });
  console.log("saved id:", id);
  const cached = await soloRepo.getCached("Test Company", "Q4_2026");
  console.log("round-trip headline:", cached?.headline);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verify failed:", err);
    process.exit(1);
  });
