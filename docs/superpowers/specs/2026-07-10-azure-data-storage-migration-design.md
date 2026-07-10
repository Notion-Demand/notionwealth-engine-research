# Azure Data + Storage Migration — Design

## Context

Quantalyze currently runs entirely on Supabase: Postgres (12 repository interfaces built in an earlier migration — see `docs/superpowers/specs/2026-07-09-data-wrapper-and-public-api-design.md`), Auth (`@supabase/ssr`, used directly across ~14 files), and Storage (one bucket, `transcripts`, holding earnings-call PDF transcripts, wrapped behind `StorageRepository`).

The decision to move to Azure was made 2026-07-09 (see project memory `infra-cloud-provider.md`): Microsoft Partner Network status, cost, and — the decisive factor — that Indian AMC/BFSI back-office IT is disproportionately Microsoft-standardized, which matters for vendor security reviews and Entra ID SSO federation if this product is ever sold into an AMC's environment. Azure's three India regions (Mumbai/West, Pune/Central, Chennai/South) are the candidate hosting locations.

**"The Azure migration" is not one project.** The Supabase surface area splits into three independent pieces with very different risk profiles:

1. **Postgres data** — already fully behind the repository pattern (12 interfaces, one composition root at `lib/repositories/index.ts`). Swapping the concrete implementation behind an unchanged interface is exactly what that wrapper was built for.
2. **Storage** — already wrapped behind `StorageRepository` (5 methods, one bucket: `transcripts`). Same story.
3. **Auth** — **not wrapped**. `@supabase/ssr` and Supabase session cookies are used directly in ~14 files (login, OAuth callback routes, dashboard pages, `lib/auth.ts`). Genuinely different kind of work: session/cookie handling, an OAuth flow to re-point, no existing abstraction to swap behind, and a real product decision (which Azure identity product). Deferred to its own future project — not built here.

**Sequencing (revised during review):** app hosting is also moving off Vercel onto Azure compute (Container Apps/App Service) — motivated by the same AMC-security-review logic driving the whole migration. That migration is **a prerequisite for this spec, not a follow-on to it.** The reason: Vercel's serverless functions have no stable outbound IPs, so a Postgres server reachable from Vercel has no choice but public-access networking (allow-all-IPs + SSL + credentials as the only real control) — a strictly worse security posture than the private/VNet access Azure-to-Azure traffic can use, and one that would just be thrown away the moment hosting moves anyway. Doing hosting first means this spec's Postgres server never needs public exposure at all. This spec assumes the Hosting migration (its own separate spec, covering deployment pipeline, SSR runtime target, custom domain, CI/CD) is **already complete** by the time this one executes.

**Hosting migration is now actually complete** (2026-07-10, `docs/superpowers/plans/2026-07-10-azure-hosting-migration.md`): the app runs on Azure App Service (`quantalyze-app`, `quantalyze-prod-rg`, Central India), with regional VNet integration already added into `quantalyze-prod-vnet` (`10.0.0.0/16`), via a delegated subnet `appservice-integration-subnet` (`10.0.1.0/24`, delegated to `Microsoft.Web/serverFarms`). This spec's networking design (below) builds on that real VNet rather than a hypothetical one.

