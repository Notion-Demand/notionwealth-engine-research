# Azure Data + Storage Migration — Design

## Context

Quantalyze currently runs entirely on Supabase: Postgres (12 repository interfaces built in an earlier migration — see `docs/superpowers/specs/2026-07-09-data-wrapper-and-public-api-design.md`), Auth (`@supabase/ssr`, used directly across ~14 files), and Storage (one bucket, `transcripts`, holding earnings-call PDF transcripts, wrapped behind `StorageRepository`).

The decision to move to Azure was made 2026-07-09 (see project memory `infra-cloud-provider.md`): Microsoft Partner Network status, cost, and — the decisive factor — that Indian AMC/BFSI back-office IT is disproportionately Microsoft-standardized, which matters for vendor security reviews and Entra ID SSO federation if this product is ever sold into an AMC's environment. Azure's three India regions (Mumbai/West, Pune/Central, Chennai/South) are the candidate hosting locations.

**"The Azure migration" is not one project.** The Supabase surface area splits into three independent pieces with very different risk profiles:

1. **Postgres data** — already fully behind the repository pattern (12 interfaces, one composition root at `lib/repositories/index.ts`). Swapping the concrete implementation behind an unchanged interface is exactly what that wrapper was built for.
2. **Storage** — already wrapped behind `StorageRepository` (5 methods, one bucket: `transcripts`). Same story.
3. **Auth** — **not wrapped**. `@supabase/ssr` and Supabase session cookies are used directly in ~14 files (login, OAuth callback routes, dashboard pages, `lib/auth.ts`). Genuinely different kind of work: session/cookie handling, an OAuth flow to re-point, no existing abstraction to swap behind, and a real product decision (which Azure identity product). Deferred to its own future project — not built here.

**Sequencing (revised during review):** app hosting is also moving off Vercel onto Azure compute (Container Apps/App Service) — motivated by the same AMC-security-review logic driving the whole migration. That migration is **a prerequisite for this spec, not a follow-on to it.** The reason: Vercel's serverless functions have no stable outbound IPs, so a Postgres server reachable from Vercel has no choice but public-access networking (allow-all-IPs + SSL + credentials as the only real control) — a strictly worse security posture than the private/VNet access Azure-to-Azure traffic can use, and one that would just be thrown away the moment hosting moves anyway. Doing hosting first means this spec's Postgres server never needs public exposure at all. This spec assumes the Hosting migration (its own separate spec, covering deployment pipeline, SSR runtime target, custom domain, CI/CD) is **already complete** by the time this one executes.

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

## Architecture

### Connection module

`lib/azure/postgres.ts` is the **only Azure-specific file** in this design — repositories themselves talk to plain Postgres and don't know or care that Azure is hosting it (see naming rationale below). It exports:

```ts
export function pgPool(): Pool  // pg.Pool, created once, reused across invocations

export function query<T>(text: string, params?: unknown[]): Promise<T[]>
// thin helper around pgPool().query(text, params), returning rows typed as T[]
// — every repository method calls this instead of pool.query(...) directly,
// so parameter binding and error wrapping stay in one place instead of
// being repeated eleven times.
```

Configured from a single `AZURE_POSTGRES_CONNECTION_STRING` env var (not separate host/port/user/password/database vars) — one secret to rotate, one thing to get right in the deployment environment's env var UI, and it's the standard shape `psql`/`pg_dump`/`pg.Pool` all accept directly.

### Repository implementations — naming

Classes are named `PostgresAnalysisRepository`, `PostgresSectorRepository`, etc. — **not** `AzurePostgresAnalysisRepository`. The reasoning: Azure Database for PostgreSQL Flexible Server is standard Postgres; the SQL these classes write is portable to any Postgres host (RDS, Neon, Crunchy, Railway, self-hosted). The only thing in this whole design that is actually Azure-specific is `lib/azure/postgres.ts`'s connection setup — the repositories themselves only know they're talking to Postgres via `pg`. Naming the classes after Azure would wrongly suggest the query logic itself is Azure-coupled, when it isn't. If the Postgres host ever changes again, only the connection module changes; not one of the eleven repository files.

