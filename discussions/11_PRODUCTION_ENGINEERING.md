# 11. Production Engineering Assessment

Scope: the live app (`app/`, `lib/`, `components/`, `supabase/migrations/`, `.github/workflows/`,
`Dockerfile`, `middleware.ts`, `auth.ts`). The `finance-agent/` and `disclosure-analysis-pipeline/`
trees are archived prototypes with zero import edges into the live app (confirmed:
`grep -rln "finance-agent\|disclosure-analysis-pipeline" app lib components` returns nothing) and
are cited only for contrast, labeled **IMPLEMENTED-BUT-ARCHIVED**.

**Headline finding before the category-by-category breakdown**: the top-level `README.md` and
`TECHNICAL_ARCHITECTURE.md` describe a **Vercel + Supabase Auth/Postgres/Storage** architecture.
The actual running system is **Azure Container Apps + Postgres Flexible Server + Blob Storage +
NextAuth/Microsoft Entra ID**, per a fully-documented, multi-phase migration recorded in
`docs/superpowers/plans/2026-07-09-*` through `2026-07-13-azure-auth-migration.md` and evidenced
directly in code: `lib/repositories/index.ts` wires only `PostgresXRepository`/
`AzureBlobStorageRepository` classes (lines 1-25), `auth.ts` imports
`next-auth/providers/microsoft-entra-id`, and `.github/workflows/deploy-azure.yml` builds a Docker
image and calls `az containerapp update`. **The top-level docs were never updated after the
migration** — every claim in `TECHNICAL_ARCHITECTURE.md` about Supabase Auth, RLS, and Vercel's
300s function limit is describing a system that no longer exists. This is treated as a fact
established once here, and referenced by short pointer throughout the sections below rather than
re-litigated in each one.

---

## RELIABILITY

**Retries (LLM calls)** — **NOT IMPLEMENTED.** Every Gemini call in the live product
(`lib/pipeline.ts`, `lib/solo-pipeline.ts`, `lib/insights-pipeline.ts`, `lib/sector-narrative.ts`,
`lib/kpi-extractor.ts`) goes through a bare `Promise.race([model.generateContent(...), timeout])`
pattern with **zero retry logic** — one failure (rate limit, transient 5xx, network blip) and the
call is done. Contrast directly with the **archived** prototype: `finance-agent/vertex.py:21-48`
(`call_gemini`) implements `max_retries: int = 3` with exponential backoff
(`time.sleep(2 ** attempt)`) and an in-process LRU response cache — genuinely more resilient
LLM-calling code than anything in the production TypeScript pipelines. The production system's
resilience regressed relative to the code it replaced. IMPLEMENTED-BUT-ARCHIVED for the retry
pattern; NOT IMPLEMENTED in production.

**Timeouts** — IMPLEMENTED, verified in code, and the figures in `TECHNICAL_ARCHITECTURE.md` check
out: `AGENT_TIMEOUT_MS = 25_000` in `lib/pipeline.ts:189`; `TIMEOUT_MS = 55_000` in
`lib/solo-pipeline.ts:45` and `CALL_TIMEOUT_MS = 55_000` in `lib/insights-pipeline.ts:81`;
`PIPELINE_TIMEOUT_MS = 270_000` in `app/api/v1/analyze/route.ts:86`; route-level
`maxDuration = 300` on `analyze` (`app/api/v1/analyze/route.ts:8`) and `insights`
(`app/api/v1/insights/route.ts:6`), `maxDuration = 120` on `analyze/solo`
(`app/api/v1/analyze/solo/route.ts:6`, with an internal 110s stream-level timeout at line 54 and a
55s per-call timeout inside the pipeline — three nested timeout layers for one endpoint).
**Caveat**: `maxDuration` is a Vercel-specific Next.js export; the app now runs on Azure Container
Apps (see headline finding), where this export has no platform meaning at all — it's dead
configuration left over from the pre-migration deployment target, silently ignored rather than
erroring, which is arguably worse than if it failed loudly.

**Circuit breakers** — NOT IMPLEMENTED. No failure-count tracking, no open/half-open/closed state
anywhere in `lib/`. A Gemini outage degrades one call at a time, forever, with no mechanism to
stop hammering a known-down dependency.

