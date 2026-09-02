# 07 — Data Architecture: Full Lifecycle Trace

**Scope**: reverse-engineered from the actual source in `/tmp/quantalyze`, not from `TECHNICAL_ARCHITECTURE.md`'s narrative. Every claim below cites a file, and is labeled:
`IMPLEMENTED` / `PARTIALLY IMPLEMENTED` / `IMPLIED-ARCHITECTURALLY-PREPARED` / `NOT IMPLEMENTED` / `IMPLEMENTED-BUT-ARCHIVED`.

---

## 0. The headline finding: this is not the Supabase app the docs describe

`TECHNICAL_ARCHITECTURE.md` (lines 14–16) states:

```
| Auth     | Supabase Auth      | JWT Bearer tokens, service-role admin |
| Database | Supabase PostgreSQL| 10 tables, JSONB payloads, RLS on 3 tables |
| Object Storage | Supabase Storage | `transcripts` bucket (PDF files) |
```

This is **stale**. The code shows a completed platform migration off Supabase onto Azure, with the Supabase-flavored code paths left in place as dead classes:

| Concern | Docs say | Code actually wires up (`lib/repositories/index.ts`) |
|---|---|---|
| Auth | Supabase Auth (JWT, email/Google) | **`NextAuth` v5 + Microsoft Entra ID** — `auth.ts:1-54` |
| Database | Supabase Postgres via `supabaseAdmin()` | **Raw `pg` Pool → Azure Database for PostgreSQL Flexible Server** — `lib/postgres/client.ts:1-72`, every `Postgres*Repository` class |
| Object storage | Supabase Storage `transcripts` bucket | **Azure Blob Storage**, container `transcripts` — `storageRepo = new AzureBlobStorageRepository()` at `lib/repositories/index.ts:24` |
| Deployment | Vercel serverless | **Azure App Service** — `auth.ts:16-22` explicitly works around App Service's Host-header behavior (`trustHost: true`) |

Evidence this was a deliberate, executed migration (not aspirational):

