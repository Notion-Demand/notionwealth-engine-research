import { PostgresKpiRepository } from "@/lib/repositories/kpis";

async function main() {
  const repo = new PostgresKpiRepository();
  await repo.upsertSnapshot({ ticker: "TESTCO", sector: "TestSector", quarter: "Q4_2026", quarterPrevious: "Q3_2026", kpis: [] });
  const latest = await repo.getLatestByTicker("TESTCO");
  console.log("latest sector:", latest?.sector);
  const batch = await repo.getLatestByTickers(["TESTCO"]);
  console.log("batch size:", batch.size, "has TESTCO:", batch.has("TESTCO"));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verify failed:", err);
    process.exit(1);
  });
