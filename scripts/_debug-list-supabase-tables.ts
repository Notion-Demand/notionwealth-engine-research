import { Client as PgClient } from "pg";

async function main() {
  const client = new PgClient({ connectionString: process.env.SUPABASE_DB_CONNECTION_STRING });
  await client.connect();
  const res = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`
  );
  console.log("Supabase public tables:", res.rows.map((r) => r.table_name).join(", "));
  await client.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("List failed:", err);
    process.exit(1);
  });
