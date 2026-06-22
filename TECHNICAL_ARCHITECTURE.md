# Quantalyze — Technical Architecture

Complete system design, API topology, database schema, AI pipeline architecture, cost estimation, and engineering decisions.

---

## 1. System Overview

| Layer | Technology | Detail |
|-------|-----------|--------|
| Frontend | Next.js 14 (App Router) | React Server Components + Client Components |
| Styling | Tailwind CSS | Custom `brand-*` color palette |
| AI Model | Gemini 2.5 Flash Lite | All pipelines, structured JSON output |
| Auth | Supabase Auth | JWT Bearer tokens, service-role admin |
| Database | Supabase PostgreSQL | 10 tables, JSONB payloads, RLS on 3 tables |
| Object Storage | Supabase Storage | `transcripts` bucket (PDF files) |
| Deployment | Vercel | Serverless functions, 300s max duration |
| Streaming | NDJSON over ReadableStream | Real-time pipeline progress |
| PDF Export | jsPDF | Client-side text-based PDF generation |
| PDF Parsing | pdf-parse | Server-side transcript extraction |

---

## 2. Database Schema (10 Tables)

### Core Tables

| Table | Key | Purpose | Used By |
|-------|-----|---------|---------|
| `analysis_results` | (company_ticker, q_prev, q_curr) | Delta analysis cache | Dashboard, Screener, Sectors |
| `solo_analysis_cache` | (ticker, quarter) | Deep Dive cache | Dashboard |
| `insights_cache` | (ticker, quarters_key) | Multi-quarter insights cache | Insights |
| `sector_intelligence` | (sector, quarter) | Sector narrative + scores | Sectors |
| `earnings_calendar` | (ticker, quarter) | Board meeting dates | Calendar |
| `concall_links` | (ticker, quarter) | YouTube video ID cache | Videos |
| `kpi_snapshots` | (company_ticker, quarter) | KPI extractions | KPIs |
| `promoter_activity` | (ticker, news_id) | BSE pledge/SAST filings | Divergence |
| `user_tickers` | (user_id, ticker) | Per-user custom stocks | Dashboard, Insights |
| `user_connections` | (user_id, provider) | OAuth connections (legacy) | — |

### Storage

| Bucket | Content | Access |
|--------|---------|--------|
| `transcripts` | Earnings call PDFs (`TICKER_Q#_YYYY.pdf`) | Service-role only |

### RLS Policy

- `analysis_results` — RLS enabled, `auth.uid() = user_id`
- `user_tickers` — RLS enabled, `auth.uid() = user_id`
- `user_connections` — RLS enabled, `auth.uid() = user_id`
- All others — No RLS (accessed via `supabaseAdmin` service-role key)

---

## 3. Per-Screen API Topology

### Dashboard (`/dashboard` → `DashboardClient.tsx`)

| Action | Endpoint | Method | Tables | External API | Streaming |
|--------|----------|--------|--------|-------------|-----------|
| Load available transcripts | `/api/v1/available` | GET | Supabase Storage list | — | No |
| Auto-fetch transcripts | `/api/v1/request` | POST | Supabase Storage (upload) | Screener.in, BSE API | No |
| Delta Analysis | `/api/v1/analyze` | POST | `analysis_results`, Storage | Gemini (11 calls), Yahoo Finance | NDJSON |
| Deep Dive Analysis | `/api/v1/analyze/solo` | POST | `solo_analysis_cache`, Storage | Gemini (1 call) | NDJSON |
| Promoter Pledge Badge | `/api/v1/divergence` | GET | `promoter_activity`, `insights_cache` | BSE API | No |
| Analysis History | `/api/v1/analyze/history` | GET | `analysis_results` | — | No |
| Transcript Download | `/api/v1/transcript/download` | GET | Supabase Storage | — | No |
| User Tickers | `/api/v1/user-tickers` | GET/POST | `user_tickers` | — | No |

### Multi-Quarter Insights (`/insights` → `InsightsClient.tsx`)

| Action | Endpoint | Method | Tables | External API | Streaming |
|--------|----------|--------|--------|-------------|-----------|
| Run Insights | `/api/v1/insights` | POST | `insights_cache`, Storage | Gemini (N+1 calls: N per-quarter + 1 synthesis) | NDJSON |