- `scripts/migrate-schema-to-azure.ts` — a real SQL-transpiler that reads every file in `supabase/migrations/`, and for the live database **drops every `ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` statement**, and **strips every `REFERENCES auth.users(id)`** FK, because "Azure Postgres has no `auth.uid()` function" and "`auth.users` doesn't exist on Azure Postgres" (comments, lines 9-19).
- `scripts/migrate-postgres-data.ts` — `pg_dump --data-only ... --exclude-table=auth.* --exclude-table=storage.*` from `SUPABASE_DB_CONNECTION_STRING`, loaded via `psql` into `POSTGRES_CONNECTION_STRING` (Azure).
- `lib/postgres/client.ts:5-27` — inline comments about "Azure Database for PostgreSQL Flexible Server" TLS behavior, and VNet/NAT keepalive tuning specific to Azure's network path — this is production hardening for a real Azure deployment, not a stub.
- Every repository file (`analysis.ts`, `kpis.ts`, `credits.ts`, `apiAccess.ts`, `insights.ts`, `soloAnalysis.ts`, `promoterActivity.ts`, `calendar.ts`, `concalls.ts`) defines **two** classes: `Supabase<X>Repository` (talks to `supabaseAdmin()`) and `Postgres<X>Repository` (talks to `lib/postgres/client.ts`'s raw `pg` pool). `lib/repositories/index.ts` **only ever instantiates the `Postgres*` class** — confirmed by `grep -rn "new Supabase"` returning zero hits outside the class definitions themselves. The `Supabase*` classes and `SupabaseStorageRepository` (`lib/repositories/storage.ts:26-69`) are **dead code**, kept around (probably as a rollback path / reference implementation), never imported by any route.
- `@supabase/supabase-js` is still a dependency and `lib/supabase/admin.ts` still exists — but grepping the entire `app/` and `lib/` tree for `createServerClient`, `createBrowserClient`, `@supabase/ssr`, or `supabase.auth` returns **nothing**. Supabase Auth is not wired into a single route.

**Consequence for RLS** (task explicitly asked to verify the "3 tables" claim): the original Supabase migrations *did* enable RLS on exactly 3 tables — `user_connections` (`001_initial.sql:29-34`), `analysis_results` (`001_initial.sql:47-52`), `user_tickers` (`006_user_tickers.sql:13-20`), each with a policy `USING (auth.uid() = user_id)`. TECHNICAL_ARCHITECTURE.md's "RLS on 3 tables" is **correct for the schema file, but describes a control that is not live in production** — `migrate-schema-to-azure.ts` strips it deploy-time, and Azure Postgres has no `auth.uid()` to evaluate it even if it were left in. **On the database that answers real production traffic today, RLS enforcement is on zero tables.** Per-user isolation on `user_tickers`/`analysis_results`/`user_credits` is enforced entirely in application code — every `Postgres*Repository` method takes `userId` as a bound `$1` parameter (e.g. `credits.ts:43-46`, `analysis.ts:402-406`) — i.e., the database will happily return another user's rows to any caller holding a live Postgres connection; the only thing standing between users is that every repository call site remembers to filter by `userId`.

`IMPLEMENTED`: the Azure Postgres + Azure Blob Storage + NextAuth/Entra stack, verified from `lib/repositories/index.ts`, `lib/postgres/client.ts`, `auth.ts`, `middleware.ts`, `package.json`.
`NOT IMPLEMENTED` (in production, despite existing in SQL and in dead Supabase* classes): Postgres RLS, Supabase Auth, Supabase Storage.

---

## 1. SOURCE → transcript acquisition (scraping, not an API)

`lib/transcript-fetcher.ts` and the near-identical inline copy in `app/api/v1/request/route.ts` (476 lines — the module-doc comment at the top of `transcript-fetcher.ts` claims it was "extracted from request/route.ts for reuse," but `request/route.ts` still carries its own full, drifted copy of every function — see §9) do the following, in order:

1. **Screener.in** (`getCompanyPageUrl`, `transcript-fetcher.ts:75-89`) — hits `https://www.screener.in/api/company/search/?q=...&field=name&limit=5`, an **undocumented internal search endpoint** of the screener.in website (not a published/keyed API), spoofing a desktop Chrome `User-Agent` and `Referer: https://www.screener.in/` (`SCREENER_HEADERS`, lines 10-17) to avoid being blocked as a bot.
2. Fetches the resolved company page HTML and regex-scrapes every `<a href="..." title="Raw Transcript">` link (`extractRawTranscriptUrls`, lines 99-124) — a **structural HTML scrape**, not a documented API. It also regex-extracts the BSE scrip code from an embedded link pattern (`extractBseCode`, lines 126-129).
3. **BSE's `AnnSubCategoryGetData/w` endpoint** (`fetchBseTranscripts`, lines 157-191) — `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w`, again with browser-spoofing headers (`Origin`/`Referer: bseindia.com`) and a hand-rolled keyword filter (`BSE_TRANSCRIPT_KEYWORDS`) on the `HEADLINE`/`SUBCATNAME` fields to find concall-transcript filings among all corporate announcements.
4. Downloads the PDF directly from `nsearchives.nseindia.com` or `bseindia.com` (`downloadPdf`, lines 291-298), validating only that the byte stream starts with `%PDF`.
5. Quarter is inferred (never explicitly given by any source) via a cascade: NSE filename timestamp (`inferQuarterFromNseUrl`) → PDF text regex for `Q# FY##` (`inferQuarterFromText`, run on the first 3 pages via `pdfParse(pdf, {max:3})`) → HTML surrounding-context date parsing (`inferQuarterFromHtml`, lines 224-279, handling `Q3 2025-26`, `quarter ended December 2025`, `14 Feb, 2026`, bare `Feb 2026`, etc.) — a **best-effort heuristic chain**, not a authoritative field from any source.

There is **no official Screener.in or BSE partner API**, and **no manual-upload endpoint** for the primary transcript ingestion path — this is answered precisely from code, correcting the ambiguity in the assignment framing:

`IMPLEMENTED`: web scraping of screener.in (undocumented JSON search endpoint + HTML page scrape) and the BSE `AnnSubCategoryGetData/w` public JSON endpoint, plus direct PDF fetch from NSE/BSE archive hosts.
`NOT IMPLEMENTED`: any documented/keyed vendor API (no API key, no rate-limit contract, no SLA) for transcripts; no manual-upload UI/route was found for the primary pipeline (`/api/v1/request` is scrape-only, POST body is just `{ ticker }`).

`app/api/v1/request/route.ts:321-476` is the user-triggered entry point (`POST`, requires `getCurrentUser()` — NextAuth session, `lib/auth.ts` not shown here but referenced at line 4) that runs this whole scrape chain synchronously inside one request (up to `maxDuration = 60`), downloading up to 8 candidate PDFs (`allLinks.slice(0, 8)`, line 389) and uploading the new ones. Note the two copies use **different constants**: `transcript-fetcher.ts` looks back 548 days and caps at 4 transcripts (lines 160, 309); `request/route.ts` looks back 912 days and caps at 8 (lines 161, 389) — a real, citable drift between the "shared" module and its un-refactored caller.

---

## 2. Promoter / pledge data source

`lib/promoter-activity-fetcher.ts` (97 lines) reuses the **exact same BSE `AnnSubCategoryGetData/w` endpoint**, but with `strCat=Insider Trading / SAST` (line 60) instead of `strCat=-1`, over an 18-month lookback (`fromDate.setDate(fromDate.getDate() - 548)`, line 55).

Classification is regex-based, not from any structured BSE field:
- `PLEDGE_RE = /encumbrance.{0,40}promoter|promoter.{0,40}encumbrance/i` (line 41) — matched against `HEADLINE + SUBCATNAME`, explicitly commented as "validated as an unambiguous, zero-false-positive substring across both chronically-pledged (VEDL) and clean (RELIANCE/TATAMOTORS) companies" — i.e. hand-validated against a handful of real tickers, not a formally tested classifier.
- `REG29_RE = /reg\.?\s*29/i` (line 46) — SEBI SAST Regulation 29 substantial-acquisition filings, kept as "secondary/informational" since they're "often filed by unrelated institutional trustees."
- `BOILERPLATE_RE = /closure of trading window/i` (line 36) filters out quarterly boilerplate notices.

`IMPLEMENTED`: BSE SAST feed scrape + 3-bucket regex classifier (`pledge` / `institutional` / `other`).
Caveat worth flagging explicitly: this is **not** an SEC/SEBI structured-data feed — it is the same generic corporate-announcements JSON endpoint as transcripts, filtered client-side by string matching on free-text headlines. A headline BSE writes slightly differently in the future silently drops out of the `pledge` bucket with no error.

---

## 3. Raw data storage — bucket structure and access control

Despite the docs saying "Supabase Storage `transcripts` bucket," the wired implementation is `AzureBlobStorageRepository` (`lib/repositories/storage.ts:90-156`), against container `AZURE_CONTAINER = process.env.AZURE_STORAGE_CONTAINER ?? "transcripts"` (line 71) — same logical bucket **name**, different **platform**.

- **Naming convention**: flat key `TICKER_Q#_YYYY.pdf`, e.g. `RELIANCE_Q4_2026.pdf` — built at upload time in both `transcript-fetcher.ts:383` and `request/route.ts:448`: `` `${tickerClean}_Q${q}_${y}.pdf` ``. No folder/prefix structure — it's a flat namespace, matched by filename regex on read (`available/route.ts:33`: `` /^(.+?)_Q(\d)_(\d{4})\.pdf$/i ``).
- **Access control**: every storage call goes through `storageRepo`, which uses `supabaseAdmin()`'s service-role key in the (dead) Supabase implementation or `BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING!)` (line 76) — an account-level connection string, i.e. **full read/write on the whole storage account**, held server-side only. No route exposes this connection string to the client; downloads to the browser go through `createSignedUrl()` (Azure SAS token, `generateSasUrl({permissions: BlobSASPermissions.parse("r"), expiresOn})`, lines 147-155) — a **time-limited, read-only** URL, confirming the "service-role/account-key only, no public bucket" claim, just on Azure instead of Supabase.
- **Listing has no native prefix-search on Azure**: `listBlobsFlat()` has no server-side substring filter (explicit comment, `storage.ts:81-86`), so `list({search})` (lines 102-118) does a **full in-memory filter** over a **60-second TTL in-process cache** (`LIST_CACHE_TTL_MS = 60_000`, line 87) of the entire container listing — added specifically because `app/api/v1/available/route.ts` fires ~200 parallel per-ticker `storageRepo.list({search: ticker})` calls (one per Nifty200 constituent, `Promise.all` over `knownTickers`, `available/route.ts:55-68`), which without the cache would be ~200 full-container Azure enumerations per page load.

`IMPLEMENTED`: flat-namespace Azure Blob container, SAS-token-gated downloads, service-role uploads, in-process listing cache as a real read-amplification mitigation.
`PARTIALLY IMPLEMENTED` vs. docs: "Supabase Storage" claim is wrong for the live system; the *behavior* (service-role-only writes, signed/time-limited reads) is preserved across the migration.

---

## 4. Full relational schema (13 tables as of migrations 001–011, 15 as of 012)

> **Update (RAG/agents vertical slice, `feature/rag-agents-v1`):** migration `012_rag_and_agents.sql`
> adds two more tables, `transcript_chunks` and `evidence_verifications` — see the new subsection
> at the end of this section. Everything else here (001–011) is unmodified.

11 tables across 11 migration files (`supabase/migrations/001_initial.sql` … `011_api_access.sql`). Two tables not in the README's original 9-table list, added in 010/011: **`user_credits`** and the 4-table **`api_partners` / `api_keys` / `api_key_products` / `api_usage`** cluster (011 alone adds 4 tables, so the true count is 9 original + `user_credits` + 4 API-access tables = **13 CREATE TABLE statements**, though the "11 tables" the assignment names likely bundles the api_access cluster as one concern — table-by-table below).

| Table | Migration | Primary/Unique key | Notable columns | Indexes | FK | RLS (as written) |
|---|---|---|---|---|---|---|
| `user_connections` | 001 | PK `id`; `UNIQUE(user_id, provider)` | `provider CHECK IN ('gmail','slack')`, OAuth token columns | — | `user_id → auth.users(id) CASCADE` | **Yes** — `auth.uid() = user_id` |
| `analysis_results` | 001 | PK `id` (no unique key on natural key!) | `company_ticker, q_prev, q_curr TEXT`, `payload JSONB` | **none** | `user_id → auth.users(id) CASCADE` (nullable) | **Yes** — `auth.uid() = user_id` |
| `kpi_snapshots` | 002 | PK `id` | `company_ticker, quarter, quarter_previous, sector`, `kpis JSONB DEFAULT '[]'` | `UNIQUE INDEX idx_kpi_ticker_quarter (company_ticker, quarter)` | — | none (comment: "server-side only cached data") |
| `sector_intelligence` | 003 | PK `id`; `UNIQUE(sector, quarter)` | `payload JSONB` | (unique constraint implies btree index) | — | none |
| `earnings_calendar` | 004 | PK `id`; `UNIQUE(ticker, quarter)` | `date DATE`, `source TEXT DEFAULT 'estimated'`, `confirmed BOOLEAN` | `idx_ec_date(date)`, `idx_ec_ticker(ticker)` | — | none |
| `concall_links` | 005 | PK `id`; `UNIQUE(ticker, quarter)` | `youtube_url, video_id, video_title, channel_title` | `idx_cl_ticker`, `idx_cl_quarter` | — | none |
| `user_tickers` | 006 | PK `id`; `UNIQUE(user_id, ticker)` | `name`, `sector DEFAULT 'Custom'` | (unique constraint index) | `user_id → auth.users(id) CASCADE` | **Yes** — `auth.uid() = user_id` |
| `insights_cache` | 007 | PK `id`; `UNIQUE(ticker, quarters_key)` | `payload JSONB` | (unique constraint index) | — | none (comment: "service-role only") |
| `promoter_activity` | 008 | PK `id`; `UNIQUE(ticker, news_id)` | `event_type TEXT` ('pledge'/'institutional'/'other') | `idx_promoter_activity_ticker_date(ticker, disclosure_date DESC)` | — | none |
| `promoter_activity_fetch_log` | 008 | PK `ticker` | `fetched_at, row_count` | (PK is the index) | — | none |
| `solo_analysis_cache` | 009 | PK `id` (**no unique key on ticker+quarter**) | `payload JSONB` | **none** | — | none (comment: "service-role only") |
| `user_credits` | 010 | PK `id`; `UNIQUE(user_id, month)` | `used, quota INTEGER`, `month TEXT 'YYYY-MM'` | (unique constraint index) | `user_id → auth.users(id) CASCADE` | none — comment explicitly says "no RLS — managed by backend" (despite `user_id` FK to `auth.users`) |
| `api_partners` | 011 | PK `id` | `name` | — | — | none |
| `api_keys` | 011 | PK `id` | `key_hash TEXT UNIQUE`, `active`, `daily_quota INT DEFAULT 1000` | `idx_api_keys_key_hash(key_hash)` (redundant with the inline `UNIQUE`) | `partner_id → api_partners(id) CASCADE` | none |
| `api_key_products` | 011 | composite PK `(key_id, product_name)` | — | (PK is the index) | `key_id → api_keys(id) CASCADE` | none |
| `api_usage` | 011 | composite PK `(key_id, window_start)` | `request_count INTEGER` | (PK is the index) | `key_id → api_keys(id) CASCADE` | none |

### Missing-index findings (grep-verified: `CREATE INDEX`/`CREATE UNIQUE INDEX` across all 11 files returns exactly 6 explicit index statements, listed above)

- **`analysis_results` has zero indexes beyond the surrogate `id` PK**, despite being the highest-traffic read table in the system: every one of `PostgresAnalysisRepository`'s 8 query methods (`analysis.ts:288-416`) filters/orders on `company_ticker`, `q_prev`, `q_curr`, and `created_at` — e.g. `getCachedAnalysis` (lines 288-306): `WHERE company_ticker=$1 AND q_prev=$2 AND q_curr=$3 ORDER BY created_at DESC LIMIT 1`. With no index on `(company_ticker, q_prev, q_curr)`, this is a sequential scan on every cache lookup, on every dashboard load, on every `/api/v1/screener` call (`listAllByTickers`, `listByTickersAndQuarterPair`). This is not a hypothetical — it's the literal cache-hit path.
- **`solo_analysis_cache` also has zero indexes beyond `id`**, same problem for `WHERE ticker=$1 AND quarter=$2` (`soloAnalysis.ts:95-99`).
- Both of these tables also **lack any `UNIQUE` constraint on their natural cache key** (`(company_ticker,q_prev,q_curr)` and `(ticker,quarter)` respectively) — see §6 (dedup/idempotency) for why this matters more than it looks.

### RLS findings (grep-verified: `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` appear only in 001 and 006)

Exactly 3 tables carry RLS **in the SQL as written**: `user_connections`, `analysis_results`, `user_tickers` — confirming TECHNICAL_ARCHITECTURE.md's "RLS on 3 tables" claim is accurate **to the schema file**. But per §0, none of this RLS is active on the database the app actually talks to in production (Azure Postgres, via `migrate-schema-to-azure.ts` stripping it at deploy time). `user_credits` (010) has a `user_id` FK into `auth.users` but **no RLS at all**, even in the original Supabase-era SQL — its own comment says "no RLS — managed by backend," i.e. it was designed from day one to rely on `supabaseAdmin()`/service-role bypass, unlike `analysis_results`/`user_tickers` which were designed for two access modes (RLS'd user client + service-role admin bypass) but in practice are only ever touched via the service-role path (`supabaseAdmin()` in the dead code, `pgPool()` in the live code) — the RLS policies on those tables were, in the current runtime, always cosmetic; only Supabase Auth users hitting the anon/authenticated Supabase key directly would have exercised them, and no such client exists in this codebase (§0).