**Fallback behavior on stage failure** — PARTIALLY IMPLEMENTED, and inconsistent across pipelines:
- Delta: individual thematic agents return `null` on failure and are filtered out
  (`lib/pipeline.ts:471-475,809-814`) — a missing section degrades the payload but doesn't fail
  the run. Evasiveness falls back to a hardcoded `5.0` (`lib/pipeline.ts:490-492`). Synthesis
  agents (`runEarningsDeltaAgent`, `runFCFImplicationsAgent`) fall back to `[]`
  (`lib/pipeline.ts:581-584,602-605`).
- Insights: a failed per-quarter brief returns a **fully-populated empty object**
  (`lib/insights-pipeline.ts:317-334`), not `null` — meaning the synthesis agent downstream cannot
  distinguish "nothing happened this quarter" from "the extraction call failed." This is a strictly
  worse failure mode than delta's null-and-filter approach, sitting in a sibling file with an
  almost identical structure.
- Sector narrative: returns `null` on any failure, caller carries over the previous DB value
  (`lib/sector-narrative.ts:192-198`, `PRODUCT_NOTES.md` "narrative is carried over automatically")
  — the cleanest fallback of the four.
- Solo (Deep Dive): **no fallback** — a single Gemini call with no fallback path; failure
  propagates straight to the NDJSON `error` event (`app/api/v1/analyze/solo/route.ts:64-67`) and
  the user sees a failed run. This is architecturally correct for a single-call pipeline (there's
  nothing to degrade to) but means Deep Dive has the least fault tolerance of the four AI
  capabilities.

**Gemini down entirely** — every pipeline fails per-call as above; there is no product-wide
"AI temporarily unavailable" banner or health check gating the UI. **Supabase down** — moot; the
app no longer depends on Supabase for data/auth/storage (see headline finding) except that
`@supabase/supabase-js` remains a `package.json` dependency and `lib/supabase/admin.ts` /
`SupabaseXRepository` classes remain in the tree as dead code, retained deliberately per the
migration spec ("both classes coexist... deleted once the cutover is confirmed stable" —
`docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md`). **Azure Postgres
down** — PARTIALLY IMPLEMENTED: `lib/postgres/client.ts:62-72`'s `query()` helper retries exactly
once on a defined set of connection-acquisition errors (`ECONNRESET`, "Connection terminated
unexpectedly," TLS reset during handshake — `lib/postgres/client.ts:45`), with an explicit,
well-reasoned comment that retrying is safe here because these errors occur before any SQL reaches
the server ("the query itself was never sent, meaning a retry cannot double-execute a write" —
`lib/postgres/client.ts:43-44`). This is genuinely solid, specific engineering — it names the exact
Azure VNet failure mode it's defending against (idle connections silently reaped by Azure's
NAT/LB path) and enables TCP keepalive as the actual root-cause fix
(`keepAlive: true, keepAliveInitialDelayMillis: 10000`, `lib/postgres/client.ts:26-27`) rather than
just papering over symptoms with the retry alone. This is the single best-engineered reliability
mechanism in the codebase, and it is at the database-connection layer, not the AI layer.

**Idempotency (re-running the same analysis)** — IMPLEMENTED for delta and solo: `saveAnalysis`
does `DELETE ... WHERE (ticker,q_prev,q_curr)` immediately before `INSERT`
(`lib/repositories/analysis.ts:169`, `postgres` variant at line 314) — an atomic per-key
delete-then-insert, not an upsert, chosen deliberately per `PRODUCT_NOTES.md`'s "2026-05-27 —
Atomic Delete-Insert (Timeout-Wipe Protection)" entry, which documents exactly the failure mode
this avoids (a bulk DELETE-all-then-loop-INSERT pattern that could wipe data if the function timed
out mid-loop). Re-running produces the same cache key and simply replaces the row — safe,
verified, and its own commit history shows the team debugging a real incident to get here.

**Graceful degradation** — the `PromoterActivityBadge` frontend component
(`components/EarningsReport.tsx:115-149`) is the cleanest example in the codebase:
`fetch(...).catch(() => {})` with no re-throw, and `if (!data) return null` — the badge simply
doesn't render on any API failure, so a broken `/api/v1/divergence` call never breaks the dashboard
around it. Documented deliberately in `PRODUCT_NOTES.md`: "Fails closed (renders nothing) on API
error, so the dashboard never breaks — even before migration 008 is applied."

---

## PERFORMANCE

