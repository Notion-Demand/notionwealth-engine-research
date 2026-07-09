# Data-Access Wrapper + Public API Layer — Design

## Context

Two combined initiatives, designed together at the user's request:

1. **A provider-agnostic data-access wrapper.** The app currently has 31 files
   calling `supabaseAdmin()` directly across 11 Postgres tables and one Storage
   bucket. This is prep work for the already-decided Supabase→Azure migration
   ([[infra-cloud-provider]]) — introducing the abstraction now, while still
   safely on Supabase, so the eventual provider swap is contained to a handful
   of files instead of 31.
2. **A public API layer** for enterprise partners — PMS (Portfolio Management
   Services) firms first, AMCs (Asset Management Companies) second — exposing
   curated intelligence products without revealing prompts, pipeline internals,
   or source code. Built exclusively on top of (1).

**Explicitly unchanged:** the existing internal portal (Dashboard/Concall
Analysis, Multi-Quarter Insights, Sector Intelligence, Screener, Calendar,
Videos, Request, KPI Tracker) stays exactly as it is today. Both initiatives
here are additive.

**Not self-serve.** API keys are manually provisioned per partner — no
signup flow, no self-serve billing in this version.

## Named patterns this design follows

- **Repository Pattern** (Fowler, *PoEAA*) — the `lib/data/*` modules:
  domain-oriented objects exposing purpose-built methods (`getCachedAnalysis()`),
  never raw query-builder chains.
- **Ports and Adapters / Hexagonal Architecture** (Cockburn) — each
  `lib/data/*` module is a port; today's Supabase-backed implementation is one
  adapter behind it; an Azure implementation is a second adapter behind the
  same port, swapped without touching any caller.
- **Anti-Corruption Layer** (Evans, DDD) — the public API's response-mapping
  layer: internal shapes (`DashboardPayload`, `SectorNarrative`, etc.) are
  translated into a stable external contract, so internal pipeline changes
  never leak into partner integrations.
- **Strangler Fig** (Fowler) — the migration strategy: domain-by-domain
  replacement of direct Supabase calls behind the new interface, live system
  running throughout, never a big-bang rewrite.
- Two-layer API structure (stable resource layer + productized views on top)
  matches how established API businesses (Stripe, Twilio, Plaid-style) are
  built — validated against *Building an API Product* (Bruno Pedro, 2024).

## Part 1: Data-Access Wrapper

### Scope

**In scope:** the 11 Postgres tables and 1 Storage bucket currently accessed
via `supabaseAdmin()`:

| Module | Table(s) | Current refs |
|---|---|---|
| `lib/data/analysis.ts` | `analysis_results` | 9 |
| `lib/data/sectors.ts` | `sector_intelligence` | 4 |
| `lib/data/kpis.ts` | `kpi_snapshots` | 4 |
| `lib/data/watchlist.ts` | `user_tickers` | 3 |
| `lib/data/credits.ts` | `user_credits` | 3 |
| `lib/data/solo-analysis.ts` | `solo_analysis_cache` | 3 |
| `lib/data/insights.ts` | `insights_cache` | 3 |
| `lib/data/promoter-activity.ts` | `promoter_activity`, `promoter_activity_fetch_log` | 4 |
| `lib/data/calendar.ts` | `earnings_calendar` | 2 |
| `lib/data/concalls.ts` | `concall_links` | 2 |
| `lib/data/storage.ts` | `transcripts` Storage bucket | 10 files |

**Out of scope: Auth.** 14 files use `supabase.auth.*` (OAuth callbacks,
session/cookie handling via `@supabase/ssr`). Auth is not meaningfully
abstractable behind a generic connection-layer wrapper the way CRUD/Storage
are — OAuth flows, session/token formats, and redirect mechanics differ
fundamentally by provider (Supabase Auth vs. Azure's eventual auth product,
not yet chosen). Building a universal Auth abstraction now, before the target
is known, risks over-engineering around the wrong requirements. Auth gets its
own dedicated project when the Azure migration is actually executed.

### Structure

No generic "Postgres adapter" layer sits underneath the 11 modules — each
module talks to Supabase directly today, same as it does now, just relocated
behind named, purpose-built functions. A future Azure swap means rewriting
the *inside* of these 11 files; every one of the 31 calling files is
untouched, since they only ever call e.g. `getCachedAnalysis(ticker, qPrev,
qCurr)`, never Supabase directly. A thin generic query-builder passthrough
would just reinvent Supabase's own API against a new backend without
actually decoupling anything — deliberately not building that.

Two files already exemplify this pattern and become the template:
`lib/analysis-cache.ts` (→ `lib/data/analysis.ts`) and `lib/credits.ts` (→
`lib/data/credits.ts`).

Each new module's exact function set is determined during planning by
auditing that domain's actual current call sites — not designed in the
abstract here. As an illustration of the shape (not a commitment to these
exact signatures): `lib/data/sectors.ts` would expose something like
`getSectorPayload(sector, quarter)` / `saveSectorPayload(...)` /
`listSeededSectors()`, mirroring whatever operations the 4 existing call
sites actually perform today.

### Migration strategy

Strangler Fig, domain-by-domain — 11 independent steps, each:

1. Write the new `lib/data/X.ts` module, wrapping today's actual queries
   behind named functions (same behavior, relocated, not redesigned).
