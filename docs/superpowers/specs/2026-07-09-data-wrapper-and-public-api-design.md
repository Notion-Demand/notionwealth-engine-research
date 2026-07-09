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

**Design posture:** this revision deliberately invests in more structure than
the strict v1 feature set needs — a formal Service layer, interface-based
Repositories, and a dependency-injection composition root — because the
target is a multi-year platform (Azure migration, growing partner API
surface, eventual AI-provider diversification), not a one-off script. Each
addition is justified below against what it actually buys, not adopted for
its own sake.

## Architectural principles

These six rules are the checklist for every future addition to this system
— repositories, services, or routes — not just what's built in this spec:

1. Repositories own persistence only — no orchestration, no caching, no
   calls to other repositories.
2. Services own orchestration — composition, caching decisions, and (later)
   AI/ranking workflows.
3. Routes stay thin — parse the request, call one service or repository,
   shape the response. No business logic in a route file.
4. Provider-specific SDKs (Supabase today, Azure later) never escape the
   repository layer — nothing above it imports `@supabase/supabase-js`
   directly.
5. External API contracts never expose internal models — every public
   response passes through the anti-corruption mapping layer.
6. Infrastructure is replaceable through the composition roots
   (`lib/data/index.ts`, `lib/services/index.ts`) — swapping a provider or
   faking a dependency for a test never requires touching a caller.

## Named patterns this design follows

- **Repository Pattern** (Fowler, *PoEAA*) — domain-oriented objects exposing
  purpose-built methods (`getCachedAnalysis()`), never raw query-builder
  chains.
- **Service Layer** (Fowler, *PoEAA*) — a layer above repositories that owns
  orchestration, composition, and (later) caching; repositories stay
  persistence-only.
- **Strategy Pattern** (GoF) / **Ports and Adapters** (Cockburn) — each
  repository is defined as an interface (the port); `SupabaseXRepository` is
  today's implementation (the adapter/strategy); a future
  `AzureXRepository` is a second implementation behind the same interface,
  swapped without touching any caller.
- **Dependency Injection via a composition root** — one file
  (`lib/data/index.ts`) decides which concrete repository implementation is
  active; nothing else in the codebase imports a concrete class directly.
  Services follow the same discipline one layer up: each service takes its
  repository dependencies through its constructor rather than importing
  them inline, and a second composition root (`lib/services/index.ts`)
  wires services to the repo instances from `lib/data/index.ts`. This makes
  every service trivially testable with fake repositories whenever a test
  runner is adopted — not needed today, but the cost of building it in now
  is small and the retrofit cost later is not.
- **Anti-Corruption Layer** (Evans, DDD) — the public API's response-mapping
  layer: internal shapes (`DashboardPayload`, `SectorNarrative`, etc.) are
  translated into a stable external contract, so internal pipeline changes
  never leak into partner integrations.
- **Strangler Fig** (Fowler) — the migration strategy: domain-by-domain
  replacement of direct Supabase calls behind the new interfaces, live
  system running throughout, never a big-bang rewrite.
- Two-layer API structure (stable resource layer + productized views on top)
  matches how established API businesses (Stripe, Twilio, Plaid-style) are
  built — validated against *Building an API Product* (Bruno Pedro, 2024).

## Layering

```
app/api/**                  Route handlers (thin — parse request, call a
                             service or repository, shape the response)
        ↓
lib/services/**              Orchestration: compose multiple repositories,
                             own caching decisions, the future home for
                             LLM/ranking/embedding calls. Classes,
                             constructor-injected with their repo deps.
        ↓
lib/services/index.ts        Composition root — constructs each service
                             with repo instances pulled from lib/data/index.ts
        ↓
lib/data/** (Repositories)   Interfaces + Supabase-backed implementations.
                             Persistence only — no orchestration, no caching,
                             no cross-domain composition.
        ↓
lib/data/index.ts            Composition root — the ONLY file that
                             instantiates concrete repository classes
        ↓
Supabase (today) / Azure (later)
```

**Where each concern lives, and why:**
- **Repositories answer "how do I fetch/persist this one thing."** One
  repository per domain (`AnalysisRepository`, `SectorRepository`, etc.),
  each a TypeScript `interface` plus a `SupabaseXRepository implements`
  class. No caching, no calls to other repositories, no business logic.
