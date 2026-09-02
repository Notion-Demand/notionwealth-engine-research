# 08 — Backend Architecture: Reverse-Engineering the Quantalyze API Layer

Scope: the live production Next.js 14 backend — `app/api/**` (24 route handlers), `lib/services/*.ts`,
`lib/repositories/*.ts`, `lib/public-api/product-routes.ts`, `auth.ts`, `middleware.ts`, `lib/auth.ts`,
`lib/api.ts`, `lib/credits.ts`. Deployed as a Docker container (`Dockerfile`, `next.config.mjs`
`output: "standalone"`) to Azure App Service, not Vercel, despite `vercel.json` and `maxDuration`
exports still being present (a Vercel-era config vestige — see Background Tasks section).

An archived FastAPI prototype lives at `finance-agent/server.py` / `finance-agent/api/*.py`
("Production FastAPI server for NotionWealth Intelligence Engine", mounted under `/api/v1`). It is
**NOT** part of the live product — the live product is 100% Next.js route handlers — and is not
analyzed further here except where it explains naming fossils (e.g. `package.json`'s `"name":
"notionwealth-frontend"`, `lib/api.ts`'s doc-comment "Next.js API route client helpers", and
`.env.local.example`'s dead `NEXT_PUBLIC_API_URL` var, which described pointing the frontend at
this FastAPI server before it was retired in favor of same-origin Next.js routes).

---

## 1. API Design: Is This REST?

**PARTIALLY IMPLEMENTED — REST-flavored, not REST.**

Route naming is resource-shaped in the public surface but action/RPC-shaped in the internal
surface:

- `app/api/public/v1/data/companies/[ticker]/route.ts` → `GET /api/public/v1/data/companies/RELIANCE` —
  genuinely RESTful: nouns, path params for resource identity, `GET` for a read.
- `app/api/public/v1/data/sectors/[sector]/route.ts` → same pattern.
- `app/api/public/v1/products/sector-thesis/route.ts` — a "product" endpoint keyed by a `?sector=`
  query param rather than a path segment; borderline REST (a computed/derived resource, arguably
  fine as a query-filtered collection).

The internal `/api/v1/*` surface is largely RPC-over-HTTP:
- `POST /api/v1/analyze` — triggers a multi-minute AI pipeline (verb-like use of POST on a
  collection-less path; not "create an analysis resource", more "run the analyze operation").
- `POST /api/v1/seed-analysis`, `POST /api/v1/seed-transcripts`, `POST /api/v1/sectors/seed`,
  `POST /api/v1/calendar/seed` — explicitly named as verbs ("seed"), admin/batch jobs shaped as
  HTTP endpoints.
- `DELETE /api/v1/kpis` (`app/api/v1/kpis/route.ts:110-118`) deletes **the entire KPI cache**, not
  one resource — a collection-wide destructive verb mapped onto `DELETE` with no ID, which is a
  REST anti-pattern (idempotent by HTTP semantics, but semantically "wipe everything" hiding behind
  a bare DELETE with no request body / confirmation).

HTTP method usage is otherwise conventional: `GET` for reads (`available`, `screener`, `sectors`,
`divergence`, `calendar`, `credits`, `kpis`, `analyze/history`, `transcript/download`), `POST` for
writes/expensive-compute/mutations (`analyze`, `analyze/solo`, `insights`, `request`, `user-tickers`
POST), `DELETE` for removal (`user-tickers` DELETE, `kpis` DELETE). No `PUT`/`PATCH` anywhere in the
24 handlers — updates go through `POST` (e.g. adding a watchlist ticker) or upsert-shaped repository
methods, so there's no create-vs-replace distinction at the HTTP layer.

**Status codes actually returned** (grepped from every `NextResponse.json(..., { status: N })` /
`status:` literal across `app/api`):

| Status | Count | Meaning in this codebase |
|---|---|---|
| 500 | 12 | Generic "internal error" catch-all |
| 400 | 11 | Malformed input (bad JSON, missing required query param) |
| 401 | 10 | `getCurrentUser()` returned null |
| 422 | 8 | Semantically invalid body (missing/invalid required fields) — used instead of 400 in several `POST` handlers, e.g. `app/api/v1/analyze/route.ts:24-29` |
| 429 | 3 | Credit-quota exceeded (`lib/credits.ts` `checkAndDeduct`) and, in the public API, daily API-key quota exceeded (`middleware.ts:60`) |
| 404 | 3 | Domain "not found" (`NotFoundError`, transcript-not-found) |
| 200 | 2 explicit | (most 200s are implicit via `NextResponse.json(data)` with no status arg) |

400 vs 422 usage is not principled — some routes use 400 for "missing required field" (e.g.
`app/api/v1/screener` has none, but `user-tickers/route.ts:43` uses 400 for invalid ticker) while
others use 422 for the same class of error (`app/api/v1/analyze/route.ts:24-29`,
`app/api/v1/insights/route.ts:22`, `app/api/v1/analyze/solo/route.ts:22`). This is a **per-author
convention, not an enforced contract** — there is no shared `badRequest()`/`validationError()`
helper; every route hand-writes its own `NextResponse.json({...}, { status: N })`.

**Response shape consistency: NOT IMPLEMENTED as a contract.** Error bodies vary by route: some use
`{ detail: string }` (all of `analyze`, `analyze/solo`, `insights`, `transcript/download` —
apparently modeled on FastAPI's `HTTPException(detail=...)` convention, a leftover from the FastAPI
prototype), others use `{ error: string }` (`user-tickers`, `screener`, the public-API v1 routes via
`lib/services/errors.ts`), and `kpis` uses `{ detail: string }` for some errors but a bespoke
`_debug_cache` field bolted onto success responses (`app/api/v1/kpis/route.ts:67-69`). There is no
shared envelope type (no `{ data, error, meta }` wrapper) anywhere in `app/api`.

---

## 2. API Versioning

**NOT IMPLEMENTED as real versioning — `v1` is a hardcoded namespace prefix, not a negotiated or
evolvable version.**

Evidence:
- No `v2` directory anywhere under `app/api`.
- No `Accept`/`API-Version` header negotiation in any route or in `middleware.ts`.
- No version field in any request or response body.
- The literal string `"v1"` is baked into two independent path prefixes (`app/api/v1/*` and
  `app/api/public/v1/*`) and into the DTO module path `lib/api-contracts/v1/*.ts` and function names
  (`toSectorThesisResponseV1`, `toCompanyResponseV1`, `toSectorResponseV1`) — i.e., "v1" is used as
  a *namespace convention for a future rename*, not as a live version selector. If a `v2` were
  introduced today it would require duplicating every route file under a new `app/api/v2/` tree —
  there is no shared handler that branches on version.

**Two genuinely distinct API surfaces exist, however, and conflating them would be the wrong
takeaway:**

### `/api/v1/*` — internal, frontend-only API
- 21 of the 24 route handlers.
- Authenticated (where authenticated at all — see §9) via the NextAuth **session cookie** through
  `getCurrentUser()` (`lib/auth.ts`).
- Consumed exclusively by the Next.js frontend via `lib/api.ts`, which is explicit about this:
  `lib/api.ts:1-6` — *"All requests are same-origin, so the Auth.js session cookie is sent
  automatically — no manual token extraction or Authorization header needed."*
- No product/entitlement/quota concept beyond the per-user monthly credit balance
  (`lib/credits.ts`).
- Response shapes are whatever each route's internal domain objects happen to serialize to
  (`DashboardPayload`, raw repository rows) — not passed through `lib/api-contracts`.

### `/api/public/v1/*` — external, partner-facing **product** API
- 3 route handlers: `data/companies/[ticker]`, `data/sectors/[sector]`, `products/sector-thesis`.
- A completely separate authentication mechanism: **bearer API keys**, hashed and checked in
  `middleware.ts` against the `api_keys` table (via `apiAccessRepo`), *before* the request ever
  reaches the route handler.
- Has real API-product semantics that `/api/v1` lacks entirely:
  - **Entitlements**: `lib/public-api/product-routes.ts` maps each URL pattern to a named product
    (`"data:companies"`, `"data:sectors"`, `"products:sector-thesis"`), and `middleware.ts:45-49`
    rejects a key that isn't entitled to the product the path maps to, with a `403` and a
    human-readable message (`` `key is not entitled to '${product}' — contact us to add this
    product` ``).
  - **Per-key daily quota**: `middleware.ts:57-63`, backed by `apiAccessRepo.getUsageToday` /
    `incrementUsage` against an `api_usage` table keyed by `(key_id, window_start)`.
  - **Partner attribution**: every request is tagged with `x-api-key-id` / `x-api-partner-id`
    headers forwarded to the route handler (`middleware.ts:67-70`), though none of the 3 public
    route handlers actually read these headers today — they're wired for future per-partner
    logic/billing but currently unused downstream.
  - **Structured, versioned response DTOs**: `lib/api-contracts/v1/*.ts` (`toCompanyResponseV1`,
    `toSectorResponseV1`, `toSectorThesisResponseV1`) are used *only* by these 3 routes — every
    response includes a `generatedAt` timestamp and a stable, camelCased, hand-declared shape
    decoupled from the internal `Analysis`/`Sector` repository types.
  - **A real domain-error → HTTP mapping** via `lib/services/errors.ts` (see §4).

**Conclusion for the interview narrative:** this is a legitimate architectural distinction — an
internal BFF-style API for the SPA vs. a metered external product API with API keys, entitlements
and quotas — but "v1" itself signals *namespace*, not *version*: there is no mechanism in this
codebase that would let `/api/public/v1/products/sector-thesis` and a hypothetical
`/api/public/v2/products/sector-thesis` coexist, negotiate, or deprecate gracefully. It's the
directory convention teams adopt "in case we need to version later," not versioning.

---

## 3. Route Organization — the "Controller" Layer

**PARTIALLY IMPLEMENTED as thin controllers — inconsistent by call site.** Next.js route handlers
are unambiguously the controller layer (no separate Express/Fastify tier), but how much logic lives
inline varies enormously by route, with no architectural rule enforcing "routes stay thin."

**Thin, well-delegated example** — `app/api/public/v1/data/sectors/[sector]/route.ts` (22 lines
total): parse path param → call `sectorRepo.getBySector()` → map through `toSectorResponseV1()` →
catch via `isDomainError()`. All business logic (finding the sector, deciding what "not found"
means) lives in the repository + a shared domain-error type. This is the pattern the public API
consistently follows (also true of `products/sector-thesis/route.ts`, which delegates to
`sectorThesisService.getSectorThesis()`, a real service-layer method — see §4).

**Fat, everything-inline example** — `app/api/v1/screener/route.ts` (285 lines): the route file
itself *is* the business logic. It defines `MetricDelta`/`SectionalInsight`/`ScreenerSignal` types
inline (duplicating shapes that already exist in `lib/pipeline.ts`), implements a
`detectDisclosureInflation()` regex heuristic (`screener/route.ts:65-68`), a `computeConfidence()`
scoring function with hand-tuned weights (`screener/route.ts:76-118`), a custom fiscal-quarter
sort-key function `qIdx()` (`screener/route.ts:122-129`), and a two-pass "Nifty 50 first, then
Nifty 200 overflow" merge algorithm — none of it extracted into `lib/services`. The `GET` handler
(`screener/route.ts:207-284`) directly orchestrates repository calls, builds the response, and does
the ranking sort itself. This is a controller acting as service, repository client, and view model
builder simultaneously.

**Also fat**: `app/api/v1/analyze/route.ts` (127 lines) inlines the streaming/NDJSON protocol, the
cache-hit short-circuit, the credit check ordering, *and* a client-side-looking timeout race
(`PIPELINE_TIMEOUT_MS`, see §14) directly in the route body — though the actual AI orchestration is
correctly delegated to `runPipeline()` in `lib/pipeline.ts`.

**Pattern**: the **public API surface** (3 routes) consistently delegates to
`lib/services`/`lib/repositories` and stays thin. The **internal `/api/v1` surface** (21 routes)
delegates the *AI pipeline* work to `lib/pipeline.ts` / `lib/*-pipeline.ts` / `lib/kpi-extractor.ts`
(so the actually-expensive, actually-reused logic does live outside the route file) but leaves
response-shaping, scoring/ranking business logic, and ad hoc validation inline in the route. There
is no `lib/pipeline.ts`-equivalent central place for "screener ranking logic" or "confidence
scoring" — it lives only in the route file and nowhere else, meaning it can't be unit tested without
importing a Next.js route module.

---

## 4. Service Layer

**PARTIALLY IMPLEMENTED — real for one bounded case, absent everywhere else.**

`lib/services/` contains exactly 3 files: `errors.ts`, `index.ts`, `sectorThesisService.ts`. This
is a genuine service layer *for the public sector-thesis product*, not a general-purpose service
layer for the app:

- `lib/services/sectorThesisService.ts` — `SectorThesisService` is a real class with constructor
  **dependency injection** of repository interfaces (`{ sectorRepo, kpiRepo, analysisRepo }`,
  `sectorThesisService.ts:37-43`), containing actual business logic: picking each sector's top-5
  companies by weight, batch-fetching KPI + analysis data for just those companies (with an
  explicit comment justifying the batching as a performance choice — `sectorThesisService.ts:65-66`
  *"Two batched calls cover every top company at once, instead of one KPI call and one analysis
  call per company"*), and deriving a `managementConfidence` label from `evasivenessScore`
  thresholds (`sectorThesisService.ts:101-102`).
- `lib/services/index.ts` wires the single concrete instance: `export const sectorThesisService =
  new SectorThesisService({ sectorRepo, kpiRepo, analysisRepo });` — manual, file-level "composition
  root," not a DI container (see §7).
- `lib/services/errors.ts` — a real, small **error class hierarchy**:
  ```ts
  export class NotFoundError extends Error { readonly status = 404; ... }
  export class UnauthorizedError extends Error { readonly status = 401; ... }
  export class EntitlementError extends Error { readonly status = 403; ... }
  export class QuotaExceededError extends Error { readonly status = 429; ... }
  export function isDomainError(err: unknown): err is NotFoundError | UnauthorizedError |
    EntitlementError | QuotaExceededError { ... }
  ```
  Each error class self-declares its HTTP status. Route handlers pattern-match with
  `isDomainError()` and respond `{ error: err.message }, { status: err.status }` — a clean,
  extensible error→HTTP mapping (`app/api/public/v1/products/sector-thesis/route.ts:17-21`,
  `app/api/public/v1/data/companies/[ticker]/route.ts:17-21`,
  `app/api/public/v1/data/sectors/[sector]/route.ts:15-19`).

**This hierarchy is used in exactly 3 files (the public API routes) and nowhere in the 21
`/api/v1` routes.** `UnauthorizedError` and `EntitlementError` are *defined* but never *thrown*
anywhere in the codebase (`grep` for `throw new UnauthorizedError` / `throw new EntitlementError`
returns zero hits) — the internal API's 401s are all hand-written
`NextResponse.json({ detail: "Unauthorized" }, { status: 401 })` inline in each route rather than
going through this hierarchy, and there's no entitlement concept at all on the internal side. So the
error hierarchy is real but only half-adopted — a pattern introduced for the public-API rebuild that
never got backported to the older internal routes.

Everything else that could be "service layer" logic — credit checking (`lib/credits.ts`, a set of
free functions, not a class), the confidence-scoring in `screener/route.ts`, the KPI extraction
orchestration (`lib/kpi-extractor.ts`) — is either a flat function module or lives directly in route
files. **There is no general `AnalysisService`, `ScreenerService`, `CreditsService`, etc.** —
`sectorThesisService` is the one deliberate exception, not the rule.

---

## 5. Domain Models / DTOs — `lib/api-contracts/v1/*.ts`

**IMPLEMENTED, but scoped only to the public API.** Three files: `company.ts`, `sector.ts`,
`sectorThesis.ts`. Each defines a `*ResponseV1` interface plus a pure mapping function
(`toCompanyResponseV1`, `toSectorResponseV1`, `toSectorThesisResponseV1`) that takes an internal
domain type (`Analysis`, `Sector`, `SectorThesisResult`) and a `generatedAt` timestamp and returns
the wire DTO — e.g. `lib/api-contracts/v1/company.ts:20-39` converts `Analysis.keyMetrics`
(snake_case internal field names inherited from the Gemini JSON schema: `revenue_growth`,
`ebitda_margin`, `pat_growth`) into camelCase (`revenueGrowth`, `ebitdaMargin`, `patGrowth`) DTO
fields — a genuine boundary translation, not a passthrough.

These are used consistently **at response-shaping time** in exactly the 3 public-API routes that
import them (confirmed by `grep -rl "api-contracts"` → only those 3 route files plus `sectorThesis.ts`
itself). They are **not used for request parsing** anywhere — none of the 3 public routes validates
its inbound path params against a contract type; `params.ticker` / `params.sector` are used as raw
strings straight off the URL.

The internal `/api/v1` API has **no equivalent contracts module**. Its "domain model" is whatever
shape `lib/pipeline.ts`'s `DashboardPayload` happens to have (a `snake_case`, wire-shaped type
documented in `lib/repositories/analysis.ts:58-68` as deliberately *not* being renamed to camelCase,
specifically because the existing frontend depends on the exact field names). Internal routes return
this type directly, unmapped, in both the streamed and cached-hit code paths
(`toDashboardPayload(cached)` / raw `payload` from `runPipeline()` in `analyze/route.ts:60,108`).

---

## 6. Repository / Database Access Layer

**IMPLEMENTED — a real, consistently-applied repository pattern**, with one important cross-cutting
migration story layered on top.

**Pattern**: every file in `lib/repositories/*.ts` (11 files) follows the same shape:
1. An exported TypeScript `interface FooRepository { ... }` describing the contract.
2. One or more concrete classes implementing it.
3. `lib/repositories/index.ts` is the single composition point that instantiates and exports the
   concrete singletons actually used app-wide (`export const analysisRepo = new
   PostgresAnalysisRepository(); ...`).

Method naming is consistent (`get*` for single-item lookups, `list*` for collections, `save*`/
`upsert*`/`create*` for writes, `delete*` for removal) — confirmed across all 11 files
(`getCachedAnalysis`, `getLatestByTicker`, `listAllByTickers`, `listByTickersAndQuarterPair`,
`saveAnalysis`; `getKeyByHash`, `getUsageToday`, `incrementUsage`, `createKey`, `createPartner`,
`grantEntitlement`; `getOrCreateStatus`, `setUsed`; etc.). This is a real, deliberate convention, not
ad hoc per-file naming.

**What's inconsistent**: the *error-signaling* convention differs by file. Some methods return
Go-style `{ data, error: string | null }` tuples that callers must check (`kpis.ts`'s `listAll()` →
`{ snapshots, error }`; `watchlist.ts`'s `list()` → `{ tickers, error }`; `analysis.ts`'s
`listAllByTickers()` → `{ records, error }`), while others simply **throw** on failure
(`storage.ts`'s every method: `if (error) throw new Error(...)`) and others **swallow errors and
return null/empty** (`analysis.ts`'s `getCachedAnalysis` returns `null` on JSON-parse failure,
`saveAnalysis` catches internally and returns the string `"unknown"` — `analysis.ts:183-186`,
`308-324` — silently discarding the actual DB error from the caller's perspective beyond a
`console.error`). A caller cannot know, without reading the implementation, whether a given
repository method will throw, return an error tuple, or return a silent empty/null on failure — this
is a real per-file inconsistency, not a designed convention.

**The migration story**: nearly every repository file (`analysis.ts`, `sectors.ts`, `kpis.ts`,
`watchlist.ts`, `credits.ts`, `soloAnalysis.ts`, `insights.ts`, `promoterActivity.ts`, `calendar.ts`,
`concalls.ts`, `apiAccess.ts`) defines **two full implementations** of its interface: a
`Supabase*Repository` (using `supabaseAdmin()` from `lib/supabase/admin.ts`) and a
`Postgres*Repository` (using `query()` from `lib/postgres/client.ts`, raw parameterized SQL against
`pg.Pool`). Only the `Postgres*` classes are actually wired up — `lib/repositories/index.ts`
imports and instantiates exclusively `Postgres*Repository` classes. The `Supabase*Repository`
classes are 100% dead code in the live app (confirmed: nothing outside each file's own module
imports them) — a frozen snapshot of a completed Supabase→Azure-Postgres migration, left in place
(likely for reference/rollback) rather than deleted. `storage.ts` is the exception where **both**
paths *could* still matter operationally: `SupabaseStorageRepository` (Supabase Storage buckets) is
also dead per `index.ts` wiring `AzureBlobStorageRepository` — but transcripts are binary PDFs, so
this is a storage-backend migration (Supabase Storage → Azure Blob), same story, different resource
type. One genuine oddity: `apiAccess.ts` — the file backing the *newer* public-API-key system —
**still imports `supabaseAdmin`** at the top even though its wired implementation
(`PostgresApiAccessRepository`) never uses it; only the dead `SupabaseApiAccessRepository` class in
the same file does. Minor, harmless, but confirms the dead code wasn't even pruned import-by-import.

**Traced example 1 — `PostgresAnalysisRepository.getCachedAnalysis`**
(`lib/repositories/analysis.ts:288-306`): Supabase client call →
```ts
const rows = await query<{ payload: unknown }>(
  `SELECT payload FROM analysis_results
   WHERE company_ticker = $1 AND q_prev = $2 AND q_curr = $3
   ORDER BY created_at DESC LIMIT 1`,
  [ticker.toUpperCase(), qPrev, qCurr]
);
```
→ raw `pg` row (`payload` is JSONB, auto-parsed into a JS object by `pg`, per the doc-comment in
`lib/postgres/client.ts:53-55`) → `toEntity()` (private helper, `analysis.ts:79-99`) maps the
snake_case stored `DashboardPayload` shape to the camelCase `Analysis` domain entity → typed
`Promise<Analysis | null>` returned to the route. Two extra business rules live in this one
method: `strict` mode additionally requires `raw.earnings_delta` to be an array (treats
older/partial cached rows as cache-misses), and an empty `insights` array is also treated as a
miss — cache *validity*, not just cache *presence*, is enforced at the repository layer.

**Traced example 2 — `PostgresApiAccessRepository.incrementUsage`**
(`lib/repositories/apiAccess.ts:137-144`): a single atomic upsert —
```sql
INSERT INTO api_usage (key_id, window_start, request_count)
VALUES ($1, $2, 1)
ON CONFLICT (key_id, window_start) DO UPDATE SET request_count = api_usage.request_count + 1
```
— explicitly documented as "Atomic, unlike the Supabase version's non-atomic read-then-write" (the
`SupabaseApiAccessRepository.incrementUsage` at `apiAccess.ts:61-69` does a `getUsageToday()` read
then a separate `upsert()` write — a race condition under concurrent requests from the same key,
which `middleware.ts:51-56` itself calls out in a comment: *"Best-effort rate limit... concurrent
requests from the same key within the same second can both read the same count and both pass...
Acceptable at v1's scale."*). This is a rare, well-documented example of the Postgres migration
being used to *fix* a known correctness bug, not just relocate the same logic.

---

## 7. Dependency Injection

**NOT IMPLEMENTED as a DI container/framework — module-level singletons everywhere, with one
localized exception (constructor-injected `SectorThesisService`).**

- `lib/supabase/admin.ts`: lazy module-level singleton — `let _client: SupabaseClient | null =
  null; export function supabaseAdmin() { if (!_client) { _client = createClient(...) } return
  _client; }`. Every repository file that needs Supabase imports this function directly
  (`import { supabaseAdmin } from "@/lib/supabase/admin"`) — confirmed 13 files import it, ~40 call
  sites (`grep -rn "supabaseAdmin"` across `lib/repositories/*.ts`), all dead in production per §6
  but structurally identical to the live pattern.
- `lib/postgres/client.ts`: same lazy-singleton shape for the `pg.Pool` (`pgPool()`), imported
  directly by every `Postgres*Repository` class via `import { query } from "@/lib/postgres/client"`.
- **Gemini client is *not* even a singleton** — `getGenAI()` is redefined nearly identically in 5
  separate files (`lib/pipeline.ts:182-186`, `lib/insights-pipeline.ts:75-78` (approx),
  `lib/solo-pipeline.ts`, `lib/sector-narrative.ts:118`, `lib/kpi-extractor.ts:368`), each
  constructing a **fresh `new GoogleGenerativeAI(apiKey)` instance on every call** rather than
  caching it module-level like the Supabase/Postgres clients do. Copy-pasted, not shared — a small
  but real signal of duplicated infra code across the 5 pipeline files rather than one shared
  `lib/gemini.ts`.
- The one place resembling real DI: `lib/services/sectorThesisService.ts`'s `SectorThesisService`
  takes its 3 repository dependencies through its constructor (`constructor(private deps: {
  sectorRepo, kpiRepo, analysisRepo })`), and `lib/services/index.ts` is a manual "composition
  root" wiring the concrete repos into it. This makes the service unit-testable with fake
  repositories — but it is hand-rolled, one-off wiring, not a container (no `tsyringe`, `inversify`,
  or Next.js-idiomatic request-scoped DI anywhere in `package.json`).

**Risk**: because every route/service imports concrete singletons directly, there's no way to swap
implementations per-request or per-test without module mocking — consistent with there being no
visible test suite in the reviewed tree (no `*.test.ts`/`*.spec.ts` files under `app` or `lib`).

---

## 8. Configuration / Environment Variables

**NOT IMPLEMENTED as a centralized config module — pure scattered `process.env.X` access, and the
`.env.local.example` documentation is materially out of date relative to the live code.**

Variables actually read via `process.env.*` in live backend code (`app/**`, `lib/**`, `auth.ts`,
`middleware.ts`):

| Variable | Read at |
|---|---|
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` / `_ISSUER` | `auth.ts:8-10` (NextAuth Entra ID provider config) |
| `GOOGLE_API_KEY` | `lib/pipeline.ts`, `lib/insights-pipeline.ts`, `lib/solo-pipeline.ts`, `lib/sector-narrative.ts`, `lib/kpi-extractor.ts` (each file's own `getGenAI()`) |
| `YOUTUBE_API_KEY` | referenced in the concall-lookup path (`app/api/v1/concall` / `lib/promoter-activity-fetcher.ts`-adjacent) |
| `POSTGRES_CONNECTION_STRING` | `lib/postgres/client.ts:9` (`pgPool()`) |
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase/admin.ts:14` (still required even though Supabase DB usage is dead — Supabase Storage/legacy paths still reference it) |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase/admin.ts:15` |
| `AZURE_STORAGE_CONNECTION_STRING` | `lib/repositories/storage.ts:76` (`blobServiceClient()`) |
| `AZURE_STORAGE_CONTAINER` | `lib/repositories/storage.ts:71` (defaults to `"transcripts"` if unset) |
| `NEXT_PUBLIC_API_URL` | `lib/api.ts:8` (defaults to `/api/v1`; vestige of the FastAPI-backend era, effectively unused now that everything is same-origin) |

There is **no `lib/config.ts` or equivalent** — every module reaches into `process.env` directly, at
the point of use, with ad hoc `!` non-null assertions (`process.env.POSTGRES_CONNECTION_STRING!`,
`lib/postgres/client.ts:9`) or `if (!apiKey) throw` guards (`lib/pipeline.ts:184`) rather than a
single startup-time validation pass. A missing env var fails at first *use*, not at boot — e.g. a
misconfigured `GOOGLE_API_KEY` only surfaces the first time a pipeline route is hit, mid-request,
as a `500`.

**`.env.local.example` is stale relative to the live app**: it documents `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Google OAuth) and `SLACK_CLIENT_ID` /
`SLACK_CLIENT_SECRET` / `NEXT_PUBLIC_SLACK_CLIENT_ID` (Slack OAuth) — none of which are referenced
anywhere in the live `app/`/`lib/` tree (`grep` for these names outside `.env.local.example` and
`finance-agent/` returns zero hits) — while it **omits** every variable the app actually needs today:
`AUTH_MICROSOFT_ENTRA_ID_*`, `GOOGLE_API_KEY` (Gemini — easily confused with the dead
`GOOGLE_CLIENT_ID` OAuth var, different purpose entirely), `YOUTUBE_API_KEY`,
`POSTGRES_CONNECTION_STRING`, `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER`. This is
a genuine onboarding/ops risk: a new engineer following the example file would set up Google/Slack
OAuth credentials the app no longer uses and have no idea `POSTGRES_CONNECTION_STRING` or
`AUTH_MICROSOFT_ENTRA_ID_*` are required to boot successfully.

---

## 9. Authentication / Authorization

This is the section with the most consequential findings.

### 9.1 Internal `/api/v1/*` — session-cookie auth via NextAuth, **enforced per-route, not
centrally**

- `auth.ts` configures NextAuth (`next-auth@5.0.0-beta.31`) with a single provider, Microsoft Entra
  ID (`MicrosoftEntraID`), JWT session strategy (`session: { strategy: "jwt" }`), and a custom `jwt`
  callback that swaps `token.sub` from the OIDC `providerAccountId` (an opaque pairwise identifier)
  to the Entra `oid` claim (a real GUID) — with a detailed comment explaining this was needed
  because every Postgres `user_id` column is `UUID`-typed and the pairwise ID isn't a valid UUID
  (`auth.ts:30-46`, "found by testing the real deployment, not caught by type-checking").
- `lib/auth.ts`'s `getCurrentUser()` is the single chokepoint that calls NextAuth's `auth()` and
  returns `{ id, email } | null`, explicitly designed (per its doc comment) so call sites don't call
  `auth()` directly.
- **But nothing forces every route to call it.** There is no `withAuth()` HOC, no auth middleware
  covering `/api/v1/*`, and `middleware.ts`'s `matcher` is scoped to `"/api/public/:path*"` only
  (`middleware.ts:5-7`) — **the internal `/api/v1` tree is entirely outside the Next.js middleware's
  reach.** Authentication on `/api/v1/*` is opt-in, per-file, by whether that file's author
  remembered to call `getCurrentUser()` at the top of the handler.

**Confirmed by direct inspection of all 24 route files** (`grep -c "getCurrentUser"` per file):

Routes that **do** check auth (10 of 24): `analyze/history`, `analyze`, `analyze/solo`, `credits`,
`insights`, `request`, `transcript/download`, `user-tickers` (all 3 methods) — i.e., every route
that spends AI/credit budget, plus the ones touching per-user data, are protected.

Routes that call **zero** auth check (14 of 24), all reachable by anyone with the URL, no login
required:

- `GET /api/v1/available` — lists every transcript on file, all tickers/quarters
  (`app/api/v1/available/route.ts`, no `getCurrentUser` call anywhere in the file).
- `GET /api/v1/screener` — the full ranked signal screener across Nifty 50/200, including
  proprietary confidence scores and summaries (`app/api/v1/screener/route.ts`).
- `GET /api/v1/sectors`, `GET /api/v1/calendar`, `GET /api/v1/divergence`, `GET /api/v1/concall`,
  `GET /api/v1/kpis` — all unauthenticated reads of what is presumably paid/proprietary analysis
  output.
- **`DELETE /api/v1/kpis`** (`app/api/v1/kpis/route.ts:110-118`) — wipes the entire KPI cache table
  for **any unauthenticated caller** who sends a bare `DELETE` to this URL. No auth, no confirmation,
  no soft-delete.
- **`POST /api/v1/seed-analysis`** (`app/api/v1/seed-analysis/route.ts`) — runs the full Gemini
  analysis pipeline across up to all ~200 Nifty 200 tickers (`maxDuration = 300`), with **no auth
  check and no credit deduction** (it doesn't call `checkAndDeduct` at all — this path bypasses the
  credits system entirely, unlike the user-facing `/analyze` route). Anyone who discovers this URL
  can trigger unbounded Gemini API spend against the project's own key, repeatedly, for free.
- **`POST /api/v1/seed-transcripts`** — similarly unauthenticated, `maxDuration = 300`, drives
  external scraping (transcript acquisition) at will.
- **`POST /api/v1/calendar/seed`**, **`POST /api/v1/sectors/seed`** — same story: unauthenticated,
  long-running (`maxDuration = 300` / `60`), hit third-party sources (Tickertape/BSE/NSE, per the
  doc-comment in `calendar/seed/route.ts:5-9`) with real network cost and rate-limit exposure to
  those upstreams.

There is no secret header, no `x-admin-key`, no IP allowlist, nothing gating these four `*seed*`
routes and the `kpis` `DELETE` — they read as internal/ops tooling ("run this after each quarter
end," per `calendar/seed/route.ts:13`) that was written assuming obscurity-by-URL, not actual access
control. **This is the most significant finding in this document**: four routes that can burn real
Gemini API budget or third-party scraping capacity, plus one that destroys cached data, are exposed
with zero authentication on the public internet (Azure App Service, custom domain
`quantalyze.me` per `next.config.mjs`'s redirect rule).

### 9.2 Public `/api/public/v1/*` — API-key auth, enforced centrally and correctly

By contrast, this surface's auth **is** centralized and **is** enforced before any route code runs,
via `middleware.ts` (see full trace in §2). Every request must present `Authorization: Bearer
<raw-key>`; the middleware SHA-256-hashes it, looks it up (`apiAccessRepo.getKeyByHash`), checks
`active`, checks product entitlement, checks daily quota, and only then forwards to the route with
partner-identifying headers attached. This is real, working, request-blocking middleware — the
opposite of §9.1's per-route opt-in pattern.

### 9.3 Authorization (as opposed to authentication)

**NOT IMPLEMENTED beyond "is there a session" / "is there a valid key."** There is no role system —
no admin/user distinction anywhere in the internal API (which is precisely why the `*seed*` and
`kpis DELETE` routes have nowhere correct to check "is this user an admin," because that concept
doesn't exist in the codebase at all). `getCurrentUser()` returns only `{ id, email }` — no role,
no plan tier. On the public side, authorization is entitlement-based per API key
(`entitledProducts`) but still flat — no scopes, no read/write distinction, no per-partner rate
tiers beyond the single `dailyQuota` number per key.

---

## 10. Validation

**NOT IMPLEMENTED via any schema library — no `zod`, `yup`, `joi`, or similar in `package.json`'s
dependencies (confirmed: full dependency list checked, none present).** All validation is manual,
inline, per-route:

- Presence checks: `if (!ticker || !q_prev || !q_curr) return NextResponse.json({ detail: "..."
  }, { status: 422 })` (`app/api/v1/analyze/route.ts:24-29`).
- Cross-field checks: `if (q_prev === q_curr) return ...` (`analyze/route.ts:30-35`).
- The one real regex-validated field in the whole surface: `user-tickers` POST validates the ticker
  format — `if (!ticker || !/^[A-Z0-9&.-]{1,20}$/.test(ticker)) return NextResponse.json({ error:
  "Invalid ticker" }, { status: 400 })` (`app/api/v1/user-tickers/route.ts:42-44`) — a genuine
  allowlist-pattern input validation, notably the *only* one of its kind found in the reviewed
  surface.
- JSON body parsing is wrapped in `try { body = await req.json() } catch { return ...400 }` in
  most `POST` handlers (`analyze`, `analyze/solo`, `insights`) but **not** in `user-tickers` POST,
  which instead does `req.json().catch(() => ({}))` — swallowing a parse failure into an empty
  object rather than a 400, so a malformed body there silently becomes "ticker is empty" → 400 from
  the *next* check, not a body-parse error surfaced as such.
- Public API route params (`params.ticker`, `params.sector`) are used completely unvalidated —
  whatever string Next.js's router extracts from the URL segment is passed straight to the
  repository query (parameterized SQL protects against injection, but no format/length validation
  exists).

No request ever goes through a shared schema — every route re-implements its own ad hoc guard
clauses, with the inconsistent 400-vs-422 status choice noted in §1 as a direct symptom of this.

---

## 11. Serialization — JSONB → API Response Shapes

**IMPLEMENTED, but via hand-written mapper functions per repository, not a generic
serializer.** The core payload structure, `DashboardPayload` (`lib/pipeline.ts`), is stored directly
as Postgres `JSONB` in `analysis_results.payload` and comes back auto-deserialized into a JS object
by the `pg` driver (documented in `lib/postgres/client.ts:53-55`: *"pg automatically parses
JSON/JSONB columns into JS objects/arrays on read... but does NOT auto-serialize JS objects into
JSONB for writes"*) — writes must be explicit `JSON.stringify(...)` bound with a `$n::jsonb` SQL
cast, which every repository's insert/upsert does explicitly (e.g.
`lib/repositories/analysis.ts:317`: `VALUES ($1, $2, $3, $4, $5::jsonb)` with
`JSON.stringify(fromEntity(analysis))` as the bound param).

Two symmetric private functions, `toEntity()` and `fromEntity()`
(`lib/repositories/analysis.ts:79-99` / `112-131`), handle the JSONB ↔ domain-entity translation for
the analysis pipeline's output specifically — snake_case stored fields (`executive_evasiveness_score`,
`market_alignment_pct`, `key_metrics`) map to camelCase entity fields (`evasivenessScore`,
`marketAlignmentPct`, `keyMetrics`), and back again via `toDashboardPayload()`/`fromDashboardPayload()`
exported specifically so route handlers can serialize a fresh pipeline run and a cached DB row
through the identical wire shape (`analysis.ts:60-77`, `101-110`). This is careful, intentional
serialization design for one specific hot path — but it's local to `analysis.ts`; other repositories
(`kpis.ts`, `sectors.ts`) do similar ad hoc snake↔camel mapping inline in their own `toEntity`-style
helpers rather than sharing a common serialization utility.

---

## 12. Error Handling

**PARTIALLY IMPLEMENTED — consistent shape of "try/catch → generic 500," inconsistent depth of what
gets caught and what leaks.**

- The domain-error pattern (`isDomainError` + `err.status`) used by the 3 public routes is the one
  place error handling is genuinely structured (§4, §9.2).
- Every `/api/v1` route otherwise hand-rolls its own `try { ... } catch (e) { ... }`, with the
  message-extraction idiom `const msg = e instanceof Error ? e.message : String(e);` repeated
  near-verbatim across `analyze/route.ts:110`, `analyze/solo/route.ts:65`, and others — a copy-pasted
  idiom, not a shared helper.
- **What a client sees on failure is inconsistent** between routes:
  - `app/api/v1/analyze/route.ts:112`: `send({ type: "error", detail: \`Pipeline error:
    ${msg}\` })` — leaks the raw `Error.message` (not a full stack trace, but an unfiltered internal
    message, e.g. whatever Gemini's SDK or the PDF parser throws) straight into the client-visible
    NDJSON stream.
  - `app/api/v1/transcript/download/route.ts:42-45`: same pattern — `Could not generate download URL:
    ${msg}` returned in a `500` JSON body, again forwarding the raw underlying error message
    (e.g. a raw Azure SDK error string) to the caller.
  - `app/api/v1/screener/route.ts:219`: by contrast, on a real DB error it logs the detail
    server-side (`console.error("[screener] Nifty50 DB error:", n50Err)`) and returns only the
    generic `{ error: "Failed to fetch results" }` to the client — no leak.
  - The public API routes always return a fixed `{ error: "internal error" }` on any non-domain
    exception (`sector-thesis/route.ts:21`, `companies/[ticker]/route.ts:21`) — the most disciplined
    of the three patterns.
  - **No route in the reviewed set returns a raw stack trace** to the client — the leak, where it
    exists, is limited to `Error.message` text, not `Error.stack`. Still a real information-disclosure
    surface (internal file paths, SDK-specific error phrasing, occasionally SQL fragments via a
    driver error message) on the routes that do it.
- **Credits are deducted before the operation is known to succeed**, and are not refunded on
  failure: in `analyze/solo/route.ts:27` and `insights/route.ts:25` and `analyze/route.ts:76`, the
  `checkAndDeduct()` call happens *before* the `try { await runXPipeline(...) }` block that can
  itself throw (Gemini timeout, transcript-parse failure, etc.) — a user who hits a timed-out or
  failed AI run has still spent the credit. `analyze/solo/route.ts:25-26`'s own comment
  acknowledges the intent (*"deduct on every call... to discourage spam"*) but the mechanism doesn't
  distinguish "spam" from "the run genuinely failed" — this is a real UX/billing-fairness gap.

---

## 13. Logging

**NOT IMPLEMENTED as structured logging — plain `console.log`/`console.error`/`console.warn`
throughout, one deliberate exception.** No logging library (`pino`, `winston`, `bunyan`) appears in
`package.json`. 65 `console.*` call sites across `app/` and `lib/`.

Representative examples (verbatim):
```ts
// lib/pipeline.ts:244
console.log(`[Pipeline] ${storageKey}: ${buffer.length} bytes, header="${header}"`);
// lib/pipeline.ts:472
console.error(`[${sectionName}] Agent failed:`, e);
// lib/kpi-extractor.ts:415
console.log(`[KPI] Extracting KPIs for ${ticker} (${companyName}, ${sector})`);
// app/api/v1/analyze/route.ts:55
console.log(`[Cache] HIT for ${tickerUp} ${q_prev}→${q_curr}`);
```
These are free-text, human-readable, bracket-tagged strings (`[Pipeline]`, `[KPI]`, `[Cache]`,
`[Insights]`) — a *convention*, not a system: no log levels config, no correlation/request IDs, no
JSON output, nothing queryable as structured fields in a log aggregator without string-parsing the
bracket tag out of free text.

**The one exception is `middleware.ts`'s `log()` helper** (`middleware.ts:80-97`), which *does*
emit real structured JSON:
```ts
console.log(JSON.stringify({
  requestId: ctx.requestId, partnerId: ctx.partnerId ?? null, keyId: ctx.keyId ?? null,
  endpoint: ctx.pathname, product: ctx.product, status: response.status, latencyMs,
}));
```
with a `crypto.randomUUID()`-generated `requestId` per public-API request (`middleware.ts:23`).
This is genuinely good practice — but it is scoped to exactly the public API's middleware and does
not extend to any `/api/v1` route or to the pipeline internals. There is no request-ID propagation
from this middleware into anything downstream (the forwarded headers are `x-api-key-id` /
`x-api-partner-id`, not a request ID), so even the one structured-logging path can't be correlated
with whatever unstructured `console.log` lines the eventual route/pipeline code emits for the same
request.

---

## 14. Retries / Timeouts / Concurrency

**Timeouts: IMPLEMENTED, but as soft "give up waiting" races, not hard cancellation. Retries: NOT
IMPLEMENTED for any LLM call; IMPLEMENTED (once) for Postgres connection acquisition only.**

**Gemini call timeouts** are real and match `TECHNICAL_ARCHITECTURE.md`'s documented figures,
implemented identically across every pipeline file as `Promise.race([call, timeout])`:
```ts
// lib/pipeline.ts:189, 208-212
const AGENT_TIMEOUT_MS = 25_000;
const timeout = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error("Gemini agent timed out")), AGENT_TIMEOUT_MS)
);
const result = await Promise.race([model.generateContent(userPrompt), timeout]);
```
Same pattern, different constants, in `lib/insights-pipeline.ts:81-98` (`CALL_TIMEOUT_MS = 55_000`),
`lib/solo-pipeline.ts:45,181` (`TIMEOUT_MS = 55_000`), `lib/sector-narrative.ts:92,176-178`
(`NARRATIVE_TIMEOUT_MS = 22_000`).

**Important nuance**: `Promise.race` does not cancel the losing promise. When the 25s/55s timer
wins, `model.generateContent()` is still running against Google's servers in the background — the
function just stops *awaiting* it. There is **no `AbortController` passed into any Gemini SDK
call anywhere** (confirmed: `grep` for `AbortController`/`signal:` inside any of the 5 pipeline
files' Gemini call sites returns nothing — every `AbortSignal.timeout(...)` hit in the codebase is
on plain `fetch()` calls to third-party HTTP APIs — screener.in, NSE, BSE, Tickertape — not on any
Gemini SDK call). So "timeout" here means "the request-handling code moves on and reports failure to
the user," not "the expensive upstream call is actually stopped" — real (if likely small, given
per-call token limits) wasted Gemini spend on every timeout, and no way to reconcile that a
"failed" agent call might still complete and do nothing with its result.

**The outer pipeline timeout has the same property, one layer up**:
`app/api/v1/analyze/route.ts:86,99-103` sets `PIPELINE_TIMEOUT_MS = 270_000` and races it against
`runPipeline(...)` via a `setTimeout` that sends an `{"type":"error"}` NDJSON line and calls
`controller.close()` — but does **not** cancel `runPipeline()` itself. If `runPipeline()` later
resolves after the stream has already closed, `analysisRepo.saveAnalysis(...)` still runs
server-side and the result is still persisted — the client just never finds out synchronously (it
would only see it on a subsequent request that hits the now-populated cache). This is a soft,
UX-only timeout, not resource-freeing cancellation — worth naming precisely as such rather than as
"the pipeline times out."

**Retries**: **no retry logic exists on any Gemini call** — a `Promise.race` timeout or a thrown SDK
error propagates straight up and is caught only to be logged/reported, never retried
(`lib/pipeline.ts:471-473`: `catch (e) { console.error(...); return fallbackValue; }` — several
agent-level catches degrade to a fallback/empty result rather than retrying, which is a form of
graceful degradation, but not a retry). The **only actual retry in the codebase** is
`lib/postgres/client.ts:61-69`'s single retry-once on a connection-*acquisition* failure (matched
against `ECONNRESET` / `"Connection terminated unexpectedly"` / `"socket disconnected before secure
TLS"`), explicitly justified as safe because the failure occurs *before* any SQL reaches the server
(no risk of double-executing a write) — a well-reasoned, narrowly-scoped retry, not a general
resilience pattern applied elsewhere (no retry around Gemini, Azure Blob, or any third-party
scraping `fetch()` call).

**Concurrency**: `Promise.all` is used 12 times (e.g. `analyze/route.ts:42-45`'s parallel
`resolvePdfKey()` for both quarters; `available/route.ts:55-68`'s ~50 parallel per-ticker storage
searches). **`Promise.allSettled` is never used anywhere in the codebase** — every `Promise.all` call
either (a) is fine to fail-fast because a single failure should abort the whole operation
(`resolvePdfKey` — if either quarter's PDF is missing, the whole analyze request should 422), or (b)
achieves partial-failure tolerance manually by wrapping each individual promise in its own
`try/catch` that returns a safe fallback (`available/route.ts:61-67`: each per-ticker search is
individually try/caught to `{ ticker, files: [] }` on failure, so `Promise.all` itself never
rejects) — a hand-rolled `allSettled` rather than using the built-in.

---

## 15. Background Tasks / Queues

**NOT IMPLEMENTED.** Everything is synchronous request/response (including the streaming NDJSON
endpoints, which are still a single long-lived HTTP request, not a queued job with a separate
status-poll endpoint). Evidence of absence:
- `vercel.json` contains only `{"framework": "nextjs"}` — no `crons` array.
- No `app/api/cron/*` route, no queue client (no BullMQ, no Azure Service Bus/Queue Storage SDK, no
  SQS) in `package.json`'s dependencies.
- The `*seed*` routes (`seed-analysis`, `seed-transcripts`, `calendar/seed`, `sectors/seed`) are the
  closest thing to "background jobs" in this system, but they are literally just long-running
  synchronous `POST` handlers (`maxDuration = 300`, i.e. relying on the platform's request timeout
  ceiling) that someone (a human, or conceivably `cron` on a box, or an external scheduler) is
  expected to hit manually or via an external trigger — there's no in-app scheduler.
- `maxDuration` exports (`export const maxDuration = 300`) are a **Vercel-specific** Next.js
  convention for serverless function timeout — present in 8 route files
  (`analyze`, `analyze/solo`, `insights`, `seed-analysis`, `seed-transcripts`, `calendar/seed`,
  `sectors/seed`, `kpis`, `divergence`, `request`) despite the app actually running as a long-lived
  Node process in a Docker container on Azure App Service (`Dockerfile`'s `CMD ["node",
  "server.js"]`), where this export is inert. This is a leftover from an earlier
  Vercel-hosted deployment (`auth.ts`'s own comment block explicitly discusses the Vercel→Azure App
  Service auth migration) — a real technical-debt/documentation-clarity issue: a reader would
  reasonably but incorrectly conclude these numbers are enforced platform timeouts, when on the
  actual deployment target they're just dead configuration and the real ceiling is whatever
  reverse-proxy/App-Service timeout Azure applies (not visible in this repo).

---

## 16. Caching

**HTTP-layer caching: deliberately disabled everywhere, not "not implemented."** Every route that
sets a `Cache-Control` header sets it to `no-store` or `no-cache` — 19 occurrences across 13 files
(`kpis`, `screener`, `sectors`, `divergence`, `calendar`, `calendar/seed`, `sectors/seed`,
`available`, `concall`, `analyze`, `analyze/solo`, `insights`, `seed-analysis`, `seed-transcripts`)
— and 16 of the 24 route files export `export const dynamic = "force-dynamic"`, opting every one of
them out of Next.js's Full Route Cache / Data Cache entirely. There is no `revalidate` export
anywhere in `app/api`. This is a consistent, intentional choice (every dynamic financial-data read
must reflect the latest DB/cache state), not an oversight — but it does mean **all caching in this
system is application-level** (the `analysisRepo.getCachedAnalysis` / KPI-snapshot / insights-cache
patterns covered elsewhere in this codebase's docs), with zero benefit from CDN/edge/browser
caching, and correspondingly full DB round-trip cost on every single request including the ones
serving already-computed, rarely-changing data (e.g. `screener`, which recomputes its ranking sort
in-process on every request over data that's usually hours or days stale).

---

## 17. Rate Limiting

**IMPLEMENTED, but only on the public partner API — NOT IMPLEMENTED on the internal API beyond the
credits system, which is a monthly quota, not a rate limiter.**

- Public API: `middleware.ts:57-63` — per-key daily quota (`dailyQuota` from the `api_keys` row),
  checked and incremented on every request, `429 "daily rate limit exceeded"` on breach. Explicitly
  documented as *not* a true per-second/per-minute rate limiter and *not* atomic under concurrency
  in the Supabase implementation (§6); the Postgres implementation fixed the atomicity but the
  granularity is still daily-bucket, not sliding-window.
- Internal API: **no IP-based or per-user request-rate limiting anywhere.** The credits system
  (`lib/credits.ts`) caps *spend* per calendar month on the 3 explicitly-metered actions
  (`delta`/`solo`/`insights`, `ACTION_COSTS` in `credits.ts:16-20`) — it does nothing to stop a
  logged-in user (or, per §9.1, an *unauthenticated* caller on the 14 unprotected routes) from
  hammering `GET /api/v1/screener`, `GET /api/v1/available`, or the four unauthenticated `POST
  *seed*` routes at whatever request rate they choose. There is no `express-rate-limit`-equivalent,
  no token bucket, no sliding window, anywhere in `lib/` or `middleware.ts` scoped to `/api/v1/*`.

---

## 18. Idempotency

**NOT IMPLEMENTED via any explicit idempotency key — dedup is entirely cache-based, and is
race-prone under concurrency.**

`POST /api/v1/analyze` "dedups" by looking up `analysisRepo.getCachedAnalysis(ticker, q_prev,
q_curr)` before running the pipeline (`analyze/route.ts:53`) and, on a cache miss, runs the full
pipeline and then `saveAnalysis()`s the result — but nothing locks the `(ticker, q_prev, q_curr)`
key for the duration of the run. Two concurrent identical requests (e.g. a user double-clicking
"Analyze," or two browser tabs) will both see a cache miss, both deduct a credit
(`checkAndDeduct` at `analyze/route.ts:76` — meaning a double-click can cost the user 2× credits for
one logical action), both run the full ~4-minute Gemini pipeline in parallel, and both call
`saveAnalysis()` — which itself does `DELETE ... WHERE (ticker, q_prev, q_curr)` followed by
`INSERT` (`analysis.ts:314-319`), so the second writer's `DELETE` can race the first writer's
still-in-flight `INSERT`/read, and whichever `INSERT` lands last wins with no conflict signal to
either caller. There is no `Idempotency-Key` header support, no advisory lock, no
`INSERT ... ON CONFLICT DO NOTHING`-style guard on this particular table (contrast with
`api_usage`'s and `user_credits`'s proper `ON CONFLICT` upserts elsewhere in the codebase — the
pattern exists in this codebase, just isn't applied here). Same shape of risk applies to
`analyze/solo` and `insights`.

---

## 19. Health Checks

**IMPLEMENTED, but as a liveness stub only — checks nothing downstream.**

```ts
// app/api/health/route.ts
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
```
This confirms the Node process is up and able to route a request — it does **not** check Postgres
connectivity (`pgPool()`/`query()` is never called here), does not check Supabase Storage/Azure Blob
reachability, does not check `GOOGLE_API_KEY` validity or Gemini reachability, and does not check
Entra ID/NextAuth configuration. A deployment could have a dead `POSTGRES_CONNECTION_STRING` or an
expired Gemini key and this endpoint would still return `200 {"status":"ok"}` — it's useful only as
an Azure App Service / load-balancer liveness probe ("is the container alive"), not as a readiness
or dependency-health check.

---

## 20. Graceful Degradation

**PARTIALLY IMPLEMENTED — inconsistent by dependency, with real fallback logic in a few places and
hard failure in most.**

**If Gemini is down / errors / times out**: at the individual-agent level, several call sites
degrade to a safe fallback rather than failing the whole pipeline — e.g. `lib/pipeline.ts:471-473`
catches a per-section agent failure, logs it, and (per the surrounding function shape) contributes an
empty/neutral result for that section rather than aborting the entire analysis; `lib/kpi-extractor.ts:403`
catches a Gemini sector-extraction failure and continues without sector KPIs
(`console.error("[KPI] Gemini sector extraction failed:", e)`, function proceeds). But at the
*pipeline* level, an unrecovered exception simply propagates to the route's outer `catch`, which
reports a generic `{ type: "error", detail: "Pipeline error: ..." }` over the NDJSON stream and ends
the request (`analyze/route.ts:109-116`) — there is no pipeline-level fallback ("show cached data
from last quarter" or "return partial results") once an agent's own local catch doesn't absorb the
failure; the user just gets an error and (per §12) has already paid a credit for it.

**If Postgres is down**: connection-acquisition failures get one retry (§14); a *second* failure
(or a query-time, not connection-time, failure) propagates as a thrown error. Route-level handling
of this varies: `screener/route.ts:217-220` catches a DB error from `listAllByTickers` (which itself
catches internally and returns `{ records: [], error: msg }` rather than throwing —
`analysis.ts:343-361`) and returns a clean `500 { error: "Failed to fetch results" }`; but many
`GET` routes (`sectors`, `calendar`, `kpis` single-ticker path) call repository methods that
**throw** rather than return an error tuple, with no route-level `try/catch` wrapping them at all —
an unhandled Postgres error in, say, `available/route.ts` outside its explicitly-try/caught storage
calls would surface as Next.js's own default unhandled-error 500 (opaque, framework-generated),
not an app-authored JSON error body.

**If Supabase Storage / Azure Blob is down**: consistently handled — every `storageRepo` call site
reviewed (`available/route.ts:20-24`, `61-66`; `transcript/download/route.ts:26-31`;
`seed-analysis/route.ts:47-54`) wraps the call in its own local `try/catch` with an explicit
comment preserving "originally swallowed such errors" behavior — i.e., a storage outage degrades
these endpoints to "as if no files were found" rather than a hard 500, a deliberate (if silent)
choice.

**Net assessment**: degradation is real and thoughtful at the leaf/agent level (many individual
Gemini calls and every storage call have a documented fallback), but there is no *system-level*
circuit breaker, health-aware routing, or user-facing "service degraded" signal — a sustained Gemini
outage would simply make every analyze/insights/solo request time out or error one at a time, at
full latency cost each time, indistinguishable to the user from a one-off failure.

---

## Summary Table

| Mechanism | Status | Where |
|---|---|---|
| REST route naming | Partial (public API REST-ish; internal API RPC-ish) | §1 |
| API versioning | Not implemented (namespace only) | §2 |
| Internal vs public API split | Implemented, real and distinct | §2 |
| Service layer | Partial (1 real service; rest is inline/route-level) | §4 |
| Domain error hierarchy | Implemented, but adopted in only 3/24 routes | §4 |
| DTOs at the boundary | Implemented, public API only | §5 |
| Repository pattern | Implemented, consistent naming; inconsistent error signaling | §6 |
| Dead Supabase repo classes | Present (post-migration debt) | §6 |
| Dependency injection | Not implemented (module singletons); 1 hand-wired exception | §7 |
| Centralized config module | Not implemented | §8 |
| `.env.example` accuracy | Stale / misleading | §8 |
| Session auth (NextAuth) | Implemented, real | §9.1 |
| Auth enforced on `/api/v1/*` | **Partial — 14/24 routes have none, incl. 4 expensive POSTs + 1 destructive DELETE** | §9.1 |
| API-key auth + entitlements + quota (`/public/v1`) | Implemented, enforced centrally | §9.2 |
| Authorization / roles | Not implemented | §9.3 |
| Request validation (schema) | Not implemented (manual checks only) | §10 |
| Serialization (JSONB↔DTO) | Implemented, per-repository | §11 |
| Error handling consistency | Partial; some routes leak `Error.message` | §12 |
| Credit refund on failure | Not implemented | §12 |
| Structured logging | Not implemented app-wide; implemented in `middleware.ts` only | §13 |
| Gemini call timeout | Implemented (soft, via `Promise.race`) | §14 |
| Gemini call cancellation | Not implemented (no `AbortController`) | §14 |
| Gemini call retries | Not implemented | §14 |
| DB connection retry | Implemented (once, connection-acquisition only) | §14 |
| `Promise.allSettled` | Not used anywhere | §14 |
| Background jobs / queue / cron | Not implemented | §15 |
| HTTP caching | Deliberately disabled everywhere | §16 |
| Rate limiting (internal API) | Not implemented | §17 |
| Rate limiting (public API) | Implemented (daily quota, atomic in Postgres impl) | §17 |
| Idempotency keys | Not implemented (cache-based dedup only, race-prone) | §18 |
| Health check | Implemented, liveness-only, no dependency checks | §19 |
| Graceful degradation | Partial — good at leaf level, absent at system level | §20 |

## Flagged for the Tech-Debt Doc

1. **Unauthenticated, expensive/destructive endpoints on the public internet**: `POST
   /api/v1/seed-analysis` (runs Gemini across ~200 tickers, no auth, no credit deduction),
   `POST /api/v1/seed-transcripts`, `POST /api/v1/calendar/seed`, `POST /api/v1/sectors/seed` (all
   unauthenticated, long-running, third-party-scraping), and `DELETE /api/v1/kpis` (unauthenticated,
   wipes the whole KPI cache) — genuine cost/availability/data-integrity exposure, not theoretical.
2. **14 of 24 route handlers have zero authentication check**, and `middleware.ts`'s matcher
   (`/api/public/:path*`) structurally cannot cover them even if someone tried to add a check there
   — auth on `/api/v1/*` is per-file opt-in with no enforcement mechanism.
3. **No rate limiting at all on the internal API** — the credits system is a monthly spend cap on 3
   named actions, not a request-rate limiter, and doesn't apply to the 14 unauthenticated routes
   anyway.
4. **Credits are charged before success is known and never refunded on pipeline failure/timeout.**
5. **`.env.local.example` documents dead Google/Slack OAuth vars and omits the real required vars**
   (`AUTH_MICROSOFT_ENTRA_ID_*`, `GOOGLE_API_KEY`, `POSTGRES_CONNECTION_STRING`,
   `AZURE_STORAGE_CONNECTION_STRING`) — an onboarding trap.
6. **Idempotency gap on `/analyze`, `/analyze/solo`, `/insights`**: concurrent duplicate requests can
   double-charge credits and race each other's cache writes.
7. **Dead Supabase repository classes and Supabase DB env vars still load-bearing for `admin.ts`**
   even though the wired implementations are 100% Postgres — safe today, but a real "which client is
   actually live" trap for a new contributor reading `lib/repositories/*.ts` top to bottom.
8. **`maxDuration` exports across 10 route files are inert on the actual Azure App Service /
   Docker deployment** — a Vercel-era leftover that misleadingly implies an enforced timeout ceiling
   that isn't real.
