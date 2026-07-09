# Services and Public API Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public-facing enterprise API (Part 2 of `docs/superpowers/specs/2026-07-09-data-wrapper-and-public-api-design.md`) — a two-layer REST API (Data + Products) for manually-provisioned PMS/AMC partners, backed entirely by the repositories built in Plan A, with its own auth/entitlement/rate-limit middleware and a versioned anti-corruption response layer.

**Architecture:** `app/api/public/v1/data/*` route handlers call one repository method each and map the domain entity through a versioned external type. `app/api/public/v1/products/*` route handlers call one Service each (`lib/services/*`), which composes multiple repositories in-process. A new `middleware.ts` scoped to `/api/public/*` authenticates the `Authorization: Bearer <key>` header against a new `ApiAccessRepository`, checks entitlement and daily rate limit, and logs one structured line per request. Domain errors (`NotFoundError`, `UnauthorizedError`, `EntitlementError`, `QuotaExceededError`) are thrown by services/middleware and translated to HTTP status only inside `app/api/public/*` route handlers.

**Tech Stack:** Next.js 14 App Router (`middleware.ts` at project root, Edge runtime by default), TypeScript, `@supabase/supabase-js` via the existing `supabaseAdmin()` client, Web Crypto API (`crypto.subtle`) for key hashing (portable across Edge and Node runtimes — Node's `crypto.createHash` is not available in the Edge runtime middleware defaults to).

## Global Constraints

- Public API code depends exclusively on `lib/repositories/index.ts` instances — never `supabaseAdmin()` directly (spec: Scope).
- Two-layer REST: `app/api/public/v1/data/*` (thin, one repository call each) and `app/api/public/v1/products/*` (thin, one Service call each) (spec: Architecture).
- v1 ships the pattern plus exactly **one** concrete product: `SectorThesisService` composing `sectorRepo` + `kpiRepo` + `analysisRepo` (spec: Architecture). No second product.
- Caching, if ever added, goes inside a service function, never inside a repository. No caching is implemented in this plan (spec: Caching rule).
- New tables: `api_partners` (`id`, `name`, `created_at`), `api_keys` (`id`, `partner_id`, `key_hash`, `active`, `created_at`), `api_key_products` (`key_id`, `product_name`) (spec: Auth & entitlements).
- `middleware.ts` scoped to `/api/public/*` only — existing internal routes are untouched (spec: Auth & entitlements).
- A request for a product/resource the key isn't entitled to gets **403**, not 404 (spec: Auth & entitlements).
- Keys are provisioned by inserting rows directly via an internal admin script — no self-serve UI (spec: Auth & entitlements).
- `api_usage` table (`key_id`, `window_start`, `request_count`), checked in middleware before the request is allowed through, daily rolling window (spec: Rate limiting).
- `lib/services/errors.ts` defines exactly `NotFoundError`, `UnauthorizedError`, `EntitlementError`, `QuotaExceededError`. Route handlers under `app/api/public/*` are the only place that translates a domain error into an HTTP status (spec: Error boundaries).
- Basic structured request logging in `/api/public/*` middleware: request ID, partner ID, key ID, endpoint, HTTP status, total latency, for every request (spec: Observability). No per-layer latency breakdown, no cache hit/miss metrics.
- `/v1/` prefix from day one under both `/data/` and `/products/` (spec: Versioning).
- New versioned TypeScript types under `lib/api-contracts/v1/*.ts`, hand-defined per public resource/product — never a repository's domain entity exposed directly. Mapper functions transform domain entities into these external types (spec: Response contract stability).
- No prompts, extraction logic, or pipeline internals appear in any public response — only curated outputs (spec: What "without revealing the code" means).
- No automated test runner exists in this repo. Verification is `npx tsc --noEmit` plus manual `curl`-based smoke testing per endpoint using a self-issued test key (spec: Testing).
- Non-goals (do not build): self-serve signup/billing UI, auth-provider abstraction, `AzureXRepository` implementations, AI-provider abstraction, transaction-aware repository methods, a domain-error taxonomy across the 11 internal repositories, per-layer observability, a second Products-layer example, GraphQL.

---

### Task 1: `ApiAccessRepository` — tables, entity, repository, composition root

**Files:**
- Create: `supabase/migrations/011_api_access.sql`
- Create: `lib/repositories/apiAccess.ts`
- Modify: `lib/repositories/index.ts`

**Interfaces:**
- Consumes: `supabaseAdmin()` from `lib/supabase/admin.ts` (existing, signature `(): SupabaseClient`).
- Produces:
  ```ts
  export interface ApiKeyInfo {
    keyId: string;
    partnerId: string;
    partnerName: string;
    active: boolean;
    dailyQuota: number;
    entitledProducts: string[];
  }

  export interface ApiAccessRepository {
    getKeyByHash(keyHash: string): Promise<ApiKeyInfo | null>;
    getUsageToday(keyId: string, windowStart: string): Promise<number>;
    incrementUsage(keyId: string, windowStart: string): Promise<void>;
    createPartner(name: string): Promise<{ id: string }>;
    createKey(partnerId: string, keyHash: string, dailyQuota: number): Promise<{ id: string }>;
    grantEntitlement(keyId: string, productName: string): Promise<void>;
  }
  ```
  Exported as `apiAccessRepo` from `lib/repositories/index.ts`, consumed by Task 3 (middleware) and Task 7 (provisioning script).

**Future extension (named, not built):** `ApiAccessRepository` currently owns four concepts — partners, keys, entitlements, usage — behind one interface, matching the spec's explicit "New repository `ApiAccessRepository`" design. If this repository's responsibilities grow significantly (e.g. partner self-serve management, key rotation workflows), it can split into `PartnerRepository` / `KeyRepository` / `UsageRepository` behind the same composition-root pattern used throughout this codebase. Not done now — v1's scope (manual provisioning, one flat entitlement check, one usage counter) doesn't need it.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/011_api_access.sql`:

```sql
-- Public API access: partners, keys, per-key entitlements, and daily usage.
-- No RLS — accessed only via supabaseAdmin() service-role client from
-- middleware and the internal provisioning script, same as user_credits.

CREATE TABLE IF NOT EXISTS api_partners (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id   UUID        NOT NULL REFERENCES api_partners(id) ON DELETE CASCADE,
  key_hash     TEXT        NOT NULL UNIQUE,
  active       BOOLEAN     NOT NULL DEFAULT true,
  daily_quota  INTEGER     NOT NULL DEFAULT 1000,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS api_key_products (
  key_id       UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  PRIMARY KEY (key_id, product_name)
);

CREATE TABLE IF NOT EXISTS api_usage (
  key_id        UUID    NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  window_start  DATE    NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, window_start)
);
```

- [ ] **Step 2: Apply the migration**

Run this SQL against the project's Supabase instance (via the Supabase SQL editor or CLI, matching how migrations 001-010 were applied — there is no automated migration runner in this repo). Verify with:

```sql
select table_name from information_schema.tables
where table_name in ('api_partners', 'api_keys', 'api_key_products', 'api_usage');
```

Expected: all four rows returned.

- [ ] **Step 3: Write the repository**

Create `lib/repositories/apiAccess.ts`:

```ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ApiKeyInfo {
  keyId: string;
  partnerId: string;
  partnerName: string;
  active: boolean;
  dailyQuota: number;
  entitledProducts: string[];
}

export interface ApiAccessRepository {
  getKeyByHash(keyHash: string): Promise<ApiKeyInfo | null>;
  getUsageToday(keyId: string, windowStart: string): Promise<number>;
  incrementUsage(keyId: string, windowStart: string): Promise<void>;
  createPartner(name: string): Promise<{ id: string }>;
  createKey(partnerId: string, keyHash: string, dailyQuota: number): Promise<{ id: string }>;
  grantEntitlement(keyId: string, productName: string): Promise<void>;
}

interface StoredKeyRow {
  id: string;
  partner_id: string;
  active: boolean;
  daily_quota: number;
  api_partners: { name: string } | null;
  api_key_products: { product_name: string }[];
}

export class SupabaseApiAccessRepository implements ApiAccessRepository {
  async getKeyByHash(keyHash: string): Promise<ApiKeyInfo | null> {
    const { data } = await supabaseAdmin()
      .from("api_keys")
      .select("id, partner_id, active, daily_quota, api_partners(name), api_key_products(product_name)")
      .eq("key_hash", keyHash)
      .maybeSingle();
    if (!data) return null;
    const row = data as unknown as StoredKeyRow;
    return {
      keyId: row.id,
      partnerId: row.partner_id,
      partnerName: row.api_partners?.name ?? "",
      active: row.active,
      dailyQuota: row.daily_quota,
      entitledProducts: row.api_key_products.map((p) => p.product_name),
    };
  }

  async getUsageToday(keyId: string, windowStart: string): Promise<number> {
    const { data } = await supabaseAdmin()
      .from("api_usage")
      .select("request_count")
      .eq("key_id", keyId)
      .eq("window_start", windowStart)
      .maybeSingle();
    return data?.request_count ?? 0;
  }

  async incrementUsage(keyId: string, windowStart: string): Promise<void> {
    const current = await this.getUsageToday(keyId, windowStart);
    await supabaseAdmin()
      .from("api_usage")
      .upsert(
        { key_id: keyId, window_start: windowStart, request_count: current + 1 },
        { onConflict: "key_id,window_start" }
      );
  }

  async createPartner(name: string): Promise<{ id: string }> {
    const { data, error } = await supabaseAdmin()
      .from("api_partners")
      .insert({ name })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createPartner failed: ${error?.message}`);
    return { id: data.id };
  }

  async createKey(partnerId: string, keyHash: string, dailyQuota: number): Promise<{ id: string }> {
    const { data, error } = await supabaseAdmin()
      .from("api_keys")
      .insert({ partner_id: partnerId, key_hash: keyHash, daily_quota: dailyQuota })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createKey failed: ${error?.message}`);
    return { id: data.id };
  }

  async grantEntitlement(keyId: string, productName: string): Promise<void> {
    const { error } = await supabaseAdmin()
      .from("api_key_products")
      .upsert({ key_id: keyId, product_name: productName }, { onConflict: "key_id,product_name" });
    if (error) throw new Error(`grantEntitlement failed: ${error.message}`);
  }
}
```

Note: `getUsageToday` followed by `incrementUsage`'s own internal `getUsageToday` call is a read-then-write race under concurrent requests from the same key within the same day — acceptable for v1 (manually-provisioned, low-volume partners; the spec names transaction-aware writes as a named-but-not-built future extension). Do not add locking here.

- [ ] **Step 4: Wire into the composition root**

Modify `lib/repositories/index.ts` — add the import and export, keeping the existing 11 alphabetically-unordered but grouped exports intact:

```ts
import { SupabaseAnalysisRepository } from "./analysis";
import { SupabaseSectorRepository } from "./sectors";
import { SupabaseKpiRepository } from "./kpis";
import { SupabaseWatchlistRepository } from "./watchlist";
import { SupabaseCreditsRepository } from "./credits";
import { SupabaseSoloAnalysisRepository } from "./soloAnalysis";
import { SupabaseInsightsRepository } from "./insights";
import { SupabasePromoterActivityRepository } from "./promoterActivity";
import { SupabaseCalendarRepository } from "./calendar";
import { SupabaseConcallRepository } from "./concalls";
import { SupabaseStorageRepository } from "./storage";
import { SupabaseApiAccessRepository } from "./apiAccess";

