# Azure Data + Storage Migration — Design

## Context

Quantalyze currently runs entirely on Supabase: Postgres (12 repository interfaces built in an earlier migration — see `docs/superpowers/specs/2026-07-09-data-wrapper-and-public-api-design.md`), Auth (`@supabase/ssr`, used directly across ~14 files), and Storage (one bucket, `transcripts`, holding earnings-call PDF transcripts, wrapped behind `StorageRepository`).

The decision to move to Azure was made 2026-07-09 (see project memory `infra-cloud-provider.md`): Microsoft Partner Network status, cost, and — the decisive factor — that Indian AMC/BFSI back-office IT is disproportionately Microsoft-standardized, which matters for vendor security reviews and Entra ID SSO federation if this product is ever sold into an AMC's environment. Azure's three India regions (Mumbai/West, Pune/Central, Chennai/South) are the candidate hosting locations.

**"The Azure migration" is not one project.** The Supabase surface area splits into three independent pieces with very different risk profiles:

1. **Postgres data** — already fully behind the repository pattern (12 interfaces, one composition root at `lib/repositories/index.ts`). Swapping the concrete implementation behind an unchanged interface is exactly what that wrapper was built for.
2. **Storage** — already wrapped behind `StorageRepository` (5 methods, one bucket: `transcripts`). Same story.
3. **Auth** — **not wrapped**. `@supabase/ssr` and Supabase session cookies are used directly in ~14 files (login, OAuth callback routes, dashboard pages, `lib/auth.ts`). Genuinely different kind of work: session/cookie handling, an OAuth flow to re-point, no existing abstraction to swap behind, and a real product decision (which Azure identity product). Deferred to its own future project — not built here.

Additionally, mid-brainstorming, the decision was made to also migrate app hosting off Vercel onto Azure — motivated by the same AMC-security-review logic driving the whole migration (a security reviewer sees "everything is Azure, MeitY-empanelled, in India regions" as a simpler story than a hybrid Vercel-compute/Azure-data stack). That is **also excluded from this spec** — it is a materially different kind of change (deployment pipeline, SSR runtime target, custom domain, CI/CD) and is explicitly sequenced as **the next spec after this one**, once Data + Storage migration is verified working end-to-end on the existing Vercel deployment.

This spec covers **only Data + Storage migration**. Auth migration and Hosting migration are named, sequenced, and explicitly out of scope below.

## Scope

