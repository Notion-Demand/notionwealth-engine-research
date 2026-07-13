# Azure Data + Storage Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Postgres and Supabase Storage with Azure Database for PostgreSQL Flexible Server and Azure Blob Storage, behind the exact same 12 repository interfaces the app already codes against — a one-time cutover with zero behavior change except two deliberate, documented exceptions (WatchlistRepository's security model, ApiAccessRepository's usage-counter atomicity).

**Architecture:** Eleven new `PostgresXRepository` classes (added to their existing `lib/repositories/*.ts` files, alongside the current `SupabaseXRepository` classes) implement hand-written parameterized SQL via a shared `query<T>()` helper in `lib/postgres/client.ts`. A new `AzureBlobStorageRepository` (added to `lib/repositories/storage.ts`) replaces Supabase Storage. A migration adapter script mechanically strips `auth.users` foreign keys and RLS statements from the existing `supabase/migrations/*.sql` files and replays the result against the new Postgres instance. One-time data migration copies rows and blobs; the composition root (`lib/repositories/index.ts`) is edited once, at cutover, to point at the new classes.

**Tech Stack:** `pg` (node-postgres) for Postgres, `@azure/storage-blob` for Blob Storage, Azure CLI (`az`) for provisioning, TypeScript throughout — no ORM, no IaC tool.

## Global Constraints

- Public API code and all application code depend exclusively on repository interfaces — never `pg`/`@azure/storage-blob` directly outside the repository implementation files (spec: Migration invariants).
- Repository *interfaces* don't change, with two documented exceptions: `WatchlistRepository`'s three methods take `userId: string` instead of a `SupabaseClient`; `StorageRepository` is unchanged (spec: Migration invariants, Storage implementation).
- Domain entities, the service layer (`lib/services/*`), public API contracts (`lib/api-contracts/v1/*`), and route handlers don't change, except the one `app/api/v1/user-tickers/route.ts` call-site update forced by the WatchlistRepository interface change (spec: Migration invariants).
- New Postgres classes are named `PostgresXRepository` (never `AzureXRepository`) — the code is plain Postgres, portable to any host; only `lib/postgres/client.ts`'s connection *configuration* (env var, private network) is Azure-specific (spec: Repository implementations — naming).
- `lib/postgres/client.ts` is the only Postgres-specific connection file; env var is `POSTGRES_CONNECTION_STRING`, not `AZURE_`-prefixed (spec: Connection module).
- `StorageRepository.download()`/`upload()` keep their exact current `Buffer`-based signatures — no streaming interface change, since every real call site needs a `Buffer` for `pdf-parse` regardless (spec: Storage implementation).
- Schema is derived mechanically from `supabase/migrations/*.sql` via an adapter script — never hand-authored as a second, separately-maintained schema (spec: Schema migration).
- Every `REFERENCES auth.users(id)` FK is dropped; every RLS `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY` statement is dropped (Azure Postgres has no `auth.uid()` function — these statements would fail outright, not just be redundant) (spec: Schema migration, plus a build detail this plan resolves).
- `WatchlistRepository`'s Postgres and Supabase implementations both add explicit `WHERE user_id = $1` filtering — a conscious replacement for Supabase RLS, not a silent regression (spec: Watchlist security model).
- `ApiAccessRepository.incrementUsage` becomes a single atomic `INSERT ... ON CONFLICT ... DO UPDATE SET request_count = request_count + 1` — every other non-atomic read-then-write pattern in the other repositories (`CreditsRepository.getOrCreateStatus`) is preserved exactly as today, not "fixed" (per this plan's own decisions, confirmed with the user).
- Migration tooling (schema adapter, data migration, blob migration, verification) lives under `scripts/`, never `lib/` (spec: Data migration).
- Postgres version 17, SKU `Standard_B1ms` (Burstable), Central India, private-only VNet access via a new `postgres-delegated-subnet` in the existing `quantalyze-prod-vnet` (spec: Networking, Schema migration).
- Region for every new resource: Central India (`centralindia`), matching the already-provisioned `quantalyze-prod-rg`/`quantalyze-app`/`quantalyze-prod-vnet` from the Hosting migration (spec: Networking).
- No automated test runner exists in this repo. Verification is `npx tsc --noEmit` for every code change, plus the Verification section's row-count/hash checks, plus manual route smoke tests (spec: Testing).
- Non-goals: Auth migration, an ORM, Infrastructure-as-code, a permanent multi-provider runtime flag, connection pooling middleware (PgBouncer), zero-downtime dual-write (spec: Non-goals).

---

### Task 1: Provision Azure Postgres Flexible Server and Storage account

**Files:** none (infrastructure only).

**Interfaces:**
- Consumes: an authenticated `az` CLI session (already logged in from the Hosting migration); the existing `quantalyze-prod-rg` resource group and `quantalyze-prod-vnet` VNet.
- Produces: a running Postgres Flexible Server reachable only from inside `quantalyze-prod-vnet`, and a Blob Storage account + container — their connection details are consumed by Task 2 (Postgres) and Task 15 (Blob).

- [ ] **Step 1: Confirm the authenticated session and existing resources**

```bash
az account show --query "{subscriptionId:id, name:name}" -o table
az group show --name quantalyze-prod-rg --query name -o tsv
az network vnet show --resource-group quantalyze-prod-rg --name quantalyze-prod-vnet --query name -o tsv
```

Expected: all three commands succeed and print the expected names. If any fails, stop — this task depends on the Hosting migration's resources already existing.

- [ ] **Step 2: Create the Postgres-delegated subnet**

```bash
az network vnet subnet create \
  --resource-group quantalyze-prod-rg \
  --vnet-name quantalyze-prod-vnet \
  --name postgres-delegated-subnet \
  --address-prefixes 10.0.2.0/24 \
  --delegations Microsoft.DBforPostgreSQL/flexibleServers
```

Expected: JSON output with `"provisioningState": "Succeeded"`.

- [ ] **Step 3: Generate a strong admin password**

```bash
POSTGRES_ADMIN_PASSWORD=$(openssl rand -base64 24)
echo "Generated password length: ${#POSTGRES_ADMIN_PASSWORD}"
```

Do not print the password itself to any log, chat, or commit. Keep this shell variable set for the next step (same session), and store the password securely (e.g. a password manager) once provisioning succeeds — it is not recoverable from Azure afterward except by resetting it.

- [ ] **Step 4: Provision the Postgres Flexible Server**

```bash
az postgres flexible-server create \
  --resource-group quantalyze-prod-rg \
  --name quantalyze-postgres \
  --location centralindia \
  --version 17 \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --vnet quantalyze-prod-vnet \
  --subnet postgres-delegated-subnet \
  --private-dns-zone quantalyze-postgres.private.postgres.database.azure.com \
  --admin-user quantalyzeadmin \
  --admin-password "$POSTGRES_ADMIN_PASSWORD" \
  --yes
```

Expected: JSON output with `"state": "Ready"` (may take several minutes). If the command fails with a name conflict on `quantalyze-postgres` (server names are only unique within your subscription, so this is unlikely but possible if re-run), retry with a suffix and use that name consistently in every later step.

- [ ] **Step 5: Confirm no public network access**

```bash
az postgres flexible-server show \
  --resource-group quantalyze-prod-rg \
  --name quantalyze-postgres \
  --query "{network:network, state:state}" -o json
```

Expected: `network.publicNetworkAccess` is `"Disabled"` (VNet-integrated servers created with `--vnet`/`--subnet` have no public endpoint by default).

- [ ] **Step 6: Construct and save the connection string**

Use the server's own reported FQDN, not the private DNS zone's name — they're different hostnames. Confirm first:

```bash
az postgres flexible-server show \
  --resource-group quantalyze-prod-rg \
  --name quantalyze-postgres \
  --query fullyQualifiedDomainName -o tsv
```

Expected: `quantalyze-postgres.postgres.database.azure.com` (note: **no** `.private.` in this hostname, even though the private DNS zone created in Step 4 is named `quantalyze-postgres.private.postgres.database.azure.com` — that zone name and the server's connection hostname are deliberately different; Azure resolves the server's public-style FQDN to the private IP automatically for any resource inside a VNet linked to that zone. Using the zone's own name as the connection hostname will fail DNS resolution.)

```bash
POSTGRES_CONNECTION_STRING="postgresql://quantalyzeadmin:${POSTGRES_ADMIN_PASSWORD}@quantalyze-postgres.postgres.database.azure.com:5432/postgres?sslmode=require"
echo "Connection string constructed (length: ${#POSTGRES_CONNECTION_STRING} chars)"
```

Save this value securely now — it's needed as the `POSTGRES_CONNECTION_STRING` App Service Application Setting in Task 18, and for testing in every repository task below (Tasks 4–14).

**Note on testing connectivity:** this Postgres server has no public endpoint — neither your local machine nor Kudu's SCM sandbox (which does not share the main site's VNet integration) can reach it directly. Testing requires either the actual deployed App Service (once code is deployed there) or a temporary jump-box inside `quantalyze-prod-vnet` (e.g., an Azure Container Instance with its own delegated subnet) for the duration of Tasks 2–17's live verification steps. Do not print connection strings in full to any shared log.

- [ ] **Step 7: Provision the Storage account and container**

```bash
az storage account create \
  --name quantalyzestorage \
  --resource-group quantalyze-prod-rg \
  --location centralindia \
  --sku Standard_LRS \
  --kind StorageV2
```

If `quantalyzestorage` is taken (storage account names are globally unique), retry with a suffix (e.g. `quantalyzestorage01`) and use that name consistently below.

```bash
AZURE_STORAGE_CONNECTION_STRING=$(az storage account show-connection-string \
  --name quantalyzestorage \
  --resource-group quantalyze-prod-rg \
  --query connectionString -o tsv)
echo "Storage connection string retrieved (length: ${#AZURE_STORAGE_CONNECTION_STRING} chars)"

az storage container create \
  --account-name quantalyzestorage \
  --name transcripts \
  --connection-string "$AZURE_STORAGE_CONNECTION_STRING"
```

Expected: `{"created": true}`. The container is named `transcripts`, matching the existing Supabase bucket name (functionally equivalent, per spec).

- [ ] **Step 8: Provision a temporary jump-box for testing (discovered necessary during execution)**

Neither your local machine nor Kudu's SCM sandbox can reach the private Postgres server — Kudu is documented as not sharing the main site's VNet integration. A temporary Azure Container Instance, in its own delegated subnet within the same VNet, is the practical way to run every live-verification step in Tasks 2–17.

```bash
az network vnet subnet create \
  --resource-group quantalyze-prod-rg \
  --vnet-name quantalyze-prod-vnet \
  --name aci-migration-subnet \
  --address-prefixes 10.0.3.0/24 \
  --delegations Microsoft.ContainerInstance/containerGroups
```

If this is the first Container Instance in the subscription, register the provider first (one-time): `az provider register --namespace Microsoft.ContainerInstance`, then poll `az provider show --namespace Microsoft.ContainerInstance --query registrationState -o tsv` until `Registered`.

```bash
GH_TOKEN=$(gh auth token)
POSTGRES_CONNECTION_STRING="<value from Step 6>"
AZURE_STORAGE_CONNECTION_STRING="<value from Step 7>"

az container create \
  --resource-group quantalyze-prod-rg \
  --name quantalyze-migration-jumpbox \
  --location centralindia \
  --image mcr.microsoft.com/devcontainers/javascript-node:22-bookworm \
  --os-type Linux \
  --cpu 1 --memory 2 \
  --vnet quantalyze-prod-vnet \
  --subnet aci-migration-subnet \
  --restart-policy Never \
  --secure-environment-variables \
    GH_TOKEN="$GH_TOKEN" \
    POSTGRES_CONNECTION_STRING="$POSTGRES_CONNECTION_STRING" \
    AZURE_STORAGE_CONNECTION_STRING="$AZURE_STORAGE_CONNECTION_STRING" \
    AZURE_STORAGE_CONTAINER="transcripts" \
  --command-line 'bash -c "apt-get update -qq; apt-get install -y -qq postgresql-client git curl; git clone https://x-access-token:${GH_TOKEN}@github.com/Notion-Demand/notionwealth-engine-research.git /app; cd /app && git checkout <your-feature-branch> && npm install; sleep infinity"'
```

**Critical: never let `${GH_TOKEN}` (or any other secret) be expanded by your own local shell before reaching Azure** — the entire `--command-line` value above must stay single-quoted so your shell passes `${GH_TOKEN}` through literally, letting the *container's own* `bash -c` resolve it from the secure environment variable at runtime. If you interpolate the token yourself (e.g., via double-quoting, or an escaping mistake), the raw token value gets baked into the container's command-line property, which Azure stores and echoes back in every `show`/`create`/`delete` response — a real credential leak. If this happens, revoke the token immediately (`gh auth logout`, then also manually confirm via GitHub → Settings → Applications → Authorized OAuth Apps) and recreate the container with a fresh token, quoted correctly.

Push your feature branch to origin first (`git push -u origin <branch>`) — the container clones from GitHub, not your local disk.

**Running commands in the jump-box:** use `az container exec --resource-group quantalyze-prod-rg --name quantalyze-migration-jumpbox --exec-command "<command>"`. Keep commands simple (a single binary + args, or a call to a committed script file) — nested quotes inside `--exec-command` are unreliable and will produce confusing shell-parsing errors. For anything non-trivial, write it as a script file, commit and push it, then `git -C /app pull` inside the jump-box (via a plain `az container exec`) and run the file directly, rather than fighting inline quoting. `az container logs` only shows the container's original startup command output, not the output of separate `exec` sessions — use the `exec` command's own returned output for those.

**Connectivity gotcha:** the connection hostname is the server's own FQDN (`<server>.postgres.database.azure.com`, confirmed in Step 6) — not the private DNS zone's name (`<server>.private.postgres.database.azure.com`, from Step 4). Using the zone name as the connection host fails DNS resolution even from inside the correct VNet.

This jump-box is deleted once Task 18's cutover is verified and no further live testing is needed:

```bash
az container delete --resource-group quantalyze-prod-rg --name quantalyze-migration-jumpbox --yes
```

No commit for the infrastructure itself — nothing in this repo's tracked files changes, though the temporary debug scripts referenced above should not be merged into the final PR (see Task 18's cleanup).