### Screener (`/screener` → `ScreenerClient.tsx`)

| Action | Endpoint | Method | Tables | External API |
|--------|----------|--------|--------|-------------|
| Load Signals | `/api/v1/screener` | GET | `analysis_results` | — |

### Sectors (`/sectors` → `SectorsClient.tsx`)

| Action | Endpoint | Method | Tables | External API |
|--------|----------|--------|--------|-------------|
| Load Sectors | `/api/v1/sectors` | GET | `sector_intelligence` | — |
| Seed Sector | `/api/v1/sectors/seed` | POST | `sector_intelligence`, `analysis_results`, Storage | Gemini (per uncached ticker + narrative) |

### Calendar (`/calendar` → `CalendarClient.tsx`)

| Action | Endpoint | Method | Tables | External API |
|--------|----------|--------|--------|-------------|
| Load Calendar | `/api/v1/calendar` | GET | `earnings_calendar`, `analysis_results` | — |
| Seed Calendar | `/api/v1/calendar/seed` | POST | `earnings_calendar` | NSE API, BSE API, Tickertape |

### Videos (`/videos` → `VideosClient.tsx`)

| Action | Endpoint | Method | Tables | External API |
|--------|----------|--------|--------|-------------|
| Load Video per company | `/api/v1/concall` | GET | `concall_links` | YouTube Data API v3 |

---

## 4. AI Pipeline Architecture

### 4a. Delta Analysis Pipeline (`lib/pipeline.ts`)

**Trigger**: `POST /api/v1/analyze` → `runPipeline()`

**Model**: `gemini-2.5-flash-lite`, temperature `0`, structured JSON output

**Agent timeout**: 25s per agent | **Function timeout**: 300s | **Pipeline timeout**: 270s

**Phases (sequential)**:

```
Phase 1 — PDF Extraction (parallel)
  ├── extractPdfText(qPrevKey)     ~2-3s
  └── extractPdfText(qCurrKey)     ~2-3s
  Transcript cap: 120,000 chars

Phase 2 — Thematic Agents + Evasiveness (parallel, 11 calls)
  ├── Revenue & Growth (prev)      ─┐
  ├── Revenue & Growth (curr)       │
  ├── Margins & Profitability (prev)│
  ├── Margins & Profitability (curr)│
  ├── Cost Structure (prev)         ├── 10 parallel Gemini calls
  ├── Cost Structure (curr)         │   Schema: QUARTER_SNAPSHOT_SCHEMA
  ├── CapEx & Balance Sheet (prev)  │
  ├── CapEx & Balance Sheet (curr)  │
  ├── Macro & Risk (prev)           │
  ├── Macro & Risk (curr)          ─┘
  └── Evasiveness Agent (curr only) ── 1 Gemini call
                                        Schema: EVASIVENESS_SCHEMA
                                        Input: last 30,000 chars only

Phase 3 — Temporal Delta (parallel, up to 5 calls)
  For each section where both prev+curr succeeded:
  └── runTemporalDelta(section)     Schema: SECTIONAL_INSIGHT_SCHEMA

Phase 4 — Synthesis + Market Data (parallel, 4 calls)
  ├── runEarningsDeltaAgent()       Schema: BULLETS_SCHEMA ("What Changed")
  ├── runFCFImplicationsAgent()     Schema: BULLETS_SCHEMA ("Financial Impact")
  ├── runKeyMetricsAgent()          Schema: KEY_METRICS_SCHEMA (Rev, EBITDA, PAT)
  └── fetchStockPriceChange()       Yahoo Finance API (no Gemini)

Phase 5 — Local Validation (no LLM)
  ├── localValidation()             Signal/score consistency check
  └── computeMarketAlignment()      Stock direction vs signal direction
```

**Total Gemini calls per delta analysis**: 11 (thematic) + 1 (evasiveness) + 5 (delta) + 3 (synthesis) = **~20 calls**

**Streaming events** (NDJSON to client):
```
{ type: "start", sections: [...] }
{ type: "thematic_done", section: "Revenue & Growth", which: "prev" }
{ type: "evasiveness_done", score: 3.2 }
{ type: "delta_done", section: "Revenue & Growth" }
{ type: "stock_done", stockPriceChange: 5.2 }
{ type: "done", payload: {...}, id: "uuid" }
```

