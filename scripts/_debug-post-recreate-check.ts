import { pgPool } from "@/lib/postgres/client";

async function main() {
  const tables = await pgPool().query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`
  );
  console.log("Tables:", tables.rows.map((r) => r.table_name).join(", "));
  const counts = await pgPool().query<{ n: string }>(`SELECT count(*)::text AS n FROM analysis_results`);
  console.log("analysis_results count (should be 0, post-cleanup):", counts.rows[0].n);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Check failed:", err);
    process.exit(1);
  });
