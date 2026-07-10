import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pgPool } from "@/lib/postgres/client";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Splits a .sql file's full text into individual statements (split on `;`
 * followed by a newline — every statement in supabase/migrations/*.sql ends
 * this way) and adapts each one for Azure Postgres:
 *   - drops `ENABLE ROW LEVEL SECURITY` statements entirely (Azure Postgres
 *     has no `auth.uid()` function, so any RLS policy referencing it would
 *     fail outright, not just be redundant — Auth stays on Supabase, unrelated
 *     to this migration)
 *   - drops `CREATE POLICY` statements entirely, for the same reason
 *   - strips `REFERENCES auth.users(id)` (with or without a trailing
 *     `ON DELETE CASCADE`) from column definitions, leaving the column as a
 *     plain UUID with no FK constraint (auth.users doesn't exist on Azure
 *     Postgres; Auth stays on Supabase)
 * Returns null for statements that should be dropped entirely (comments-only
 * fragments, or RLS/policy statements).
 */
function adaptStatement(rawStatement: string): string | null {
  const trimmed = rawStatement.trim();
  if (trimmed === "") return null;
  if (/ENABLE ROW LEVEL SECURITY/i.test(trimmed)) return null;
  if (/^CREATE POLICY/i.test(trimmed)) return null;
  const adapted = trimmed.replace(/REFERENCES\s+auth\.users\(id\)(\s+ON DELETE CASCADE)?/gi, "");
  return adapted + ";";
}

function splitStatements(sqlText: string): string[] {
  return sqlText.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s.length > 0);
}

async function main() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // "001_..." through "011_..." sort correctly as plain strings

  console.log(`Found ${files.length} migration files: ${files.join(", ")}`);

  for (const file of files) {
    const fullPath = join(MIGRATIONS_DIR, file);
    const sqlText = readFileSync(fullPath, "utf-8");
    const statements = splitStatements(sqlText);
    console.log(`\n--- ${file} (${statements.length} statement(s)) ---`);

    for (const raw of statements) {
      const adapted = adaptStatement(raw);
      if (adapted === null) {
        console.log(`  SKIPPED (RLS/policy): ${raw.slice(0, 60).replace(/\n/g, " ")}...`);
        continue;
      }
      try {
        await pgPool().query(adapted);
        console.log(`  OK: ${adapted.slice(0, 60).replace(/\n/g, " ")}...`);
      } catch (err) {
        console.error(`  FAILED: ${adapted.slice(0, 120).replace(/\n/g, " ")}`);
        throw err;
      }
    }
  }

  console.log("\nSchema replay complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Schema migration failed:", err);
    process.exit(1);
  });