2. Update that domain's call sites to import from the new module instead of
   `supabaseAdmin()` directly.
3. Verify: `npx tsc --noEmit`, plus a manual smoke check of the affected
   screen(s)/route(s) via the dev server (no test runner exists in this
   repo).
4. Commit.

No domain's migration touches another domain's files. A failure or rollback
in one module never puts working code for the other ten at risk.

## Part 2: Public API Layer

### Scope

Consumers: enterprise partners only, manually provisioned — PMS firms first,
AMCs second. All public API code depends exclusively on `lib/data/*` — never
`supabaseAdmin()` directly, from day one (no need to wait for the full
Part 1 migration to finish; the public API is new code, written against the
wrapper from the start).

### Architecture: two-layer REST

- **Data layer** — stable resource endpoints under `app/api/public/v1/data/*`
  (e.g. `/v1/data/companies/{ticker}`, `/v1/data/sectors/{sector}`), each
  wrapping the corresponding `lib/data/*` function and mapping its result
  through a versioned external type (the anti-corruption layer — see below).
- **Products layer** — composed, opinionated endpoints under
  `app/api/public/v1/products/*`, built by calling `lib/data/*` functions
  directly (in-process function composition, not HTTP calls to the Data
  layer — same app, same runtime) and combining them into a sellable "view."
  New products are new compositions; they never require new data plumbing.
- v1 ships the *pattern* plus **one concrete example product** — a Sector
  Thesis endpoint composing sector narrative + dimension heat map + supporting
  company signals — to prove the pattern before building more. Its exact
  field-by-field response shape is a planning-level detail, not fixed here.

### Auth & entitlements

New module `lib/data/api-access.ts` and three new tables:

- `api_partners` — `id`, `name`, `created_at`.
- `api_keys` — `id`, `partner_id`, `key_hash`, `active`, `created_at`.
- `api_key_products` — `key_id`, `product_name` (join table: which
  products/resources a given key may call — not all-or-nothing access).

New `middleware.ts`, scoped to `/api/public/*` only (this app has no
middleware today — the existing internal routes are untouched). It validates
an `Authorization: Bearer <key>` header, hashes and looks up the key, checks
`active` plus entitlement for the requested product/resource, and attaches
partner context to the request.

A request for a product the key isn't entitled to gets **403**, not 404.
Since keys are manually provisioned to known, contracted partners (not
open self-serve signup), there's no meaningful "don't reveal a product
exists" concern to defend against here — a partner who's out of contract
scope should get a clear, actionable "not entitled, contact us" error, not
an ambiguous 404 that reads as a broken integration on their end.

Keys are provisioned by inserting rows directly (an internal admin script) —
no self-serve UI in v1.

### Rate limiting

New table `api_usage` (`key_id`, `window_start`, `request_count`) — same
Postgres-counter pattern already proven in `user_credits`. Checked in the
same middleware, before the request is allowed through, on a rolling window
(daily, to start).

### Versioning

`/v1/` prefix from day one, under both `/data/` and `/products/`.

### Response contract stability (the anti-corruption layer)

New versioned TypeScript types under `lib/api-contracts/v1/*.ts`, hand-defined
per public resource/product — never the internal types (`DashboardPayload`,
`SectorNarrative`, etc.) exposed directly. Mapper functions transform
internal shapes into these external types. When the internal pipeline
changes, the mapper changes; the external contract doesn't move underneath
partners. A breaking change to what's exposed gets a new `/v2/` namespace,
never a silent mutation of `/v1/`.

### What "without revealing the code" actually means here

- No prompts, extraction logic, or pipeline internals appear in any response
  — only curated outputs, enforced by the anti-corruption layer above.
- Server-side code (Next.js API routes) never reaches any client bundle —
  true by default in this framework, not something new to build.
- Per-key entitlements + rate limiting bound how much of the underlying
  dataset any single partner can pull, limiting wholesale scraping/cloning.
- A usage agreement/terms of service with each partner is a business/legal
  artifact, not a code deliverable — flagged as a dependency of going live,
  out of scope for this spec.

## Non-goals

- Self-serve signup or billing UI
- Auth-provider abstraction (stays on Supabase Auth; revisit when the Azure
  migration actually executes)
- Any change to the existing internal portal
- More than one Products-layer example (Sector Thesis) — further products
  are follow-on work using the now-established pattern
- GraphQL

## Testing

No automated test runner exists in this repo (established throughout prior
work on this project). Verification: `npx tsc --noEmit` throughout the
wrapper migration, plus manual dev-server smoke checks per domain. For the
public API layer: manual `curl`-based testing per endpoint (auth
success/failure, entitlement enforcement, rate-limit enforcement) using a
self-issued test key — there's no live partner integration to test against
yet.

## Open questions carried into planning

- Exact function signatures for each `lib/data/*` module — requires a
  careful per-file audit of current call-site behavior during planning, not
  guessed here.
- Exact field-by-field response shape for the Sector Thesis product.
- Given the combined scope (11 wrapper modules + a full new API subsystem),
  the resulting implementation plan is large. It may make sense to split it
  into two plans at the writing-plans stage — wrapper-and-migration, then
  API-layer-on-top — even though this is one spec. That decision is
  deferred to planning, not made here.