**In scope:**
- Provisioning Azure Database for PostgreSQL — Flexible Server, and an Azure Storage account (Blob), in Central India (Pune).
- Eleven `AzurePostgresXRepository` implementations (one per existing Postgres-backed repository interface) plus one `AzureBlobStorageRepository` — twelve total, each implementing the exact same interface its `SupabaseXRepository`/`SupabaseStorageRepository` counterpart already implements.
- Schema replay onto the new Azure Postgres instance, with every `REFERENCES auth.users(id)` foreign key dropped (Auth stays on Supabase; cross-database foreign keys aren't possible in Postgres).
- One-time data migration: `pg_dump`/`psql` for table data, a copy script for the `transcripts` blobs.
- Swapping the composition root (`lib/repositories/index.ts`) to the Azure implementations.
- A maintenance-window cutover procedure and verification checklist.

**Out of scope (named, not built here):**
- **Auth migration** — Supabase Auth stays exactly as-is. No Azure identity product (Entra External ID, B2C, etc.) is chosen or built in this spec.
- **Hosting migration** — the app keeps deploying on Vercel through this spec. Azure App Service / Static Web Apps / Container Apps is the next spec, after this one ships and is verified.
- **Zero-downtime / dual-write migration** — this app is pre-launch with no live paying partners (confirmed during brainstorming), so a maintenance-window cutover is appropriate. Dual-write/backfill complexity is not justified at this stage.
- **An ORM** (Prisma, Drizzle) — raw `pg` (node-postgres) with hand-written parameterized SQL, matching this codebase's existing style (repositories already hand-write their own snake_case↔camelCase mapping; migrations stay plain `.sql` files).
- **Infrastructure-as-code** (Bicep/Terraform) for provisioning — one-time manual/CLI provisioning is proportionate for a single environment at this stage. Can be revisited if/when a second environment (staging) is needed.
- **A permanent multi-provider abstraction** (e.g., a runtime env-var flag to choose Supabase vs. Azure per-request). This is a one-time cutover, not a long-lived dual-backend system — the old `SupabaseXRepository` classes are deleted once the cutover is confirmed stable, not kept as a permanent alternate path.
- **Connection pooling middleware** (PgBouncer, Azure's built-in pooling tier) — not needed at current scale; the existing lazy-singleton client pattern (`lib/supabase/admin.ts`) is mirrored as a lazy-singleton `pg.Pool`, which handles connection reuse adequately for a low-traffic pre-launch app.

## Architecture

### Connection module

`lib/azure/postgres.ts` exports a lazy-singleton accessor, mirroring `lib/supabase/admin.ts`'s existing pattern:

```ts
export function azurePool(): Pool  // pg.Pool, created once, reused across invocations
```

Configured from a single `AZURE_POSTGRES_CONNECTION_STRING` env var (not separate host/port/user/password/database vars) — one secret to rotate, one thing to get right in Vercel's env var UI, and it's the standard shape `psql`/`pg_dump`/`pg.Pool` all accept directly.

### Repository implementations

Eleven new Postgres-backed classes, one file each, mirroring the existing `lib/repositories/*.ts` file structure exactly — e.g. `AzureAnalysisRepository` implementing the same `AnalysisRepository` interface `SupabaseAnalysisRepository` already implements, with the same domain entities (`Analysis`, `Sector`, `KpiSnapshot`, etc. — unchanged, since those are provider-agnostic by design). Each method becomes hand-written parameterized SQL against `azurePool()` instead of a Supabase query-builder chain. The existing `toEntity()`/`fromEntity()` mapping functions in each file are reused as-is — only the query mechanics change, not the entity shapes or the wire-format conversion helpers (`toDashboardPayload`, `toSectorWirePayload`, etc.).

The eleven Postgres-backed interfaces: `AnalysisRepository`, `SectorRepository`, `KpiRepository`, `WatchlistRepository`, `CreditsRepository`, `SoloAnalysisRepository`, `InsightsRepository`, `PromoterActivityRepository`, `CalendarRepository`, `ConcallRepository`, `ApiAccessRepository`. A twelfth interface, `StorageRepository`, is also being migrated in this spec but is backed by Blob Storage, not Postgres — covered in its own section immediately below.

### Storage implementation

`AzureBlobStorageRepository` implements `StorageRepository` (`list`, `listAllPaginated`, `download`, `upload`, `createSignedUrl`) using `@azure/storage-blob`, against a single Blob container (name TBD at planning time, functionally equivalent to today's `transcripts` bucket). `createSignedUrl` maps to Azure's SAS (Shared Access Signature) token generation — same purpose (time-limited, unauthenticated read access to one blob), different mechanism than Supabase's signed URLs, but the interface's return type (`Promise<string>`, a URL) is unchanged.

### Composition root

`lib/repositories/index.ts` — the only file that changes which concrete class backs each exported singleton. During implementation, both `SupabaseXRepository` and `AzureXRepository` classes coexist in the codebase (so they can be built and tested independently); the composition root is edited once, at cutover time, to instantiate the Azure classes instead of the Supabase ones. This is a direct code edit, not a runtime-configurable flag — per the Non-goals above, this migration is a one-time cutover, not a permanent dual-backend system.

## Schema migration

The existing `supabase/migrations/*.sql` files (001–011) remain as historical record of the Supabase-era schema — they are not rewritten. A new, separate schema definition is created for Azure by replaying that same DDL with one systematic change applied: every `REFERENCES auth.users(id)` foreign key constraint is dropped, leaving the referencing column as a plain `UUID` with no FK constraint. Referential integrity against Supabase-issued user IDs becomes an application-level concern (unchanged behavior from the application's point of view — it never validated this FK itself; Postgres did). This is the same seam that would be cut again if Auth ever moves to Azure too.

Extensions used by the existing schema (`pgcrypto` for `gen_random_uuid()`) are standard and available on Azure Database for PostgreSQL Flexible Server without modification.

## Data migration

**Table data:** `pg_dump --data-only --no-owner` against the Supabase connection string, `psql` (or `pg_restore`, depending on dump format chosen at planning time) to load into the already-schema'd Azure Postgres instance. Schema and data are migrated as two separate steps (schema replay first, from the adapted migration files; then data-only dump/restore) rather than one combined `pg_dump`, specifically so the `auth.users` FK removal is a clean, reviewable schema change rather than something patched into a dump file after the fact.

**Blob files:** a one-time script using the already-existing `StorageRepository.listAllPaginated()` to enumerate every object in the Supabase `transcripts` bucket, downloading each via the existing `SupabaseStorageRepository.download()` and re-uploading via the new `AzureBlobStorageRepository.upload()`. Reusing the existing repository methods for this (rather than calling the Supabase/Azure SDKs directly in the migration script) keeps the migration script itself thin and exercises the very code paths being shipped.

## Networking and security

Azure Database for PostgreSQL Flexible Server's firewall is configured to allow public access (since Vercel's serverless functions have non-fixed outbound IPs, ruling out IP-allowlisting as the primary control), with SSL enforced on every connection (`sslmode=require` in the connection string) and a generated high-entropy password as the actual access control — not network restriction. This is a materially different security posture than a private-network/VNet setup, and is an accepted tradeoff given the hosting stays on Vercel through this spec; revisit if/when the hosting migration (next spec) puts the app inside Azure's own network, at which point VNet integration and removing public access become possible.

## Cutover procedure

1. Provision Azure Postgres Flexible Server + Storage account (Central India / Pune).
2. Replay adapted schema (FK-dropped) onto the new Postgres instance.
3. Implement and unit-verify (via `npx tsc --noEmit`, no live calls) all eleven `AzurePostgresXRepository` classes plus `AzureBlobStorageRepository` (twelve total) against the schema from step 2, using a scratch/dev Azure instance if available, or structural review if not.
4. **Maintenance window begins.**
5. `pg_dump --data-only` from Supabase → load into Azure Postgres.
6. Run the blob-copy script (Supabase `transcripts` → Azure Blob container).
7. Edit the composition root to instantiate Azure classes; set `AZURE_POSTGRES_CONNECTION_STRING` / `AZURE_STORAGE_CONNECTION_STRING` in Vercel's env vars; deploy.
8. Verify against a checklist: row counts per table match pre-migration counts; a sample of PDF transcripts download correctly; the existing manual smoke-test routes (per the Plan A/B testing conventions already established in this repo — `npx tsc --noEmit` plus manual route hits) return expected data; the public API endpoints built in the prior plan (`/api/public/v1/data/companies/{ticker}`, `/api/public/v1/data/sectors/{sector}`, `/api/public/v1/products/sector-thesis`) return 200s with real data for the first time (previously blocked by placeholder Supabase credentials — this migration is also what unblocks that).
9. **Maintenance window ends** once the checklist passes.
10. Old `SupabaseXRepository`/`SupabaseStorageRepository` classes and their `lib/supabase/admin.ts` usages are kept, unused, for a short safety window (exact duration decided at planning time), then deleted in a follow-up cleanup once the cutover is confirmed stable in production.

## Rollback plan

Because the composition-root swap is a single, small, reviewable code change (not a spread of edits across many files), rollback is: revert that one commit, redeploy. Supabase remains untouched and fully functional throughout the maintenance window (data is copied, not moved-and-deleted), so a rollback at any point before decommissioning Supabase is a code revert, not a data recovery operation.

## Testing

No automated test runner exists in this repo (established throughout prior work). Verification is `npx tsc --noEmit` for every new repository implementation, plus the manual cutover checklist in step 8 above. There is no way to test the `AzureXRepository` implementations against a live Azure instance until one is provisioned (step 1) — planning should sequence "provision a real (or scratch/dev) Azure Postgres instance" early enough that later implementation tasks can be manually smoke-tested against it, not just type-checked.

## Non-goals

(Consolidated from Scope above, for a single reference list at planning time)
- Auth migration (Supabase Auth stays; separate future project)
- Hosting migration (Vercel stays through this spec; separate next project)
- Zero-downtime dual-write migration
- An ORM (Prisma, Drizzle) — raw `pg` only
- Infrastructure-as-code (Bicep/Terraform) for provisioning
- A permanent runtime-configurable multi-provider abstraction
- Connection pooling middleware (PgBouncer, etc.)
- VNet/private networking (requires hosting to also be in Azure — next spec's concern)

## Open questions carried into planning

- Exact Azure Postgres Flexible Server SKU/tier (compute + storage sizing) — a planning-level/cost decision, not fixed here; should default to the smallest tier that fits current data volume given this is a pre-launch app, with a documented easy upgrade path.
- Exact Blob Storage container name and access tier (Hot/Cool) — functionally equivalent to today's `transcripts` bucket either way.
- Dump/restore tool specifics: plain-text `pg_dump` + `psql`, vs. custom-format `pg_dump -Fc` + `pg_restore` — a mechanical choice with no architectural impact, deferred to planning.
- Exact duration of the "keep old Supabase classes dormant" safety window before deletion.
- Whether a scratch/dev Azure Postgres instance is provisioned separately from the production one for implementation-time testing, or whether the production instance itself is used pre-cutover (schema exists, no real data yet) — planning should decide based on actual Azure cost/complexity at provisioning time.
