import { pgPool } from "@/lib/postgres/client";

async function main() {
  const tables = await pgPool().query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`
  );
  console.log("Tables:", tables.rows.map((r) => r.table_name).join(", "));

  const policies = await pgPool().query(`SELECT * FROM pg_policies WHERE schemaname = 'public';`);
  console.log("RLS policies remaining:", policies.rows.length);

  const authSchema = await pgPool().query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'auth';`
  );
  console.log("auth schema exists:", authSchema.rows.length > 0);

  const fks = await pgPool().query(
    `SELECT tc.table_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';`
  );
  console.log("Foreign keys remaining:", JSON.stringify(fks.rows));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verify failed:", err);
    process.exit(1);
  });