export const analysisRepo = new SupabaseAnalysisRepository();
export const sectorRepo = new SupabaseSectorRepository();
export const kpiRepo = new SupabaseKpiRepository();
export const watchlistRepo = new SupabaseWatchlistRepository();
export const creditsRepo = new SupabaseCreditsRepository();
export const soloAnalysisRepo = new SupabaseSoloAnalysisRepository();
export const insightsRepo = new SupabaseInsightsRepository();
export const promoterActivityRepo = new SupabasePromoterActivityRepository();
export const calendarRepo = new SupabaseCalendarRepository();
export const concallRepo = new SupabaseConcallRepository();
export const storageRepo = new SupabaseStorageRepository();
export const apiAccessRepo = new SupabaseApiAccessRepository();
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/011_api_access.sql lib/repositories/apiAccess.ts lib/repositories/index.ts
git commit -m "feat: add ApiAccessRepository for public API auth/entitlements/usage"
```

---

### Task 2: Domain errors

**Files:**
- Create: `lib/services/errors.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `NotFoundError`, `UnauthorizedError`, `EntitlementError`, `QuotaExceededError` classes, each with a `.message: string` and a `.status: number` field carrying the HTTP status the route handler should map it to. Consumed by Task 3 (middleware), Task 4 (Data routes), Task 5 (`SectorThesisService`), Task 6 (Products route).

- [ ] **Step 1: Write the errors module**

Create `lib/services/errors.ts`:

```ts
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class EntitlementError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "EntitlementError";
  }
}

export class QuotaExceededError extends Error {
  readonly status = 429;
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

export function isDomainError(
  err: unknown
): err is NotFoundError | UnauthorizedError | EntitlementError | QuotaExceededError {
  return (
    err instanceof NotFoundError ||
    err instanceof UnauthorizedError ||
    err instanceof EntitlementError ||
    err instanceof QuotaExceededError
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/services/errors.ts
git commit -m "feat: add domain error types for the public API/services layer"
```

---

### Task 3: Auth, entitlement, rate-limit, and observability middleware

**Files:**
- Create: `lib/public-api/product-routes.ts`
- Create: `middleware.ts` (project root)

**Interfaces:**
- Consumes: `apiAccessRepo` from `lib/repositories/index.ts` (Task 1) — `getKeyByHash(keyHash: string): Promise<ApiKeyInfo | null>`, `getUsageToday(keyId, windowStart): Promise<number>`, `incrementUsage(keyId, windowStart): Promise<void>`.
- Produces: for every request under `/api/public/*`, on success, forwards the request with two extra headers set — `x-api-key-id` and `x-api-partner-id` — that Task 4 and Task 6 route handlers may read via `req.headers.get(...)`. On failure, returns a JSON error response directly (`{ error: string }`) with the matching status, without reaching the route handler. Also exports `PRODUCT_ROUTES` (see Step 1), which Task 6 (or any future Products-layer endpoint) extends with one entry per new route — no other file needs editing to add a route's entitlement mapping.

This task has no automated test (no test runner in this repo, and Next.js middleware only runs behind the dev/prod server, not `tsc`). Verification is `npx tsc --noEmit` plus the manual `curl` checks in Step 3.

**Scope note (entitlement vs. authorization):** this middleware checks *coarse* entitlement only — "is this key allowed to call this product at all" (`api_key_products`), which is exactly what the spec's Auth & entitlements section assigns to middleware. It does not and should not do *fine-grained, resource-level* authorization (e.g. "does this specific portfolio belong to this specific partner") — no v1 endpoint has partner-scoped resources, so that need doesn't exist yet. If a future product introduces partner-owned resources, that check belongs in the owning Service (it has the domain context middleware doesn't), not here. Named for later, not built now.

- [ ] **Step 1: Write the product-route registry**

Create `lib/public-api/product-routes.ts`. This replaces a hardcoded if/else chain in the middleware itself: adding a new public endpoint later means adding one entry here, not editing middleware logic.

```ts
export interface ProductRoute {
  pattern: RegExp;
  product: string;
}

// Add one entry per public API endpoint. Order doesn't matter — patterns
// are mutually exclusive by construction (each anchors to a distinct path
// prefix or exact path).
export const PRODUCT_ROUTES: ProductRoute[] = [
  { pattern: /^\/api\/public\/v1\/data\/companies\//, product: "data:companies" },
  { pattern: /^\/api\/public\/v1\/data\/sectors\//, product: "data:sectors" },
  { pattern: /^\/api\/public\/v1\/products\/sector-thesis$/, product: "products:sector-thesis" },
];

export function resolveProductName(pathname: string): string | null {
  return PRODUCT_ROUTES.find((r) => r.pattern.test(pathname))?.product ?? null;
}
```

- [ ] **Step 2: Write the middleware**

Create `middleware.ts` at the project root (same level as `next.config.mjs`):

```ts
import { NextRequest, NextResponse } from "next/server";
import { apiAccessRepo } from "@/lib/repositories";
import { resolveProductName } from "@/lib/public-api/product-routes";

export const config = {
  matcher: "/api/public/:path*",
};

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const start = Date.now();
  const requestId = crypto.randomUUID();
  const { pathname } = req.nextUrl;

  const product = resolveProductName(pathname);
  if (!product) {
    return log(jsonError(404, "unknown public API resource"), { requestId, pathname, product: null, start });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) {
    return log(jsonError(401, "missing or malformed Authorization header"), { requestId, pathname, product, start });
  }
  const rawKey = match[1];
  const keyHash = await sha256Hex(rawKey);

  const keyInfo = await apiAccessRepo.getKeyByHash(keyHash);
  if (!keyInfo || !keyInfo.active) {
    return log(jsonError(401, "invalid or inactive API key"), { requestId, pathname, product, start });
  }

  if (!keyInfo.entitledProducts.includes(product)) {
    return log(jsonError(403, `key is not entitled to '${product}' — contact us to add this product`), {
      requestId, pathname, product, start, keyId: keyInfo.keyId, partnerId: keyInfo.partnerId,
    });
  }

  // Best-effort rate limit: getUsageToday + incrementUsage is a read-then-write,
  // not an atomic increment, so concurrent requests from the same key within
  // the same second can both read the same count and both pass. Acceptable at
  // v1's scale (manually-provisioned, low-volume partners); revisit with an
  // atomic SQL increment (or the transaction-aware repository extension named
  // in the spec) if a partner's volume makes the race actually matter.
  const windowStart = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const usedToday = await apiAccessRepo.getUsageToday(keyInfo.keyId, windowStart);
  if (usedToday >= keyInfo.dailyQuota) {
    return log(jsonError(429, "daily rate limit exceeded"), {
      requestId, pathname, product, start, keyId: keyInfo.keyId, partnerId: keyInfo.partnerId,
    });
  }

  await apiAccessRepo.incrementUsage(keyInfo.keyId, windowStart);

  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set("x-api-key-id", keyInfo.keyId);
  forwardedHeaders.set("x-api-partner-id", keyInfo.partnerId);

  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  return log(response, { requestId, pathname, product, start, keyId: keyInfo.keyId, partnerId: keyInfo.partnerId });
}

function log(
  response: NextResponse,
  ctx: { requestId: string; pathname: string; product: string | null; start: number; keyId?: string; partnerId?: string }
): NextResponse {
  const latencyMs = Date.now() - ctx.start;
  console.log(
    JSON.stringify({
      requestId: ctx.requestId,
      partnerId: ctx.partnerId ?? null,
      keyId: ctx.keyId ?? null,
      endpoint: ctx.pathname,
      product: ctx.product,
      status: response.status,
      latencyMs,
    })
  );
  return response;
}
```

Note on runtime: this uses `crypto.subtle` (Web Crypto API) rather than Node's `crypto.createHash`, because Next.js middleware runs in the Edge runtime by default and Node-native `crypto` is not guaranteed available there. `crypto.subtle` and `crypto.randomUUID()` are both available in the Edge runtime and in Node 22 (this project's runtime), so this works regardless of which runtime the middleware executes under.