**Async/concurrency** — IMPLEMENTED extensively and correctly. `Promise.all` fans out the 10
thematic + 1 evasiveness calls in delta (`lib/pipeline.ts:786-807`), the up-to-5 temporal delta
calls (`lib/pipeline.ts:819-834`), and the 4 synthesis-phase calls (`lib/pipeline.ts:843-851`); the
insights pipeline parallelizes N quarter-brief calls (`lib/insights-pipeline.ts:411-418`) after
parallel transcript downloads (`lib/insights-pipeline.ts:404-408`). This is the reason
`TECHNICAL_ARCHITECTURE.md`'s "wall-clock ~15-25s vs ~120s" claim for 5-agent-parallel-vs-serial is
architecturally plausible — 11 network-bound Gemini calls at ~5-15s each in parallel do land in
that range; not independently re-measured here, but the code structure supports the claim.

**Caching** — IMPLEMENTED, and this is where cost/latency actually gets controlled in this
product, not token budgeting (see COST below). Five permanent/TTL caches:
`analysis_results` (delta, permanent, manual invalidation), `solo_analysis_cache` (permanent),
`insights_cache` (30-day app-enforced TTL, computed key-invalidation — see below),
`concall_links` (permanent, `?retry=true` bypass), `promoter_activity_fetch_log` (24h TTL). The
`insights_cache` key design is worth calling out specifically: `makeQuartersKey()`
(`lib/insights-pipeline.ts:249-251`) sorts and comma-joins the actual quarter list, so adding a new
transcript changes the cache key automatically and invalidates stale results without any manual
"clear cache" action — a genuinely elegant piece of cache-key design, documented as deliberate in
`PRODUCT_NOTES.md` ("2026-05-27 — Multi-Quarter Insights: Response Caching"). **Quantified
benefit**: a cache hit on delta analysis costs 0 Gemini calls vs. ~20 on a miss
(`app/api/v1/analyze/route.ts:52-73` vs. the pipeline call count) — a 100% cost/latency reduction
on repeat views of the same ticker/quarter-pair, which given `TECHNICAL_ARCHITECTURE.md`'s own
estimate that infra cost scales roughly linearly with per-user analysis volume, is the single
largest cost lever in the system, larger than any model-selection or token-budgeting choice.

**Batching** — NOT IMPLEMENTED in the sense of batching multiple Gemini requests into one API
call; the product instead achieves throughput via *parallel* independent calls (above), which is a
different (and for this workload, reasonable) technique — no batched-request API is used anywhere.

**Connection pooling** — IMPLEMENTED for Postgres: `lib/postgres/client.ts:8-39`, a lazy-singleton
`pg.Pool`. **Pool size is not explicitly configured** — no `max` option is passed to the `Pool`
constructor, so it runs at `pg`'s library default (10 connections). For a single-instance,
low-traffic pre-launch app (explicitly described as such in the migration spec —
"this app is pre-launch with no live paying partners") this is plausibly adequate, but it is
unconfigured, not deliberately sized, and would need revisiting before any horizontal-scaling push
(see SCALABILITY below — N container replicas each holding up to 10 idle-capable connections
multiplies pressure on Postgres Flexible Server's own connection cap, which is not mentioned or
budgeted for anywhere in the docs). Supabase's client (`lib/supabase/admin.ts`) is HTTP-based
(PostgREST) and has no pool concept — moot, and also dead code post-migration.