### 4b. Deep Dive Pipeline (`lib/solo-pipeline.ts`)

**Trigger**: `POST /api/v1/analyze/solo` → `runSoloPipeline()`

**Model**: `gemini-2.5-flash-lite`, temperature `0`, structured JSON

**Agent timeout**: 55s | **Function timeout**: 120s

```
Phase 1 — Cache check (solo_analysis_cache)
Phase 2 — PDF extraction (~2-3s)
Phase 3 — Single Gemini call with comprehensive prompt
           Input: full transcript (120K chars)
           Output: { headline, management_tone, sections: [{ title, bullets }] }
           Sections: 8-14 thematic sections
Phase 4 — Cache result
```

**Total Gemini calls**: **1** (single comprehensive call)

### 4c. Multi-Quarter Insights Pipeline (`lib/insights-pipeline.ts`)

**Trigger**: `POST /api/v1/insights` → `runInsightsPipeline()`

**Model**: `gemini-2.5-flash-lite`, temperature `0`, structured JSON

**Agent timeout**: 55s | **Function timeout**: 300s

```
Phase 1 — Discover quarters (Supabase Storage search)
           Takes up to 8 most recent quarters

Phase 2 — Per-quarter brief extraction (parallel, N calls)
           Each call extracts: key_points, segment_highlights,
           guidance_statements, new_developments, management_tone,
           financials, growth_outlook, margins, cost_control,
           capex_and_capacity, customer_and_market, macro_and_news
           Schema: QUARTER_BRIEF_SCHEMA

Phase 3 — Cross-quarter synthesis (1 call)
           Input: all quarter briefs concatenated
           Output: recurring_themes, guidance_tracks,
           management_credibility_score, new_business_signals,
           key_watchpoints, segment_narrative
           Schema: SYNTHESIS_SCHEMA
```

**Total Gemini calls**: **N+1** (N quarters + 1 synthesis, typically 5-9 calls)

### 4d. Sector Narrative (`lib/sector-narrative.ts`)

**Model**: `gemini-2.5-flash-lite`, temperature `0.1`

**Timeout**: 22s

**Output**: 7 fields — competitive_structure, strategic_theme, tailwinds, headwinds, key_triggers, macro_sensitivity, transformation_signal

**Calls**: 1 per sector seed

---

## 5. Authentication Flow

```
Browser → Supabase Auth (email/password or Google OAuth)
       → JWT stored in Supabase session
       → Client reads: supabase.auth.getSession() → access_token

API Request:
  Client: Authorization: Bearer <access_token>
  Server: getUserId(req) → supabase.auth.getUser(token) → user.id
  Throws "Unauthorized" if invalid

Admin operations (caching, storage):
  supabaseAdmin() → createClient(url, service_role_key)
  Bypasses RLS, used for all pipeline read/write operations
  cache: "no-store" on all fetch calls (prevents Next.js fetch cache)
```

---

## 6. Streaming Architecture (NDJSON)

```
Server (Route Handler):
  new ReadableStream({
    async start(controller) {
      const send = (data) => controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"))
      // Pipeline runs, calls send() for each progress event
      send({ type: "done", payload, id })
      controller.close()
    }
  })
  → Response with Content-Type: application/x-ndjson

Client (lib/api.ts):
  const reader = response.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop()
    for (const line of lines) processLine(line)  // JSON.parse → onEvent callback
  }
```

**Safety mechanisms**:
- `closed` flag prevents enqueue after controller errors
- Pipeline-level timeout (270s) sends error event before Vercel kills function
- `try/catch` around `controller.enqueue` to handle client disconnects

---

## 7. Caching Strategy

| Cache | Table | Key | TTL | Invalidation |
|-------|-------|-----|-----|-------------|
| Delta Analysis | `analysis_results` | (ticker, q_prev, q_curr) | Permanent | Manual "Clear cache & re-analyze" |
| Deep Dive | `solo_analysis_cache` | (ticker, quarter) | Permanent | Manual re-analyse |
| Multi-Quarter | `insights_cache` | (ticker, quarters_key) | 30 days (app-enforced) | Auto: new quarter uploaded changes key |
| Sector Intel | `sector_intelligence` | (sector, quarter) | Permanent | Manual re-seed |
| YouTube Videos | `concall_links` | (ticker, quarter) | Permanent | `?retry=true` param skips cache |
| Promoter Data | `promoter_activity` | (ticker, news_id) | 24h fetch log | Per-ticker 24h refetch TTL |
| Calendar | `earnings_calendar` | (ticker, quarter) | Permanent | Manual Refresh button |