- [ ] **Step 3: Manual smoke test**

These require Task 1 through Task 7 to all exist end-to-end to fully exercise (a real key, a real entitlement, a real product route). Run this check now to confirm the middleware itself loads and blocks correctly, then re-run the full set after Task 7:

```bash
npm run dev
```

In another terminal:

```bash
curl -i http://localhost:3000/api/public/v1/data/companies/RELIANCE
```
Expected: `HTTP/1.1 401` with body `{"error":"missing or malformed Authorization header"}` (no route handler exists yet at this point, but the middleware intercepts before that matters).

```bash
curl -i -H "Authorization: Bearer not-a-real-key" http://localhost:3000/api/public/v1/data/companies/RELIANCE
```
Expected: `HTTP/1.1 401` with body `{"error":"invalid or inactive API key"}`.

Return to this step after Task 7 to verify the 200/403/429 paths with a real provisioned key.

- [ ] **Step 4: Commit**

```bash
git add lib/public-api/product-routes.ts middleware.ts
git commit -m "feat: add auth/entitlement/rate-limit middleware for /api/public"
```

---

### Task 4: API contracts (anti-corruption layer) + Data layer endpoints

**Files:**
- Modify: `lib/repositories/analysis.ts`
- Create: `lib/api-contracts/v1/company.ts`
- Create: `lib/api-contracts/v1/sector.ts`
- Create: `app/api/public/v1/data/companies/[ticker]/route.ts`
- Create: `app/api/public/v1/data/sectors/[sector]/route.ts`

**Interfaces:**
- Consumes: `sectorRepo.getBySector(sector: string): Promise<Sector | null>` from `lib/repositories/index.ts` (already exists from Plan A); `NotFoundError` from `lib/services/errors.ts` (Task 2).
- Produces: a new `AnalysisRepository.getLatestByTicker(ticker: string): Promise<Analysis | null>` method (Step 1, added to the existing Plan A interface — additive, no existing caller changes); `CompanyResponseV1`, `toCompanyResponseV1(analysis: Analysis): CompanyResponseV1`; `SectorResponseV1`, `toSectorResponseV1(sector: Sector): SectorResponseV1`. `SectorResponseV1`'s `dimensions` and `narrative` shapes are reused as-is by Task 6's `SectorThesisResponseV1`.

- [ ] **Step 1: Add `getLatestByTicker` to `AnalysisRepository`**

The public companies endpoint needs "the most recent analysis for this ticker, any quarter" — a read the existing `AnalysisRepository` interface doesn't expose directly (only `listAllByTickers`, which returns a full list and leaves the caller to know it's sorted). Rather than have the public API route re-derive that sort-order knowledge itself, add the method to the repository, where that knowledge already lives.

In `lib/repositories/analysis.ts`, add to the `AnalysisRepository` interface (after the existing `listUserHistory` line):

```ts
  /** public API companies endpoint: most recent analysis for this ticker, any quarter. */
  getLatestByTicker(ticker: string): Promise<Analysis | null>;
```

Add the implementation to `SupabaseAnalysisRepository` (same class that already implements `listAllByTickers` — place this method next to it, reusing its exact table/column names: `analysis_results`, `company_ticker`, `q_prev`, `q_curr`, `payload`, `created_at`, and its `toEntity(ticker, qPrev, qCurr, payload)` call signature):

```ts
  async getLatestByTicker(ticker: string): Promise<Analysis | null> {
    const { data } = await supabaseAdmin()
      .from("analysis_results")
      .select("company_ticker, q_curr, q_prev, payload, created_at")
      .eq("company_ticker", ticker)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return toEntity(data.company_ticker, data.q_prev, data.q_curr, data.payload);
  }
```

- [ ] **Step 2: Type-check the repository change in isolation**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit the repository extension**

```bash
git add lib/repositories/analysis.ts
git commit -m "feat: add getLatestByTicker to AnalysisRepository for the public API"
```

- [ ] **Step 4: Write the company contract**

Create `lib/api-contracts/v1/company.ts`. This deliberately omits `sections` (raw thematic extraction bullets), `evasivenessScore`, `validationScore`, `flaggedCount`, `marketAlignmentPct`, `stockPriceChange`, `marketSources`, and `fcfImplications` from the internal `Analysis` entity — those are either pipeline-internal signals or not yet a stable product decision for external partners; only the curated summary fields ship in v1. Also includes `generatedAt` — a request-time timestamp, not part of the domain entity, set by the route handler at serialization time (Step 7), not by this mapper:

```ts
import type { Analysis } from "@/lib/repositories/analysis";

export interface CompanyResponseV1 {
  ticker: string;
  quarter: string;
  quarterPrevious: string;
  overallSignal: "Positive" | "Negative" | "Mixed" | "Noise";
  overallScore: number;
  summary: string;
  keyMetrics?: {
    revenue?: string;
    revenueGrowth?: string;
    ebitdaMargin?: string;
    patGrowth?: string;
  };
  earningsDelta: string[];
  generatedAt: string;
}

export function toCompanyResponseV1(analysis: Analysis, generatedAt: string): CompanyResponseV1 {
  return {
    ticker: analysis.ticker,
    quarter: analysis.quarter,
    quarterPrevious: analysis.quarterPrevious,
    overallSignal: analysis.overallSignal,
    overallScore: analysis.overallScore,
    summary: analysis.summary,
    keyMetrics: analysis.keyMetrics
      ? {
          revenue: analysis.keyMetrics.revenue,
          revenueGrowth: analysis.keyMetrics.revenue_growth,
          ebitdaMargin: analysis.keyMetrics.ebitda_margin,
          patGrowth: analysis.keyMetrics.pat_growth,
        }
      : undefined,
    earningsDelta: analysis.earningsDelta,
    generatedAt,
  };
}
```

- [ ] **Step 5: Check the `KeyMetrics` field names before using them**

Run: `grep -n "export interface KeyMetrics" -A 10 lib/pipeline.ts`

Confirm the field names `revenue`, `revenue_growth`, `ebitda_margin`, `pat_growth` exist on `KeyMetrics` exactly as referenced in Step 4. If the actual field names differ, update `toCompanyResponseV1` to match the real names before proceeding — do not guess.

- [ ] **Step 6: Write the sector contract**

Create `lib/api-contracts/v1/sector.ts`. This omits `companySignals` (per-company breakdowns within each dimension) from the sector-level resource — company-level detail is what the companies endpoint is for — but keeps the full `SectorNarrative` (all 7 fields), since none of it is pipeline-internal; it's the synthesized commentary that is the product's value:

```ts
import type { Sector } from "@/lib/repositories/sectors";

export interface SectorDimensionV1 {
  dimension: string;
  signal: string;
  direction: "strengthening" | "stable" | "weakening";
  weightedScore: number;
}

export interface SectorNarrativeV1 {
  competitiveStructure: string;
  strategicTheme: string;
  tailwinds: string[];
  headwinds: string[];
  keyTriggers: string[];
  macroSensitivity: string;
  transformationSignal: string;
}

export interface SectorResponseV1 {
  sector: string;
  sectorLabel: string;
  quarter: string;
  companyCount: number;
  dimensions: SectorDimensionV1[];
  narrative: SectorNarrativeV1 | null;
  generatedAt: string;
}

export function toSectorResponseV1(sector: Sector, generatedAt: string): SectorResponseV1 {
  return {
    sector: sector.sector,
    sectorLabel: sector.sectorLabel,
    quarter: sector.quarter,
    companyCount: sector.companyCount,
    dimensions: sector.dimensions.map((d) => ({
      dimension: d.dimension,
      signal: d.signal,
      direction: d.direction,
      weightedScore: d.weightedScore,
    })),
    narrative: sector.narrative
      ? {
          competitiveStructure: sector.narrative.competitive_structure,
          strategicTheme: sector.narrative.strategic_theme,
          tailwinds: sector.narrative.tailwinds,
          headwinds: sector.narrative.headwinds,
          keyTriggers: sector.narrative.key_triggers,
          macroSensitivity: sector.narrative.macro_sensitivity,
          transformationSignal: sector.narrative.transformation_signal,
        }
      : null,
    generatedAt,
  };
}
```

- [ ] **Step 7: Write the companies Data-layer route**

Create `app/api/public/v1/data/companies/[ticker]/route.ts`, using the `getLatestByTicker` method added in Step 1 — the route just asks for "the latest analysis," with no knowledge of how that's determined:

```ts
import { NextRequest, NextResponse } from "next/server";
import { analysisRepo } from "@/lib/repositories";
import { toCompanyResponseV1 } from "@/lib/api-contracts/v1/company";
import { NotFoundError, isDomainError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();

  try {
    const analysis = await analysisRepo.getLatestByTicker(ticker);
    if (!analysis) {
      throw new NotFoundError(`no analysis available for ticker '${ticker}'`);
    }
    return NextResponse.json(toCompanyResponseV1(analysis, new Date().toISOString()));
  } catch (err) {
    if (isDomainError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
```

- [ ] **Step 8: Write the sectors Data-layer route**

Create `app/api/public/v1/data/sectors/[sector]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { sectorRepo } from "@/lib/repositories";
import { toSectorResponseV1 } from "@/lib/api-contracts/v1/sector";
import { NotFoundError, isDomainError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { sector: string } }) {
  try {
    const sector = await sectorRepo.getBySector(params.sector);
    if (!sector) {
      throw new NotFoundError(`no sector data available for '${params.sector}'`);
    }
    return NextResponse.json(toSectorResponseV1(sector, new Date().toISOString()));
  } catch (err) {
    if (isDomainError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
```

- [ ] **Step 9: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add lib/api-contracts/v1/company.ts lib/api-contracts/v1/sector.ts \
  app/api/public/v1/data/companies/[ticker]/route.ts \
  app/api/public/v1/data/sectors/[sector]/route.ts
git commit -m "feat: add v1 API contracts and Data-layer endpoints (companies, sectors)"
```

---

### Task 5: `SectorThesisService`

**Files:**
- Modify: `lib/repositories/kpis.ts`
- Create: `lib/services/sectorThesisService.ts`
- Create: `lib/services/index.ts`

**Interfaces:**
- Consumes: `sectorRepo.getBySector(sector: string): Promise<Sector | null>`, `analysisRepo.listByTickersAndQuarterPair(tickers: string[], qPrev: string, qCurr: string): Promise<AnalysisRecord[]>` (from `lib/repositories/index.ts`, both existing from Plan A); `NotFoundError` from `lib/services/errors.ts` (Task 2).
- Produces: a new `KpiRepository.getLatestByTickers(tickers: string[]): Promise<Map<string, KpiSnapshot>>` batch method (Step 1, additive to the existing Plan A interface); plus:
  ```ts
  export interface SectorThesisCompany {
    ticker: string;
    signal: string;
    direction: "positive" | "neutral" | "negative";
    weightPct: number;
    topKpi?: { name: string; changePct: number | null };
    managementConfidence?: "high" | "moderate" | "low";
  }

  export interface SectorThesisResult {
    sector: string;
    sectorLabel: string;
    quarter: string;
    quarterPrevious: string;
    companyCount: number;
    narrative: SectorNarrativeShape | null; // same 7-field shape as SectorResponseV1's narrative
    dimensions: { dimension: string; signal: string; direction: string; weightedScore: number }[];
    topCompanies: SectorThesisCompany[];
  }

  export class SectorThesisService {
    constructor(deps: { sectorRepo: SectorRepository; kpiRepo: KpiRepository; analysisRepo: AnalysisRepository });
    getSectorThesis(sector: string): Promise<SectorThesisResult>;
  }
  ```
  Consumed by Task 6 (Products route) via the `sectorThesisService` singleton exported from `lib/services/index.ts`.

Design: "top companies" is the top 5 companies by `weightPct` across all of the sector's dimensions' `companySignals` (deduplicated by ticker, keeping the highest-weight appearance). For each, `topKpi` is that ticker's single highlighted KPI (`is_highlight: true`) with the largest absolute `change_pct`, if any. `managementConfidence` is derived from that ticker's `evasivenessScore` (0-10 scale, lower = more forthcoming) on the sector's own quarter/quarterPrevious pair: `< 4` → `"high"`, `4-7` → `"moderate"`, `> 7` → `"low"`; omitted if no analysis is cached for that ticker/quarter pair.

**Performance note:** the first draft of this service called `kpiRepo.getLatestByTicker` and `analysisRepo.getCachedAnalysis` once per top company — 2 DB round-trips × 5 companies = 10 calls, and would have been ~2 calls per company (up to 50 for a 25-company sector) if it fetched a KPI/analysis per company in `sectorData.dimensions` rather than just the top 5. Step 1 adds a batch KPI lookup, and Step 2 uses the analysis repository's existing batch method (`listByTickersAndQuarterPair`, already built in Plan A for exactly this kind of multi-ticker call) instead of one call per ticker — the whole service now makes exactly 3 DB calls regardless of company count: one for the sector, one batched KPI lookup, one batched analysis lookup.

- [ ] **Step 1: Add `getLatestByTickers` to `KpiRepository`**

In `lib/repositories/kpis.ts`, add to the `KpiRepository` interface (after `getLatestByTicker`):

```ts
  /** Batch variant of getLatestByTicker, for callers needing several tickers at once (e.g. SectorThesisService). */
  getLatestByTickers(tickers: string[]): Promise<Map<string, KpiSnapshot>>;