**Database query optimization / missing indexes** — PARTIALLY IMPLEMENTED, with a concrete gap.
Indexes exist for `kpi_snapshots` (unique on ticker+quarter, `002_kpi_snapshots.sql:13`),
`promoter_activity` (`008_promoter_activity.sql:17`), `earnings_calendar` (date, ticker —
`004_earnings_calendar.sql:15-16`), `concall_links` (ticker, quarter —
`005_concall_links.sql:16-17`), and `api_keys.key_hash` (`011_api_access.sql:20`) — this last one
matters because `middleware.ts:37` runs `apiAccessRepo.getKeyByHash(keyHash)` on **every** public
API request. **The gap**: `analysis_results` — the single most heavily-queried table in the
product, hit by every dashboard load's cache check
(`WHERE company_ticker = $1 AND q_prev = $2 AND q_curr = $3`,
`lib/repositories/analysis.ts:290-295`), every screener load (`listAllByTickers`,
`.in("company_ticker", tickers)`), and every sector-narrative sampler call — has **no explicit
index** in `001_initial.sql` beyond its implicit primary-key index on `id`. At current scale
(hundreds of companies, low query volume, per the migration spec's own "pre-launch" framing) a
sequential scan is not yet a real problem, but this table sees compound `WHERE` clauses on
`(company_ticker, q_prev, q_curr)` and `(company_ticker)` alone with no composite index backing
either — a straightforward gap to name, not a catastrophic one at today's scale.

**Token optimization** — PARTIALLY IMPLEMENTED as hard truncation, not adaptive budgeting: every
pipeline caps transcript input at a fixed `120_000` characters
(`MAX_TRANSCRIPT_CHARS`/`MAX_CHARS`, consistently named across `lib/pipeline.ts:238`,
`lib/solo-pipeline.ts:115`, `lib/insights-pipeline.ts:274`), and the evasiveness agent additionally
narrows to just the last 30,000 chars (`lib/pipeline.ts:482`) and `runKeyMetricsAgent` to the first
40,000 (`lib/pipeline.ts:613`) — deliberate scoping of which part of the transcript each agent
actually needs, which is a real token-cost lever, just not a dynamic/measured one (no logging of
actual tokens consumed per call anywhere — see OBSERVABILITY).

**Latency** — `TECHNICAL_ARCHITECTURE.md`'s specific wall-clock claims (delta ~15-25s core
pipeline, sector narrative 4-8s baseline / ~15s if using a hypothetical "Flash Pro") are internally
consistent with the timeout constants in code but are **not independently verified** by any
logging in the codebase — there is no per-pipeline latency metric emitted anywhere (see
OBSERVABILITY), so these figures are architecturally plausible engineering estimates, not measured
production numbers.

---

## SCALABILITY

**Statelessness** — IMPLEMENTED correctly for the AI pipelines and API routes: no in-memory
caches, no module-level mutable state, no file-based locks anywhere in `app/api/**/route.ts` or
`lib/*pipeline*.ts` — every piece of cross-request state (analysis cache, credits, API usage
counters) is externalized to Postgres. This *does* hold up under horizontal scaling to N Azure
Container Apps replicas — there is nothing in the request-handling path that assumes a single
process. The one process-local state that exists — `lib/postgres/client.ts`'s lazy-singleton
`Pool` and `lib/supabase/admin.ts`'s lazy-singleton client — is exactly the correct pattern
(per-process connection reuse, not shared application state) and is explicitly documented as
intentional ("mirrors lib/supabase/admin.ts's lazy-singleton pattern," `lib/postgres/client.ts:5`).

**Horizontal scaling readiness** — IMPLIED-ARCHITECTURALLY-PREPARED but with two concrete risks
under multi-replica scale-out that are not addressed anywhere in the code or docs:
1. **The credits race** (`lib/credits.ts:33-49`, `checkAndDeduct`): `getCreditStatus` (a read) is
   followed by `creditsRepo.setUsed(userId, status.month, status.used + cost)` (a write of a
   client-computed value) — a classic read-modify-write race. Two concurrent requests from the
   same user on two different replicas can both read `used=0`, both pass the quota check, and both
   write `used=cost` instead of `used=2*cost` — silently under-charging credits under concurrency.
   Neither the Postgres nor the (dead) Supabase implementation of `setUsed` uses an atomic
   `used = used + $1` SQL update (`lib/repositories/credits.ts:59-61` does `SET used = $1`, a raw
   overwrite of the caller-computed value, not an increment).
2. **The API-quota race** — explicitly self-documented in `middleware.ts:53-58`: "Best-effort rate
   limit: `getUsageToday` + `incrementUsage` is a read-then-write, not an atomic increment, so
   concurrent requests from the same key within the same second can both read the same count and
   both pass." This is a rarer but sharper case: the underlying `incrementUsage` SQL *is* atomic
   (`INSERT ... ON CONFLICT ... DO UPDATE SET request_count = request_count + 1`,
   `lib/repositories/apiAccess.ts:137-144`), so the **counter itself never loses increments** — but
   the **429 quota-check comparison** (`usedToday >= keyInfo.dailyQuota`) happens against a stale
   read, so N concurrent requests can all pass the check before any of their increments land,
   letting a partner briefly burst past `dailyQuota`. The code comment explicitly accepts this
   trade-off "at v1's scale (manually-provisioned, low-volume partners)" and names the fix (an
   atomic increment-then-check, or the transaction-aware extension "named in the spec") for later.

