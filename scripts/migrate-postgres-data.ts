import { execSync } from "node:child_process";

const SUPABASE_DB_URL = process.env.SUPABASE_DB_CONNECTION_STRING;
const AZURE_DB_URL = process.env.POSTGRES_CONNECTION_STRING;

if (!SUPABASE_DB_URL || !AZURE_DB_URL) {
  console.error("Set both SUPABASE_DB_CONNECTION_STRING and POSTGRES_CONNECTION_STRING before running this script.");
  process.exit(1);
}

const DUMP_FILE = "/tmp/quantalyze-data-dump.sql";

console.log("Step 1: dumping data-only from Supabase...");
execSync(
  `pg_dump --data-only --no-owner --no-privileges --exclude-table=auth.* --exclude-table=storage.* "${SUPABASE_DB_URL}" > ${DUMP_FILE}`,
  { stdio: "inherit" }
);

console.log("Step 2: loading into Azure Postgres...");
execSync(`psql "${AZURE_DB_URL}" -f ${DUMP_FILE}`, { stdio: "inherit" });

console.log("Data migration complete.");