This spec covers **only Data + Storage migration**, on the assumption that the app is already running on Azure compute. Auth migration stays out of scope, as does the Hosting migration itself (it's a prerequisite, specified and built separately).

## Scope

**In scope:**
- Provisioning Azure Database for PostgreSQL — Flexible Server, and an Azure Storage account (Blob), in Central India (Pune), on private/VNet networking (no public internet access to Postgres).
- Eleven `PostgresXRepository` implementations (one per existing Postgres-backed repository interface) plus one `AzureBlobStorageRepository` — twelve total, each implementing the exact same interface its `SupabaseXRepository`/`SupabaseStorageRepository` counterpart already implements.
- Schema replay onto the new Azure Postgres instance, with every `REFERENCES auth.users(id)` foreign key dropped (Auth stays on Supabase; cross-database foreign keys aren't possible in Postgres).
- One-time data migration: `pg_dump`/`psql` for table data, a streaming copy script for the `transcripts` blobs.
- Swapping the composition root (`lib/repositories/index.ts`) to the new implementations.
- A maintenance-window cutover procedure, including hash-based data verification (not just row counts) and rollback steps.

**Out of scope (named, not built here):**
- **Auth migration** — Supabase Auth stays exactly as-is. No Azure identity product (Entra External ID, B2C, etc.) is chosen or built in this spec.
- **Hosting migration** — a *prerequisite* for this spec (see Context above), specified and executed separately. By the time this spec's work begins, the app is already deployed on Azure compute with a private network the new Postgres server can join.
- **Zero-downtime / dual-write migration** — this app is pre-launch with no live paying partners (confirmed during brainstorming), so a maintenance-window cutover is appropriate. Dual-write/backfill complexity is not justified at this stage.
- **An ORM** (Prisma, Drizzle) — raw `pg` (node-postgres) with hand-written parameterized SQL, matching this codebase's existing style (repositories already hand-write their own snake_case↔camelCase mapping; migrations stay plain `.sql` files).
- **Infrastructure-as-code** (Bicep/Terraform) for provisioning — one-time manual/CLI provisioning is proportionate for a single environment at this stage. Can be revisited if/when a second environment (staging) is needed.
- **A permanent multi-provider abstraction** (e.g., a runtime env-var flag to choose Supabase vs. Azure per-request). This is a one-time cutover, not a long-lived dual-backend system — the old `SupabaseXRepository` classes are deleted once the cutover is confirmed stable, not kept as a permanent alternate path.
- **Connection pooling middleware** (PgBouncer, Azure's built-in pooling tier) — not needed at current scale; the existing lazy-singleton client pattern (`lib/supabase/admin.ts`) is mirrored as a lazy-singleton `pg.Pool`, which handles connection reuse adequately for a low-traffic pre-launch app.

## Migration invariants

The following must remain unchanged by this migration — this is the whole point of having built the repository pattern before attempting a provider swap:

- Repository *interfaces* (`AnalysisRepository`, `SectorRepository`, `StorageRepository`, etc. — the method signatures and domain entities every caller already codes against), **with one necessary exception**: `WatchlistRepository`'s three methods (`list`, `add`, `remove`) currently take a Supabase `SupabaseClient` as their first parameter — a type that names a specific provider and genuinely cannot be "reused as-is" by a Postgres implementation, unlike every other interface in this migration. This parameter existed solely to carry a request-scoped, RLS-authenticated client so Postgres's Row-Level Security could do the actual `user_id` filtering invisibly (see the Watchlist security model note below). All three methods change to take `userId: string` as their first parameter instead.
- Domain entities (`Analysis`, `Sector`, `KpiSnapshot`, ...)
- The service layer (`lib/services/*`)
- Public API contracts (`lib/api-contracts/v1/*`)
- Route handlers (`app/api/**/route.ts`) — one exception, directly following from the interface change above: `app/api/v1/user-tickers/route.ts` already extracts `user.id` via `supabase.auth.getUser()` (Supabase Auth, unrelated to this migration) before calling into `watchlistRepo`; its three call sites change from passing `supabase` to passing `user.id` directly. No other route handler changes.

Only these change:
- Repository *implementations* (new `PostgresXRepository`/`AzureBlobStorageRepository` classes)
- The connection module (`lib/postgres/client.ts`, plus Blob Storage setup)
- The composition root (`lib/repositories/index.ts`)
- `WatchlistRepository`'s interface signature and its one call site, as described above

### Watchlist security model

`WatchlistRepository.list()` today has **no application-level `user_id` filter at all** — it relies entirely on Postgres Row-Level Security (`CREATE POLICY ... USING (auth.uid() = user_id)` on `user_tickers`) plus a request-scoped, RLS-authenticated Supabase client threading the caller's JWT through automatically. A raw `pg.Pool` connection to Azure Postgres has no equivalent mechanism — there's no JWT-to-RLS wiring without Supabase's PostgREST layer sitting in front of Postgres, and every one of this codebase's other ten repositories already relies on application-level correctness with zero RLS (all accessed via the `supabaseAdmin()` service-role client, which bypasses RLS entirely).

Rather than rebuilding Postgres-native RLS with per-request session-scoped GUCs (`SET app.current_user_id = $1` before each query, which would also complicate the simple lazy-singleton `pg.Pool` design this migration otherwise uses everywhere), this migration adds explicit `WHERE user_id = $1` filtering to `list()` (and keeps it, redundantly with today, in `remove()`) — consciously, as a deliberate decision recorded here, not as a silent side effect. This makes `WatchlistRepository`'s security model consistent with the other ten repositories rather than uniquely different. `SupabaseWatchlistRepository`'s existing implementation is updated in the same commit to match — switching from the passed-in RLS-scoped client to `supabaseAdmin()` with the same explicit `WHERE user_id` filtering — so both implementations share one security model going forward, and the dormant Supabase class isn't left implementing a different, now-inconsistent interface.

If a task in the eventual implementation plan touches anything outside that second list, it's out of scope for this migration and should be flagged, not built.

## Architecture

### Connection module

`lib/postgres/client.ts` is a plain Postgres connection module with nothing Azure-specific in it at all — not even the folder name, per the same reasoning as the repository naming below: the code inside is just `pg.Pool` construction from a connection string, which works identically against any Postgres host. It exports:

```ts
export function pgPool(): Pool  // pg.Pool, created once, reused across invocations

export function query<T>(text: string, params?: unknown[]): Promise<T[]>
// thin helper around pgPool().query(text, params), returning rows typed as T[]
// — every repository method calls this instead of pool.query(...) directly,
// so parameter binding and error wrapping stay in one place instead of
// being repeated eleven times.
```

Configured from a single `POSTGRES_CONNECTION_STRING` env var (not separate host/port/user/password/database vars, and not `AZURE_`-prefixed, since the module itself isn't Azure-specific) — one secret to rotate, one thing to get right in the deployment environment's env var UI, and it's the standard shape `psql`/`pg_dump`/`pg.Pool` all accept directly. (`AzureBlobStorageRepository`'s connection setup, by contrast, is genuinely Azure-specific — see the naming exception below — so its env vars stay `AZURE_`-prefixed.)

### Repository implementations — naming

Classes are named `PostgresAnalysisRepository`, `PostgresSectorRepository`, etc. — **not** `AzurePostgresAnalysisRepository`. The reasoning: Azure Database for PostgreSQL Flexible Server is standard Postgres; the SQL these classes write is portable to any Postgres host (RDS, Neon, Crunchy, Railway, self-hosted). The only thing in this whole design that is actually Azure-specific is `lib/postgres/client.ts`'s connection *setup* (which env var it reads, which private network it's provisioned on) — the code and the repositories themselves only know they're talking to Postgres via `pg`. Naming the classes after Azure would wrongly suggest the query logic itself is Azure-coupled, when it isn't. If the Postgres host ever changes again, only the connection module's configuration changes; not one of the eleven repository files.

(The one exception is `AzureBlobStorageRepository` — Blob Storage's API genuinely is Azure-specific, unlike raw Postgres wire protocol, so that name is accurate as given.)

### Repository implementations — structure

Eleven new Postgres-backed classes, one file each, mirroring the existing `lib/repositories/*.ts` file structure exactly — e.g. `PostgresAnalysisRepository` implementing the same `AnalysisRepository` interface `SupabaseAnalysisRepository` already implements, with the same domain entities (`Analysis`, `Sector`, `KpiSnapshot`, etc. — unchanged, since those are provider-agnostic by design). Each method becomes hand-written parameterized SQL via the `query<T>()` helper above instead of a Supabase query-builder chain. The existing `toEntity()`/`fromEntity()` mapping functions in each file are reused as-is — only the query mechanics change, not the entity shapes or the wire-format conversion helpers (`toDashboardPayload`, `toSectorWirePayload`, etc.).

The eleven Postgres-backed interfaces: `AnalysisRepository`, `SectorRepository`, `KpiRepository`, `WatchlistRepository`, `CreditsRepository`, `SoloAnalysisRepository`, `InsightsRepository`, `PromoterActivityRepository`, `CalendarRepository`, `ConcallRepository`, `ApiAccessRepository`. A twelfth interface, `StorageRepository`, is also being migrated in this spec but is backed by Blob Storage, not Postgres — covered in its own section immediately below.

### Storage implementation

`AzureBlobStorageRepository` implements `StorageRepository` using `@azure/storage-blob`, against a single Blob container (name TBD at planning time, functionally equivalent to today's `transcripts` bucket). **The interface's method signatures are unchanged** — `download(path: string): Promise<Buffer>` and `upload(path: string, data: Buffer): Promise<void>` stay exactly as they are today. This was reconsidered during review: an earlier version of this spec changed both methods to stream-based signatures, on the reasoning that large PDFs shouldn't be fully buffered in memory. An audit of every current call site (`lib/pipeline.ts`, `lib/kpi-extractor.ts`, `lib/insights-pipeline.ts`, `lib/solo-pipeline.ts` for reads; `app/api/v1/seed-transcripts/route.ts`, `app/api/v1/request/route.ts`, `lib/transcript-fetcher.ts` for writes) found that every read immediately does buffer-only operations (`.length`, `.slice(0, 5).toString("ascii")` header-sniffing) and hands the result to `pdf-parse`, which requires a `Buffer` and has no streaming input mode; every write already holds a full `Buffer` from an earlier fetch/parse step. A stream-based interface would force a stream→buffer (or buffer→stream) conversion at all seven call sites for no actual memory benefit anywhere in the app's real usage — pure churn. The genuine large-file concern this was meant to address only applies to the one-time bulk migration copy, which doesn't need the shared interface to change at all (see Data migration below). `createSignedUrl` maps to Azure's SAS (Shared Access Signature) token generation — same purpose (time-limited, unauthenticated read access to one blob), different mechanism than Supabase's signed URLs, but the interface's return type (`Promise<string>`, a URL) is unchanged. `list`/`listAllPaginated` are also unchanged.

### Composition root

`lib/repositories/index.ts` — the only file that changes which concrete class backs each exported singleton. During implementation, both `SupabaseXRepository` and the new `PostgresXRepository`/`AzureBlobStorageRepository` classes coexist in the codebase (so they can be built and tested independently); the composition root is edited once, at cutover time, to instantiate the new classes instead of the Supabase ones. This is a direct code edit, not a runtime-configurable flag — per the Non-goals above, this migration is a one-time cutover, not a permanent dual-backend system.

### Networking

Postgres Flexible Server needs its own dedicated subnet — it can't share App Service's `appservice-integration-subnet` (a subnet accepts only one delegation). A new subnet, `postgres-delegated-subnet` (`10.0.2.0/24`), is added to the existing `quantalyze-prod-vnet`, delegated to `Microsoft.DBforPostgreSQL/flexibleServers`, alongside a Private DNS Zone linked to that VNet for the server's private name resolution. The Postgres Flexible Server is provisioned with "Private access (VNet integration)" networking — no public endpoint is ever created, satisfying this spec's original private-only design exactly as written before Hosting existed for real. App Service (already VNet-integrated via its own subnet in the same VNet) reaches Postgres over this private network; nothing about the app's *outbound* connectivity needs to change beyond the connection string itself.

Blob Storage's account-level networking is left at its default (public endpoint, access-key-authenticated via `AZURE_STORAGE_CONNECTION_STRING`) — deliberately, not by omission. Unlike Postgres, Blob Storage exposes only opaque object names (`{ticker}_{quarter}.pdf`-style paths, not queryable/enumerable without the account key) behind an access-key gate; there's no equivalent to a SQL injection surface or a broad query interface to defend against, so the threat model is meaningfully different and the operational bar for "needs private networking" is correspondingly lower. Private Endpoints for Blob Storage remain a possible future hardening step, not required for this initial migration (consistent with this spec's existing non-goals around infrastructure scope).

## Schema migration

There is exactly one logical schema, not two — `supabase/migrations/*.sql` (001–011) stays the single source of truth, and no second, hand-maintained copy is created that could silently drift from it over time. A migration adapter script reads each existing `.sql` file and mechanically strips every `REFERENCES auth.users(id)` foreign key constraint before replaying the (now-adapted) DDL against the Azure Postgres instance — a scripted transformation, applied fresh from the existing files each time it's needed, not a parallel schema someone has to remember to keep in sync by hand. Referential integrity against Supabase-issued user IDs becomes an application-level concern for the affected columns (unchanged behavior from the application's point of view — it never validated this FK itself; Postgres did). This is the same seam that would be cut again if Auth ever moves to Azure too.

Extensions used by the existing schema (`pgcrypto` for `gen_random_uuid()`) are standard and available on Azure Database for PostgreSQL Flexible Server without modification.

**Version pinning:** the Azure Postgres Flexible Server is provisioned at **PostgreSQL 17**, the selected target version at the time this migration was designed (current and stable without being the newest available), and the `pg_dump`/`pg_restore`/`psql` client tools used for the data migration are installed at the matching major version — not whatever happens to be on the operator's machine or newest-available. A client newer than the server (e.g. a `pg_dump` 18 client against a Postgres 17 server) can silently emit syntax or options the server rejects, or dump-format warnings that are easy to miss in a live cutover.

## Data migration

All migration tooling below is **operational code, not application code** — it lives under `scripts/` (alongside the existing `scripts/provision-api-key.ts` from the earlier public-API plan), never under `lib/`, so ops tooling stays clearly separated from the code the running app actually imports.

**Table data:** `scripts/migrate-postgres-data.ts` orchestrates `pg_dump --data-only --no-owner` (client version matching the server, per above) against the Supabase connection string, then `psql` (or `pg_restore`, depending on dump format chosen at planning time) to load into the already-schema'd Azure Postgres instance. Schema and data are migrated as two separate steps (schema replay first, via the migration adapter above; then data-only dump/restore) rather than one combined `pg_dump`, specifically so the `auth.users` FK removal is a clean, reviewable schema change rather than something patched into a dump file after the fact.

**Blob files:** `scripts/copy-blobs-to-azure.ts` uses the already-existing `StorageRepository.listAllPaginated()` to enumerate every object in the Supabase `transcripts` bucket, but — unlike the rest of this migration's scripts — does **not** go through `SupabaseStorageRepository.download()`/`AzureBlobStorageRepository.upload()` for the actual copy, since those stay `Buffer`-based (per Storage implementation above). Instead it calls the Supabase Storage client's and `@azure/storage-blob`'s native streaming APIs directly (Supabase's storage download returns a `Blob`/stream from the underlying `fetch` response; `@azure/storage-blob`'s `uploadStream()` accepts a `Readable`), piping one directly into the other without buffering a whole file in memory — important given some existing transcript PDFs are large enough that a buffer-based copy is wasteful (and, at some size, a real memory-pressure risk in a long-running migration process). This is the one place in the whole migration where bypassing the repository abstraction is deliberate: the interface's job is to serve the app's normal Buffer-based read/write needs, and this script has a genuinely different one (bulk-copy many potentially-large files once), which real streaming — not a wrapped Buffer — actually serves.

## Verification

Row counts alone can miss corruption (e.g. a JSON payload column truncated or mis-encoded during dump/restore, while the row itself still exists). Verification therefore has two layers:

1. **Row counts per table** — `SELECT count(*)` on both databases, for every migrated table, must match exactly.
2. **Random-sample content hashing** — for the tables carrying the largest/most complex payloads (`analysis_results`, `sector_intelligence`, `kpi_snapshots`), pull a random sample (e.g. 100 rows via `ORDER BY random() LIMIT 100`, using the same seed/ticker+quarter keys on both sides so the *same* logical rows are compared) from both the source (Supabase) and destination (Azure) databases, and compare a hash of the key identifying columns plus the JSON payload column between the two. A mismatch means the dump/restore altered data, not just that a row is missing.

**Blob verification** follows the same two-layer principle, with a size-based rule rather than pure random sampling: every migrated blob's file size is compared between source and destination (cheap, catches truncation, done for 100% of blobs regardless of size). For SHA-256 content hashing — which catches corruption that preserves file size, e.g. from a partial/retried stream write — every blob under 10 MB is hashed and compared in full, and blobs at or above 10 MB are hashed on a random sample; full hashing of every blob regardless of size isn't needed to catch systematic corruption, and this keeps verification cheap without weakening it where it matters most (the common case of many small-to-medium transcripts).

`scripts/verify-migration.ts` implements both the Postgres and blob verification checks above, using the same repository methods used for the migration itself.

## Cutover procedure

0. **Prerequisite:** Hosting migration (separate spec) is complete — the app is running on Azure compute, in a network the new Postgres server can privately join. (Done, 2026-07-10.)
1. Add `postgres-delegated-subnet` (`10.0.2.0/24`, delegated to `Microsoft.DBforPostgreSQL/flexibleServers`) to `quantalyze-prod-vnet`, plus a linked Private DNS Zone. Provision Azure Postgres Flexible Server (version 17, `Standard_B1ms`, Central India) into that subnet with private-only access, and the Storage account (Central India), per the Networking section above.
2. Replay adapted schema (FK-dropped) onto the new Postgres instance.
3. Implement and unit-verify (via `npx tsc --noEmit`, no live calls) all eleven `PostgresXRepository` classes plus `AzureBlobStorageRepository` (twelve total) against the schema from step 2. If a scratch/dev Azure Postgres instance is available, smoke-test each implementation against it directly; if not, implementation proceeds with type-checking and code review only, with live repository validation deferred until the production Azure instance exists in step 1 above.
4. **Maintenance window begins.**
5. `pg_dump --data-only` from Supabase → load into Azure Postgres.
6. Run the blob-copy script (Supabase `transcripts` → Azure Blob container, streaming).
7. Run the Verification checks above (row counts, random-sample content hashes, blob size + hash comparison) — do not proceed to step 8 until all pass.
8. Edit the composition root to instantiate the new classes; set the env vars below in the deployment environment; deploy.
9. Post-deploy verification: the existing manual smoke-test routes (per the Plan A/B testing conventions already established in this repo — `npx tsc --noEmit` plus manual route hits) return expected data; the public API endpoints built in the prior plan (`/api/public/v1/data/companies/{ticker}`, `/api/public/v1/data/sectors/{sector}`, `/api/public/v1/products/sector-thesis`) return 200s with real data for the first time (previously blocked by placeholder Supabase credentials — this migration is also what unblocks that).
10. **Maintenance window ends** once step 9 passes.
11. Old `SupabaseXRepository`/`SupabaseStorageRepository` classes and their `lib/supabase/admin.ts` usages are kept, unused, until the same three exit criteria used by the Hosting migration's safety window are all met, then deleted in a follow-up cleanup: one successful production deployment on the new implementations, verification passed (the Verification checks from step 7, with no unresolved discrepancies), and 7 days in production with no migration-related incidents.

### New environment variables

- `POSTGRES_CONNECTION_STRING` — full Postgres connection string (host, port, user, password, database, `sslmode`), private-network address (not a public hostname, per the networking design above). Not `AZURE_`-prefixed — see the Connection module naming note above.
- `AZURE_STORAGE_CONNECTION_STRING` — Blob Storage account connection string.
- `AZURE_STORAGE_CONTAINER` — the Blob container name (equivalent to today's `transcripts` bucket; exact name decided at planning time).

## Rollback plan

1. Revert the composition-root commit (the single, small, reviewable edit from step 8) — this is the only code change the cutover makes.
2. Restore the previous (Supabase-pointing) environment variables in the deployment environment.
3. Redeploy.
4. Re-run the post-deploy verification checks (step 9 above) against the reverted deployment to confirm the app is healthy on Supabase again.
5. Investigate the Azure environment offline, without time pressure, now that the live app is back on the known-good Supabase path.

Supabase remains untouched and fully functional throughout the maintenance window (data is copied, not moved-and-deleted), so rollback at any point before the old classes are deleted (step 11 above) is a code revert, not a data recovery operation. Hopefully never needed — but every migration should answer "how do we undo this," and now this one does.

## Testing

No automated test runner exists in this repo (established throughout prior work). Verification is `npx tsc --noEmit` for every new repository implementation, plus the Verification section above and the manual cutover checklist. There is no way to test the `PostgresXRepository`/`AzureBlobStorageRepository` implementations against a live Azure instance until one is provisioned (cutover step 1) — planning should sequence "provision a real (or scratch/dev) Azure Postgres instance" early enough that later implementation tasks can be manually smoke-tested against it, not just type-checked.

## Non-goals

(Consolidated from Scope above, for a single reference list at planning time)
- Auth migration (Supabase Auth stays; separate future project)
- Hosting migration itself (a *prerequisite* for this spec, specified and built separately — not a follow-on)
- Zero-downtime dual-write migration
- An ORM (Prisma, Drizzle) — raw `pg` only
- Infrastructure-as-code (Bicep/Terraform) for provisioning
- A permanent runtime-configurable multi-provider abstraction
- Connection pooling middleware (PgBouncer, etc.)

## Open questions carried into planning

Resolved during reconciliation with the now-complete Hosting migration (2026-07-10): Postgres Flexible Server SKU (`Standard_B1ms`, Burstable), major version (17), and VNet/subnet design (see Networking section above). Still open:

- Exact Blob Storage container name and access tier (Hot/Cool) — functionally equivalent to today's `transcripts` bucket either way.
- Dump/restore tool specifics: plain-text `pg_dump` + `psql`, vs. custom-format `pg_dump -Fc` + `pg_restore` — a mechanical choice with no architectural impact, deferred to planning.
- Whether a scratch/dev Azure Postgres instance is provisioned separately from the production one for implementation-time testing, or whether the production instance itself is used pre-cutover (schema exists, no real data yet) — planning should decide based on actual Azure cost/complexity at provisioning time.