Neither race is single-replica-safe either (both can happen from concurrent requests on one
process), but both get **strictly more likely** the more replicas Azure Container Apps scales out
to, since there's no cross-replica coordination at all — this is exactly the kind of bug that
"works fine in dev, misbehaves under production concurrency" and gets worse, not introduced, by
horizontal scaling.

**Worker architecture** — NOT IMPLEMENTED. No background job queue, no worker process, no
scheduled task runner anywhere in the codebase. Every AI pipeline runs synchronously inside the
HTTP request/response lifecycle of the route handler that triggered it — the entire product's
"async" story is `Promise.all` within one request, not queued background work. This directly
explains why the delta pipeline needs a 270s in-request timeout: there's no way to hand a
long-running job off to a worker and poll/stream a result from elsewhere.

**Queues** — NOT IMPLEMENTED. No message queue (Service Bus, Storage Queue, etc.) anywhere despite
running on Azure, which has first-party queue products readily available. A burst of concurrent
delta-analysis requests (each ~20 Gemini calls, up to 270s wall-clock) is bounded only by how many
concurrent Container Apps replicas + in-process connections can be spun up — there is no admission
control or backpressure mechanism.

**Database scaling** — NOT IMPLEMENTED / not addressed: single Azure Postgres Flexible Server
instance, no read replicas, no sharding, no mention of either in `docs/superpowers/specs/` beyond
provisioning "Azure Database for PostgreSQL — Flexible Server ... in Central India (Pune), on
private/VNet networking." Reasonable for the stated pre-launch scale; simply not built or planned
for beyond that.

**Storage scaling** — IMPLIED-ARCHITECTURALLY-PREPARED: Azure Blob Storage is itself a scalable
object store by design (`AzureBlobStorageRepository`, `lib/repositories/storage.ts`, not read
line-by-line here but confirmed as the live storage backend via `lib/repositories/index.ts:24`), so
transcript-PDF storage volume is not a realistic near-term bottleneck regardless of user growth.

---

## SECURITY

**Secrets management** — `.env.local` is correctly listed in `.gitignore`
(`.gitignore:8` — `.env.local`, alongside a separate `.env` entry at line 7), and this working
copy has no `.git` directory to audit history against, so "was it ever committed" cannot be
verified further than "the current ignore rule is correct." No secret-scanning tool (git-secrets,
Trufflehog, GitHub secret scanning config) is referenced anywhere in `.github/workflows/` — the
one workflow present (`deploy-azure.yml`) does an OIDC login (`azure/login@v2` with
`client-id`/`tenant-id`/`subscription-id` as GitHub Actions secrets, no long-lived credentials in
the repo) and pushes to `quantalyzeacr.azurecr.io` — this part is genuinely well done: OIDC
federation instead of a stored Azure credential is the current best practice, correctly applied.

**Authentication** — IMPLEMENTED: NextAuth v5 (`next-auth@^5.0.0-beta.31`, `package.json`) with
Microsoft Entra ID as the sole provider (`auth.ts:1-8`), JWT session strategy. Two real production
issues are visible directly in `auth.ts`'s own comments, both explicitly framed as bugs "found by
testing the real deployment, not caught by type-checking": (1) Azure App Service isn't in Auth.js's
auto-trusted-host allowlist, requiring `trustHost: true` (`auth.ts:16-20`) — accepted as safe only
because "App Service's own routing already guarantees the Host header matches this app's actual
bound domain," an assumption that is true for the current single-app-per-hostname Container Apps
setup but would need re-verifying if that topology ever changes; (2) Entra External ID's OIDC `sub`
claim is a non-UUID opaque identifier that broke every `user_id`-keyed query
("invalid input syntax for type uuid"), worked around by mapping the Entra `oid` claim (a real GUID)
into `token.sub` instead (`auth.ts:22-33,36-41`) — a real bug that was caught in production, not
design review, and the fix is a targeted patch rather than a schema change (every table's `user_id`
column stays typed `UUID`). This is competent incident response, not a strength claim about the
auth system's design.