(The one exception is `AzureBlobStorageRepository` — Blob Storage's API genuinely is Azure-specific, unlike raw Postgres wire protocol, so that name is accurate as given.)

### Repository implementations — structure

Eleven new Postgres-backed classes, one file each, mirroring the existing `lib/repositories/*.ts` file structure exactly — e.g. `PostgresAnalysisRepository` implementing the same `AnalysisRepository` interface `SupabaseAnalysisRepository` already implements, with the same domain entities (`Analysis`, `Sector`, `KpiSnapshot`, etc. — unchanged, since those are provider-agnostic by design). Each method becomes hand-written parameterized SQL via the `query<T>()` helper above instead of a Supabase query-builder chain. The existing `toEntity()`/`fromEntity()` mapping functions in each file are reused as-is — only the query mechanics change, not the entity shapes or the wire-format conversion helpers (`toDashboardPayload`, `toSectorWirePayload`, etc.).

The eleven Postgres-backed interfaces: `AnalysisRepository`, `SectorRepository`, `KpiRepository`, `WatchlistRepository`, `CreditsRepository`, `SoloAnalysisRepository`, `InsightsRepository`, `PromoterActivityRepository`, `CalendarRepository`, `ConcallRepository`, `ApiAccessRepository`. A twelfth interface, `StorageRepository`, is also being migrated in this spec but is backed by Blob Storage, not Postgres — covered in its own section immediately below.

### Storage implementation

`AzureBlobStorageRepository` implements `StorageRepository` using `@azure/storage-blob`, against a single Blob container (name TBD at planning time, functionally equivalent to today's `transcripts` bucket). Two of the interface's methods change shape from the original design, to handle large PDFs efficiently rather than buffering entire files in memory:

- `download(path: string): Promise<Buffer>` → **`downloadStream(path: string): Promise<NodeJS.ReadableStream>`**
- `upload(path: string, data: Buffer): Promise<void>` → **`uploadStream(path: string, data: NodeJS.ReadableStream): Promise<void>`**

This is a real interface change (not just an Azure-side implementation detail), since `SupabaseStorageRepository` also implements `StorageRepository` — both implementations move to streaming together, in the same commit that changes the interface, so the interface never has two different method shapes across its implementers. Call sites that currently do `const buf = await storageRepo.download(path)` become `const stream = await storageRepo.downloadStream(path)` and pipe or consume the stream directly (e.g., straight into an HTTP response body, or into a PDF-parsing library that accepts a stream) — this is deferred to planning to enumerate exact call sites and confirm each one can consume a stream. `createSignedUrl` maps to Azure's SAS (Shared Access Signature) token generation — same purpose (time-limited, unauthenticated read access to one blob), different mechanism than Supabase's signed URLs, but the interface's return type (`Promise<string>`, a URL) is unchanged. `list`/`listAllPaginated` are also unchanged.

### Composition root

`lib/repositories/index.ts` — the only file that changes which concrete class backs each exported singleton. During implementation, both `SupabaseXRepository` and the new `PostgresXRepository`/`AzureBlobStorageRepository` classes coexist in the codebase (so they can be built and tested independently); the composition root is edited once, at cutover time, to instantiate the new classes instead of the Supabase ones. This is a direct code edit, not a runtime-configurable flag — per the Non-goals above, this migration is a one-time cutover, not a permanent dual-backend system.

## Schema migration

The existing `supabase/migrations/*.sql` files (001–011) remain as historical record of the Supabase-era schema — they are not rewritten. A new, separate schema definition is created for Azure by replaying that same DDL with one systematic change applied: every `REFERENCES auth.users(id)` foreign key constraint is dropped, leaving the referencing column as a plain `UUID` with no FK constraint. Referential integrity against Supabase-issued user IDs becomes an application-level concern (unchanged behavior from the application's point of view — it never validated this FK itself; Postgres did). This is the same seam that would be cut again if Auth ever moves to Azure too.

Extensions used by the existing schema (`pgcrypto` for `gen_random_uuid()`) are standard and available on Azure Database for PostgreSQL Flexible Server without modification.

**Version pinning:** the Azure Postgres Flexible Server is provisioned at a specific major version (e.g. 16), and the `pg_dump`/`pg_restore`/`psql` client tools used for the data migration are the matching major version — not whatever happens to be on the operator's machine or newest-available. A client newer than the server (e.g. a `pg_dump` 17 client against a Postgres 15 server) can silently emit syntax or options the server rejects, or dump-format warnings that are easy to miss in a live cutover. The exact version is a planning-level decision, but the *rule* — client and server major versions must match — is fixed here.

## Data migration

**Table data:** `pg_dump --data-only --no-owner` (client version matching the server, per above) against the Supabase connection string, `psql` (or `pg_restore`, depending on dump format chosen at planning time) to load into the already-schema'd Azure Postgres instance. Schema and data are migrated as two separate steps (schema replay first, from the adapted migration files; then data-only dump/restore) rather than one combined `pg_dump`, specifically so the `auth.users` FK removal is a clean, reviewable schema change rather than something patched into a dump file after the fact.

**Blob files:** a one-time script using the already-existing `StorageRepository.listAllPaginated()` to enumerate every object in the Supabase `transcripts` bucket, streaming each one directly from `SupabaseStorageRepository.downloadStream()` into `AzureBlobStorageRepository.uploadStream()` without buffering the whole file in memory — important given some existing transcript PDFs are large enough that a buffer-based copy is wasteful (and, at some size, a real memory-pressure risk in a serverless function). Reusing the existing repository methods for this (rather than calling the Supabase/Azure SDKs directly in the migration script) keeps the migration script itself thin and exercises the very code paths being shipped.

## Verification

Row counts alone can miss corruption (e.g. a JSON payload column truncated or mis-encoded during dump/restore, while the row itself still exists). Verification therefore has two layers:

1. **Row counts per table** — `SELECT count(*)` on both databases, for every migrated table, must match exactly.
2. **Random-sample content hashing** — for the tables carrying the largest/most complex payloads (`analysis_results`, `sector_intelligence`, `kpi_snapshots`), pull a random sample (e.g. 100 rows via `ORDER BY random() LIMIT 100`, using the same seed/ticker+quarter keys on both sides so the *same* logical rows are compared) from both the source (Supabase) and destination (Azure) databases, and compare a hash of the key identifying columns plus the JSON payload column between the two. A mismatch means the dump/restore altered data, not just that a row is missing.

**Blob verification** follows the same two-layer principle: every migrated blob's file size is compared between source and destination (cheap, catches truncation), and a SHA-256 hash of a random sample of blobs is compared (catches corruption that preserves file size, e.g. from a partial/retried stream write). Both checks are scriptable using the same repository methods used for the migration itself.

## Cutover procedure

0. **Prerequisite:** Hosting migration (separate spec) is complete — the app is running on Azure compute, in a network the new Postgres server can privately join.
1. Provision Azure Postgres Flexible Server + Storage account (Central India / Pune), with private/VNet-only network access (no public endpoint).
2. Replay adapted schema (FK-dropped) onto the new Postgres instance.
3. Implement and unit-verify (via `npx tsc --noEmit`, no live calls) all eleven `PostgresXRepository` classes plus `AzureBlobStorageRepository` (twelve total) against the schema from step 2, using a scratch/dev Azure instance if available, or structural review if not.
4. **Maintenance window begins.**
5. `pg_dump --data-only` from Supabase → load into Azure Postgres.
6. Run the blob-copy script (Supabase `transcripts` → Azure Blob container, streaming).
7. Run the Verification checks above (row counts, random-sample content hashes, blob size + hash comparison) — do not proceed to step 8 until all pass.
8. Edit the composition root to instantiate the new classes; set the env vars below in the deployment environment; deploy.
9. Post-deploy verification: the existing manual smoke-test routes (per the Plan A/B testing conventions already established in this repo — `npx tsc --noEmit` plus manual route hits) return expected data; the public API endpoints built in the prior plan (`/api/public/v1/data/companies/{ticker}`, `/api/public/v1/data/sectors/{sector}`, `/api/public/v1/products/sector-thesis`) return 200s with real data for the first time (previously blocked by placeholder Supabase credentials — this migration is also what unblocks that).
10. **Maintenance window ends** once step 9 passes.
11. Old `SupabaseXRepository`/`SupabaseStorageRepository` classes and their `lib/supabase/admin.ts` usages are kept, unused, for a short safety window (exact duration decided at planning time), then deleted in a follow-up cleanup once the cutover is confirmed stable in production.

### New environment variables

- `AZURE_POSTGRES_CONNECTION_STRING` — full Postgres connection string (host, port, user, password, database, `sslmode`), private-network address (not a public hostname, per the networking design below).
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

- Exact Azure Postgres Flexible Server SKU/tier (compute + storage sizing) — a planning-level/cost decision, not fixed here; should default to the smallest tier that fits current data volume given this is a pre-launch app, with a documented easy upgrade path.
- Exact Postgres major version to pin (server + client tools) — likely the latest version Azure Flexible Server offers at provisioning time, but fixed as a specific number during planning, not left to whatever's installed locally.
- Exact Blob Storage container name and access tier (Hot/Cool) — functionally equivalent to today's `transcripts` bucket either way.
- Dump/restore tool specifics: plain-text `pg_dump` + `psql`, vs. custom-format `pg_dump -Fc` + `pg_restore` — a mechanical choice with no architectural impact, deferred to planning.
- Exact duration of the "keep old Supabase classes dormant" safety window before deletion.
- Whether a scratch/dev Azure Postgres instance is provisioned separately from the production one for implementation-time testing, or whether the production instance itself is used pre-cutover (schema exists, no real data yet) — planning should decide based on actual Azure cost/complexity at provisioning time.
- Exact VNet/subnet/private-endpoint configuration linking the Postgres server to the app's network — this depends on decisions made in the (prerequisite, separate) Hosting migration spec, and should be finalized once that spec's networking design is fixed, not guessed here.
- Full enumeration of call sites currently using `StorageRepository.download()`/`upload()` that need updating to the new stream-based methods — a mechanical audit, deferred to planning.
