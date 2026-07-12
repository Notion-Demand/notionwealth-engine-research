import { PostgresSectorRepository } from "@/lib/repositories/sectors";

async function main() {
  const repo = new PostgresSectorRepository();
  const result = await repo.replaceSector("TestSector", "Q4_2026", {
    sector: "TestSector",
    sectorLabel: "Test Sector",
    companyCount: 1,
    quarter: "Q4_2026",
    quarterPrevious: "Q3_2026",
    dimensions: [],
  });
  console.log("replaceSector result:", result);
  const fetched = await repo.getBySector("TestSector");
  console.log("fetched sectorLabel:", fetched?.sectorLabel);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verify failed:", err);
    process.exit(1);
  });