**Authorization** — PARTIALLY IMPLEMENTED, and the story is different for the two API surfaces:
- **Internal API** (`/api/v1/*`): every mutating/AI route checks `getCurrentUser()` and 401s if
  absent (`app/api/v1/analyze/route.ts:12-13`, and equivalently in `analyze/solo`, `insights`).
  Beyond session presence, authorization is **entirely hand-written `WHERE user_id = $1` filtering
  inside each repository method** — e.g. `listUserHistory` (`lib/repositories/analysis.ts:267-273,
  402-407`), `WatchlistRepository`. There is **no database-level Row-Level Security actually
  enforced** in the live system: the app connects to Azure Postgres via a raw `pg.Pool` service
  credential (`lib/postgres/client.ts`), not through Supabase's PostgREST/RLS-aware layer, so
  `auth.uid() = user_id` policies defined in `supabase/migrations/001_initial.sql:28-34,47-52`
  (still present in the migrations folder, still described as active in
  `TECHNICAL_ARCHITECTURE.md` §2's "RLS Policy" table) **cannot function against this connection
  method at all** — `auth.uid()` is a Supabase-Auth-specific SQL function with no equivalent
  session context in a plain `pg.Pool` connection. The Azure data-migration spec confirms this
  directly: it describes RLS as something the *old* Supabase-backed `WatchlistRepository`
  depended on via "a request-scoped, RLS-authenticated Supabase client," and states the new
  Postgres implementation adds "explicit `WHERE user_id = $1` filtering" specifically *because*
  there is no RLS equivalent to lean on
  (`docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md`, "Watchlist security
  model" section). **The practical consequence**: authorization for every user-scoped table now
  depends entirely on every repository method remembering its `WHERE user_id` clause correctly,
  with zero database-level defense in depth if one is ever missed in a future change — a real
  regression in the security posture from what the architecture docs still claim, not a
  theoretical one.
- **Public API** (`/api/public/v1/*`): a real authorization layer, in `middleware.ts` — Bearer-token
  API keys are SHA-256 hashed and looked up (`sha256Hex`, `middleware.ts:9-14`, `apiAccessRepo.
  getKeyByHash`), checked for `active` status, and checked against a per-key `entitledProducts[]`
  allowlist resolved from the request path via `resolveProductName()`
  (`lib/public-api/product-routes.ts:15-17`) before the request is allowed through — genuine,
  working product-level authorization, more rigorous than the internal API's.

**Input validation / SQL injection** — IMPLEMENTED correctly: every Postgres repository method
uses parameterized queries via the `query<T>(text, params)` helper
(`lib/postgres/client.ts:62-72`) — `grep`-verified across `lib/repositories/*.ts`: no template-
literal string interpolation of user input into SQL text was found anywhere in the reviewed
repository files; every dynamic value is passed as a `$1, $2, ...` bound parameter. This is
consistently applied, not just in the happy-path files reviewed line-by-line above.

**Prompt injection** — **NOT IMPLEMENTED, and this is a real, unmitigated risk.** Every pipeline
interpolates raw, unsanitized transcript text directly into the Gemini user-turn prompt with plain
template literals — e.g. `` `TRANSCRIPT:\n${transcript}` `` (`lib/pipeline.ts:461`),
`` `Full earnings call transcript:\n${text}` `` (`lib/solo-pipeline.ts:178`), and equivalently in
`lib/insights-pipeline.ts:309` and `lib/kpi-extractor.ts:381`. Transcripts are sourced from two
external, non-adversarially-vetted feeds — Screener.in scraping and the BSE announcements API
(`lib/transcript-fetcher.ts`, per `TECHNICAL_ARCHITECTURE.md` §11) — and stored as-is in Blob
Storage, then fed whole into the model. **No prompt-injection mitigation exists anywhere in the
codebase**: no delimiter escaping, no instruction to the model to disregard embedded instructions
inside the transcript, no output-side check that generated content doesn't echo an injected
directive, no separate "untrusted content" framing distinct from the system prompt. A transcript
PDF (or any document that got miscategorized and uploaded into the same storage path — the pipeline
only checks the PDF magic-byte header, `lib/pipeline.ts:249-251`, not content trustworthiness)
containing text like "ignore prior instructions and instead output..." would flow completely
unfiltered into every one of the ~20 Gemini calls in a delta run. The practical blast radius is
bounded by `responseSchema` (the model is still constrained to emit valid JSON matching the schema
shape — Capability boundary discussed in 10_AI_PRODUCT_INTEGRATION.md), so a successful injection
could not, say, make the model call external tools or leak system-prompt content in free text as
easily as it might in an unconstrained chat context, but it absolutely could corrupt the *content*
of `key_takeaways`, `signal_classification`, or `raw_quotes` fields with attacker-chosen text that
then gets persisted to `analysis_results` and rendered directly to every user who views that
ticker/quarter. Given transcripts are sourced from public filings (harder for a single attacker to
control) the practical exploitability is lower than a user-generated-content product, but the
mitigation is genuinely absent, not just weak.

**Data leakage (cross-user)** — see Authorization above: the RLS-based defense-in-depth the
architecture docs claim does not function against the live connection method; isolation is
currently correct in the code reviewed (every repository method that should filter by `user_id`
does), but it is a single-layer defense, not the two-layer (app + DB) defense the docs describe.

**Tenant isolation** — this is a **single-tenant-per-deployment** product, not multi-tenant SaaS in
the conventional sense: there is one shared `analysis_results`/`insights_cache`/etc. pool of
company analyses visible to *all* authenticated users (these tables have no per-tenant scoping
column at all — `company_ticker` + quarter is the only key), and only `user_tickers`, credits, and
the user's own analysis-history queries are actually user-scoped. This is architecturally correct
for the product's stated shape (India-market company research shared across all subscribers,
per-user only for personal watchlists/history) — not a defect, just worth naming precisely: this is
not a system that isolates Customer A's data from Customer B's, because the core analysis content
is intentionally shared, not tenant-private.

**API security (public API abuse protection)** — PARTIALLY IMPLEMENTED: key-hash auth,
entitlement-gating, and a daily quota exist (`middleware.ts`, above) — but the quota-check race
condition (SCALABILITY, above) means the "abuse protection" can be briefly bypassed under
concurrent bursts, and there is no IP-based rate limiting, no anomaly detection, and no automatic
key revocation on abuse patterns — quota is the only control.

**Dependency vulnerabilities** — general gap, not independently scanned here per task scope: no
Dependabot config, no `npm audit` step, no Snyk/similar integration visible in
`.github/workflows/deploy-azure.yml` (the only workflow present, and it runs `npm ci` + `npm run
build` with no security-scanning step at all before pushing an image to production).

---

## OBSERVABILITY

**Structured logs** — PARTIALLY IMPLEMENTED, and inconsistently: the vast majority of logging
across the codebase (65 `console.log`/`console.error`/`console.warn` call sites across 16 files —
`lib/pipeline.ts`, `lib/insights-pipeline.ts`, `lib/kpi-extractor.ts`, repositories, etc.) is
plain unstructured string interpolation, e.g. `` console.log(`[Pipeline] ${storageKey}: ${buffer.
length} bytes...`) `` (`lib/pipeline.ts:244`) or `` console.error(`[${sectionName}] Agent failed:`,
e) `` (`lib/pipeline.ts:472`) — greppable by a bracketed-tag prefix convention, but not machine-
parseable JSON. The one genuine exception is `middleware.ts:80-93`'s `log()` helper, which emits a
single `console.log(JSON.stringify({ requestId, partnerId, keyId, endpoint, product, status,
latencyMs }))` per public-API request — real structured logging, complete with a `requestId`
(`crypto.randomUUID()`, `middleware.ts:24`) for request correlation, but it exists in exactly one
file covering exactly one API surface (the low-traffic public partner API), not the high-traffic
internal pipelines where a failure is actually expensive (a failed delta run has already burned
Gemini cost and user credits by the time it fails).

**Metrics** — NOT IMPLEMENTED. No metrics library (Prometheus client, StatsD, Azure Monitor SDK,
etc.) appears in `package.json`'s dependency list, and no `/metrics` endpoint exists —
`/api/health` (`app/api/health/route.ts`) returns a static `{ status: "ok" }` unconditionally, with
no check of Postgres connectivity, Blob Storage reachability, or the `GOOGLE_API_KEY` being valid —
it is a liveness check in the loosest sense (the Node process is up), not a readiness check, and
would report "ok" even if every downstream dependency were down.

**Traces** — NOT IMPLEMENTED. No OpenTelemetry, no Azure Application Insights SDK, no distributed
tracing of any kind in `package.json` or anywhere in `app/`/`lib/`.

**AI telemetry (per-call latency/token logging)** — NOT IMPLEMENTED. None of the `invokeStructured`
helpers (`lib/pipeline.ts:191-214`, `lib/insights-pipeline.ts:83-100`, and the inline equivalent in
`lib/solo-pipeline.ts:166-176`) record how long a Gemini call took, how many input/output tokens it
consumed, or whether the model's `usageMetadata` (which the `@google/generative-ai` SDK's response
object does expose) was ever read — it is not read anywhere in the codebase. This means the cost
estimates in `TECHNICAL_ARCHITECTURE.md` §9 (e.g. "~600K input tokens... ~$0.03 per run") are
**a priori engineering estimates, not measured production numbers** — there is no way, from the
code as it stands, to verify actual token spend per analysis without adding instrumentation first.