---

### Task 2: Postgres connection module

**Files:**
- Create: `lib/postgres/client.ts`
- Modify: `package.json` (add `pg` dependency)

**Interfaces:**
- Consumes: `POSTGRES_CONNECTION_STRING` env var (Task 1).
- Produces: `pgPool(): Pool` and `query<T>(text: string, params?: unknown[]): Promise<T[]>`, consumed by every repository task (4–14).

- [ ] **Step 1: Install `pg`**

```bash
npm install pg
npm install --save-dev @types/pg
```

- [ ] **Step 2: Write the connection module**

Create `lib/postgres/client.ts`:

```ts
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
  }
  return _pool;
}

/** Thin helper every repository method calls instead of pgPool().query(...)
 *  directly, so parameter binding stays in one place. Returns rows typed as T[].
 *  Note: `pg` automatically parses JSON/JSONB columns into JS objects/arrays on
 *  read (no manual JSON.parse needed) — but does NOT auto-serialize JS objects
 *  into JSONB for writes; bind those via JSON.stringify(...) with a `$n::jsonb`
 *  cast in the SQL, as each repository task below does explicitly. */
export async function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pgPool().query(text, params);
  return result.rows as T[];
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/postgres/client.ts package.json package-lock.json
git commit -m "feat: add Postgres connection module (lib/postgres/client.ts)"
```

---

### Task 3: Schema migration adapter

**Files:**
- Create: `scripts/migrate-schema-to-azure.ts`

**Interfaces:**
- Consumes: `supabase/migrations/001_initial.sql` through `011_api_access.sql` (read as plain text); `pgPool()` from `lib/postgres/client.ts` (Task 2).
- Produces: the full schema replayed onto the Azure Postgres instance, consumed by every repository task's live-verification step (4–14) and by Task 16's data migration.

- [ ] **Step 1: Write the adapter script**

Create `scripts/migrate-schema-to-azure.ts`:

```ts
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
 *
 * Note: RLS/policy statements are detected without a leading `^` anchor
 * because several of these files have the actual SQL keyword preceded by a
 * `--` line comment within the same split statement (e.g. 006_user_tickers.sql:
 * "-- Users can only read / write their own rows\nCREATE POLICY ..."). An
 * anchored `^CREATE POLICY` regex misses these — found by running this script
 * against a real Azure Postgres instance, not just type-checking it.
 */
function adaptStatement(rawStatement: string): string | null {
  const trimmed = rawStatement.trim();
  if (trimmed === "") return null;
  if (/ENABLE ROW LEVEL SECURITY/i.test(trimmed)) return null;
  if (/CREATE POLICY/i.test(trimmed)) return null;
  const adapted = trimmed.replace(/REFERENCES\s+auth\.users\(id\)(\s+ON DELETE CASCADE)?/gi, "");
  return adapted + ";";
}

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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run against the real Azure Postgres instance**

With `POSTGRES_CONNECTION_STRING` set (from Task 1 Step 6) in your local shell or `.env.local`:

```bash
npx tsx scripts/migrate-schema-to-azure.ts
```

Expected: every statement logs `OK` or `SKIPPED (RLS/policy)`; script exits 0. If any statement fails, the script throws and exits 1 with the failing statement printed — do not proceed to later tasks until this completes cleanly.

- [ ] **Step 4: Verify the schema landed correctly**

```bash
npx tsx -e "
import { query } from './lib/postgres/client';
(async () => {
  const tables = await query<{ table_name: string }>(
    \"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name\"
  );
  console.log(tables.map(t => t.table_name).join('\n'));
  process.exit(0);
})();
"
```

Expected: all 12 tables listed — `analysis_results`, `api_key_products`, `api_keys`, `api_partners`, `api_usage`, `concall_links`, `earnings_calendar`, `insights_cache`, `kpi_snapshots`, `promoter_activity`, `promoter_activity_fetch_log`, `sector_intelligence`, `solo_analysis_cache`, `user_credits`, `user_tickers` (15 tables total — note `user_connections` from `001_initial.sql` also gets created since the adapter only strips RLS/FK details, not whole tables, even though no repository queries it; this is expected and harmless).

- [ ] **Step 5: Confirm the auth.users FK and RLS were actually dropped**

```bash
npx tsx -e "
import { query } from './lib/postgres/client';
(async () => {
  const fks = await query(\"SELECT conname FROM pg_constraint WHERE confrelid = 'auth.users'::regclass::oid\").catch(() => []);
  console.log('FKs to auth.users:', fks.length, '(expected: 0, and this query itself should fail since auth.users does not exist on Azure Postgres — that failure IS the confirmation)');
  process.exit(0);
})();
"
```

Expected: this query itself fails with an error like `relation "auth.users" does not exist` — that failure is the confirmation that no FK to a nonexistent schema was created (if the FK had somehow been created, table creation would have failed already in Step 3, so this step is a belt-and-suspenders sanity check, not the primary verification).

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-schema-to-azure.ts
git commit -m "feat: add schema migration adapter script (Supabase migrations -> Azure Postgres)"
```

---

### Task 4: PostgresAnalysisRepository

**Files:**
- Modify: `lib/repositories/analysis.ts`

**Interfaces:**
- Consumes: `query<T>` from `lib/postgres/client.ts` (Task 2); the existing private `toEntity`/`fromEntity` functions already in this file (unchanged, reused as-is).
- Produces: `PostgresAnalysisRepository` implementing `AnalysisRepository`, consumed by Task 18's composition-root swap.

- [ ] **Step 1: Add the import**

At the top of `lib/repositories/analysis.ts`, add:

```ts
import { query } from "@/lib/postgres/client";
```

- [ ] **Step 2: Add the class**

Append to `lib/repositories/analysis.ts` (after `SupabaseAnalysisRepository`):

```ts
export class PostgresAnalysisRepository implements AnalysisRepository {
  async getCachedAnalysis(ticker: string, qPrev: string, qCurr: string, opts: { strict?: boolean } = {}): Promise<Analysis | null> {
    const strict = opts.strict ?? true;
    const rows = await query<{ payload: unknown }>(
      `SELECT payload FROM analysis_results
       WHERE company_ticker = $1 AND q_prev = $2 AND q_curr = $3
       ORDER BY created_at DESC LIMIT 1`,
      [ticker.toUpperCase(), qPrev, qCurr]
    );
    if (rows.length === 0) return null;
    let raw: Record<string, unknown>;
    try {
      raw = (typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload as string) : rows[0].payload) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (!Array.isArray(raw.insights) || raw.insights.length === 0) return null;
    if (strict && !Array.isArray(raw.earnings_delta)) return null;
    return toEntity(ticker.toUpperCase(), qPrev, qCurr, raw);
  }

  async saveAnalysis(userId: string | null, ticker: string, qPrev: string, qCurr: string, analysis: Analysis): Promise<string> {
    try {
      if (!Array.isArray(analysis.sections) || analysis.sections.length === 0) {
        return "not-cached-empty";
      }
      const tickerUp = ticker.toUpperCase();
      await query(`DELETE FROM analysis_results WHERE company_ticker = $1 AND q_prev = $2 AND q_curr = $3`, [tickerUp, qPrev, qCurr]);
      const rows = await query<{ id: string }>(
        `INSERT INTO analysis_results (user_id, company_ticker, q_prev, q_curr, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
        [userId, tickerUp, qPrev, qCurr, JSON.stringify(fromEntity(analysis))]
      );
      return rows[0]?.id ?? "unknown";
    } catch (e) {
      console.error("Failed to save analysis result:", e);
      return "unknown";
    }
  }

  async listRecentByTickersAndQuarter(tickers: string[], qCurr: string, limit: number): Promise<AnalysisRecord[]> {
    const rows = await query<{ company_ticker: string; payload: unknown }>(
      `SELECT company_ticker, payload FROM analysis_results
       WHERE q_curr = $1 AND company_ticker = ANY($2::text[])
       ORDER BY created_at DESC LIMIT $3`,
      [qCurr, tickers, limit]
    );
    return rows.map((row) => ({
      ticker: row.company_ticker,
      quarterPrevious: "",
      quarter: qCurr,
      analysis: toEntity(row.company_ticker, "", qCurr, row.payload),
      createdAt: "",
    }));
  }

  async listAllByTickers(tickers: string[]): Promise<{ records: AnalysisRecord[]; error: string | null }> {
    try {
      const rows = await query<{ company_ticker: string; q_curr: string; q_prev: string; payload: unknown; created_at: string }>(
        `SELECT company_ticker, q_curr, q_prev, payload, created_at FROM analysis_results
         WHERE company_ticker = ANY($1::text[]) ORDER BY created_at DESC`,
        [tickers]
      );
      const records = rows.map((row) => ({
        ticker: row.company_ticker,
        quarterPrevious: row.q_prev,
        quarter: row.q_curr,
        analysis: toEntity(row.company_ticker, row.q_prev, row.q_curr, row.payload),
        createdAt: row.created_at,
      }));
      return { records, error: null };
    } catch (err) {
      return { records: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async getLatestByTicker(ticker: string): Promise<Analysis | null> {
    const rows = await query<{ company_ticker: string; q_curr: string; q_prev: string; payload: unknown }>(
      `SELECT company_ticker, q_curr, q_prev, payload FROM analysis_results
       WHERE company_ticker = $1 ORDER BY created_at DESC LIMIT 1`,
      [ticker]
    );
    if (rows.length === 0) return null;
    return toEntity(rows[0].company_ticker, rows[0].q_prev, rows[0].q_curr, rows[0].payload);
  }

  async listByTickersAndQuarterPair(tickers: string[], qPrev: string, qCurr: string): Promise<AnalysisRecord[]> {
    const rows = await query<{ company_ticker: string; q_curr: string; q_prev: string; payload: unknown; created_at: string }>(
      `SELECT company_ticker, q_curr, q_prev, payload, created_at FROM analysis_results
       WHERE q_prev = $1 AND q_curr = $2 AND company_ticker = ANY($3::text[])
       ORDER BY created_at DESC`,
      [qPrev, qCurr, tickers]
    );
    return rows.map((row) => ({
      ticker: row.company_ticker,
      quarterPrevious: row.q_prev,
      quarter: row.q_curr,
      analysis: toEntity(row.company_ticker, row.q_prev, row.q_curr, row.payload),
      createdAt: row.created_at,
    }));
  }

  async listTickersWithAnalysis(tickers: string[]): Promise<string[]> {
    const rows = await query<{ company_ticker: string }>(
      `SELECT company_ticker FROM analysis_results WHERE company_ticker = ANY($1::text[])`,
      [tickers]
    );
    return rows.map((r) => r.company_ticker);
  }

  async listAllTickerQuarterPairs(): Promise<{ ticker: string; qCurr: string }[]> {
    const rows = await query<{ company_ticker: string; q_curr: string }>(`SELECT company_ticker, q_curr FROM analysis_results`);
    return rows.map((r) => ({ ticker: r.company_ticker, qCurr: r.q_curr }));
  }

  async listUserHistory(userId: string, limit: number): Promise<(AnalysisRecord & { id: string })[]> {
    const rows = await query<{ id: string; company_ticker: string; q_curr: string; payload: unknown; created_at: string }>(
      `SELECT id, company_ticker, q_curr, payload, created_at FROM analysis_results
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return rows.map((row) => ({
      id: row.id,
      ticker: row.company_ticker,
      quarterPrevious: "",
      quarter: row.q_curr,
      analysis: toEntity(row.company_ticker, "", row.q_curr, row.payload),
      createdAt: row.created_at,
    }));
  }
}
```

Note: `getCachedAnalysis` does its own defensive `JSON.parse` because `toEntity` (already in this file) expects either a string or an already-parsed object — `pg` auto-parses JSONB columns into JS objects on read, so `rows[0].payload` will normally already be an object, but the existing `toEntity` function's own defensive handling (`typeof raw === "string" ? JSON.parse(raw) : raw`) is preserved by calling it unchanged; the extra check here exists only to validate `insights`/`earnings_delta` shape before calling `toEntity`, matching the original Supabase implementation's exact validation order.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification against the real Azure Postgres instance**

```bash
npx tsx -e "
import { PostgresAnalysisRepository } from './lib/repositories/analysis';
(async () => {
  const repo = new PostgresAnalysisRepository();
  const id = await repo.saveAnalysis(null, 'TESTCO', 'Q3_2026', 'Q4_2026', {
    ticker: 'TESTCO', quarter: 'Q4_2026', quarterPrevious: 'Q3_2026',
    evasivenessScore: 3, sections: [{ section_name: 'Test', key_takeaways: ['ok'], metrics: {} } as any],
    overallScore: 7, overallSignal: 'Positive', summary: 'test', validationScore: 8,
    flaggedCount: 0, marketAlignmentPct: 90, stockPriceChange: 1.2, marketSources: [],
    earningsDelta: ['test delta'], fcfImplications: [],
  });
  console.log('saved id:', id);
  const cached = await repo.getCachedAnalysis('TESTCO', 'Q3_2026', 'Q4_2026');
  console.log('round-trip ticker:', cached?.ticker, 'summary:', cached?.summary);
  process.exit(0);
})();
"
```

Expected: `saved id: <a uuid>`, `round-trip ticker: TESTCO summary: test`. This confirms the JSONB round-trip and the delete-then-insert pattern both work against the real server.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/analysis.ts
git commit -m "feat: add PostgresAnalysisRepository"
```

---

### Task 5: PostgresSectorRepository

**Files:**
- Modify: `lib/repositories/sectors.ts`

**Interfaces:**
- Consumes: `query<T>` from `lib/postgres/client.ts`; the existing private `toEntity`/`fromEntity` in this file.
- Produces: `PostgresSectorRepository` implementing `SectorRepository`.

- [ ] **Step 1: Add the import**

At the top of `lib/repositories/sectors.ts`, add:

```ts
import { query } from "@/lib/postgres/client";
```

- [ ] **Step 2: Add the class**

Append to `lib/repositories/sectors.ts`:

```ts
export class PostgresSectorRepository implements SectorRepository {
  async listBySectors(sectors: string[]): Promise<{ records: SectorRecord[]; error: string | null }> {
    try {
      const rows = await query<{ sector: string; quarter: string; payload: unknown; created_at: string }>(
        `SELECT sector, quarter, payload, created_at FROM sector_intelligence
         WHERE sector = ANY($1::text[]) ORDER BY created_at DESC`,
        [sectors]
      );
      const records = rows.map((row) => ({
        sector: row.sector,
        quarter: row.quarter,
        payload: toEntity(row.payload),
        createdAt: row.created_at,
      }));
      return { records, error: null };
    } catch (err) {
      return { records: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async getBySector(sector: string): Promise<Sector | null> {
    const rows = await query<{ payload: unknown }>(
      `SELECT payload FROM sector_intelligence WHERE sector = $1 ORDER BY created_at DESC LIMIT 1`,
      [sector]
    );
    if (rows.length === 0) return null;
    return toEntity(rows[0].payload);
  }

  async replaceSector(sector: string, quarter: string, payload: Sector): Promise<{ id: string | null; error: string | null }> {
    try {
      await query(`DELETE FROM sector_intelligence WHERE sector = $1`, [sector]);
      const rows = await query<{ id: string }>(
        `INSERT INTO sector_intelligence (sector, quarter, payload) VALUES ($1, $2, $3::jsonb) RETURNING id`,
        [sector, quarter, JSON.stringify(fromEntity(payload))]
      );
      return { id: rows[0]?.id ?? null, error: null };
    } catch (err) {
      return { id: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

```bash
npx tsx -e "
import { PostgresSectorRepository } from './lib/repositories/sectors';
(async () => {
  const repo = new PostgresSectorRepository();
  const result = await repo.replaceSector('TestSector', 'Q4_2026', {
    sector: 'TestSector', sectorLabel: 'Test Sector', companyCount: 1,
    quarter: 'Q4_2026', quarterPrevious: 'Q3_2026', dimensions: [],
  });
  console.log('replaceSector result:', result);
  const fetched = await repo.getBySector('TestSector');
  console.log('fetched sectorLabel:', fetched?.sectorLabel);
  process.exit(0);
})();
"
```

Expected: `replaceSector result: { id: '<uuid>', error: null }`, `fetched sectorLabel: Test Sector`.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/sectors.ts
git commit -m "feat: add PostgresSectorRepository"
```

---

### Task 6: PostgresKpiRepository

**Files:**
- Modify: `lib/repositories/kpis.ts`

**Interfaces:**
- Consumes: `query<T>` from `lib/postgres/client.ts`; the existing private `toEntity` in this file.
- Produces: `PostgresKpiRepository` implementing `KpiRepository`.

- [ ] **Step 1: Add the import**

At the top of `lib/repositories/kpis.ts`, add:

```ts
import { query } from "@/lib/postgres/client";
```

- [ ] **Step 2: Add the class**

Append to `lib/repositories/kpis.ts`. `getLatestByTickers` and `listAll` use `DISTINCT ON (company_ticker)` — Postgres's native idiom for "one row per group, the most recent by some order" — which reproduces the app-level "first row per ticker wins" dedup exactly, since both are ordered `company_ticker, created_at DESC`:

```ts
export class PostgresKpiRepository implements KpiRepository {
  async getLatestByTicker(ticker: string): Promise<KpiSnapshot | null> {
    const rows = await query<StoredKpiRow>(
      `SELECT company_ticker, sector, quarter, quarter_previous, kpis FROM kpi_snapshots
       WHERE company_ticker = $1 ORDER BY created_at DESC LIMIT 1`,
      [ticker]
    );
    return rows.length > 0 ? toEntity(rows[0]) : null;
  }

  async getLatestByTickers(tickers: string[]): Promise<Map<string, KpiSnapshot>> {
    if (tickers.length === 0) return new Map();
    const rows = await query<StoredKpiRow>(
      `SELECT DISTINCT ON (company_ticker) company_ticker, sector, quarter, quarter_previous, kpis
       FROM kpi_snapshots WHERE company_ticker = ANY($1::text[])
       ORDER BY company_ticker, created_at DESC`,
      [tickers]
    );
    const result = new Map<string, KpiSnapshot>();
    for (const row of rows) result.set(row.company_ticker, toEntity(row));
    return result;
  }

  async upsertSnapshot(snapshot: KpiSnapshot): Promise<{ error: string | null }> {
    try {
      await query(
        `INSERT INTO kpi_snapshots (company_ticker, quarter, quarter_previous, sector, kpis)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (company_ticker, quarter) DO UPDATE SET
           quarter_previous = EXCLUDED.quarter_previous, sector = EXCLUDED.sector, kpis = EXCLUDED.kpis`,
        [snapshot.ticker, snapshot.quarter, snapshot.quarterPrevious, snapshot.sector, JSON.stringify(snapshot.kpis)]
      );
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async listAll(sectorFilter?: string): Promise<{ snapshots: KpiSnapshot[]; error: string | null }> {
    try {
      const rows = await query<StoredKpiRow>(
        `SELECT DISTINCT ON (company_ticker) company_ticker, sector, quarter, quarter_previous, kpis
         FROM kpi_snapshots
         WHERE $1::text IS NULL OR sector = $1
         ORDER BY company_ticker, created_at DESC`,
        [sectorFilter ?? null]
      );
      return { snapshots: rows.map(toEntity), error: null };
    } catch (err) {
      return { snapshots: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async deleteAll(): Promise<{ error: string | null }> {
    try {
      await query(`DELETE FROM kpi_snapshots`);
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

```bash
npx tsx -e "
import { PostgresKpiRepository } from './lib/repositories/kpis';
(async () => {
  const repo = new PostgresKpiRepository();
  await repo.upsertSnapshot({ ticker: 'TESTCO', sector: 'TestSector', quarter: 'Q4_2026', quarterPrevious: 'Q3_2026', kpis: [] });
  const latest = await repo.getLatestByTicker('TESTCO');
  console.log('latest sector:', latest?.sector);
  const batch = await repo.getLatestByTickers(['TESTCO']);
  console.log('batch size:', batch.size, 'has TESTCO:', batch.has('TESTCO'));
  process.exit(0);
})();
"
```

Expected: `latest sector: TestSector`, `batch size: 1 has TESTCO: true`.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/kpis.ts
git commit -m "feat: add PostgresKpiRepository"
```

---

### Task 7: WatchlistRepository interface change + Postgres implementation

**Files:**
- Modify: `lib/repositories/watchlist.ts`
- Modify: `app/api/v1/user-tickers/route.ts`

**Interfaces:**
- Consumes: `query<T>` from `lib/postgres/client.ts`; `supabaseAdmin()` from `lib/supabase/admin.ts` (new import needed in this file, replacing the `SupabaseClient` type import).
- Produces: `WatchlistRepository` with the new `userId: string`-based signature (a breaking interface change, per the spec's documented exception), `PostgresWatchlistRepository`, and an updated `SupabaseWatchlistRepository`.

This is the one task in this plan that changes an interface and a route handler, per the spec's explicitly documented exception (Watchlist security model) — confirmed with the user during planning: Postgres has no equivalent to Supabase's automatic JWT-to-RLS wiring, so this repository moves from "RLS does the `user_id` filtering invisibly" to "explicit `WHERE user_id = $1`," matching every other repository's security model.

- [ ] **Step 1: Rewrite the whole file**

Replace the full contents of `lib/repositories/watchlist.ts`:

```ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import { query } from "@/lib/postgres/client";

// user_tickers previously relied on Postgres Row-Level Security (RLS) plus a
// request-scoped, RLS-authenticated Supabase client to filter each user's own
// rows invisibly. Raw `pg` has no equivalent mechanism (no JWT-to-RLS wiring
// without Supabase's PostgREST layer in front of Postgres), and every other
// repository in this codebase already relies on explicit application-level
// filtering with no RLS at all. This repository was updated to match that
// pattern — a conscious, documented decision (see docs/superpowers/specs/
// 2026-07-09-azure-data-storage-migration-design.md's "Watchlist security
// model" section), not a silent regression. Both implementations below now
// take `userId` directly instead of a per-request Supabase client.

export interface WatchlistTicker {
  ticker: string;
  name: string;
  sector: string;
  addedAt: string;
}

export interface WatchlistRepository {
  list(userId: string): Promise<{ tickers: WatchlistTicker[]; error: string | null }>;
  add(userId: string, ticker: string, name: string, sector: string): Promise<{ ticker: WatchlistTicker | null; error: string | null }>;
  remove(userId: string, ticker: string): Promise<void>;
}

function toEntity(row: { ticker: string; name: string; sector: string; added_at: string }): WatchlistTicker {
  return { ticker: row.ticker, name: row.name, sector: row.sector, addedAt: row.added_at };
}

export class SupabaseWatchlistRepository implements WatchlistRepository {
  async list(userId: string): Promise<{ tickers: WatchlistTicker[]; error: string | null }> {
    const { data, error } = await supabaseAdmin()
      .from("user_tickers")
      .select("ticker, name, sector, added_at")
      .eq("user_id", userId)
      .order("added_at", { ascending: false });
    return { tickers: (data ?? []).map(toEntity), error: error ? error.message : null };
  }

  async add(userId: string, ticker: string, name: string, sector: string): Promise<{ ticker: WatchlistTicker | null; error: string | null }> {
    const { data, error } = await supabaseAdmin()
      .from("user_tickers")
      .upsert({ user_id: userId, ticker, name: name || ticker, sector }, { onConflict: "user_id,ticker" })
      .select("ticker, name, sector, added_at")
      .single();
    return { ticker: data ? toEntity(data) : null, error: error ? error.message : null };
  }

  async remove(userId: string, ticker: string): Promise<void> {
    await supabaseAdmin().from("user_tickers").delete().eq("user_id", userId).eq("ticker", ticker);
  }
}

export class PostgresWatchlistRepository implements WatchlistRepository {
  async list(userId: string): Promise<{ tickers: WatchlistTicker[]; error: string | null }> {
    try {
      const rows = await query<{ ticker: string; name: string; sector: string; added_at: string }>(
        `SELECT ticker, name, sector, added_at FROM user_tickers WHERE user_id = $1 ORDER BY added_at DESC`,
        [userId]
      );
      return { tickers: rows.map(toEntity), error: null };
    } catch (err) {
      return { tickers: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async add(userId: string, ticker: string, name: string, sector: string): Promise<{ ticker: WatchlistTicker | null; error: string | null }> {
    try {
      const rows = await query<{ ticker: string; name: string; sector: string; added_at: string }>(
        `INSERT INTO user_tickers (user_id, ticker, name, sector)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, ticker) DO UPDATE SET name = EXCLUDED.name, sector = EXCLUDED.sector
         RETURNING ticker, name, sector, added_at`,
        [userId, ticker, name || ticker, sector]
      );
      return { ticker: rows[0] ? toEntity(rows[0]) : null, error: null };
    } catch (err) {
      return { ticker: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async remove(userId: string, ticker: string): Promise<void> {
    await query(`DELETE FROM user_tickers WHERE user_id = $1 AND ticker = $2`, [userId, ticker]);
  }
}
```

- [ ] **Step 2: Update the one call site**

Modify `app/api/v1/user-tickers/route.ts` — change the three `watchlistRepo` calls (the `supabase`/`createClient()` calls that establish `user.id` stay exactly as they are, since that's Supabase Auth, unrelated to this migration):

```ts
    const { tickers, error } = await watchlistRepo.list(user.id);
```
(replacing `await watchlistRepo.list(supabase);` at line 26)

```ts
    const { ticker: saved, error } = await watchlistRepo.add(user.id, ticker, name, sector);
```
(replacing `await watchlistRepo.add(supabase, user.id, ticker, name, sector);` at line 48)

```ts
    await watchlistRepo.remove(user.id, ticker);
```
(replacing `await watchlistRepo.remove(supabase, user.id, ticker);` at line 65)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If this reveals other call sites beyond `user-tickers/route.ts` that this research didn't find, fix those too — the type-checker will show every one, since the interface signature genuinely changed.

- [ ] **Step 4: Manual verification**

```bash
npx tsx -e "
import { PostgresWatchlistRepository } from './lib/repositories/watchlist';
(async () => {
  const repo = new PostgresWatchlistRepository();
  const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
  const added = await repo.add(TEST_USER_ID, 'TESTCO', 'Test Co', 'Custom');
  console.log('added:', added);
  const listed = await repo.list(TEST_USER_ID);
  console.log('listed count:', listed.tickers.length);
  const otherUserListed = await repo.list('00000000-0000-0000-0000-000000000002');
  console.log('other user sees:', otherUserListed.tickers.length, '(expected: 0 — confirms WHERE user_id filtering works)');
  await repo.remove(TEST_USER_ID, 'TESTCO');
  process.exit(0);
})();
"
```

Expected: `added: { ticker: {...}, error: null }`, `listed count: 1`, `other user sees: 0 (expected: 0 — confirms WHERE user_id filtering works)`.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/watchlist.ts app/api/v1/user-tickers/route.ts
git commit -m "feat: add PostgresWatchlistRepository; change WatchlistRepository interface from SupabaseClient to userId (RLS replacement)"
```

---

### Task 8: PostgresCreditsRepository

**Files:**
- Modify: `lib/repositories/credits.ts`

**Interfaces:**
- Consumes: `query<T>` from `lib/postgres/client.ts`.
- Produces: `PostgresCreditsRepository` implementing `CreditsRepository`.

- [ ] **Step 1: Add the import**

At the top of `lib/repositories/credits.ts`, add:

```ts
import { query } from "@/lib/postgres/client";
```

- [ ] **Step 2: Add the class**

Append to `lib/repositories/credits.ts`. Supabase's `.upsert()` without `ignoreDuplicates` defaults to `DO UPDATE` (merging the provided columns) — reproduced exactly as `ON CONFLICT ... DO UPDATE`, not `DO NOTHING`, to preserve today's exact (non-atomic, "last upsert wins") race behavior:

```ts
export class PostgresCreditsRepository implements CreditsRepository {
  async getOrCreateStatus(userId: string, month: string, defaultQuota: number): Promise<CreditStatus> {
    const existing = await query<{ used: number; quota: number }>(
      `SELECT used, quota FROM user_credits WHERE user_id = $1 AND month = $2`,
      [userId, month]
    );
    if (existing.length > 0) {
      const { used, quota } = existing[0];
      return { used, quota, remaining: quota - used, month };
    }
    await query(
      `INSERT INTO user_credits (user_id, month, used, quota) VALUES ($1, $2, 0, $3)
       ON CONFLICT (user_id, month) DO UPDATE SET used = EXCLUDED.used, quota = EXCLUDED.quota`,
      [userId, month, defaultQuota]
    );
    return { used: 0, quota: defaultQuota, remaining: defaultQuota, month };
  }

  async setUsed(userId: string, month: string, used: number): Promise<void> {
    await query(`UPDATE user_credits SET used = $1 WHERE user_id = $2 AND month = $3`, [used, userId, month]);
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

```bash
npx tsx -e "
import { PostgresCreditsRepository } from './lib/repositories/credits';
(async () => {
  const repo = new PostgresCreditsRepository();
  const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
  const status = await repo.getOrCreateStatus(TEST_USER_ID, '2026-07', 2500);
  console.log('status:', status);
  await repo.setUsed(TEST_USER_ID, '2026-07', 100);
  const updated = await repo.getOrCreateStatus(TEST_USER_ID, '2026-07', 2500);
  console.log('updated used:', updated.used, '(expected: 100)');
  process.exit(0);
})();
"
```

Expected: `status: { used: 0, quota: 2500, remaining: 2500, month: '2026-07' }`, `updated used: 100 (expected: 100)`.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/credits.ts
git commit -m "feat: add PostgresCreditsRepository"
```

---

### Task 9: PostgresSoloAnalysisRepository

**Files:**
- Modify: `lib/repositories/soloAnalysis.ts`

**Interfaces:**
- Consumes: `query<T>` from `lib/postgres/client.ts`; the existing private `toEntity`/`fromEntity` in this file.
- Produces: `PostgresSoloAnalysisRepository` implementing `SoloAnalysisRepository`.

- [ ] **Step 1: Add the import**

At the top of `lib/repositories/soloAnalysis.ts`, add:

```ts
import { query } from "@/lib/postgres/client";
```

- [ ] **Step 2: Add the class**

Append to `lib/repositories/soloAnalysis.ts`. Note the bare `catch { return "unknown"; }` with no logging — matching `SupabaseSoloAnalysisRepository`'s existing behavior exactly (unlike `analysis.ts`'s `saveAnalysis`, which does log):

```ts
export class PostgresSoloAnalysisRepository implements SoloAnalysisRepository {
  async getCached(ticker: string, quarter: string): Promise<SoloAnalysis | null> {
    const rows = await query<{ payload: unknown }>(
      `SELECT payload FROM solo_analysis_cache WHERE ticker = $1 AND quarter = $2`,
      [ticker, quarter]
    );
    if (rows.length === 0) return null;
    const entity = toEntity(ticker, quarter, rows[0].payload);
    if (!entity.sections || entity.sections.length === 0) return null;
    return entity;
  }

  async saveAnalysis(ticker: string, quarter: string, analysis: SoloAnalysis): Promise<string> {
    try {
      await query(`DELETE FROM solo_analysis_cache WHERE ticker = $1 AND quarter = $2`, [ticker, quarter]);
      const rows = await query<{ id: string }>(
        `INSERT INTO solo_analysis_cache (ticker, quarter, payload) VALUES ($1, $2, $3::jsonb) RETURNING id`,
        [ticker, quarter, JSON.stringify(fromEntity(analysis))]
      );
      return rows[0]?.id ?? "unknown";
    } catch {
      return "unknown";
    }
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

```bash
npx tsx -e "
import { PostgresSoloAnalysisRepository } from './lib/repositories/soloAnalysis';
(async () => {
  const repo = new PostgresSoloAnalysisRepository();
  const id = await repo.saveAnalysis('Test Company', 'Q4_2026', {
    ticker: 'Test Company', quarter: 'Q4_2026', headline: 'test headline',
    managementTone: 'confident', sections: [{ title: 'T', bullets: ['b'] }],
  });
  console.log('saved id:', id);
  const cached = await repo.getCached('Test Company', 'Q4_2026');
  console.log('round-trip headline:', cached?.headline);
  process.exit(0);
})();
"
```

Expected: `saved id: <uuid>`, `round-trip headline: test headline`.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/soloAnalysis.ts
git commit -m "feat: add PostgresSoloAnalysisRepository"
```

---

### Task 10: PostgresInsightsRepository

**Files:**
- Modify: `lib/repositories/insights.ts`

**Interfaces:**
- Consumes: `query<T>` from `lib/postgres/client.ts`; the existing private `toEntity`/`fromEntity` in this file.
- Produces: `PostgresInsightsRepository` implementing `InsightsRepository`.

- [ ] **Step 1: Add the import**

At the top of `lib/repositories/insights.ts`, add:

```ts
import { query } from "@/lib/postgres/client";
```

- [ ] **Step 2: Add the class**

Append to `lib/repositories/insights.ts`. `saveInsights` explicitly stamps `created_at` in the query (not left to a DB default) — this is what makes the TTL check in `getCached` work correctly across repeated saves of the same key, exactly as in the Supabase version. `getLatestRawPayload` returns the payload as an untyped `Record<string, unknown>`, not run through `toEntity` — preserving the documented, known inconsistency where `lib/divergence-score.ts` reads fields that don't exist on `InsightsWirePayload`:

```ts
export class PostgresInsightsRepository implements InsightsRepository {
  async getCached(ticker: string, quartersKey: string, ttlDays: number): Promise<InsightsSummary | null> {
    try {
      const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();
      const rows = await query<{ payload: InsightsWirePayload }>(
        `SELECT payload FROM insights_cache WHERE ticker = $1 AND quarters_key = $2 AND created_at >= $3`,
        [ticker, quartersKey, cutoff]
      );
      if (rows.length === 0) return null;
      return toEntity(rows[0].payload);
    } catch {
      return null;
    }
  }

  async saveInsights(ticker: string, quartersKey: string, insights: InsightsSummary): Promise<void> {
    await query(
      `INSERT INTO insights_cache (ticker, quarters_key, payload, created_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (ticker, quarters_key) DO UPDATE SET payload = EXCLUDED.payload, created_at = EXCLUDED.created_at`,
      [ticker, quartersKey, JSON.stringify(fromEntity(insights)), new Date().toISOString()]
    );
  }

  async getLatestRawPayload(ticker: string): Promise<Record<string, unknown> | null> {
    const rows = await query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM insights_cache WHERE ticker = $1 ORDER BY created_at DESC LIMIT 1`,
      [ticker]
    );
    return rows.length > 0 ? rows[0].payload : null;
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

```bash
npx tsx -e "
import { PostgresInsightsRepository } from './lib/repositories/insights';
(async () => {
  const repo = new PostgresInsightsRepository();
  await repo.saveInsights('TESTCO', 'Q1_2026,Q2_2026', {
    ticker: 'TESTCO', quartersAnalyzed: ['Q1_2026','Q2_2026'], quarterBriefs: [],
    recurringThemes: [], guidanceTracks: [], managementCredibilityScore: 8,
    newBusinessSignals: [], keyWatchpoints: [], segmentNarrative: 'test',
  });
  const cached = await repo.getCached('TESTCO', 'Q1_2026,Q2_2026', 30);
  console.log('cached segmentNarrative:', cached?.segmentNarrative);
  const raw = await repo.getLatestRawPayload('TESTCO');
  console.log('raw has ticker field:', 'ticker' in (raw ?? {}));
  process.exit(0);
})();
"
```

Expected: `cached segmentNarrative: test`, `raw has ticker field: true`.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/insights.ts
git commit -m "feat: add PostgresInsightsRepository"
```

---

### Task 11: PostgresPromoterActivityRepository

**Files:**
- Modify: `lib/repositories/promoterActivity.ts`

**Interfaces:**
- Consumes: `query<T>` from `lib/postgres/client.ts`; the existing private `toEntity` in this file.
- Produces: `PostgresPromoterActivityRepository` implementing `PromoterActivityRepository`.

- [ ] **Step 1: Add the import**

At the top of `lib/repositories/promoterActivity.ts`, add:

```ts
import { query } from "@/lib/postgres/client";
```

- [ ] **Step 2: Add the class**

Append to `lib/repositories/promoterActivity.ts`. `upsertEvents` is a genuine batch upsert (matches the table's `UNIQUE(ticker, news_id)`), built as one multi-row `INSERT ... VALUES (...),(...) ON CONFLICT` statement rather than N separate calls, to preserve the same atomicity/performance characteristic as Supabase's batched upsert:

```ts
export class PostgresPromoterActivityRepository implements PromoterActivityRepository {
  async getFetchLog(ticker: string): Promise<{ fetchedAt: string } | null> {
    const rows = await query<{ fetched_at: string }>(
      `SELECT fetched_at FROM promoter_activity_fetch_log WHERE ticker = $1`,
      [ticker]
    );
    return rows.length > 0 ? { fetchedAt: rows[0].fetched_at } : null;
  }

  async saveFetchLog(ticker: string, fetchedAt: string, rowCount: number): Promise<{ error: string | null }> {
    try {
      await query(
        `INSERT INTO promoter_activity_fetch_log (ticker, fetched_at, row_count)
         VALUES ($1, $2, $3)
         ON CONFLICT (ticker) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, row_count = EXCLUDED.row_count`,
        [ticker, fetchedAt, rowCount]
      );
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async upsertEvents(events: PromoterActivityEvent[]): Promise<{ error: string | null }> {
    if (events.length === 0) return { error: null };
    try {
      const valueClauses: string[] = [];
      const params: unknown[] = [];
      events.forEach((e, i) => {
        const base = i * 7;
        valueClauses.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
        params.push(e.ticker, e.newsId, e.disclosureDate, e.subcatName, e.headline, e.attachmentName, e.eventType);
      });
      await query(
        `INSERT INTO promoter_activity (ticker, news_id, disclosure_date, subcat_name, headline, attachment_name, event_type)
         VALUES ${valueClauses.join(", ")}
         ON CONFLICT (ticker, news_id) DO UPDATE SET
           subcat_name = EXCLUDED.subcat_name, headline = EXCLUDED.headline,
           attachment_name = EXCLUDED.attachment_name, event_type = EXCLUDED.event_type`,
        params
      );
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async listByTicker(ticker: string): Promise<{ events: PromoterActivityEvent[]; error: string | null }> {
    try {
      const rows = await query<{
        news_id: string; disclosure_date: string; subcat_name: string;
        headline: string; attachment_name: string | null; event_type: string;
      }>(
        `SELECT news_id, disclosure_date, subcat_name, headline, attachment_name, event_type
         FROM promoter_activity WHERE ticker = $1 ORDER BY disclosure_date DESC`,
        [ticker]
      );
      return { events: rows.map((row) => toEntity(row, ticker)), error: null };
    } catch (err) {
      return { events: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

```bash
npx tsx -e "
import { PostgresPromoterActivityRepository } from './lib/repositories/promoterActivity';
(async () => {
  const repo = new PostgresPromoterActivityRepository();
  await repo.saveFetchLog('TESTCO', new Date().toISOString(), 2);
  const log = await repo.getFetchLog('TESTCO');
  console.log('fetch log:', log);
  await repo.upsertEvents([
    { ticker: 'TESTCO', newsId: 'N1', disclosureDate: '2026-07-01', subcatName: 'Pledge', headline: 'h1', attachmentName: null, eventType: 'pledge' },
    { ticker: 'TESTCO', newsId: 'N2', disclosureDate: '2026-07-02', subcatName: 'Pledge', headline: 'h2', attachmentName: null, eventType: 'pledge' },
  ]);
  const listed = await repo.listByTicker('TESTCO');
  console.log('event count:', listed.events.length);
  process.exit(0);
})();
"
```

Expected: `fetch log: { fetchedAt: '...' }`, `event count: 2`.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/promoterActivity.ts
git commit -m "feat: add PostgresPromoterActivityRepository"
```

---

### Task 12: PostgresCalendarRepository

**Files:**
- Modify: `lib/repositories/calendar.ts`

**Interfaces:**
- Consumes: `query<T>` from `lib/postgres/client.ts`; the existing private `toEntity` in this file.
- Produces: `PostgresCalendarRepository` implementing `CalendarRepository`.

- [ ] **Step 1: Add the import**

At the top of `lib/repositories/calendar.ts`, add:

```ts
import { query } from "@/lib/postgres/client";
```

- [ ] **Step 2: Add the class**

Append to `lib/repositories/calendar.ts`. `inserted` in the return value echoes `rows.length` on success (not a true DB-reported count), matching the Supabase version's exact behavior:

```ts
export class PostgresCalendarRepository implements CalendarRepository {
  async listInRange(fromDate: string, toDate: string): Promise<{ events: EarningsEvent[]; error: string | null }> {
    try {
      const rows = await query<{ ticker: string; date: string; quarter: string; source: string; confirmed: boolean }>(
        `SELECT ticker, date, quarter, source, confirmed FROM earnings_calendar
         WHERE date >= $1 AND date <= $2 ORDER BY date`,
        [fromDate, toDate]
      );
      return { events: rows.map(toEntity), error: null };
    } catch (err) {
      return { events: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async upsertEvents(events: (EarningsEvent & { updatedAt: string })[]): Promise<{ inserted: number; error: string | null }> {
    if (events.length === 0) return { inserted: 0, error: null };
    try {
      const valueClauses: string[] = [];
      const params: unknown[] = [];
      events.forEach((e, i) => {
        const base = i * 6;
        valueClauses.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
        params.push(e.ticker, e.date, e.quarter, e.source, e.confirmed, e.updatedAt);
      });
      await query(
        `INSERT INTO earnings_calendar (ticker, date, quarter, source, confirmed, updated_at)
         VALUES ${valueClauses.join(", ")}
         ON CONFLICT (ticker, quarter) DO UPDATE SET
           date = EXCLUDED.date, source = EXCLUDED.source, confirmed = EXCLUDED.confirmed, updated_at = EXCLUDED.updated_at`,
        params
      );
      return { inserted: events.length, error: null };
    } catch (err) {
      return { inserted: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

```bash
npx tsx -e "
import { PostgresCalendarRepository } from './lib/repositories/calendar';
(async () => {
  const repo = new PostgresCalendarRepository();
  const upserted = await repo.upsertEvents([
    { ticker: 'TESTCO', date: '2026-07-15', quarter: 'Q4_2026', source: 'estimated', confirmed: false, updatedAt: new Date().toISOString() },
  ]);
  console.log('upserted:', upserted);
  const listed = await repo.listInRange('2026-07-01', '2026-07-31');
  console.log('events in range:', listed.events.length);
  process.exit(0);
})();
"
```

Expected: `upserted: { inserted: 1, error: null }`, `events in range: 1` (or more, if other test data landed in this range from earlier tasks — that's fine).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/calendar.ts
git commit -m "feat: add PostgresCalendarRepository"
```

---

### Task 13: PostgresConcallRepository

**Files:**
- Modify: `lib/repositories/concalls.ts`

**Interfaces:**
- Consumes: `query<T>` from `lib/postgres/client.ts`; the existing private `toEntity` in this file.
- Produces: `PostgresConcallRepository` implementing `ConcallRepository`.

- [ ] **Step 1: Add the import**

At the top of `lib/repositories/concalls.ts`, add:

```ts
import { query } from "@/lib/postgres/client";
```

- [ ] **Step 2: Add the class**

Append to `lib/repositories/concalls.ts`. `getCached` never returns the real `fetched_at` value (the existing `toEntity` hardcodes it to `""`) — this is preserved exactly as today, not "fixed," since this plan's philosophy is behavior preservation except the two explicitly-confirmed exceptions (Watchlist, ApiAccessRepository):

```ts
export class PostgresConcallRepository implements ConcallRepository {
  async getCached(ticker: string, quarter: string): Promise<ConcallLink | null> {
    const rows = await query<{
      youtube_url: string; video_id: string | null; video_title: string | null; channel_title: string | null;
    }>(
      `SELECT youtube_url, video_id, video_title, channel_title FROM concall_links
       WHERE ticker = $1 AND quarter = $2`,
      [ticker, quarter]
    );
    if (rows.length === 0) return null;
    return toEntity(ticker, quarter, rows[0]);
  }

  async saveLink(link: ConcallLink): Promise<void> {
    await query(
      `INSERT INTO concall_links (ticker, quarter, youtube_url, video_id, video_title, channel_title, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (ticker, quarter) DO UPDATE SET
         youtube_url = EXCLUDED.youtube_url, video_id = EXCLUDED.video_id,
         video_title = EXCLUDED.video_title, channel_title = EXCLUDED.channel_title,
         fetched_at = EXCLUDED.fetched_at`,
      [link.ticker, link.quarter, link.youtubeUrl, link.videoId, link.videoTitle, link.channelTitle, link.fetchedAt || new Date().toISOString()]
    );
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

```bash
npx tsx -e "
import { PostgresConcallRepository } from './lib/repositories/concalls';
(async () => {
  const repo = new PostgresConcallRepository();
  await repo.saveLink({ ticker: 'TESTCO', quarter: 'Q4_2026', youtubeUrl: 'https://youtube.com/watch?v=abc', videoId: 'abc', videoTitle: 'Test Concall', channelTitle: 'Test Channel', fetchedAt: '' });
  const cached = await repo.getCached('TESTCO', 'Q4_2026');
  console.log('cached:', cached);
  process.exit(0);
})();
"
```

Expected: `cached: { ticker: 'TESTCO', quarter: 'Q4_2026', youtubeUrl: '...', videoId: 'abc', videoTitle: 'Test Concall', channelTitle: 'Test Channel', fetchedAt: '' }` — note `fetchedAt: ''` is correct, not a bug.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/concalls.ts
git commit -m "feat: add PostgresConcallRepository"
```

---

### Task 14: PostgresApiAccessRepository

**Files:**
- Modify: `lib/repositories/apiAccess.ts`

**Interfaces:**
- Consumes: `query<T>` from `lib/postgres/client.ts`.
- Produces: `PostgresApiAccessRepository` implementing `ApiAccessRepository`.

- [ ] **Step 1: Add the import**

At the top of `lib/repositories/apiAccess.ts`, add:

```ts
import { query } from "@/lib/postgres/client";
```

- [ ] **Step 2: Add the class**

Append to `lib/repositories/apiAccess.ts`. `getKeyByHash` needs a two-cardinality join (many-to-one to `api_partners`, one-to-many to `api_key_products`) in one query — `array_agg(...) FILTER (WHERE ... IS NOT NULL)` avoids returning `{NULL}` for a key with zero products. Like the Supabase version, this method throws on error rather than swallowing it. Per the confirmed decision, `incrementUsage` becomes a single atomic statement instead of the original non-atomic read-then-write:

```ts
export class PostgresApiAccessRepository implements ApiAccessRepository {
  async getKeyByHash(keyHash: string): Promise<ApiKeyInfo | null> {
    const rows = await query<{
      id: string; partner_id: string; active: boolean; daily_quota: number;
      partner_name: string | null; entitled_products: string[];
    }>(
      `SELECT ak.id, ak.partner_id, ak.active, ak.daily_quota, ap.name AS partner_name,
              COALESCE(array_agg(akp.product_name) FILTER (WHERE akp.product_name IS NOT NULL), '{}') AS entitled_products
       FROM api_keys ak
       LEFT JOIN api_partners ap ON ap.id = ak.partner_id
       LEFT JOIN api_key_products akp ON akp.key_id = ak.id
       WHERE ak.key_hash = $1
       GROUP BY ak.id, ap.name`,
      [keyHash]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      keyId: row.id,
      partnerId: row.partner_id,
      partnerName: row.partner_name ?? "",
      active: row.active,
      dailyQuota: row.daily_quota,
      entitledProducts: row.entitled_products,
    };
  }

  async getUsageToday(keyId: string, windowStart: string): Promise<number> {
    const rows = await query<{ request_count: number }>(
      `SELECT request_count FROM api_usage WHERE key_id = $1 AND window_start = $2`,
      [keyId, windowStart]
    );
    return rows.length > 0 ? rows[0].request_count : 0;
  }

  /** Atomic, unlike the Supabase version's non-atomic read-then-write — a
   *  deliberate, confirmed improvement made possible by writing raw SQL by
   *  hand for this migration (see Global Constraints). */
  async incrementUsage(keyId: string, windowStart: string): Promise<void> {
    await query(
      `INSERT INTO api_usage (key_id, window_start, request_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (key_id, window_start) DO UPDATE SET request_count = api_usage.request_count + 1`,
      [keyId, windowStart]
    );
  }

  async createPartner(name: string): Promise<{ id: string }> {
    const rows = await query<{ id: string }>(`INSERT INTO api_partners (name) VALUES ($1) RETURNING id`, [name]);
    if (rows.length === 0) throw new Error("createPartner failed: no row returned");
    return { id: rows[0].id };
  }

  async createKey(partnerId: string, keyHash: string, dailyQuota: number): Promise<{ id: string }> {
    const rows = await query<{ id: string }>(
      `INSERT INTO api_keys (partner_id, key_hash, daily_quota) VALUES ($1, $2, $3) RETURNING id`,
      [partnerId, keyHash, dailyQuota]
    );
    if (rows.length === 0) throw new Error("createKey failed: no row returned");
    return { id: rows[0].id };
  }

  async grantEntitlement(keyId: string, productName: string): Promise<void> {
    await query(
      `INSERT INTO api_key_products (key_id, product_name) VALUES ($1, $2)
       ON CONFLICT (key_id, product_name) DO NOTHING`,
      [keyId, productName]
    );
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

```bash
npx tsx -e "
import { createHash } from 'node:crypto';
import { PostgresApiAccessRepository } from './lib/repositories/apiAccess';
(async () => {
  const repo = new PostgresApiAccessRepository();
  const { id: partnerId } = await repo.createPartner('Test Partner');
  const keyHash = createHash('sha256').update('test-key').digest('hex');
  const { id: keyId } = await repo.createKey(partnerId, keyHash, 1000);
  await repo.grantEntitlement(keyId, 'data:companies');
  const info = await repo.getKeyByHash(keyHash);
  console.log('key info:', info);
  const windowStart = new Date().toISOString().slice(0, 10);
  await repo.incrementUsage(keyId, windowStart);
  await repo.incrementUsage(keyId, windowStart);
  const usage = await repo.getUsageToday(keyId, windowStart);
  console.log('usage after 2 increments:', usage, '(expected: 2)');
  process.exit(0);
})();
"
```

Expected: `key info: { keyId: '...', partnerId: '...', partnerName: 'Test Partner', active: true, dailyQuota: 1000, entitledProducts: ['data:companies'] }`, `usage after 2 increments: 2 (expected: 2)`.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/apiAccess.ts
git commit -m "feat: add PostgresApiAccessRepository with atomic incrementUsage"
```

---

### Task 15: AzureBlobStorageRepository

**Files:**
- Modify: `lib/repositories/storage.ts`
- Modify: `package.json` (add `@azure/storage-blob` dependency)

**Interfaces:**
- Consumes: `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER` env vars (Task 1).
- Produces: `AzureBlobStorageRepository` implementing `StorageRepository` — same `Buffer`-based signatures as `SupabaseStorageRepository`, per the spec's confirmed decision (no streaming interface change).

- [ ] **Step 1: Install `@azure/storage-blob`**

```bash
npm install @azure/storage-blob
```

- [ ] **Step 2: Add the class**

Append to `lib/repositories/storage.ts`:

```ts
import { BlobServiceClient, BlobSASPermissions } from "@azure/storage-blob";

const AZURE_CONTAINER = process.env.AZURE_STORAGE_CONTAINER ?? "transcripts";

let _blobServiceClient: BlobServiceClient | null = null;
function blobServiceClient(): BlobServiceClient {
  if (!_blobServiceClient) {
    _blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING!);
  }
  return _blobServiceClient;
}

export class AzureBlobStorageRepository implements StorageRepository {
  async list(options: ListOptions): Promise<TranscriptFile[]> {
    const containerClient = blobServiceClient().getContainerClient(AZURE_CONTAINER);
    const results: TranscriptFile[] = [];
    // Azure Blob's listBlobsFlat() has no server-side substring search, so the
    // search filter is applied client-side, same effective behavior as before.
    for await (const blob of containerClient.listBlobsFlat()) {
      if (options.search && !blob.name.toLowerCase().includes(options.search.toLowerCase())) continue;
      results.push({ name: blob.name });
    }
    let sorted = results;
    if (options.sortBy) {
      const { column, order } = options.sortBy;
      sorted = [...results].sort((a, b) => {
        const cmp = column === "name" ? a.name.localeCompare(b.name) : 0;
        return order === "asc" ? cmp : -cmp;
      });
    }
    const offset = options.offset ?? 0;
    const limit = options.limit;
    return limit !== undefined ? sorted.slice(offset, offset + limit) : sorted.slice(offset);
  }

  async listAllPaginated(pageSize = 100): Promise<TranscriptFile[]> {
    // Azure Blob's listBlobsFlat() with .byPage() already handles pagination
    // correctly (including short-but-nonempty intermediate pages), so this
    // reduces to a straightforward accumulation loop over its async iterator —
    // no manual offset/empty-page logic needed, unlike Supabase Storage's API.
    const containerClient = blobServiceClient().getContainerClient(AZURE_CONTAINER);
    const all: TranscriptFile[] = [];
    for await (const response of containerClient.listBlobsFlat().byPage({ maxPageSize: pageSize })) {
      for (const blob of response.segment.blobItems) {
        all.push({ name: blob.name });
      }
    }
    return all;
  }

  async download(path: string): Promise<Buffer> {
    const containerClient = blobServiceClient().getContainerClient(AZURE_CONTAINER);
    const blobClient = containerClient.getBlobClient(path);
    const downloadResponse = await blobClient.download();
    if (!downloadResponse.readableStreamBody) {
      throw new Error(`Storage download failed for ${path}: empty response body`);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async upload(path: string, data: Buffer): Promise<void> {
    const containerClient = blobServiceClient().getContainerClient(AZURE_CONTAINER);
    const blockBlobClient = containerClient.getBlockBlobClient(path);
    await blockBlobClient.upload(data, data.length, {
      blobHTTPHeaders: { blobContentType: "application/pdf" },
    });
  }

  async createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const containerClient = blobServiceClient().getContainerClient(AZURE_CONTAINER);
    const blobClient = containerClient.getBlobClient(path);
    const expiresOn = new Date(Date.now() + expiresInSeconds * 1000);
    return blobClient.generateSasUrl({
      permissions: BlobSASPermissions.parse("r"),
      expiresOn,
    });
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

```bash
npx tsx -e "
import { AzureBlobStorageRepository } from './lib/repositories/storage';
(async () => {
  const repo = new AzureBlobStorageRepository();
  const testData = Buffer.from('%PDF-1.4 test content');
  await repo.upload('test/hello.pdf', testData);
  const downloaded = await repo.download('test/hello.pdf');
  console.log('round-trip matches:', downloaded.equals(testData));
  const listed = await repo.list({ search: 'hello' });
  console.log('listed:', listed);
  const url = await repo.createSignedUrl('test/hello.pdf', 60);
  console.log('signed url starts with https:', url.startsWith('https://'));
  process.exit(0);
})();
"
```

Expected: `round-trip matches: true`, `listed: [ { name: 'test/hello.pdf' } ]`, `signed url starts with https: true`.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/storage.ts package.json package-lock.json
git commit -m "feat: add AzureBlobStorageRepository"
```

---

### Task 16: Data and blob migration scripts

**Files:**
- Create: `scripts/migrate-postgres-data.ts`
- Create: `scripts/copy-blobs-to-azure.ts`

**Interfaces:**
- Consumes: `POSTGRES_CONNECTION_STRING` (Task 1, and the existing `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` for the Supabase source); `StorageRepository.listAllPaginated()` from `lib/repositories/storage.ts` (already exists); the Supabase JS client and `@azure/storage-blob`'s streaming APIs directly (bypassing the Buffer-based `StorageRepository` interface for this one bulk operation, per spec).
- Produces: fully populated Azure Postgres tables and Blob container, consumed by Task 17's verification.

- [ ] **Step 1: Write the Postgres data migration script**

Create `scripts/migrate-postgres-data.ts`. This shells out to `pg_dump`/`psql` (both must be installed locally, matching the Postgres 17 major version per the spec's version-pinning rule) rather than reimplementing dump/restore in TypeScript — `pg_dump` already handles every data type and edge case correctly, and reimplementing it would be pure risk for no benefit:

```ts
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
```

Note: `SUPABASE_DB_CONNECTION_STRING` (the source) is a separate, new, one-time-use env var — the direct Postgres connection string for the Supabase project (found in the Supabase dashboard's Database settings, not the `NEXT_PUBLIC_SUPABASE_URL`/anon-key pair used elsewhere in this app, which go through Supabase's REST API layer, not a raw Postgres connection). Set it locally only for this one script run; it is not an application env var and should not be added to `.env.local` or any deployment environment permanently.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Write the blob migration script**

Create `scripts/copy-blobs-to-azure.ts`. Per the spec, this bypasses `StorageRepository`'s Buffer-based interface and streams directly between the Supabase Storage SDK and `@azure/storage-blob`, since this is the one place true streaming matters (a long-running bulk copy of potentially many large PDFs), not the app's normal one-file-at-a-time request/response cycle:

```ts
import { Readable } from "node:stream";
import { createClient } from "@supabase/supabase-js";
import { BlobServiceClient } from "@azure/storage-blob";
import { storageRepo } from "@/lib/repositories";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING!;
const AZURE_CONTAINER = process.env.AZURE_STORAGE_CONTAINER ?? "transcripts";
const BUCKET = "transcripts";

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
  const containerClient = blobServiceClient.getContainerClient(AZURE_CONTAINER);

  // Reuses the existing StorageRepository.listAllPaginated() for enumeration
  // (its empty-page-not-short-page pagination logic is already correct and
  // battle-tested) — only the actual per-file copy bypasses the repository
  // interface, since that's the one place streaming matters.
  const files = await storageRepo.listAllPaginated();
  console.log(`Found ${files.length} files to copy.`);

  let copied = 0;
  for (const file of files) {
    const { data: downloadData, error: downloadError } = await supabase.storage.from(BUCKET).download(file.name);
    if (downloadError || !downloadData) {
      console.error(`FAILED to download ${file.name}: ${downloadError?.message}`);
      continue;
    }
    // downloadData.stream() returns a Web Streams API ReadableStream (from
    // supabase-js's fetch-based Blob implementation), not a Node.js Readable —
    // @azure/storage-blob's uploadStream() requires the latter. Found by
    // running this script against real production data, not just type-checking
    // it (an `as unknown as NodeJS.ReadableStream` cast had silenced the type
    // error without fixing the actual runtime shape mismatch).
    const stream = Readable.fromWeb(downloadData.stream() as any);
    const blockBlobClient = containerClient.getBlockBlobClient(file.name);
    await blockBlobClient.uploadStream(stream, undefined, undefined, {
      blobHTTPHeaders: { blobContentType: "application/pdf" },
    });
    copied++;
    if (copied % 10 === 0) console.log(`Copied ${copied}/${files.length}...`);
  }

  console.log(`Blob migration complete: ${copied}/${files.length} copied.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Blob migration failed:", err);
    process.exit(1);
  });
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-postgres-data.ts scripts/copy-blobs-to-azure.ts
git commit -m "feat: add data and blob migration scripts"
```

(These scripts are run for real during the actual cutover, in Task 18 — not run against production data as part of this task's own verification, since the app isn't cut over yet and there's nothing to migrate until then.)

---

### Task 17: Verification script

**Files:**
- Create: `scripts/verify-migration.ts`

**Interfaces:**
- Consumes: `POSTGRES_CONNECTION_STRING`, `SUPABASE_DB_CONNECTION_STRING` (Task 16); `storageRepo` (Supabase) and a temporary `AzureBlobStorageRepository` instance (Task 15).
- Produces: a pass/fail verification report, consumed directly by a human operator during Task 18's cutover (not by other code).

- [ ] **Step 1: Write the script**

Create `scripts/verify-migration.ts`. Implements both layers from the spec's Verification section — row counts for every migrated table, random-sample content hashing for the three JSONB-heavy tables, and size+hash blob verification with the size-threshold rule (full hash under 10 MB, sampled at or above):

```ts
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
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

async function countOrZeroIfMissing(pg: PgClient, table: string): Promise<string> {
  try {
    const res = await pg.query(`SELECT count(*) FROM ${table}`);
    return res.rows[0].count;
  } catch (err) {
    // 42P01 = undefined_table. Some tables in TABLES (e.g. user_credits,
    // api_partners/api_keys/api_key_products/api_usage) belong to features
    // whose migrations were never actually run against production Supabase —
    // confirmed by querying information_schema.tables directly, not assumed.
    // Treating "table doesn't exist on the source" as 0 rows is correct here:
    // there is genuinely nothing to migrate for it, not a lost-data case.
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "42P01") {
      return "0";
    }
    throw err;
  }
}

async function verifyRowCounts(supabasePg: PgClient, azurePg: PgClient): Promise<boolean> {
  console.log("\n=== Row count verification ===");
  let allMatch = true;
  for (const table of TABLES) {
    const sCount = await countOrZeroIfMissing(supabasePg, table);
    const aCount = await countOrZeroIfMissing(azurePg, table);
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
      // kpi_snapshots' JSONB column is named `kpis`, not `payload` — SELECT *
      // (matching sRows above) rather than a hardcoded column name, since not
      // every HASH_SAMPLE_TABLES table shares the same JSONB column name.
      // Found by running this script against real production data.
      const aRes = await azurePg.query(`SELECT * FROM ${table} WHERE id = $1`, [row.id]);
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-migration.ts
git commit -m "feat: add migration verification script (row counts, content hashes, blob checks)"
```

(Run for real during Task 18's actual cutover — same reasoning as Task 16's scripts.)

---

### Task 18: Cutover — composition root swap and execution

**Files:**
- Modify: `lib/repositories/index.ts`

**Interfaces:**
- Consumes: every `PostgresXRepository`/`AzureBlobStorageRepository` class from Tasks 4–15.
- Produces: the live app running entirely on Azure Postgres + Blob Storage.

- [ ] **Step 1: Swap the composition root**

Replace the full contents of `lib/repositories/index.ts`:

```ts
import { PostgresAnalysisRepository } from "./analysis";
import { PostgresSectorRepository } from "./sectors";
import { PostgresKpiRepository } from "./kpis";
import { PostgresWatchlistRepository } from "./watchlist";
import { PostgresCreditsRepository } from "./credits";
import { PostgresSoloAnalysisRepository } from "./soloAnalysis";
import { PostgresInsightsRepository } from "./insights";
import { PostgresPromoterActivityRepository } from "./promoterActivity";
import { PostgresCalendarRepository } from "./calendar";
import { PostgresConcallRepository } from "./concalls";
import { AzureBlobStorageRepository } from "./storage";
import { PostgresApiAccessRepository } from "./apiAccess";

export const analysisRepo = new PostgresAnalysisRepository();
export const sectorRepo = new PostgresSectorRepository();
export const kpiRepo = new PostgresKpiRepository();
export const watchlistRepo = new PostgresWatchlistRepository();
export const creditsRepo = new PostgresCreditsRepository();
export const soloAnalysisRepo = new PostgresSoloAnalysisRepository();
export const insightsRepo = new PostgresInsightsRepository();
export const promoterActivityRepo = new PostgresPromoterActivityRepository();
export const calendarRepo = new PostgresCalendarRepository();
export const concallRepo = new PostgresConcallRepository();
export const storageRepo = new AzureBlobStorageRepository();
export const apiAccessRepo = new PostgresApiAccessRepository();
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Set the new environment variables in App Service**

```bash
az webapp config appsettings set \
  --name quantalyze-app \
  --resource-group quantalyze-prod-rg \
  --settings \
    POSTGRES_CONNECTION_STRING="$POSTGRES_CONNECTION_STRING" \
    AZURE_STORAGE_CONNECTION_STRING="$AZURE_STORAGE_CONNECTION_STRING" \
    AZURE_STORAGE_CONTAINER="transcripts" \
  > /tmp/cutover-appsettings.log 2>&1
echo "exit=$?"
```

(Using the shell variables saved from Task 1, Steps 6 and 7 — never paste the raw connection strings into a shared chat/log.)

- [ ] **Step 4: Run the actual data and blob migration**

```bash
npx tsx scripts/migrate-postgres-data.ts
npx tsx scripts/copy-blobs-to-azure.ts
```

Expected: both scripts complete with 0 exit code and no `FAILED`/error lines.

- [ ] **Step 5: Run verification — do not proceed if this fails**

```bash
npx tsx scripts/verify-migration.ts
```

Expected: `Row counts: PASS`, `Content hashes: PASS`, `Blobs: PASS`, exit code 0.

- [ ] **Step 6: Commit and deploy**

```bash
git add lib/repositories/index.ts
git commit -m "feat: cut over composition root to Azure Postgres and Blob Storage implementations"
git push origin main
```

This triggers the Hosting migration's GitHub Actions workflow, deploying the new composition root to App Service.

- [ ] **Step 7: Watch the deploy and verify App Service boots cleanly**

```bash
gh run watch --repo Notion-Demand/notionwealth-engine-research
az webapp log tail --name quantalyze-app --resource-group quantalyze-prod-rg &
sleep 30
kill %1
```

Expected: workflow succeeds; no crash-loop or missing-env-var errors in the logs.

- [ ] **Step 8: Post-deploy verification**

```bash
curl -s https://quantalyze.me/api/health
```

Then, in a browser: log in, confirm the dashboard/screener show real data, and specifically hit the public API endpoints that were previously blocked by placeholder Supabase credentials:

```bash
curl -s -H "Authorization: Bearer <a real provisioned key>" "https://quantalyze.me/api/public/v1/data/companies/RELIANCE"
curl -s -H "Authorization: Bearer <a real provisioned key>" "https://quantalyze.me/api/public/v1/data/sectors/IT"
curl -s -H "Authorization: Bearer <a real provisioned key>" "https://quantalyze.me/api/public/v1/products/sector-thesis?sector=IT"
```

Expected: all three return `200` with real data — the first time this has been possible, since these were previously blocked by placeholder Supabase credentials.

- [ ] **Step 9: Record the safety window**

Note the cutover completion date. Old `SupabaseXRepository`/`SupabaseStorageRepository` classes and `lib/supabase/admin.ts` usages stay in the codebase, unused, until the same three exit criteria as the Hosting migration are met: one successful production deployment (satisfied by Step 7), verification passed (satisfied by Step 5), and 7 days in production with no migration-related incidents — then deleted in a follow-up cleanup, not as part of this task.

---

## Post-completion addendum: real cutover execution (2026-07-13)

Executed against real production data and the live `quantalyze.me` App Service. Deviations from the plan as originally written, discovered by actually running each step (not just type-checking):

- **Supabase source connectivity**: the direct DB host (`db.<project>.supabase.co`) resolved to an IPv6-only address with no A record at all, and the Azure VNet subnet has no IPv6 egress. Fixed by switching `SUPABASE_DB_CONNECTION_STRING` to Supabase's IPv4-compatible Session Pooler endpoint (`aws-1-ap-southeast-2.pooler.supabase.com:5432`, user `postgres.<project-ref>`) instead of the direct host — works transparently with both `pg_dump`/`psql` and the `pg` client library.
- **pg_dump/psql version**: the jump-box's default `postgresql-client` (Debian bookworm) was v15, not v17. Added the official PGDG apt repository and installed `postgresql-client-17` explicitly to match the spec's version-pinning rule.
- **Schema drift discovered on the real Supabase source**: `user_credits`, `api_partners`, `api_keys`, `api_key_products`, and `api_usage` do not exist as tables on production Supabase at all (confirmed via `information_schema.tables`) — their migration files exist in the repo but were apparently never run against the live database, since those features (credits/quota system, Public API partner program) had not yet shipped real usage. This is not data loss: there is genuinely nothing to migrate for these tables. `verify-migration.ts`'s `verifyRowCounts` was fixed to treat a missing source table (`42P01`/undefined_table) as 0 rows instead of crashing.
- **Blob copy script bug**: `copy-blobs-to-azure.ts`'s `downloadData.stream()` (from supabase-js) returns a Web Streams API `ReadableStream`, not a Node.js `Readable`, and `@azure/storage-blob`'s `uploadStream()` requires the latter — the original `as unknown as NodeJS.ReadableStream` cast silenced the type error without fixing the runtime mismatch. Fixed with `Readable.fromWeb(...)` from `node:stream`.
- **verify-migration.ts content-hash bug**: `kpi_snapshots`' JSONB column is named `kpis`, not `payload`; the script's Azure-side query hardcoded `SELECT payload`, which doesn't exist for that table. Fixed to `SELECT *` (matching the Supabase-side query), reusing the existing `row.payload ?? row.kpis` fallback already present in the hashing logic.
- **Real verification results**: all 15 tables' row counts matched exactly (`analysis_results`=170, `sector_intelligence`=19, `kpi_snapshots`=3, `earnings_calendar`=1206, `concall_links`=242, others as expected including the 5 empty tables above); content-hash sampling across `analysis_results`/`sector_intelligence`/`kpi_snapshots` found 0 mismatches; all 715 blobs copied and content-verified byte-for-byte.
- **Deploy**: commit `a987812` on `main`, GitHub Actions run `29244988497`, succeeded in 2m26s. `https://quantalyze.me/api/health` returned `{"status":"ok"}`; App Service logs showed a clean boot (`Site startup probe succeeded`, no missing-env-var or crash-loop errors). Confirmed real data flowing through `/api/v1/sectors` and `/api/v1/screener` (200s, genuine sector/company data). The Public API smoke test (Step 8's `curl` calls with a provisioned key) could not be run as written — `api_keys` has 0 rows in production, consistent with the schema-drift finding above; that endpoint's correctness against real data remains unverified until a partner key is actually provisioned.
- **Safety window**: cutover completed 2026-07-13. Per Step 9's exit criteria (successful deploy ✓, verification passed ✓), the 7-day no-incident window before deleting the old `SupabaseXRepository`/`SupabaseStorageRepository` classes and `lib/supabase/admin.ts` usages ends no earlier than **2026-07-20**.

---

## Self-Review Notes

**Spec coverage:** VNet/subnet + Postgres + Storage provisioning (Task 1) ✓. Connection module (Task 2) ✓. Schema migration adapter, including the RLS/policy-stripping detail this plan resolved beyond the spec's own FK-only framing (Task 3) ✓. All 11 Postgres repositories (Tasks 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, plus Task 7 for Watchlist) ✓. AzureBlobStorageRepository with unchanged Buffer signatures (Task 15) ✓. Data + blob migration scripts under `scripts/`, not `lib/` (Task 16) ✓. Verification with row counts, content hashing, and size-threshold blob hashing (Task 17) ✓. Composition root swap, cutover procedure, safety window (Task 18) ✓. Migration invariants — every task's changes are confined to the two documented exceptions (Watchlist interface + its one call site) plus repository/connection/composition-root files, nothing else ✓. Non-goals (no ORM, no IaC, no permanent dual-backend flag, no Docker) — none appear anywhere in this plan ✓.

**Placeholder scan:** No TBD/TODO markers. Every SQL statement and every TypeScript method body is complete, not illustrative. Caught and removed one dead-code artifact during self-review: Task 15's `list()` method had a leftover `const prefix = options.search ? undefined : undefined` from drafting, which always evaluated to `undefined` and did nothing — removed, along with an earlier draft of `createSignedUrl` that used a placeholder `as never` cast instead of the real `BlobSASPermissions.parse("r")` API.

**Type consistency:** Every repository's `query<T>` calls use column names verified directly against the real `lib/repositories/*.ts` files (not just the initial research pass) — this caught and fixed one real error before it reached this plan: `CreditsRepository`'s conflict resolution defaults to `DO UPDATE` (matching Supabase's real `.upsert()` default), not `DO NOTHING` as an earlier draft assumed. Method signatures in every `PostgresXRepository` match their interface exactly, including the one deliberate exception (`WatchlistRepository`'s `userId: string` parameter, consistent across Task 7's interface, both implementations, and the one call-site update).