**Analysis cache validation** (`lib/analysis-cache.ts`):
- Rejects empty insights (`insights.length === 0`)
- Strict mode: rejects missing `earnings_delta` (newer pipeline field)
- Non-strict mode: for sector seeding (doesn't need synthesis fields)

---

## 8. Frontend Patterns

### State Management
- React `useState` / `useEffect` — no external state library
- `useRef` for mutable refs (fetchAttempted, cycleRef, csvInputRef)
- `useMemo` for filtered/paginated lists
- `localStorage` for watchlist persistence (shared across Dashboard + Insights via `quantalyze_watchlist` key)

### Watchlist
- Max 20 tickers, seeded with 10 defaults on first use
- `toggle()`, `bulkAdd()`, `cycleNext()`, `cyclePrev()`
- Arrow key cycling via global `keydown` listener (skips when input focused)
- CSV upload: parses any whitespace/comma/semicolon-separated tokens

### PDF Export
- `jsPDF` — text-based PDF generation (not screenshot)
- Header: "Quantalyze by Demandion | support@demandion.ai"
- Footer on every page: "Generated by Quantalyze"
- `checkPage()` helper for multi-page overflow
- Delta report uses `html2canvas` → `jsPDF` (screenshot-based, for layout fidelity)

### Company Search (`CompanySearch` component)
- Fuzzy filter on `NIFTY200_LIST + userTickers + storageExtras`
- "Add TICKER to my list — visible only to you" for unknown tickers
- Optimistic UI update → POST to `/api/v1/user-tickers`

---

## 9. Cost Estimation (Per User Per Month)

### Gemini API Costs

| Action | Gemini Calls | Input Tokens (est.) | Output Tokens (est.) | Cost per Run |
|--------|-------------|--------------------|--------------------|-------------|
| Delta Analysis | ~20 | ~600K (120K×5 sections×2 quarters) | ~15K | ~$0.03 |
| Deep Dive | 1 | ~120K | ~8K | ~$0.01 |
| Multi-Quarter (6Q) | 7 | ~720K | ~12K | ~$0.04 |
| Sector Narrative | 1 | ~5K | ~2K | <$0.01 |

**Gemini 2.5 Flash Lite pricing** (as of mid-2025): ~$0.01 / 1M input tokens, ~$0.04 / 1M output tokens

**Estimated per-user monthly** (assuming 20 delta + 10 deep dive + 5 multi-quarter):
- Gemini: **~$1.00–1.50/month**

### Supabase Costs

| Resource | Free Tier | Usage Estimate |
|----------|-----------|---------------|
| Database | 500MB | ~50MB for 200 cached analyses |
| Storage | 1GB | ~500MB for 200 transcripts |
| Auth | 50K MAU | Negligible |
| Edge Functions | 500K invocations | ~10K/month per user |

**Supabase**: Free tier covers ~50 users. Pro ($25/mo) covers ~500 users.

### Vercel Costs

| Resource | Free Tier | Pro ($20/mo) |
|----------|-----------|-------------|
| Serverless Functions | 100 GB-hrs | 1000 GB-hrs |
| Function Duration | 10s max | 300s max |
| Bandwidth | 100GB | 1TB |

**Delta analysis requires 300s function limit** → **Vercel Pro required** ($20/mo)

### YouTube Data API

- Free tier: 10,000 units/day (~100 search calls)
- Each `/api/v1/concall` with cache miss = 1 search call (100 units)
- Cached hits = 0 API calls
- For 500 companies: first-time seed costs ~5,000 units. After that, cache serves.

### External APIs (Free)

| API | Purpose | Cost |
|-----|---------|------|
| Yahoo Finance | Stock price change per quarter | Free (unofficial) |
| BSE API | Promoter filings, calendar seed | Free |
| NSE API | Calendar seed | Free |
| Screener.in | Transcript PDF download | Free |

### Total Infrastructure Cost

| Users | Gemini | Supabase | Vercel | Total |
|-------|--------|----------|--------|-------|
| 1-10 | $15/mo | Free | $20/mo | **~$35/mo** |
| 10-50 | $75/mo | Free | $20/mo | **~$95/mo** |
| 50-200 | $300/mo | $25/mo | $20/mo | **~$345/mo** |
| 200-500 | $750/mo | $25/mo | $20/mo | **~$795/mo** |

**Unit economics at ₹35K/year per user**: ₹2,917/mo per user → ~$35/mo per user. At 50 users, infra is $95/mo vs revenue $1,750/mo = **95% gross margin**.

---

## 10. Key Architectural Decisions

### Why Gemini 2.5 Flash Lite (not GPT-4 / Claude)
- Structured JSON output via `responseSchema` — guarantees valid JSON, no parsing failures
- ~5-10x cheaper than GPT-4-turbo for similar quality on financial text
- 1M token context window fits full conglomerate transcripts (120K chars)
- Temperature 0 for deterministic financial extraction

### Why NDJSON Streaming (not WebSockets)
- Zero infrastructure overhead — works over standard HTTP
- Compatible with Vercel serverless (no persistent connections needed)
- Client can show real-time progress (11 thematic agents → 5 delta → synthesis)
- Graceful degradation: if connection drops, partial results are still usable

### Why Supabase Storage (not S3)
- Same auth layer as the database — no separate IAM
- `supabaseAdmin()` client works for both DB queries and file operations
- Signed URLs for transcript download with zero additional config

### Why 5 Specialist Agents (not 1 comprehensive)
- Parallelism: 10 agents finish in the time of 1 (wall-clock ~15-25s vs ~120s)
- Structured schemas per domain prevent cross-contamination
- Each agent has a focused system prompt → higher extraction quality
- Individual failures don't kill the pipeline (null agents are filtered out)

### Why Client-Side PDF Export (not Server-Side)
- Zero server cost for export
- `jsPDF` text rendering is fast (<1s for a 10-page report)
- Delta report uses `html2canvas` for pixel-perfect layout reproduction
- No Puppeteer/Chromium dependencies on Vercel

### Why localStorage for Watchlist (not DB)
- Zero latency — no API call on page load
- Shared across Dashboard and Insights via same key
- 20-ticker cap keeps payload tiny (~500 bytes)
- Per-user DB storage (`user_tickers`) only for custom stocks outside Nifty 200

### Why `cache: "no-store"` on supabaseAdmin
- Next.js 14 transparently caches `fetch()` responses
- Supabase JS client uses `fetch` internally
- Without `no-store`, DB writes (upserts) were invisible to subsequent reads
- Discovered when sector intelligence showed 15/17 sectors despite all 17 being inserted

### Why Pipeline-Level Timeout (270s) Inside Function Timeout (300s)
- Vercel kills functions silently at `maxDuration` — no error event sent to client
- Client sees "Pipeline completed without result" (stream closes without done/error)
- 270s timeout fires 30s before Vercel kill → sends proper error event
- `closed` flag prevents `controller.enqueue` after stream is closed

---

## 11. Transcript Sourcing

`lib/transcript-fetcher.ts` + `/api/v1/request`

Sources (tried in order):
1. **Screener.in** — scrapes annual report / concall PDF links
2. **BSE API** — `AnnSubCategoryGetData/w` for corporate announcements, filters for concall PDFs via `AnnPdfOpen` links

PDFs uploaded to Supabase Storage as `TICKER_Q#_YYYY.pdf`.

`resolvePdfKey()` paginates the storage bucket (100 per page) to find the exact file, case-insensitive match.

---

## 12. Promoter Pledge Scoring

`lib/divergence-score.ts` + `lib/promoter-activity-fetcher.ts`

```
BSE "Insider Trading / SAST" feed
  → Filter: Reg 31 "encumbrance by promoter" (pledge events)
  → Skip: "Closure of Trading Window" (noise)
  → Store in promoter_activity table (dedup on news_id)

Scoring:
  recent = events in last 90 days
  baseline = events in 90-450 day window, normalized to 90-day rate
  
  quiet: 0 recent events
  normal: recent ≤ baseline × 1.5
  elevated: recent > baseline × 1.5
  
  flag = elevated AND concall signal is Positive/Mixed
  (promoter pledging while management sounds upbeat = worth investigating)
```

---

*Generated for Quantalyze v2.0.0 — June 2026*