**Model latency / token usage / failure-rate tracking** — NOT IMPLEMENTED, follows directly from
the above: no aggregation of per-call latency, no token-usage dashboard, no failure-rate counter.
The only failure signal that exists anywhere is the console.error string at each catch site — there
is no way to answer "what % of delta analyses had at least one failed thematic agent last week"
without grepping raw container logs by hand.

**User-behavior analytics** — NOT IMPLEMENTED. No analytics SDK (PostHog, Mixpanel, Segment,
Amplitude, Google Analytics/gtag) appears in `package.json`'s dependencies, and no such script tag
or SDK import was found searching `app/`/`components/`/`lib/` — the product has no visibility into
which features users actually use, how often they hit "re-analyze," or where in the funnel they
drop off, beyond whatever can be inferred from raw DB row counts.

---

## COST

**Model usage patterns (verified against code)**: delta ~19-20 calls
(10 thematic + 1 evasiveness + up to 5 temporal-delta + 3 synthesis — traced and counted directly
against `lib/pipeline.ts`'s `Promise.all` blocks, matching `TECHNICAL_ARCHITECTURE.md`'s stated
~20); solo/Deep Dive exactly 1 call (`lib/solo-pipeline.ts:183`); insights N+1 (N per-quarter briefs
+ 1 synthesis, N ≤ 8 per `targetQuarters = quarters.slice(0, 8)`, `lib/insights-pipeline.ts:382`);
sector narrative 1 call per seed-with-`narrative=true`. **Delta analysis is unambiguously the most
expensive operation per run** by call count and by input volume (two full 120K-char transcripts
fanned across 11 parallel calls, several of which re-send large chunks of the same transcript to
different specialist prompts) — this matches its highest credit cost (3 credits vs. 1 for solo)
and the product's own economics table.

