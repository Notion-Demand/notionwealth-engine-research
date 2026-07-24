import { Pool } from "pg";

let _pool: Pool | null = null;

/** Lazily-initialized Postgres connection pool (mirrors lib/supabase/admin.ts's
 *  lazy-singleton pattern). SSL is required — Azure Database for PostgreSQL
 *  Flexible Server enforces TLS by default regardless of public/private access. */
export function pgPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.POSTGRES_CONNECTION_STRING!,
      ssl: { rejectUnauthorized: true },
    });
    // pg emits 'error' on the pool when an idle client hits a network-level
    // fault (e.g. a TLS reset). EventEmitter throws and crashes the whole
    // process for unhandled 'error' events specifically — so this listener
    // is required, not optional, to keep a transient DB blip from taking
    // down the entire app.
    _pool.on("error", (err) => {
      console.error("[pg pool] idle client error:", err);
    });
  }
  return _pool;
}

/** Thin helper every repository method calls instead of pgPool().query(...)
 *  directly, so parameter binding stays in one place. Returns rows typed as T[].
 *  Note: `pg` automatically parses JSON/JSONB columns into JS objects/arrays on
 *  read (no manual JSON.parse needed) — but does NOT auto-serialize JS objects
 *  into JSONB for writes; bind those via JSON.stringify(...) with a `$n::jsonb`
 *  cast in the SQL, as each repository does explicitly. */
export async function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pgPool().query(text, params);
  return result.rows as T[];
}