- **Services answer "what does this feature need, and should I even fetch
  it."** A service can call multiple repositories, decide whether to serve
  from cache, and (later) call an LLM or ranking step. Services are
  classes that receive their repository dependencies through the
  constructor — never importing repo instances inline — so a fake
  repository can be substituted in a test without touching the service's
  own code. The public API's Products layer *is* this Service layer —
  `SectorThesisService` is what backs the `/v1/products/sector-thesis`
  endpoint.
- **Route handlers stay thin.** They parse the request, call exactly one
  service or repository function, and shape the HTTP response — no
  orchestration logic ever lives directly in a route file.

## Part 1: Repositories (`lib/data/`)

### Scope

**In scope:** the 11 Postgres tables and 1 Storage bucket currently accessed
via `supabaseAdmin()`:

| Repository | Table(s) | Current refs |
|---|---|---|
| `AnalysisRepository` | `analysis_results` | 9 |
| `SectorRepository` | `sector_intelligence` | 4 |
| `KpiRepository` | `kpi_snapshots` | 4 |
| `WatchlistRepository` | `user_tickers` | 3 |
| `CreditsRepository` | `user_credits` | 3 |
| `SoloAnalysisRepository` | `solo_analysis_cache` | 3 |
| `InsightsRepository` | `insights_cache` | 3 |
| `PromoterActivityRepository` | `promoter_activity`, `promoter_activity_fetch_log` | 4 |
| `CalendarRepository` | `earnings_calendar` | 2 |
| `ConcallRepository` | `concall_links` | 2 |
| `StorageRepository` | `transcripts` Storage bucket | 10 files |

Plus one new repository for the public API layer itself: `ApiAccessRepository`
(`api_partners`, `api_keys`, `api_key_products`, `api_usage` — see Part 2).

**Out of scope: Auth.** 14 files use `supabase.auth.*` (OAuth callbacks,
session/cookie handling via `@supabase/ssr`). Auth is not meaningfully
abstractable behind a repository interface the way CRUD/Storage are — OAuth
flows, session/token formats, and redirect mechanics differ fundamentally by
provider (Supabase Auth vs. Azure's eventual auth product, not yet chosen).
Building a universal Auth abstraction now, before the target is known, risks
over-engineering around the wrong requirements. Auth gets its own dedicated
project when the Azure migration is actually executed.

### Structure

Each domain gets one file, `lib/data/<domain>.ts`, containing:

```ts
export interface AnalysisRepository {
  getCachedAnalysis(ticker: string, qPrev: string, qCurr: string): Promise<DashboardPayload | null>;
  saveAnalysis(userId: string | null, ticker: string, qPrev: string, qCurr: string, payload: DashboardPayload): Promise<string>;
}

export class SupabaseAnalysisRepository implements AnalysisRepository {
  async getCachedAnalysis(ticker, qPrev, qCurr) { /* today's supabaseAdmin() query, unchanged behavior */ }
  async saveAnalysis(userId, ticker, qPrev, qCurr, payload) { /* today's supabaseAdmin() query, unchanged behavior */ }
}
```

Interface and Supabase implementation live in the same file — not split
across separate `types.ts`/`supabase.ts` files. A future `AzureAnalysisRepository
implements AnalysisRepository` is a new class added to the same file when the
Azure migration actually happens; it is **not built now** — building a
placeholder Azure implementation today, before the target Postgres client is
even chosen, would be pure speculation with no code to verify it against.
The interface is what "prepares" for it; the second implementation is
future work with a clear, well-defined shape once that day comes.

**Composition root** — `lib/data/index.ts`:

```ts
import { SupabaseAnalysisRepository } from "./analysis";
import { SupabaseSectorRepository } from "./sectors";
// ...one import + one instantiation per domain

export const analysisRepo = new SupabaseAnalysisRepository();
export const sectorRepo = new SupabaseSectorRepository();
// ...
```

Every caller — the existing 31 files being migrated, the new Services layer,
route handlers — imports instances from `lib/data/index.ts` (e.g.
`import { analysisRepo } from "@/lib/data"`), never a concrete class
directly. The Azure cutover, when it happens, is: implement the new classes,
then change 11 lines in this one file. No other file changes.

Two existing files already exemplify the target shape and become the
template: `lib/analysis-cache.ts` (→ `AnalysisRepository`) and
`lib/credits.ts` (→ `CreditsRepository`).

Each repository's exact method set is determined during planning by
auditing that domain's actual current call sites — not designed in the
abstract here.

### Migration strategy

Strangler Fig, domain-by-domain — 11 independent steps, each:

1. Write the new `lib/data/<domain>.ts` — interface, `SupabaseXRepository`
   class wrapping today's actual queries (same behavior, relocated, not
   redesigned), and its entry in `lib/data/index.ts`.