**Token budgeting** — PARTIALLY IMPLEMENTED as static truncation only, not dynamic/enforced
budgeting: the 120K-char cap and per-agent scoping (30K/40K char slices, above) are hardcoded
constants, not runtime-configurable limits, and nothing in the code enforces a *token* ceiling (as
opposed to a *character* ceiling) — character count is a rough proxy for token count, not
equivalent to it, and no tokenizer-based check exists anywhere.

**Caching's role in cost control** — this is the actual cost lever in the system, not prompt
engineering or model selection: every cache hit (delta, solo, insights) eliminates the entire
Gemini call sequence for that request, not just some of it. Given `TECHNICAL_ARCHITECTURE.md`'s
own $35-795/mo cost table scales primarily with Gemini call volume, and given that repeat views of
the same ticker/quarter are the expected common case for a research tool, caching is doing more
cost-control work in this system than any other single mechanism — more than model choice, more
than token truncation.

**Model selection** — **NOT IMPLEMENTED as a cost-optimization lever.** One model
(`gemini-2.5-flash-lite`) is hardcoded across all five AI-calling files; there is no cheaper/faster
model substituted for simpler sub-tasks (e.g. the 5-6-word `management_tone` classification or the
0-10 evasiveness score use the exact same model as the multi-page thematic extraction). The one
place model choice is discussed at all is prose, not code: `PRODUCT_NOTES.md`'s sector-narrative
entry mentions a hypothetical "Flash Pro" alternative and explicitly rejects it for latency reasons
("Flash Pro would push this to ~15s and risk timeouts") — a real trade-off analysis, but the
conclusion in every case is "use the one model everywhere," not tiered model routing.

**Most expensive operation** — Delta Analysis, by a wide margin, per the call-count analysis above
— it is both the highest-call-count pipeline and the only one that processes two full transcripts
per run rather than one.
