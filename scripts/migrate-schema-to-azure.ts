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

/**
 * Splits SQL text into statements on `;`, but tracks dollar-quoted string
 * state (`$$ ... $$` or `$tag$ ... $tag$`, used by function bodies like
 * update_updated_at() in 001_initial.sql) so semicolons *inside* a function
 * body don't get treated as statement terminators. A naive split on every
 * `;` breaks any CREATE FUNCTION statement whose body contains its own
 * semicolons — exactly the case here.
 */
/**
 * Splits SQL text into statements on `;`, tracking three kinds of state that
 * must NOT be treated as containing real statement boundaries, even though
 * they can contain a literal `;` character:
 *   - dollar-quoted strings (`$$ ... $$` or `$tag$ ... $tag$`), used by
 *     function bodies like update_updated_at() in 001_initial.sql
 *   - `--` line comments, several of which in these files contain a `;`
 *     mid-sentence (e.g. "-- Populated on-demand; avoids re-hitting..." in
 *     005_concall_links.sql) — the semicolon there is prose, not SQL
 *   - single-quoted string literals (not hit by any of these 11 files today,
 *     but a real SQL splitter should handle this class of case regardless)
 * Both bugs above were found by actually running this script against a real
 * Azure Postgres instance, not just type-checking it — re-verify with a live
 * run after any further change to this function.
 */
function splitStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;
  let dollarTag = "";
  let inLineComment = false;
  let inSingleQuote = false;
  let i = 0;
  while (i < sqlText.length) {
    const char = sqlText[i];

    if (inLineComment) {
      current += char;
      if (char === "\n") inLineComment = false;
      i++;
      continue;
    }

    if (!inDollarQuote && !inSingleQuote && char === "-" && sqlText[i + 1] === "-") {
      inLineComment = true;
      current += "--";
      i += 2;
      continue;
    }

    if (!inDollarQuote && char === "'") {
      inSingleQuote = !inSingleQuote;
      current += char;
      i++;
      continue;
    }

    if (!inSingleQuote && char === "$") {
      const match = sqlText.slice(i).match(/^\$([a-zA-Z_]*)\$/);
      if (match) {
        const tag = match[0];
        if (!inDollarQuote) {
          inDollarQuote = true;
          dollarTag = tag;
          current += tag;
          i += tag.length;
          continue;
        } else if (tag === dollarTag) {
          inDollarQuote = false;
          dollarTag = "";
          current += tag;
          i += tag.length;
          continue;
        }
      }
    }

    if (char === ";" && !inDollarQuote && !inSingleQuote) {
      statements.push(current.trim());
      current = "";
      i++;
      continue;
    }

    current += char;
    i++;
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter((s) => s.length > 0);
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
