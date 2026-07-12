import { createHash } from "node:crypto";
import { Client as PgClient } from "pg";
import { AzureBlobStorageRepository } from "@/lib/repositories/storage";
import { storageRepo } from "@/lib/repositories";

const TABLES = [
  "analysis_results", "sector_intelligence", "kpi_snapshots", "user_tickers",
  "user_credits", "solo_analysis_cache", "insights_cache", "promoter_activity",
  "promoter_activity_fetch_log", "earnings_calendar", "concall_links",
  "api_partners", "api_keys", "api_key_products", "api_usage",
];
const HASH_SAMPLE_TABLES = ["analysis_results", "sector_intelligence", "kpi_snapshots"];
const SAMPLE_SIZE = 100;
const BLOB_HASH_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10 MB

async function verifyRowCounts(supabasePg: PgClient, azurePg: PgClient): Promise<boolean> {
  console.log("\n=== Row count verification ===");
  let allMatch = true;
  for (const table of TABLES) {
    const sRes = await supabasePg.query(`SELECT count(*) FROM ${table}`);
    const aRes = await azurePg.query(`SELECT count(*) FROM ${table}`);
    const sCount = sRes.rows[0].count;
    const aCount = aRes.rows[0].count;
    const match = sCount === aCount;
    console.log(`${table}: Supabase=${sCount} Azure=${aCount} ${match ? "OK" : "MISMATCH"}`);
    if (!match) allMatch = false;
  }
  return allMatch;
}

async function verifyContentHashes(supabasePg: PgClient, azurePg: PgClient): Promise<boolean> {
  console.log("\n=== Content hash verification (random sample) ===");
  let allMatch = true;
  for (const table of HASH_SAMPLE_TABLES) {
    const sRows = await supabasePg.query(
      `SELECT * FROM ${table} ORDER BY random() LIMIT ${SAMPLE_SIZE}`
    );
    let mismatches = 0;
    for (const row of sRows.rows) {
      const aRes = await azurePg.query(`SELECT payload FROM ${table} WHERE id = $1`, [row.id]);
      if (aRes.rows.length === 0) {
        console.log(`${table} id=${row.id}: MISSING on Azure`);
        mismatches++;
        continue;
      }
      const sHash = createHash("sha256").update(JSON.stringify(row.payload ?? row.kpis)).digest("hex");
      const aHash = createHash("sha256").update(JSON.stringify(aRes.rows[0].payload ?? aRes.rows[0].kpis)).digest("hex");
      if (sHash !== aHash) {
        console.log(`${table} id=${row.id}: HASH MISMATCH`);
        mismatches++;
      }
    }
    console.log(`${table}: sampled ${sRows.rows.length}, ${mismatches} mismatch(es)`);
    if (mismatches > 0) allMatch = false;
  }
  return allMatch;
}

async function verifyBlobs(): Promise<boolean> {
  console.log("\n=== Blob verification ===");
  const supabaseFiles = await storageRepo.listAllPaginated();
  const azureRepo = new AzureBlobStorageRepository();
  const azureFiles = await azureRepo.listAllPaginated();
  const azureNames = new Set(azureFiles.map((f) => f.name));

  let allMatch = true;
  let checked = 0;
  for (const file of supabaseFiles) {
    if (!azureNames.has(file.name)) {
      console.log(`${file.name}: MISSING on Azure`);
      allMatch = false;
      continue;
    }
    const supabaseData = await storageRepo.download(file.name);
    const azureData = await azureRepo.download(file.name);
    if (supabaseData.length !== azureData.length) {
      console.log(`${file.name}: SIZE MISMATCH (Supabase=${supabaseData.length} Azure=${azureData.length})`);
      allMatch = false;
      continue;
    }
    const shouldHash = supabaseData.length < BLOB_HASH_THRESHOLD_BYTES || Math.random() < 0.1;
    if (shouldHash) {
      const sHash = createHash("sha256").update(supabaseData).digest("hex");
      const aHash = createHash("sha256").update(azureData).digest("hex");
      if (sHash !== aHash) {
        console.log(`${file.name}: HASH MISMATCH`);
        allMatch = false;
      }
    }
    checked++;
  }
  console.log(`Blobs: ${supabaseFiles.length} total, ${checked} content-checked`);
  return allMatch;
}

async function main() {
  const supabasePg = new PgClient({ connectionString: process.env.SUPABASE_DB_CONNECTION_STRING });
  const azurePg = new PgClient({ connectionString: process.env.POSTGRES_CONNECTION_STRING, ssl: { rejectUnauthorized: true } });
  await supabasePg.connect();
  await azurePg.connect();

  const rowCountsOk = await verifyRowCounts(supabasePg, azurePg);
  const hashesOk = await verifyContentHashes(supabasePg, azurePg);
  const blobsOk = await verifyBlobs();

  await supabasePg.end();
  await azurePg.end();

  console.log("\n=== Summary ===");
  console.log(`Row counts: ${rowCountsOk ? "PASS" : "FAIL"}`);
  console.log(`Content hashes: ${hashesOk ? "PASS" : "FAIL"}`);
  console.log(`Blobs: ${blobsOk ? "PASS" : "FAIL"}`);

  if (!rowCountsOk || !hashesOk || !blobsOk) {
    console.error("\nVerification FAILED — do not proceed with cutover.");
    process.exit(1);
  }
  console.log("\nAll verification checks passed.");
}

main();