2. Update that domain's call sites to import the repo instance from
   `lib/data/index.ts` instead of calling `supabaseAdmin()` directly.
3. Verify: `npx tsc --noEmit`, plus a manual smoke check of the affected
   screen(s)/route(s) via the dev server (no test runner exists in this
   repo).
4. Commit.

No domain's migration touches another domain's files. A failure or rollback
in one repository never puts working code for the other ten at risk.

## Part 2: Services and the Public API Layer

### Scope

Consumers: enterprise partners only, manually provisioned — PMS firms first,
AMCs second. All public API code depends exclusively on `lib/data/index.ts`
repository instances — never `supabaseAdmin()` directly, from day one (no
need to wait for the full Part 1 migration to finish; the public API is new
code, written against the repositories from the start).

### Architecture: two-layer REST, with Services as the second layer

- **Data layer** — stable resource endpoints under `app/api/public/v1/data/*`
  (e.g. `/v1/data/companies/{ticker}`, `/v1/data/sectors/{sector}`), each a
  thin route handler calling one repository method and mapping the result
  through a versioned external type (the anti-corruption layer — see below).
- **Products layer** — endpoints under `app/api/public/v1/products/*`, each a
  thin route handler calling one **Service**. A service composes multiple
  repositories in-process (direct method calls, not HTTP calls to the Data
  layer — same app, same runtime), and is also where caching and any future
  LLM/ranking/embedding steps live. New products are new services; they
  never require new repository plumbing.
- v1 ships the *pattern* plus **one concrete example product**:

  ```ts
  // lib/services/sectorThesisService.ts
  export class SectorThesisService {
    constructor(private deps: {
      sectorRepo: SectorRepository;
      kpiRepo: KpiRepository;
      analysisRepo: AnalysisRepository;
    }) {}

    async getSectorThesis(sector: string): Promise<SectorThesisResult> {
      // compose deps.sectorRepo / deps.kpiRepo / deps.analysisRepo
    }
  }
  ```

  ```ts
  // lib/services/index.ts — composition root for services
  import { sectorRepo, kpiRepo, analysisRepo } from "@/lib/data";
  import { SectorThesisService } from "./sectorThesisService";

  export const sectorThesisService = new SectorThesisService({ sectorRepo, kpiRepo, analysisRepo });
  ```

  The route handler imports `sectorThesisService` from `lib/services/index.ts`
  — it never constructs a service itself, mirroring how callers consume
  repositories from `lib/data/index.ts`. Its exact field-by-field response
  shape is a planning-level detail, not fixed here.

**Caching rule:** if/when a product needs caching, it is added inside that
product's service function, never inside a repository. A repository never
knows or cares whether its result came from cache — that decision belongs
one layer up, where the *feature's* freshness/cost tradeoff is understood.
No caching is implemented in v1; this is the rule to follow whenever it's
added.

### Auth & entitlements

New repository `ApiAccessRepository` (`lib/data/apiAccess.ts`) and three new
tables:

- `api_partners` — `id`, `name`, `created_at`.
- `api_keys` — `id`, `partner_id`, `key_hash`, `active`, `created_at`.
- `api_key_products` — `key_id`, `product_name` (join table: which
  products/resources a given key may call — not all-or-nothing access).

New `middleware.ts`, scoped to `/api/public/*` only (this app has no
middleware today — the existing internal routes are untouched). It validates
an `Authorization: Bearer <key>` header, hashes and looks up the key via
`ApiAccessRepository`, checks `active` plus entitlement for the requested
product/resource, and attaches partner context to the request.

A request for a product the key isn't entitled to gets **403**, not 404.
Since keys are manually provisioned to known, contracted partners (not open
self-serve signup), there's no meaningful "don't reveal a product exists"
concern to defend against here — a partner who's out of contract scope
should get a clear, actionable "not entitled, contact us" error, not an
ambiguous 404 that reads as a broken integration on their end.