```

Add the implementation to `SupabaseKpiRepository`, reusing the same `.in()` + dedup-by-ticker pattern `listAll` already uses in this file:

```ts
  async getLatestByTickers(tickers: string[]): Promise<Map<string, KpiSnapshot>> {
    if (tickers.length === 0) return new Map();
    const { data } = await supabaseAdmin()
      .from("kpi_snapshots")
      .select("*")
      .in("company_ticker", tickers)
      .order("created_at", { ascending: false });

    const result = new Map<string, KpiSnapshot>();
    for (const row of (data ?? []) as StoredKpiRow[]) {
      if (result.has(row.company_ticker)) continue; // first row per ticker = most recent
      result.set(row.company_ticker, toEntity(row));
    }
    return result;
  }
```

- [ ] **Step 2: Type-check the repository change in isolation**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit the repository extension**

```bash
git add lib/repositories/kpis.ts
git commit -m "feat: add getLatestByTickers batch method to KpiRepository"
```

- [ ] **Step 4: Write the service**

Create `lib/services/sectorThesisService.ts`:

```ts
import type { SectorRepository } from "@/lib/repositories/sectors";
import type { KpiRepository } from "@/lib/repositories/kpis";
import type { AnalysisRepository } from "@/lib/repositories/analysis";
import { NotFoundError } from "@/lib/services/errors";

export interface SectorThesisCompany {
  ticker: string;
  signal: string;
  direction: "positive" | "neutral" | "negative";
  weightPct: number;
  topKpi?: { name: string; changePct: number | null };
  managementConfidence?: "high" | "moderate" | "low";
}

export interface SectorThesisResult {
  sector: string;
  sectorLabel: string;
  quarter: string;
  quarterPrevious: string;
  companyCount: number;
  narrative: {
    competitiveStructure: string;
    strategicTheme: string;
    tailwinds: string[];
    headwinds: string[];
    keyTriggers: string[];
    macroSensitivity: string;
    transformationSignal: string;
  } | null;
  dimensions: { dimension: string; signal: string; direction: string; weightedScore: number }[];
  topCompanies: SectorThesisCompany[];
}

const TOP_N = 5;

export class SectorThesisService {
  constructor(
    private deps: {
      sectorRepo: SectorRepository;
      kpiRepo: KpiRepository;
      analysisRepo: AnalysisRepository;
    }
  ) {}

  async getSectorThesis(sector: string): Promise<SectorThesisResult> {
    const sectorData = await this.deps.sectorRepo.getBySector(sector);
    if (!sectorData) {
      throw new NotFoundError(`no sector data available for '${sector}'`);
    }

    const byTicker = new Map<string, { ticker: string; signal: string; direction: "positive" | "neutral" | "negative"; weightPct: number }>();
    for (const dim of sectorData.dimensions) {
      for (const cs of dim.companySignals) {
        const existing = byTicker.get(cs.ticker);
        if (!existing || cs.weightPct > existing.weightPct) {
          byTicker.set(cs.ticker, { ticker: cs.ticker, signal: cs.signal, direction: cs.direction, weightPct: cs.weightPct });
        }
      }
    }
    const topTickers = Array.from(byTicker.values())
      .sort((a, b) => b.weightPct - a.weightPct)
      .slice(0, TOP_N);
    const topTickerList = topTickers.map((t) => t.ticker);

    // Two batched calls cover every top company at once, instead of one
    // KPI call and one analysis call per company (see Performance note above).
    const kpiByTicker = await this.deps.kpiRepo.getLatestByTickers(topTickerList);
    const analysisRecords = await this.deps.analysisRepo.listByTickersAndQuarterPair(
      topTickerList,
      sectorData.quarterPrevious,
      sectorData.quarter
    );
    const analysisByTicker = new Map<string, (typeof analysisRecords)[number]["analysis"]>();
    for (const record of analysisRecords) {
      if (analysisByTicker.has(record.ticker)) continue; // first record per ticker = most recent
      analysisByTicker.set(record.ticker, record.analysis);
    }

    const topCompanies: SectorThesisCompany[] = topTickers.map((t) => {
      const company: SectorThesisCompany = {
        ticker: t.ticker,
        signal: t.signal,
        direction: t.direction,
        weightPct: t.weightPct,
      };

      const kpiSnapshot = kpiByTicker.get(t.ticker);
      const highlight = kpiSnapshot?.kpis.find((k) => k.is_highlight);
      if (highlight) {
        company.topKpi = { name: highlight.name, changePct: highlight.change_pct };
      }

      const analysis = analysisByTicker.get(t.ticker);
      if (analysis) {
        company.managementConfidence =
          analysis.evasivenessScore < 4 ? "high" : analysis.evasivenessScore <= 7 ? "moderate" : "low";
      }

      return company;
    });

    return {
      sector: sectorData.sector,
      sectorLabel: sectorData.sectorLabel,
      quarter: sectorData.quarter,
      quarterPrevious: sectorData.quarterPrevious,
      companyCount: sectorData.companyCount,
      narrative: sectorData.narrative
        ? {
            competitiveStructure: sectorData.narrative.competitive_structure,
            strategicTheme: sectorData.narrative.strategic_theme,
            tailwinds: sectorData.narrative.tailwinds,
            headwinds: sectorData.narrative.headwinds,
            keyTriggers: sectorData.narrative.key_triggers,
            macroSensitivity: sectorData.narrative.macro_sensitivity,
            transformationSignal: sectorData.narrative.transformation_signal,
          }
        : null,
      dimensions: sectorData.dimensions.map((d) => ({
        dimension: d.dimension,
        signal: d.signal,
        direction: d.direction,
        weightedScore: d.weightedScore,
      })),
      topCompanies,
    };
  }
}
```

- [ ] **Step 5: Write the services composition root**

Create `lib/services/index.ts`:

```ts
import { sectorRepo, kpiRepo, analysisRepo } from "@/lib/repositories";
import { SectorThesisService } from "./sectorThesisService";