### JSONB payload fields

Every cache/analysis table stores its AI-pipeline output as one `payload JSONB NOT NULL` (or `kpis JSONB` for `kpi_snapshots`) column: `analysis_results.payload`, `solo_analysis_cache.payload`, `insights_cache.payload`, `sector_intelligence.payload`, `kpi_snapshots.kpis`. This is the dominant storage pattern in the schema (§8 explains why) — **neither of the two new 012 tables follows this pattern**, which is itself worth noting: `transcript_chunks`/`evidence_verifications` use real typed columns (`TEXT`, `VECTOR(768)`, `INTEGER`, plus one `JSONB` column on `evidence_verifications` for the findings array specifically, since that's genuinely variable-shaped structured data, not a full-payload blob) rather than one opaque JSONB payload — a deliberate departure from the schema's dominant convention, because unlike the five original pipelines' output, these two tables' columns are actually queried/filtered on individually (`WHERE ticker = $1 AND quarter = $2`, `ORDER BY embedding <=> $3::vector`), not just fetched whole by primary/natural key.

### 4.1 New in migration 012 (RAG/agents vertical slice) — `transcript_chunks`, `evidence_verifications`

| Table | Migration | Primary/Unique key | Notable columns | Indexes | FK | RLS (as written) |
|---|---|---|---|---|---|---|
| `transcript_chunks` | 012 | PK `id`; `UNIQUE(ticker, quarter, chunk_index)` | `content TEXT`, `embedding VECTOR(768)`, `storage_key TEXT` | `idx_transcript_chunks_ticker_quarter(ticker, quarter)`, `idx_transcript_chunks_embedding` (`ivfflat`, `vector_cosine_ops`) | — | none (comment: same rationale as `user_credits`/`api_access` — accessed only via the application's own repository layer) |
| `evidence_verifications` | 012 | PK `id` (`gen_random_uuid()`) | `status TEXT`, `findings JSONB`, `supported_count`/`unsupported_count`/`uncertain_count INTEGER`, `model`/`agent_version TEXT` | `idx_evidence_verifications_lookup(ticker, quarter, quarter_previous, created_at DESC)` | — | none |

Both tables **do** carry a real index matched to their actual query pattern from day one —
`transcript_chunks` has both a lookup index and an ANN (`ivfflat`) similarity-search index, and
`evidence_verifications` has a lookup index ordered for its one real read path
(`getLatestByTicker`'s `ORDER BY created_at DESC LIMIT 1`) — in contrast to the missing-index
findings just above for `analysis_results`/`solo_analysis_cache`, which shipped with zero
indexes beyond their surrogate PK despite years of being the highest-traffic read tables. Worth
naming honestly: two tables is a much easier bar to clear thoughtfully than the 13-table schema
above accumulated over — this isn't evidence the codebase's indexing discipline improved
system-wide, just that this one new addition didn't repeat that specific mistake. Full detail on
the Azure `azure.extensions` VECTOR-allowlist prerequisite this migration needs: `RAG_ARCHITECTURE.md`.

---

## 5. No vector database, no NoSQL beyond Postgres JSONB

> **Update (RAG/agents vertical slice, `feature/rag-agents-v1`):** the headline claim below —
> "zero vector index... no `pgvector` extension reference anywhere" — is no longer true. Migration
> `012_rag_and_agents.sql` adds `CREATE EXTENSION IF NOT EXISTS vector` and a `VECTOR(768)` column
> (`transcript_chunks.embedding`, §4.1 above), searched via pgvector's `<=>` cosine-distance
> operator through an `ivfflat` index. This remains a genuinely **minimal** addition, by design —
> not a general-purpose vector database service, no new infrastructure component, same Postgres
> instance every other table in this file lives in — see `RAG_ARCHITECTURE.md` for the full
> reasoning against a standalone vector DB service. The "no NoSQL beyond Postgres JSONB" half of
> this section's claim remains fully accurate: pgvector is a Postgres extension, not a second
> database, and no document/NoSQL store was introduced.

`IMPLEMENTED` (as a stated design decision, not an oversight) **as of before this slice**: the live production stack had **zero** vector index, embedding store, or NoSQL document store. All persistence is Postgres (Azure Flexible Server) with `JSONB` columns for semi-structured AI output, queried with plain SQL (`ILIKE`/equality/`ANY($::text[])`/`ORDER BY`) — no `pgvector` extension reference anywhere in the original 11 migrations, no embedding column, no similarity-search endpoint. (Migration 012 changes this for one new, narrow purpose — see the update note above.)

`IMPLEMENTED-BUT-ARCHIVED`: the archived Python prototype (`finance-agent/`, confirmed unreferenced by any live Next.js route — `grep -rln "finance-agent" app lib` returns only a **comment** in `lib/nifty50.ts:1` saying it "mirrors finance-agent/fetcher/nifty50.py", not an import) had a real vector architecture:

- `finance-agent/core/vector.py` (61 lines) — a **FAISS** index (`faiss.read_index`/`faiss.write_index`) persisted to local files `data/processed/finance.index` + `data/processed/meta.txt`, with a module-level in-memory singleton cache (`_cached_index`/`_cached_meta`) invalidated on write.
- `finance-agent/core/embeddings.py` (44 lines) — the embedding generator feeding `vector.py`'s `add()`.
- `finance-agent/core/financial_memory.py` (147 lines) — a **flat local JSON file** (`data/processed/financial_facts.json`) as a "fact" store, with a hand-built `COMPANY_ALIASES` canonicalization dict (`msft`/`microsoft`/`microsoft corp` → `Microsoft`, `apple inc.`/`aapl` → `Apple`, etc.) — notably **US-market names** (Microsoft, Apple, Alphabet), a different product scope than the live app's India-focused Nifty50/200/500 universe, another sign this is a genuinely earlier/different iteration of the product, not just an earlier storage layer.
- `finance-agent/db/supabase.py` (30 lines) — the prototype's own Supabase client factory (`supabase_admin` service-role + `get_anon_client()` RLS-respecting client), independent of and structurally identical in intent to the live app's now-dead `lib/supabase/admin.ts`.

Contrast: **local-file FAISS + local-file JSON facts + Supabase (Python client)** in the prototype vs. **Postgres JSONB + Azure Blob PDFs, zero vector store** in production. Nothing in the live app performs semantic/embedding search over transcripts — every "retrieval" is a full transcript re-read from Blob storage, PDF-parsed fresh, and re-summarized by Gemini per request (`lib/pipeline.ts:extractPdfText`, §7) — i.e. the production system re-derives insight from raw text on every cache miss rather than doing retrieval-augmented lookup over an indexed corpus.

---

## 6. Caching, dedup, and idempotency — the precise mechanics

Every "cache" is a real Postgres table (§4), not an ephemeral cache layer (no Redis/Memcached found anywhere in `package.json` or `lib/`). The cache-check pattern is identical across all AI-pipeline routes: **look up by natural key → if a shape-valid row exists, return it (free) → else invoke Gemini, then persist**.

| Cache table | Natural key | TTL | Invalidation | Idempotency mechanism |
|---|---|---|---|---|
| `analysis_results` | `(company_ticker, q_prev, q_curr)` | **none** — permanent until re-run | Manual: caller passes `force: true` (`app/api/v1/analyze/route.ts:53`: `` const cached = force ? null : await analysisRepo.getCachedAnalysis(...) ``) | **App-level DELETE-then-INSERT**, not a DB constraint — `saveAnalysis` (`analysis.ts:308-325`) runs `DELETE FROM analysis_results WHERE company_ticker=$1 AND q_prev=$2 AND q_curr=$3` then a separate `INSERT`, **not wrapped in a transaction**. There is no `UNIQUE` constraint on the natural key (§4) to fall back on — this is possible only because the app remembers to delete first. Two concurrent cache-miss requests for the same `(ticker,q_prev,q_curr)` (e.g. two browser tabs) can interleave DELETE/INSERT and leave duplicate rows, which `getCachedAnalysis`'s `ORDER BY created_at DESC LIMIT 1` masks by always picking the newest — so duplicates are silently tolerated, not prevented. |
| `solo_analysis_cache` | `(ticker, quarter)` | none | none (permanent) | Same DELETE-then-INSERT pattern (`soloAnalysis.ts:106-113`), same lack of a unique constraint, same non-atomicity. |
| `kpi_snapshots` | `(company_ticker, quarter)` | none | `?force=1` query param on `/api/v1/kpis` (`app/api/v1/kpis/route.ts:19,24-26`) | **Real DB-level upsert**: `UNIQUE INDEX idx_kpi_ticker_quarter` (migration 002) backs `ON CONFLICT (company_ticker, quarter) DO UPDATE SET ...` (`kpis.ts:141`) — atomic, no race window. |
| `insights_cache` | `(ticker, quarters_key)` where `quarters_key` = sorted comma-joined quarter list | **30 days**, enforced in application code: `getCached` filters `WHERE ... AND created_at >= $3` with `cutoff = Date.now() - ttlDays*24*60*60*1000` (`insights.ts:124-136`), `CACHE_TTL_DAYS = 30` (`lib/insights-pipeline.ts:253`) | Automatic on quarter-set change (a new quarter uploaded changes `quarters_key`, migration 007 comment) *and* time-based expiry | DB-level `ON CONFLICT (ticker, quarters_key) DO UPDATE` (`insights.ts:142`), atomic. |
| `sector_intelligence` | `(sector, quarter)` | none found | manual reseed via `/api/v1/sectors/seed` | `UNIQUE(sector, quarter)` inline constraint backs an upsert (pattern consistent with `kpis.ts`/`concalls.ts`). |
| `concall_links` | `(ticker, quarter)` | none | none | `ON CONFLICT (ticker, quarter) DO UPDATE` (`concalls.ts:80`), atomic. |
| `promoter_activity` | `(ticker, news_id)` | none — `news_id` is BSE's own immutable ID, used explicitly "for de-dup" per migration 008's comment | none; `promoter_activity_fetch_log` (PK `ticker`) tracks last-fetch time so "the API can decide whether to re-fetch, even for tickers with zero matching disclosures" (008 comment) | `ON CONFLICT (ticker, news_id) DO UPDATE` (`promoterActivity.ts:113`), atomic; batched multi-row `INSERT ... VALUES (...),(...),...` built by hand (lines 100-117). |
| `earnings_calendar` | `(ticker, quarter)` | none | reseed overwrites (`ON CONFLICT ... DO UPDATE`, `calendar.ts:74`) | Source-priority resolution (`tickertape > bse_notice > nse_calendar > estimated`, `app/api/v1/calendar/seed/route.ts:5-9,27`) is enforced **only within one seed run**, in memory: each subsequent source pass filters to `allTickers.filter(t => !resolved.has(t))` (lines 481, 489 pattern) so a higher-priority source found earlier in the same run is never overwritten by a lower one *in that run*. But the DB-level `ON CONFLICT` upsert itself has no priority awareness — a **later, separate reseed run** using a lower-quality source for a ticker that previously got a `tickertape` date will unconditionally overwrite it (`DO UPDATE SET date=EXCLUDED.date, source=EXCLUDED.source...`, no `WHERE excluded.source has higher priority than current`). Priority is a run-scoped in-memory guarantee, not a persisted invariant. |

**Direct answer to "same (ticker, quarter) requested twice"**: for the two Gemini-pipeline tables that matter most for cost (`analysis_results`, 3 credits/run; `solo_analysis_cache`, 1 credit/run — see §10), the second request **is** served from cache and costs 0 credits (`app/api/v1/analyze/route.ts:53-73`: cache hit returns a `done` NDJSON event immediately, `checkAndDeduct` is only called on the cache-miss branch, line 76) — but the dedup guarantee behind that cache is an **application-level delete-then-insert with no unique constraint and no transaction**, not a database-enforced invariant. This is exactly the kind of claim the task asked not to make without pointing at SQL — and the SQL (migrations 001, 009) confirms there is **no unique index** backing either table.

---

## 7. Retrieval → transformation → AI context (the Gemini pipeline)

`lib/pipeline.ts` (881 lines) is the delta-analysis pipeline invoked on `analysis_results` cache miss:

1. **Retrieval**: `resolvePdfKey(ticker, quarter)` (lines 223-234) pages the entire blob listing (`storageRepo.listAllPaginated()`) and does a case-insensitive exact filename match — an **O(all files in the bucket)** operation per lookup, not an indexed/keyed fetch, because the storage backend has no server-side get-by-key-with-fuzzy-case API being used here (this is by design given the flat naming convention, but is worth flagging as another full-listing scan, same shape as the `available` route's problem in §3).
2. **Transformation**: `extractPdfText` (lines 240-266) downloads the PDF via `storageRepo.download()`, validates the byte header (`%PDF`), runs `pdf-parse`, and **truncates to `MAX_TRANSCRIPT_CHARS = 120_000`** characters (line 238, commented as sized for "large conglomerate calls (e.g. Reliance, TCS)" that "run 2-3+ hours"). Note: comment at line 262-263 still says "delete it from Supabase storage" — another stale Supabase-era comment surviving the Azure migration (§0), left in an actual user-facing error message string.
3. **AI context construction**: multiple specialist Gemini agents run per section (`runThematicAgent`, `runEvasivenessAgent`, `runTemporalDelta`, `runEarningsDeltaAgent`, `runFCFImplicationsAgent`, `runKeyMetricsAgent` — lines ~440-620+), each calling `invokeStructured<T>()` (lines 191-214):
   ```ts
   generationConfig: {
     responseMimeType: "application/json",
     responseSchema: schema,   // Gemini-native JSON-schema constrained decoding
     temperature: 0,
   },
   ...
   return JSON.parse(result.response.text()) as T;
   ```
   This is Gemini's **structured output** feature (`responseSchema`), not free-text-then-parse — the model is constrained at decode time to emit JSON matching a `Schema` object. `AGENT_TIMEOUT_MS = 25_000` per agent call, raced against a timeout promise (`Promise.race`, line 212).
4. **Serialization into typed domain objects**: `invokeStructured<T>`'s return value is cast (`as T`) directly — there is **no runtime validation library** anywhere in this codebase (`grep -rln "zod"` across the whole tree returns nothing; no `ajv`, no `io-ts`, no `yup`). The only "validation" between Gemini's JSON and what gets persisted is:
   - Gemini's own `responseSchema` constrains generation (a soft guarantee — Gemini can still return an empty array, an empty string, or omit optional fields; it cannot return the *wrong shape* for a required field the schema demands, but it can return an empty/degenerate value).
   - Hand-written per-field fallback logic in each agent runner: `Math.max(0, Math.min(10, result.score))` clamps the evasiveness score (line ~483); `result.bullets ?? []` defaults on missing arrays; a `try/catch` around every agent call returns `null` (thematic/temporal-delta agents) or a hardcoded default (`5.0` for evasiveness) on any failure, and the pipeline **filters out null agent results** rather than failing the whole run (confirmed by TECHNICAL_ARCHITECTURE.md's own "individual failures don't kill the pipeline" note, which matches the code).
   - **Shape checks at the persistence boundary**, in the repository layer, not a schema validator: `saveAnalysis` refuses to cache an empty result (`if (!Array.isArray(analysis.sections) || analysis.sections.length === 0) return "not-cached-empty"`, `analysis.ts:310-312`); `getCachedAnalysis` refuses to serve a cached row back if it doesn't look complete (`if (!Array.isArray(raw.insights) || raw.insights.length===0) return null; if (strict && !Array.isArray(raw.earnings_delta)) return null`, lines 303-304) — this is a manual, ad hoc "does this JSON blob look like a finished analysis" check, not a declared schema.

`PARTIALLY IMPLEMENTED`: "validation" exists (Gemini schema-constrained decoding + defensive nullish-coalescing + array-shape gatekeeping before cache writes/reads), but there is **no declarative validation layer** (no zod schema mirroring `lib/api-contracts/v1/*.ts` or the JSONB payload shape) — a malformed-but-array-shaped payload (e.g. `signal_score` as a string, or a value outside the documented 0–10 range) would pass every check in this codebase and be persisted and served.

5. **Typed mapping / api-contracts**: `lib/api-contracts/v1/company.ts` (39 lines, and its `sector.ts`/`sectorThesis.ts` siblings) is the actual "serialize into typed objects" boundary the task asked about — but it operates **downstream** of the JSONB round-trip, not between Gemini and Postgres. It maps the repository's `Analysis` domain type (already a TS interface reconstructed from the stored JSONB by `toEntity()`, `analysis.ts:79-99`) into the public-API wire contract `CompanyResponseV1` (camelCase, curated field subset — `revenue`, `revenueGrowth`, `ebitdaMargin`, `patGrowth` cherry-picked out of the larger `keyMetrics` object). Consumed by `app/api/public/v1/data/companies/[ticker]/route.ts:1-23` — the B2B public API's company endpoint. This mapping is hand-written, one function per contract, no schema library — pure TypeScript structural typing enforced at compile time only.

---

## 8. Why Postgres JSONB instead of fully normalized columns

Not stated anywhere in code as a rationale comment, but inferable directly from the schema and pipeline shape:

- The AI pipeline output (`DashboardPayload` — `sections: SectionalInsight[]`, `keyMetrics`, `marketSources: string[]`, etc., reconstructed in `analysis.ts:10-27`) is a **deeply nested, per-run-varying tree** (a variable number of thematic sections, each with a variable number of metrics, each with free-text fields). Fully normalizing this would require a `sections` table, a `metrics` table with FKs back to both `sections` and `analysis_results`, and a migration every time a new agent/field is added to the Gemini prompt schema (`lib/pipeline.ts` defines the shape via TS `Schema` objects passed to Gemini, not via SQL DDL — the two are decoupled today, and JSONB keeps them decoupled at the storage layer too).
- Every cache table's read pattern is "fetch the whole payload for one (ticker, quarter[s]) and hand it to the frontend/another AI agent as one blob" (`toEntity()`/`fromEntity()` pairs in every repository are 1:1 field renames, not partial-field queries) — there is no query in the entire repository layer that reads a single nested field out of a JSONB column (no `payload->>'summary'` style access anywhere in the `query()` calls) — the app never needs relational joins *into* the payload, only whole-document fetch-by-key, which is exactly JSONB's strong case over full normalization.
- The trade-off cost is real and already visible in §4/§6: without normalized columns, Postgres can't enforce structural invariants (e.g. "every `sections` array element has a `signal_score` between -10 and 10") — that burden fully falls on application code (§7), and it shows in the ad hoc `Array.isArray` gatekeeping.

## Why Azure Blob Storage for transcripts (not Supabase Storage, despite `@azure/storage-blob` being "just a dependency" per the task's framing)

The task pack described `@azure/storage-blob` as a dependency to check "if used anywhere" against an assumption that Supabase Storage is primary — the finding inverts that assumption entirely: **`@azure/storage-blob` is the primary, live, actually-wired storage backend** (`lib/repositories/index.ts:24`), and `SupabaseStorageRepository` is the unused one. The "why" is the same migration story as §0: PDFs and Postgres rows moved together off Supabase onto Azure (App Service + Azure Postgres Flexible Server + Azure Blob), consistent with `auth.ts`'s explicit Azure App Service host-trust workaround and `lib/postgres/client.ts`'s Azure-VNet-specific TCP tuning. There is no evidence of a *cost* or *feature* rationale for Blob-over-Supabase-Storage in the code (unlike TECHNICAL_ARCHITECTURE.md's "Why Supabase Storage (not S3)" section, which argues "same auth layer as the database" — an argument that, post-migration, now actually favors Azure Blob + Azure Postgres for the identical reason, just unwritten).

---

## 9. Deduplication in transcript ingestion (separate from the analysis-cache dedup in §6)

Both `transcript-fetcher.ts:340-350` and `request/route.ts:370-382` dedup **before downloading**: they call `storageRepo.listAllPaginated()` once, build a `Set<string>` of lowercased existing filenames, and skip any candidate whose inferred `TICKER_Q#_YYYY.pdf` name is already in the set — including a **fast pre-check using only the NSE URL-embedded timestamp**, before even downloading the PDF (`inferQuarterFromNseUrl` short-circuit, `transcript-fetcher.ts:356-365`), to avoid wasted downloads for already-uploaded quarters. The actual write is `storageRepo.upload(filename, pdf)` with `upsert: true` in the (dead) Supabase implementation (`storage.ts:60`) but Azure's `upload()` (`storage.ts:138-145`) has no upsert flag — Azure Blob `upload()` on `BlockBlobClient` overwrites by default, so the effective behavior (last write wins on a re-upload of the same filename) is preserved across the migration, just via a different mechanism (Blob overwrite semantics vs. an explicit Supabase `upsert` param).

`IMPLEMENTED`: filename-based dedup at the storage layer, with a URL-timestamp fast-path to skip PDF downloads entirely for known quarters — this is real, working idempotency, in contrast to the DB-level gap found in §6.

---

## 10. `credits.ts` / `apiAccess.ts` — usage metering for the B2B API product

Two **separate, non-overlapping** metering systems:

### 10a. Internal user credits (`lib/credits.ts`, 49 lines + `lib/repositories/credits.ts`)

- 1 credit = $0.01; default quota `DEFAULT_QUOTA = 2_500` credits/month (`credits.ts:14`) — this **contradicts** migration 010's own header comment ("Default monthly allowance = 600 credits ($6)", `010_user_credits.sql:2`) vs. the column default `quota INTEGER NOT NULL DEFAULT 2500` (`010_user_credits.sql:9`) — the SQL comment is stale/wrong relative to its own `DEFAULT 2500`, and the app code (`2_500`) matches the column default, not the comment.
- Flat per-action pricing: `ACTION_COSTS = { delta: 3, solo: 1, insights: 4 }` (`credits.ts:16-20`) — "Screener/etc: 0 credits (DB reads)" per the header comment, confirmed by `screener/route.ts` never calling `checkAndDeduct`.
- `checkAndDeduct(userId, action)` (`credits.ts:33-49`): reads current status (`getOrCreateStatus`, a **read**), checks `status.remaining < cost` and rejects if so, then **separately** calls `setUsed(userId, status.month, status.used + cost)` — a **write** based on a value read in a prior round-trip. This is the same **non-atomic read-then-write race** the codebase explicitly calls out and accepts *elsewhere* (`middleware.ts:51-56`, quoted below) — but here, in `credits.ts`, there is **no comment acknowledging the race at all**. Two concurrent cache-miss `/api/v1/analyze` calls from the same user, arriving close enough together, can both read the same `used` value, both pass the `remaining < cost` check, and both write `used+cost` — one write clobbers the other (last-write-wins via plain `UPDATE`, `credits.ts` Postgres impl line 60: `` UPDATE user_credits SET used=$1 WHERE user_id=$2 AND month=$3 ``, no `used = used + $cost`), meaning **the net effect can undercharge**, not overcharge — one Gemini pipeline run's 3-credit cost can be silently lost, understating usage rather than over-limiting the user. This is the inverse failure mode from what a metering system is usually worried about (revenue leakage, not user lockout), and it is **not called out anywhere** as it is in the public-API rate limiter (next).
- `getOrCreateStatus`'s Postgres implementation (`repositories/credits.ts:42-56`) *does* use a real `INSERT ... ON CONFLICT (user_id, month) DO UPDATE SET used=EXCLUDED.used, quota=EXCLUDED.quota` for the create-path, so first-time-this-month creation is atomic; it's specifically the **increment** step in `checkAndDeduct` that isn't.

### 10b. Public/partner API key metering (`middleware.ts` + `lib/repositories/apiAccess.ts`, tables from migration 011)

`middleware.ts` (matcher `/api/public/:path*`, lines 1-98) runs on every public-API request:
1. Extract `Authorization: Bearer <key>`, SHA-256 hash it client-side in the middleware (`sha256Hex`, Web Crypto `crypto.subtle.digest`, lines 9-15) — **the raw key is never looked up directly; only its hash is compared against `api_keys.key_hash`** (`getKeyByHash`, `apiAccess.ts:100-124`), so a database read/leak does not expose usable keys — a real, deliberate security property.
2. `resolveProductName(pathname)` (`lib/public-api/product-routes.ts`, not fully read here but referenced) maps the URL to a product name, checked against `keyInfo.entitledProducts` (from the `api_key_products` join table) — **per-key, per-product entitlements**, not a single "has an API key" boolean; a key not entitled to a given product gets a `403` naming the product (line 46).
3. **Daily rate limiting**, keyed on `(key_id, window_start=YYYY-MM-DD)` against `api_keys.daily_quota` (default 1000, migration 011 line 16): `getUsageToday` (read) then `incrementUsage` (write) — and here the race **is explicitly documented and consciously accepted** in the code itself (lines 51-56):
   > *"Best-effort rate limit: getUsageToday + incrementUsage is a read-then-write, not an atomic increment... Acceptable at v1's scale (manually-provisioned, low-volume partners); revisit with an atomic SQL increment... if a partner's volume makes the race actually matter."*

   And critically, the **`Postgres*` implementation actually fixed this**: `PostgresApiAccessRepository.incrementUsage` (`apiAccess.ts:137-144`) uses a real atomic `INSERT ... ON CONFLICT (key_id, window_start) DO UPDATE SET request_count = api_usage.request_count + 1` — with an inline comment explicitly flagging this as "a deliberate, confirmed improvement made possible by writing raw SQL by hand for this migration" over "the Supabase version's non-atomic read-then-write" (lines 134-136). **The middleware's own call site, however, still calls `getUsageToday` then `incrementUsage` as two separate awaited calls** (`middleware.ts:58,65`) — so even though the underlying SQL *write* (`incrementUsage`) is now atomic, the *rate-limit check* that gates whether the request is allowed through (`usedToday >= keyInfo.dailyQuota`, line 59) is still evaluated against a value read before the atomic increment, meaning the **check-then-act race at the middleware level is unresolved** even though the underlying counter itself can no longer double-increment incorrectly. This is a genuinely subtle, precise distinction worth flagging: the repository layer got safer, the call site's control flow did not.
4. On success, forwards `x-api-key-id` / `x-api-partner-id` headers downstream (lines 67-70) and logs one structured JSON line per request (`log()`, lines 80-97) — `requestId`, `partnerId`, `keyId`, `endpoint`, `product`, `status`, `latencyMs` — real, if minimal, request-level observability for the B2B product.

`IMPLEMENTED`: SHA-256-hashed key storage/lookup, per-key per-product entitlements, daily quota with a (partially) atomic counter, structured request logging.
`PARTIALLY IMPLEMENTED` / concrete finding: two independent instances of the identical non-atomic read-then-write metering pattern exist in this codebase (`credits.ts:40-46` and `middleware.ts:58-65`) — one is explicitly documented as an accepted trade-off with a stated revisit condition, the other (`credits.ts`) has no such acknowledgment despite being the exact same shape of bug, and the underlying SQL fix already exists in the same file family (`apiAccess.ts`'s atomic `ON CONFLICT ... DO UPDATE SET x = x + 1`) but was never applied to `credits.ts`'s `setUsed`.

---

## 11. Pagination, filtering, sorting on the two named endpoints

Both endpoints checked precisely as requested — **neither implements pagination for the client**; both return complete, unpaginated collections, with sorting done server-side over the full result set:

- **`app/api/v1/screener/route.ts`** (284 lines): no `limit`/`offset`/`cursor` query params read at all (`GET()` takes no `req` argument, line 207). It fetches *all* Nifty50 analysis rows (`analysisRepo.listAllByTickers(nifty50Tickers)`) and *all* current-quarter Nifty200-non-50 rows, computes a `ScreenerSignal` per company (`buildSignal`, lines 133-190, including the confidence/flag computation described inline), and returns the **entire array** sorted by `is_current_quarter` then `|adjusted_score|` descending (lines 264-270) — up to ~200 rows in one response, every time, no way for a client to request a page.
- **`app/api/v1/available/route.ts`** (133 lines): also no pagination params for the *client* — but internally it does two rounds of **exhaustive** listing: (1) offset-paginated `storageRepo.list({limit:1000, offset, ...})` in a `while(true)` loop until a short/empty page (lines 14-29, "internal" pagination purely to work around backend listing limits, not exposed outward), and (2) ~200 parallel per-ticker `storageRepo.list({limit:50, search: ticker})` calls to catch anything the offset scan might have missed (lines 55-68, with the comment "Supabase `search: "TICKER"` reliably finds files regardless of bucket size" — another stale Supabase-era comment, since this now runs against `AzureBlobStorageRepository.list()`'s in-memory `.filter()`, not a real Supabase full-text search). The client-facing response is one big `Record<string, string[]>` map of every known ticker → every known quarter, unpaginated (line 130).

`NOT IMPLEMENTED`: pagination, filtering, or sorting exposed as request parameters on either endpoint — both are "return everything, sorted my way" APIs. This is consistent with their consumers (dashboard screener table, transcript-availability lookup) being small enough in absolute terms (≤200 Nifty200 companies × ≤8 quarters) that unpaginated responses are a reasonable, if not future-proof, choice — but it is a real gap the task asked to verify precisely, and the code confirms it.

---

## 12. Company & quarter identifiers — static registry, not DB-backed

`IMPLEMENTED` as **static compiled TypeScript data**, not a database table, not fetched at runtime from any exchange/vendor:

- `lib/nifty50.ts` (405 lines): `NIFTY50: Record<string, CompanyInfo>` — hardcoded `{ bse, nse, name, sector }` per ticker, header comment "mirrors finance-agent/fetcher/nifty50.py" (i.e. hand-ported from the archived Python prototype, not regenerated from it). Also defines `QUARTERS` (lines 68-77) — a **hardcoded array** `["Q4_2026", "Q3_2026", ..., "Q1_2025"]` with the comment "add new quarters here as they arrive" — meaning the system's canonical notion of "what quarters exist" requires a **code change and redeploy** to extend, not a data-driven computation from the current date or from what's in `earnings_calendar`/`analysis_results`. `app/api/v1/screener/route.ts:11-12` derives `Q_CURR`/`Q_PREV` directly from `QUARTERS[0]`/`QUARTERS[1]` — so the entire screener's notion of "current quarter" is this static array's first two entries, not a computed value.
- `lib/nifty200.ts` (263 lines), `lib/nifty500.ts` (172 lines), `lib/listed-companies.ts` (516 lines, `LISTED_COMPANIES: ListedCompany[]`, header comment: "Source: wealth/AverageMarketCapitalization31Dec2025.pdf" — i.e. manually transcribed from a SEBI market-cap PDF, not an API), `lib/sub-sectors.ts` (111 lines) — same pattern: literal object/array data checked into the TS source tree.
- Ticker identity is a plain uppercase string key (`RELIANCE`, `TCS`, etc.) — normalized by `.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")` at every ingestion boundary (`transcript-fetcher.ts:311`, `request/route.ts:337`) — there is **no canonical-company database table**; the registry *is* the source files, and every DB table (`analysis_results.company_ticker`, `kpi_snapshots.company_ticker`, etc.) just stores this free-text ticker string with no FK into any companies table (because there is no companies table — company metadata is joined in application code from the static import, e.g. `NIFTY50[cached.ticker]?.name` in `kpis/route.ts:32`).

`NOT IMPLEMENTED`: a DB-backed, dynamically-updatable company/quarter registry. `IMPLIED-ARCHITECTURALLY-PREPARED`: nothing suggests a migration path to a real `companies` table was ever planned — the pattern is stable enough (13 static registry files) to read as an intentional choice given the fixed, slow-changing universe (Nifty50/200/500 constituents change quarterly at most), not a stopgap.

---

## Summary of the lifecycle, file-by-file

```
SOURCE            screener.in (undocumented JSON search + HTML scrape),
                  BSE AnnSubCategoryGetData/w (JSON), NSE/BSE PDF archives
                  → lib/transcript-fetcher.ts, app/api/v1/request/route.ts,
                    lib/promoter-activity-fetcher.ts

INGESTION         downloadPdf() / fetch() with spoofed browser headers
                  → same files; %PDF header check only, no deeper validation

NORMALIZATION     ticker → [A-Z0-9] uppercase; quarter → inferQuarterFrom{NseUrl,Text,Html}
                  cascade (filename timestamp → PDF text regex → HTML context regex)
                  → lib/transcript-fetcher.ts:195-306

VALIDATION        %PDF byte-header check (storage); Gemini responseSchema (AI output);
                  Array.isArray() shape gates at repository read/write boundary;
                  NO zod / declarative schema anywhere in the repo
                  → lib/pipeline.ts, lib/repositories/analysis.ts,soloAnalysis.ts

STORAGE           Azure Blob container "transcripts", flat TICKER_Q#_YYYY.pdf keys,
                  account-key writes / SAS-token reads
                  → lib/repositories/storage.ts (AzureBlobStorageRepository, live)
                  Azure Database for PostgreSQL Flexible Server, 13 tables, JSONB payloads
                  → lib/postgres/client.ts, supabase/migrations/001-011, lib/repositories/*.ts

RETRIEVAL         resolvePdfKey() full-listing scan + exact match; cache-table lookup
                  by natural key before any Gemini call
                  → lib/pipeline.ts:223-234, every repository's getCached*/getLatest* method

TRANSFORMATION    pdf-parse text extraction, 120K-char truncation, multi-agent Gemini
                  calls with responseSchema-constrained JSON output
                  → lib/pipeline.ts

AI CONTEXT        per-section system prompts + prior-quarter takeaways/quotes fed back
                  into temporal-delta agent; synthesis agents (earnings delta, FCF,
                  key metrics) fed a compact cross-section summary
                  → lib/pipeline.ts:buildDeltaSummary + agent runners

DERIVED DATA      confidence/flag scoring (screener), divergence score (promoter pledges),
                  sector narrative synthesis
                  → app/api/v1/screener/route.ts:computeConfidence,
                    lib/divergence-score.ts, lib/insights-pipeline.ts

PERSISTENCE       DELETE+INSERT (analysis_results, solo_analysis_cache — no unique
                  constraint) or INSERT...ON CONFLICT (everything else — has a
                  unique constraint) into Postgres JSONB columns
                  → lib/repositories/*.ts (Postgres* classes, the only ones wired up)

API               /api/v1/* (session-auth'd, NextAuth/Entra) and /api/public/v1/*
                  (API-key-auth'd via middleware.ts, SHA-256 hash lookup, daily
                  quota, per-product entitlement) → typed api-contracts mappers
                  → middleware.ts, lib/api-contracts/v1/*.ts, app/api/public/v1/**

UI                Next.js App Router client components consume the typed JSON
                  responses directly (DashboardClient.tsx, InsightsClient.tsx, etc.
                  — not read in depth for this document)
```

---

## Flagged as genuinely surprising (for the interview discussion)

1. **The entire Supabase framing in `TECHNICAL_ARCHITECTURE.md` is stale.** Production runs on Azure Postgres + Azure Blob Storage + NextAuth/Microsoft Entra ID + (implied by `auth.ts`) Azure App Service — not Supabase Auth/Postgres/Storage on Vercel. Every repository file carries a dead `Supabase*Repository` class next to the live `Postgres*Repository` one; `lib/repositories/index.ts` is the one file that proves which is real.
2. **RLS is not enforced on the live database at all**, even though the SQL migrations correctly implement it on 3 tables — `scripts/migrate-schema-to-azure.ts` strips `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY` at deploy time because Azure Postgres has no `auth.uid()`. Per-user data isolation is 100% application-code discipline (`WHERE user_id = $1` in every query), with no database-level backstop.
3. **`@azure/storage-blob` isn't a stray/unused dependency — it's the primary, live storage backend**, inverting the assumption that Supabase Storage is what's running.
4. **Two tables central to cost control (`analysis_results`, `solo_analysis_cache`) have no unique constraint on their cache key and no index supporting their primary read query** — dedup relies entirely on an unwrapped DELETE-then-INSERT in application code, while every *other* cache table in the schema has a real `UNIQUE`/`ON CONFLICT` upsert.
5. **Two independent, structurally identical non-atomic "read usage, check limit, write usage" races exist** — one in `middleware.ts` is explicitly documented and accepted as a known v1 trade-off; the essentially identical one in `lib/credits.ts` (user-facing monthly credit metering) has no such acknowledgment, and the atomic-`ON CONFLICT` fix that was already applied to the sibling `apiAccess.ts` repository was never ported to `credits.ts`.
6. **The archived FAISS/vector prototype (`finance-agent/`) targeted a different market entirely** — `financial_memory.py`'s `COMPANY_ALIASES` are US large-caps (Microsoft, Apple, Alphabet), while the live production app is India-only (Nifty50/200/500, BSE/NSE, screener.in) — this isn't just an infrastructure downgrade from vector-search to Postgres-JSONB, it's evidence of a full product-scope pivot between the archived prototype and the shipped system.
7. **Migration 010's own header comment contradicts its own DDL** — "Default monthly allowance = 600 credits ($6)" vs. `quota INTEGER NOT NULL DEFAULT 2500` two lines below it; the app code (`DEFAULT_QUOTA = 2_500`) agrees with the DDL, not the comment.
8. **Stale Supabase-era comments now sit inside live user-facing error strings and log lines** post-migration — e.g. `lib/pipeline.ts:263`'s thrown error still says "delete it from Supabase storage and re-request the ticker" when storage is actually Azure Blob; `available/route.ts:53`'s comment claims "Supabase `search:` reliably finds files" describing code that now runs against `AzureBlobStorageRepository`'s in-memory `.filter()`.
9. **`request/route.ts` duplicates `transcript-fetcher.ts` wholesale rather than importing it**, and the two copies have already drifted on real parameters (18-month vs. 30-month BSE lookback window, 4 vs. 8 max transcripts per run) — despite `transcript-fetcher.ts`'s own module comment claiming it was "extracted from request/route.ts for reuse."