Keys are provisioned by inserting rows directly (an internal admin script) —
no self-serve UI in v1.

### Rate limiting

`api_usage` table (`key_id`, `window_start`, `request_count`), accessed via
`ApiAccessRepository` — same Postgres-counter pattern already proven in
`user_credits`. Checked in the same middleware, before the request is
allowed through, on a rolling window (daily, to start).

### Error boundaries

Scoped to the public API/Services layer only — not retrofitted across all
11 internal repositories, which have run fine on plain `null`/`Error`
returns for the whole life of this app and show no evidence of needing
more. External partners do need clear, distinguishable failures, so
`lib/services/errors.ts` defines a small set of domain errors:
`NotFoundError`, `UnauthorizedError`, `EntitlementError`,
`QuotaExceededError`. Services and the auth middleware throw these; route
handlers under `app/api/public/*` are the only place that translates a
domain error into an HTTP status — a provider-specific exception
(a Postgres error, a Supabase client error) never reaches a route handler
or a partner response directly.

### Observability

Basic structured request logging in the `/api/public/*` middleware: request
ID, partner ID, key ID, endpoint, HTTP status, total latency — logged for
every request from day one. This is cheap and immediately useful for your
own manual testing before any partner is live. Per-layer latency breakdown
(DB time vs. service time), cache hit/miss, and AI latency are **not**
built now — half of what they'd measure doesn't exist yet (no caching, and
the one example product may not even call an LLM). Add those metrics when
a layer exists that's actually worth measuring, not preemptively.

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

## Future extension (named, not built): AI-provider abstraction

The same interface + pluggable-implementation + composition-root pattern
applies directly to model providers once that becomes a real need — an
`LLMService` behind `AzureOpenAIProvider` / `OpenAIProvider` /
`AnthropicProvider` / `GeminiProvider`, and similarly an `EmbeddingService`
if/when embeddings enter the pipeline. Today's pipeline
(`lib/pipeline.ts`, `lib/sector-narrative.ts`, `lib/company-memory.ts`) calls
Gemini directly, and nothing here changes that. This is flagged so the
pattern's next natural application is on record, not because it's being
built now — doing so today would be solving a problem (multi-provider LLM
routing) nobody has yet.

## Future extension (named, not built): transactional multi-step writes

Some future service will need atomic multi-step writes — e.g. save an
analysis, update credits, write a usage record as one unit. Repositories in
this design don't yet support a shared transaction context, and none of the
v1 work requires one. When a service needs this, the repository interfaces
affected should grow a transaction-aware variant (e.g. accepting an
optional transaction handle) rather than services attempting multi-step
consistency themselves by calling repositories serially. Documented now so
it's a deliberate extension later, not a scramble.

## Non-goals

- Self-serve signup or billing UI
- Auth-provider abstraction (stays on Supabase Auth; revisit when the Azure
  migration actually executes)
- Building `AzureXRepository` implementations now — the interfaces are what
  ship; concrete Azure classes are written when that migration executes
- AI-provider abstraction (`LLMService`/`EmbeddingService`) — named above as
  a future extension of this same pattern, not built here
- Transaction-aware repository methods — named above as a future
  extension, not built here; no v1 workflow needs multi-step atomic writes
- Domain-error taxonomy across the 11 internal repositories — scoped to the
  public API/Services layer only (see Error boundaries)
- Per-layer observability (DB duration, cache hit/miss, AI latency) —
  basic request-level logging ships now; the rest waits for a layer worth
  measuring (see Observability)
- Any change to the existing internal portal
- More than one Products/Services-layer example (Sector Thesis) — further
  products are follow-on work using the now-established pattern
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

- Exact method signatures for each repository interface — requires a
  careful per-file audit of current call-site behavior during planning, not
  guessed here.
- Exact field-by-field response shape for the Sector Thesis product.
- Given the combined scope (11 repositories + composition root + a full new
  API/Services subsystem), the resulting implementation plan is large. It
  may make sense to split it into two plans at the writing-plans stage —
  repositories-and-migration, then services-and-API-layer-on-top — even
  though this is one spec. That decision is deferred to planning, not made
  here.