export const sectorThesisService = new SectorThesisService({ sectorRepo, kpiRepo, analysisRepo });
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `KpiRepository`, `AnalysisRepository`, or `SectorRepository`'s actual exported names differ from these imports, fix the import paths/names to match — they were confirmed during planning as: `KpiRepository` in `lib/repositories/kpis.ts`, `AnalysisRepository` in `lib/repositories/analysis.ts`, `SectorRepository` in `lib/repositories/sectors.ts`.

- [ ] **Step 7: Commit**

```bash
git add lib/services/sectorThesisService.ts lib/services/index.ts
git commit -m "feat: add SectorThesisService composing sector, kpi, and analysis repositories"
```

---

### Task 6: Products layer endpoint (sector-thesis)

**Files:**
- Create: `lib/api-contracts/v1/sectorThesis.ts`
- Create: `app/api/public/v1/products/sector-thesis/route.ts`

**Interfaces:**
- Consumes: `sectorThesisService` from `lib/services/index.ts` (Task 5) — `getSectorThesis(sector: string): Promise<SectorThesisResult>`; `NotFoundError`, `isDomainError` from `lib/services/errors.ts` (Task 2).
- Produces: `SectorThesisResponseV1`, `toSectorThesisResponseV1(result: SectorThesisResult): SectorThesisResponseV1`. Nothing downstream consumes this — it's the final endpoint in this plan.

- [ ] **Step 1: Write the contract**

Create `lib/api-contracts/v1/sectorThesis.ts`:

```ts
import type { SectorThesisResult } from "@/lib/services/sectorThesisService";
import type { SectorNarrativeV1, SectorDimensionV1 } from "@/lib/api-contracts/v1/sector";

export interface SectorThesisCompanyV1 {
  ticker: string;
  signal: string;
  direction: "positive" | "neutral" | "negative";
  weightPct: number;
  topKpi?: { name: string; changePct: number | null };
  managementConfidence?: "high" | "moderate" | "low";
}

export interface SectorThesisResponseV1 {
  sector: string;
  sectorLabel: string;
  quarter: string;
  quarterPrevious: string;
  companyCount: number;
  narrative: SectorNarrativeV1 | null;
  dimensions: SectorDimensionV1[];
  topCompanies: SectorThesisCompanyV1[];
  generatedAt: string;
}

export function toSectorThesisResponseV1(result: SectorThesisResult, generatedAt: string): SectorThesisResponseV1 {
  return {
    sector: result.sector,
    sectorLabel: result.sectorLabel,
    quarter: result.quarter,
    quarterPrevious: result.quarterPrevious,
    companyCount: result.companyCount,
    narrative: result.narrative,
    dimensions: result.dimensions.map((d) => ({
      dimension: d.dimension,
      signal: d.signal,
      direction: d.direction as "strengthening" | "stable" | "weakening",
      weightedScore: d.weightedScore,
    })),
    topCompanies: result.topCompanies.map((c) => ({
      ticker: c.ticker,
      signal: c.signal,
      direction: c.direction,
      weightPct: c.weightPct,
      topKpi: c.topKpi,
      managementConfidence: c.managementConfidence,
    })),
    generatedAt,
  };
}
```

- [ ] **Step 2: Write the route**

Create `app/api/public/v1/products/sector-thesis/route.ts`. The sector is passed as a query param (`?sector=IT`) since this is a Products-layer endpoint, not a Data-layer resource path:

```ts
import { NextRequest, NextResponse } from "next/server";
import { sectorThesisService } from "@/lib/services";
import { toSectorThesisResponseV1 } from "@/lib/api-contracts/v1/sectorThesis";
import { isDomainError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sector = req.nextUrl.searchParams.get("sector");
  if (!sector) {
    return NextResponse.json({ error: "sector query param required" }, { status: 400 });
  }

  try {
    const result = await sectorThesisService.getSectorThesis(sector);
    return NextResponse.json(toSectorThesisResponseV1(result, new Date().toISOString()));
  } catch (err) {
    if (isDomainError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/api-contracts/v1/sectorThesis.ts app/api/public/v1/products/sector-thesis/route.ts
git commit -m "feat: add sector-thesis Products-layer endpoint"
```

---

### Task 7: Partner/key provisioning script + full end-to-end smoke test

**Files:**
- Create: `scripts/provision-api-key.ts`

**Interfaces:**
- Consumes: `apiAccessRepo` from `lib/repositories/index.ts` (Task 1) — `createPartner`, `createKey`, `grantEntitlement`.
- Produces: nothing consumed by other code — this is an operational script, run manually via `npx tsx`.

- [ ] **Step 1: Write the provisioning script**

Create `scripts/provision-api-key.ts`. Since keys must never be stored in plaintext (only their SHA-256 hash lives in `api_keys.key_hash`), the script generates a random key, hashes it with the same algorithm the middleware uses, and prints the raw key exactly once:

```ts
import { randomBytes, createHash } from "node:crypto";
import { apiAccessRepo } from "@/lib/repositories";

function generateRawKey(): string {
  return "qzk_live_" + randomBytes(24).toString("base64url");
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function main() {
  const [, , partnerName, dailyQuotaArg, ...products] = process.argv;
  if (!partnerName || !dailyQuotaArg || products.length === 0) {
    console.error(
      "Usage: npx tsx scripts/provision-api-key.ts \"<partner name>\" <daily-quota> <product-name> [product-name ...]"
    );
    console.error(
      "Example: npx tsx scripts/provision-api-key.ts \"Acme PMS\" 1000 data:companies data:sectors products:sector-thesis"
    );
    process.exit(1);
  }

  const dailyQuota = Number(dailyQuotaArg);
  if (!Number.isInteger(dailyQuota) || dailyQuota <= 0) {
    console.error(`Invalid daily quota: ${dailyQuotaArg}`);
    process.exit(1);
  }

  const { id: partnerId } = await apiAccessRepo.createPartner(partnerName);
  const rawKey = generateRawKey();
  const keyHash = sha256Hex(rawKey);
  const { id: keyId } = await apiAccessRepo.createKey(partnerId, keyHash, dailyQuota);

  for (const product of products) {
    await apiAccessRepo.grantEntitlement(keyId, product);
  }

  console.log(`Partner created: ${partnerName} (${partnerId})`);
  console.log(`Key ID: ${keyId}`);
  console.log(`Daily quota: ${dailyQuota}`);
  console.log(`Entitled products: ${products.join(", ")}`);
  console.log("");
  console.log("Raw API key (shown once, not recoverable — store it now):");
  console.log(rawKey);
  console.log("");
  console.log("Example request:");
  console.log(
    `curl -H "Authorization: Bearer ${rawKey}" "http://localhost:3000/api/public/v1/data/companies/RELIANCE"`
  );
}

main().catch((err) => {
  console.error("Provisioning failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Provision a self-issued test key**

Run: `npx tsx scripts/provision-api-key.ts "Internal Test Partner" 1000 data:companies data:sectors products:sector-thesis`

Expected output: a partner ID, key ID, and a raw key printed once (starts with `qzk_live_`). Copy the raw key — it will not be shown again.

- [ ] **Step 3: Full end-to-end smoke test**

With `npm run dev` running, and `<KEY>` replaced by the raw key from Step 2, and `<TICKER>`/`<SECTOR>` replaced by a ticker/sector that has existing cached data in this environment (e.g. `RELIANCE` and a seeded sector name — check via the existing internal `/api/v1/available` or `/api/v1/sectors/seed` routes if unsure which have data):

```bash
curl -i -H "Authorization: Bearer <KEY>" "http://localhost:3000/api/public/v1/data/companies/<TICKER>"
```
Expected: `HTTP/1.1 200` with a `CompanyResponseV1`-shaped JSON body.

```bash
curl -i -H "Authorization: Bearer <KEY>" "http://localhost:3000/api/public/v1/data/sectors/<SECTOR>"
```
Expected: `HTTP/1.1 200` with a `SectorResponseV1`-shaped JSON body.

```bash
curl -i -H "Authorization: Bearer <KEY>" "http://localhost:3000/api/public/v1/products/sector-thesis?sector=<SECTOR>"
```
Expected: `HTTP/1.1 200` with a `SectorThesisResponseV1`-shaped JSON body, including a non-empty `topCompanies` array (assuming the sector has company signals).

```bash
curl -i -H "Authorization: Bearer <KEY>" "http://localhost:3000/api/public/v1/data/companies/NOTATICKER"
```
Expected: `HTTP/1.1 404` with body `{"error":"no analysis available for ticker 'NOTATICKER'"}`.

Entitlement check — provision a second key without the `products:sector-thesis` entitlement:

```bash
npx tsx scripts/provision-api-key.ts "Limited Partner" 1000 data:companies
```

```bash
curl -i -H "Authorization: Bearer <LIMITED_KEY>" "http://localhost:3000/api/public/v1/products/sector-thesis?sector=<SECTOR>"
```
Expected: `HTTP/1.1 403` with body containing `"is not entitled to 'products:sector-thesis'"`.

Rate limit check — provision a key with a quota of 1, then call it twice:

```bash
npx tsx scripts/provision-api-key.ts "Quota Test" 1 data:companies
curl -i -H "Authorization: Bearer <QUOTA_KEY>" "http://localhost:3000/api/public/v1/data/companies/<TICKER>"
curl -i -H "Authorization: Bearer <QUOTA_KEY>" "http://localhost:3000/api/public/v1/data/companies/<TICKER>"
```
Expected: first call `HTTP/1.1 200`, second call `HTTP/1.1 429` with body `{"error":"daily rate limit exceeded"}`.

Confirm structured log lines appeared in the `npm run dev` terminal for every request above (requestId, partnerId, keyId, endpoint, status, latencyMs).

- [ ] **Step 4: Type-check the whole branch**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/provision-api-key.ts
git commit -m "feat: add API key provisioning script"
```

---

## Self-Review Notes

**Spec coverage:** Auth/entitlements (Task 1, 3, 7) ✓. Rate limiting (Task 1, 3, 7) ✓. Error boundaries (Task 2, used throughout) ✓. Observability (Task 3, now including `product` per request) ✓. Versioning (`/v1/` in every route path, Tasks 4/6) ✓. Response contract stability / anti-corruption layer (Task 4, 6) ✓. Two-layer REST architecture with the one named example product (Task 4 Data layer, Task 5-6 Products layer) ✓. "Without revealing the code" — curated contracts omit pipeline-internal fields (Task 4 Step 4/6, Task 6 Step 1) ✓. Provisioning via internal script, no self-serve UI (Task 7) ✓. No caching added (none of Tasks 1-7 add caching) ✓. No second product built (only `sector-thesis`) ✓. No `AzureXRepository`, no AI-provider abstraction, no transaction-aware repos, no domain-error taxonomy on the 11 internal repos, no per-layer observability beyond request-level logging, no GraphQL — none of these appear anywhere in this plan ✓.

**Placeholder scan:** No TBD/TODO markers; every step has complete code; every command has an expected output.

**Type consistency:** `ApiKeyInfo`, `ApiAccessRepository` method signatures used identically across Task 1 (definition), Task 3 (middleware consumption), and Task 7 (script consumption). `SectorThesisResult`/`SectorThesisCompany` defined in Task 5 match their consumption in Task 6's `toSectorThesisResponseV1`. `SectorNarrativeV1`/`SectorDimensionV1` defined in Task 4 are reused by name in Task 6 rather than redefined. `getLatestByTicker`'s and `listByTickersAndQuarterPair`'s query column names (`company_ticker`, `q_prev`, `q_curr`) in Task 4/5 were re-verified against the real `SupabaseAnalysisRepository.listAllByTickers`/`listByTickersAndQuarterPair` implementations, not guessed — an earlier draft of `getLatestByTicker` used wrong column names (`ticker`, `quarter_previous`) and was corrected before finalizing.

**Changes from external review (this round):** registry-driven product-route mapping replacing a hardcoded if/else (Task 3); `product` added to structured logs (Task 3); rate limiting explicitly marked best-effort with a stated escalation path (Task 3); `AnalysisRepository.getLatestByTicker` added so the companies route no longer leaks "sort and take first" (Task 4); `KpiRepository.getLatestByTickers` batch method plus reuse of the existing `listByTickersAndQuarterPair` batch method, cutting `SectorThesisService` from up to ~2N DB calls to a fixed 3 (Task 5); `generatedAt` added to all three response contracts (Task 4, 6); curl example in the provisioning script's output (Task 7); a documented-not-built note on splitting `ApiAccessRepository` (Task 1). Two suggestions were not applied because they contradict the spec's already-approved design rather than this plan's own choices — flagged to the user rather than silently changed: (1) moving product entitlement checks out of middleware and into services, and (2) wrapping the Data-layer routes in a pass-through service. Both are recorded as named-not-built future extensions in Task 1/Task 3's notes so the reasoning isn't lost if raised again.
