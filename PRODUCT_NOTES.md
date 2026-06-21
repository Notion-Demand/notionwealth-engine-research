# Quantalyze — Product Notes & Design Decisions

Running log of key product decisions, reasoning, and trade-offs made during development.
Newest entries at the top.

---

## Top 20 Features & Benefits (₹35k/year value proposition)

### Concall Analysis Engine

1. **Deep Dive Analysis** — Comprehensive single-quarter earnings brief (8-14 sections) covering segment performance, pricing mechanics, channel dynamics, capex, and growth outlook — richer than Tijori or Screener, with management quotes and causation links.

2. **Delta Analysis (Quarter-over-Quarter)** — Detects what management *changed* in their language between two quarters across 5 domains: Revenue, Margins, Costs, CapEx, and Macro/Risk. Surfaces narrative shifts others miss.

3. **Promoter Pledge Activity Monitor** — Scans SEBI Reg. 31 promoter pledge/unpledge disclosures, compares last 90 days activity vs 15-month baseline frequency, cross-references with latest concall sentiment. Green "Healthy" for clean stocks, amber/red flags for elevated activity.

4. **Executive Evasiveness Score** — Quantifies how much management dodges questions in Q&A (0-10 scale). Catches deflection, non-answers, and pivot-to-talking-points behavior.

5. **Branded PDF Downloads** — Export Deep Dive or Delta analysis as professional PDFs with Quantalyze branding + transcript download.

### Multi-Quarter Insights (Pointer Sheet)

6. **Financials Tracker** — Revenue, PAT, margins, volume/realisation extracted per quarter with exact numbers — like maintaining your own pointer sheet automatically.

7. **Growth Outlook Tracker** — CAGR targets, recovery timelines, demand visibility, management confidence tracked quarter-over-quarter.

8. **Margins & Cost Control** — Separate tabs for margin trajectory AND cost reduction initiatives (power savings, input costs, operational efficiencies) with quantified savings.

9. **Capex & Capacity Tracker** — Expansion plans, utilization %, commissioning timelines, GF/BF/debottlenecking — all tracked across quarters.

10. **Customers & Market Position** — Customer concentration, de-risking progress, new industry additions, China+1 opportunities, order book composition.

11. **Macro & News** — Both stated-in-call factors AND external context relevant to the firm — each bullet tagged [Stated] or [Context].

12. **Recurring Themes Detection** — AI identifies themes that persist across 2+ quarters and tracks their evolution (improving/declining/dropped/newly emerging).

13. **Guidance Tracker with Credibility Score** — Tracks what management promised vs delivered. Scores credibility 0-10 based on guidance consistency across quarters.

14. **Product Updates & New Launches** — New customer wins, geographies, products, partnerships grouped by quarter with type icons.

### Coverage & Discovery

15. **Nifty 200 Universe** — Full coverage of India's top 200 companies with automatic transcript fetching.

16. **Sector Intelligence** — Aggregated sector-level narratives across 17 sectors / 65 companies. See which sector themes are strengthening or weakening.

17. **Earnings Calendar** — Upcoming concall dates so you never miss a result.

18. **Screener** — Filter companies by signal strength, evasiveness, divergence across the universe.

19. **Concall Videos** — YouTube concall recordings linked/embedded per company per quarter for quick playback.

20. **Watchlist + Keyboard Navigation** — Personal watchlist (up to 20 stocks), CSV bulk import, arrow-key cycling between stocks for rapid research workflow.

**One-liner:** *What a 3-analyst team builds in 2 days per company, Quantalyze delivers in 60 seconds across 200 companies — and catches shifts human readers miss.*

---

## 2026-06-15 — Portfolio Watchtower: Promoter Pledge-Activity Signal (Surface #1 v1)

### Context: Which Product Surface to Build Next
Evaluated the product against a 5-area framework (Pain, Innovation, Convenience, Cost,
Functional Gap). The deepest unmet need sits with institutions (PMS/family offices):
they currently cross-reference concall commentary, BSE insider/SAST filings, and
monthly business updates by hand across 15-30 holdings every quarter.

Four candidate "surfaces" were considered, layered on the existing concall-sentiment core:
1. **Portfolio Watchtower** (PMS/FO) — per-holding dashboard + divergence badges
2. **Divergence Screener** (long-short funds) — cross-sectional ranked table
3. **Pledge Risk Tracker** (credit desks) — pledge-trend view
4. **Governance Score API** (B2B2C) — white-label score via API

### Decision: Build Only Surface #1, Fold #2/#3 in as Features, Defer #4
Demand/supply pass before committing:
- **#1 Portfolio Watchtower** — clear gap. Tijori/Trendlyne/compounding.in cover
  fundamentals but none fuse concall sentiment with promoter-action divergence, and
  PMS heads explicitly asked for exactly this combination.
- **#2 Divergence Screener** — real per-buyer willingness-to-pay, but the addressable
  pool (single-stock long-short funds in India) is ~20-30 firms — too small for a
  standalone surface. Reframed as a premium unlock inside Watchtower, not built now.
- **#3 Pledge Risk Tracker** — Trendlyne already publishes a free promoter-pledge
  tracker, so standalone supply > demand. The only differentiated angle is fusing
  pledge data with concall commentary — i.e. the same divergence badge as #1.
- **#4 Governance Score API** — large addressable market but crowded (Tickertape /
  Smallcase / Trendlyne already ship "quality scores") and needs a different GTM
  motion (BD/licensing vs. direct analyst sales). Deferred until Watchtower has
  enough credibility to license from.

**Net effect**: ship the divergence-score work as enrichment to the existing
dashboard (Watchtower) — no separate screens or API surfaces yet.

### Data Validation: BSE "Insider Trading / SAST" Feed
Before committing to a schema, validated `AnnSubCategoryGetData/w?strCat=Insider
Trading / SAST` across two groups (18-month lookback):
- **Large, well-governed caps** (RELIANCE, TATAMOTORS, ADANIENT, BAJAJ Finance):
  ~100% "Closure of Trading Window" boilerplate, zero real pledge events — correct,
  not a bug; these names should simply show "quiet".
- **Companies with known pledge/governance situations** (VEDL, INDUSINDBK, ZEEL,
  SUZLON): VEDL had ~58 SAST filings in 18 months, many "reasons for encumbrance by
  promoter" (Reg 31) disclosures; INDUSINDBK had 23/23 real Reg 29/31 disclosures
  **clustered exactly around its Mar-May 2026 governance crisis** — the strongest
  validation case, proving the feed carries signal when it matters.

**Caveats found**:
- The Reg 31 "encumbrance by promoter" phrase is unambiguous with zero false
  positives across all 6 companies — used as the primary classifier.
- Reg 29 substantial-acquisition disclosures are often filed by unrelated
  mutual-fund trustees (HDFC MF, ICICI Prudential MF, Axis Trustee) crossing
  ownership thresholds, not promoter actions. Kept as a secondary "institutional"
  bucket and not used in the v1 flag — a per-company promoter-entity allowlist
  would be needed to use these safely.
- A Reg 31 headline confirms an encumbrance EVENT occurred but not its DIRECTION
  (pledge increase vs. release — both trigger Reg 31) or magnitude. Direction
  requires parsing the linked PDF attachment — deferred to phase 2.

### Decision: v1 Divergence Score is Frequency-Based, Not Directional
Given the direction ambiguity above, v1 does NOT claim the promoter is
bullish/bearish — it surfaces an **activity-spike signal**: recent (90-day) vs.
baseline (450-day, normalized) pledge-filing frequency per holding, cross-referenced
against the existing concall `overall_signal`.

- `pledgeActivityLevel`: `quiet` | `normal` | `elevated`
- `flag = true` only when `elevated` AND the concall signal is `Positive`/`Mixed`
  — "promoter pledge filings spiked while management sounded upbeat, worth checking
  the underlying filing."

This is intentionally conservative — INDUSINDBK shows that an activity spike alone
(without direction) is already a strong, demo-able signal.

### Implementation
- `supabase/migrations/008_promoter_activity.sql` — `promoter_activity` table
  (dedup on `ticker, news_id`) + `promoter_activity_fetch_log` (per-ticker 24h cache
  TTL, even for tickers with zero events).
- `lib/promoter-activity-fetcher.ts` — reuses the `AnnSubCategoryGetData/w` pattern
  from `fetchBseTranscripts`, classifies rows via `PLEDGE_RE` (Reg 31 "encumbrance
  ... promoter"), `REG29_RE` (institutional), skips "Closure of Trading Window".
- `lib/divergence-score.ts` — frequency comparison + latest
  `insights_cache.overall_signal` lookup → `DivergenceResult`.
- `app/api/v1/divergence/route.ts` — `GET ?ticker=X`, 24h-cached fetch/upsert, same
  pattern as `/api/v1/kpis`.
- `EarningsReport.tsx` — new self-fetching `PromoterActivityBadge`, rendered next to
  the existing signal/score badge. Fails closed (renders nothing) on API error, so
  the dashboard never breaks — even before migration 008 is applied.

### What's Deferred (Phase 2)
- PDF-attachment parsing for pledge direction/magnitude (increase vs. release, % of holding).
- Per-company promoter-entity allowlist to safely use Reg 29 disclosures.
- Shareholding-pattern (promoter holding % + pledge %) endpoint — a guessed BSE
  endpoint (`ShareholdingPattern/w`) returned a 302 error page; correct endpoint not
  yet found.
- Surfaces #2 (Divergence Screener) and #4 (Governance Score API) — revisit once
  Watchtower has traction.

### Go-to-Market: Buyer Landscape & Pilot Strategy

**Current state**: zero track record, zero paying customers. Several back-to-back
calls with PMS heads have produced warm leads. The realistic path is converting
these into a **free pilot**, not a cold sale — a pilot produces the case-study/track
record a cold pitch can't substitute for, at the cost of delayed revenue. Given the
current state, that trade-off favors the pilot.

**Buyer landscape** (full enumeration beyond the 4 surfaces above), grouped by
proximity to the validated PMS/FO segment:

- **Tier 1 — validated, warm**: PMS managers, family offices (current pilot targets).
- **Tier 2 — adjacent institutional, same product/different framing, no new build**:
  AIF Cat-III funds, smaller/boutique AMC research desks, private bank/wealth
  management RM teams (HNI advisory), NBFC treasury & bond-fund credit desks.
- **Tier 3 — niche, high WTP, small N**: long-short/hedge funds (Surface #2),
  activist/special-situations investors, governance research firms (InGovern/SES/
  IiAS-type — buyer or reseller), quant funds (API/factor input), FPI desks covering
  India (governance intel without local-filing access).
- **Tier 4 — scale/B2B2C, large N, low ACV**: broking/wealth-tech platforms
  (white-label badge, Surface #4), "serious retail" subscriptions, financial media/
  data licensing (pledge-activity spikes are newsworthy).
- **Tier 5 — tangential, long-tail**: corporate lending/project-finance teams
  (promoter-group cross-default risk), audit/forensic firms (red-flag screening).

**Sequencing**: Tier 1 is the active pilot motion. Tier 2 needs no new product
work — same dashboard, different pitch framing ("PMS, but for a private bank RM").
Tiers 3-5 require either a different product cut (screener, API) or a BD/licensing
motion — both deferred until Watchtower has pilot traction to point to.

---

## 2026-05-27 — Sector Intelligence: Sub-Sectors + Nifty 200 Narrative Enrichment

### Context
After building the 17-sector intelligence system, two gaps remained:
1. Broad sectors (e.g. "Banking") blend PSU and private bank dynamics — investors care about each separately.
2. Narratives were generated from 2–8 primary tickers only; additional Nifty 200 companies in the same sector sitting in `analysis_results` were unused.

### Decision: Nifty 200 Sampler for Narrative Enrichment

`lib/nifty200-sampler.ts` — `sampleNifty200Signals(sector, qCurr, primaryTickers, maxSamples=6)`

On every `?narrative=true` seed call, the sampler runs first:
- Looks up Nifty 200 companies matching the sector (via `SECTOR_TO_NIFTY200_TAGS` map)
- Excludes tickers already in the primary list
- Batch-queries `analysis_results` for those tickers at `q_curr`
- Returns up to 6 `CompactSignal` objects (ticker, name, signal, score, summary)

These are appended to the Gemini prompt as **"Extended Nifty 200 context — use for sector-level breadth, not headline signals."** This gives the model broader signal coverage without inflating the primary company list.

Why this approach over adding all Nifty 200 companies to the primary sector lists:
- Primary list drives the **quantitative score aggregation** (market-cap weighted). Adding illiquid companies or those not yet analyzed would dilute or zero-out scores.
- Extended context is qualitative only — Gemini uses it to enrich narratives but it doesn't affect dimension scores.

### Decision: 5 Thematic Sub-Sectors

`lib/sub-sectors.ts` — `SUB_SECTOR_UNIVERSE`

| Sub-sector | Tickers | Parent |
|---|---|---|
| PSU Banks | SBI, PNB, BANKBARODA, CANBK, BANKINDIA, UNIONBANK, INDIANB | Banking |
| Private Banks | HDFC, ICICI, KOTAKBANK, AXISBANK, INDUSINDBK, IDFCFIRSTB, FEDERALBNK | Banking |
| Capital Markets | BSE, HDFCAMC, MOTILALOFS, 360ONE, SBICARD, POLICYBZR | NBFC |
| IT Midcap | LTIM, PERSISTENT, MPHASIS, COFORGE, KPITTECH | IT |
| Renewables | ADANIGREEN, JSWENERGY, TORNTPOWER, NTPCGREEN, NHPC | Power |

Sub-sectors are seeded identically to main sectors:
```
POST /api/v1/sectors/seed?sector=PSU+Banks&skipFetch=true&maxNew=0&narrative=true
```

Each sub-sector payload carries `is_sub_sector: true`, `parent_sector`, and a PM-grade `thesis` string that explains the investment angle (e.g. "Government-owned lenders: credit cost normalisation vs. NIM compression as rate cycle turns...").

### Decision: `ALL_SECTOR_UNIVERSE` as Single Source of Truth

Both the seed route and GET route now import `ALL_SECTOR_UNIVERSE` from `lib/sub-sectors.ts` instead of `SECTOR_UNIVERSE` from `nifty50.ts`. This means:
- New sub-sectors are automatically picked up in the seed endpoint's available list
- The GET endpoint returns sub-sector rows without code changes
- `SECTOR_UNIVERSE` stays unchanged (only broad sectors) — sub-sectors are additive

### Decision: UI Separation — Sub-Sectors in Collapsible Violet Row

Sub-sectors appear in a **separate collapsible row** below the main sector tab strip:
- Collapsed by default (not shown until toggled) — avoids cluttering the tab bar for users who only care about broad sectors
- Violet color scheme to distinguish from top-level sector tabs (gray)
- `SectorMatrix` (All Sectors overview) **excludes sub-sectors** — the cross-sector scorecard compares apples to apples (17 top-level sectors)

`ThesisCard` appears at the top of every sub-sector dashboard showing the investment thesis and parent sector badge.

### Decision: Start with 5 Sub-Sectors, Add More as Cache Grows

Sub-sectors will show low coverage initially (e.g. Capital Markets companies like BSE and HDFCAMC are in Nifty 200 but may not have cached analyses yet). Coverage grows organically as users analyze those companies individually. No special handling needed — same behavior as FMCG or Healthcare which started with 2/8 coverage.

---

## 2026-05-27 — Sector Intelligence: PM-Grade Narrative Layer

### Problem
The sector intelligence dashboard showed 8 quantitative dimension scores per sector but lacked **qualitative context** — a PM looking at Banking couldn't immediately understand whether the sector is consolidating, what the key macro risks are, or what triggers could re-rate it. The numbers alone don't answer "should I be OW or UW this sector?"

### Decision: 7-Field Sector Narrative via Gemini

`lib/sector-narrative.ts` — `generateSectorNarrative(sector, quarter, companyPayloads)`

Generates a `SectorNarrative` with 7 PM-grade fields:

| Field | What it answers |
|---|---|
| `competitive_structure` | Consolidated (few dominant players taking share) vs. fragmented (intense competition)? |
| `strategic_theme` | Are managements prioritizing GROWTH or PROFITABILITY this cycle? Why? |
| `tailwinds` | 2–3 specific structural tailwinds (demand drivers, policy, pricing cycle) |
| `headwinds` | 2–3 specific structural headwinds (input costs, regulatory risk, competition) |
| `key_triggers` | 2–3 events that could materially re-rate the sector (not generic risks) |
| `macro_sensitivity` | Which specific macro variables matter (RBI rates, INR, crude, budget)? |
| `transformation_signal` | Structural shift underway — PLI, technology disruption, consolidation wave |

Model: `gemini-2.5-flash-lite` with structured JSON output (`responseSchema`). Temperature 0.1 (deterministic). 22s timeout with `Promise.race`.

**Why structured schema over free-text**: The UI renders each field in a dedicated card (tailwinds → green, headwinds → red, triggers → amber). Free-text would require regex parsing and break unpredictably.

**Why Flash Lite**: Narrative generation adds ~4–8s to a seed call. Flash Lite stays within the Vercel 60s function limit when `maxNew=0` (no pipeline runs). Flash Pro would push this to ~15s and risk timeouts.

### Decision: Triggered by `?narrative=true` Param

Narratives are not generated on every seed — only when `?narrative=true` is explicitly passed. Reason:
- Most re-seeds are triggered to pick up new company analyses (`maxNew=0`). These should be fast (<5s).
- Narrative generation adds 4–25s (including sampler). Running it on every re-seed would be wasteful and timeout-prone.
- When re-seeding *without* `?narrative=true`, the existing narrative is **automatically carried over** from the DB row — no data is lost.

### Decision: NarrativeCard UI Design

The `NarrativeCard` uses a collapsible indigo-gradient panel (open by default) with 4 sub-sections:
- **Row 1**: Structure (indigo) + Strategic Theme (violet) — 2-column
- **Row 2**: Tailwinds (emerald) / Headwinds (red) / Triggers to Watch (amber) — 3-column
- **Row 3**: Macro Sensitivity (sky) + Transformation (purple) — 2-column

This layout was chosen over a prose block because PMs scan, they don't read. Color-coded grids allow eyes to jump directly to the relevant quadrant. Tailwinds and headwinds as bullet lists (not paragraphs) make the balance of forces immediately visible.

---

## 2026-05-27 — Sector Intelligence: All 17 Sectors Seeded (Cache Fix)

### Problem
After building the sector intelligence system, 15/17 sectors appeared but FMCG and Telecom were missing — even though INSERT returned a valid row ID. An unfiltered debug query confirmed the rows existed in the DB. The filtered query (with `.in("sector", validSectors)` and the `payload` column selected) returned 15 rows only.

### Root Cause: Next.js Fetch Cache
Next.js 14 transparently caches `fetch()` calls. The Supabase JS client uses `fetch` internally. The filtered query had been called many times before FMCG was inserted — Next.js was serving a stale cached response from before those rows existed.

The unfiltered debug query (added that same session) had never been called before — no cache entry → real DB response.

### Fix: `cache: 'no-store'` in `supabaseAdmin()`

```typescript
_client = createClient(url, key, {
  global: {
    fetch: (url, options) => fetch(url, { ...options, cache: "no-store" }),
  },
});
```

This applies to all Supabase calls from the admin client globally — no per-query annotations needed. `cache: 'no-store'` tells Next.js to bypass the fetch cache entirely for every Supabase request.

**Why not `revalidate: 0`**: `no-store` is stronger than `revalidate: 0`. The latter still stores the response in cache (just expires immediately). `no-store` never caches — correct for a DB that can be mutated at any time.

### Fix: Atomic Delete-Insert (Timeout-Wipe Protection)

Old code ran `DELETE WHERE sector IN (...)` for all sectors **before** the pipeline loop. If the function timed out mid-loop, the DELETE had already run but the INSERT hadn't — sectors vanished from the DB.

New code runs DELETE immediately before each sector's INSERT (atomic per-sector swap). A timeout during pipeline runs leaves all previously-inserted sectors intact.

---

## 2026-05-27 — Multi-Quarter Insights: Response Caching

### Problem
Every visit to the Insights page re-ran 8+ Gemini calls (one brief per quarter + synthesis). On 6 quarters that's ~7 LLM calls taking 60–120 seconds. Re-visiting the same stock had zero benefit over the first run.

### Decision: insights_cache Table (30-day TTL)

Cache key: `(ticker, quarters_key)` where `quarters_key` is the **sorted, comma-joined list of quarters analyzed** (e.g. `"Q1_2026,Q2_2026,Q3_2026,Q4_2026"`).

Why this key? Sorting means key is stable regardless of query order. Using the actual quarter list means **adding a new transcript automatically invalidates the cache** — the key changes when a new quarter appears in storage.

On cache **hit**:
- Progress events (`start`, `quarter_done` × N, `synthesis_start`) are replayed instantly
- Cached payload returned — zero Gemini calls
- UI still animates through the progress panel (same UX, ~1s instead of 2min)

On cache **miss**:
- Full pipeline runs as before
- Result written to cache non-blocking (errors are warned, not thrown — never fails the user response)

`force=true` param (wired to the "Clear cache & re-analyse" button) skips the cache read entirely and overwrites on write.

### Decision: No Per-Quarter Brief Caching
Caching at the full payload level was chosen over per-quarter brief caching because:
- The synthesis output depends on the combination of quarters, not just individual briefs
- Full payload cache is simpler (one table, one key) with the same cache invalidation behavior
- The rarest scenario (only synthesis changed) can be handled by force-refresh

**Migration to run**: `supabase/migrations/007_insights_cache.sql`

---

## 2026-05-27 — Watchlist: Defaults, Max 20, Cycle Navigation, CSV on Dashboard

### Problem
- Watchlist was empty for new users with no guidance on where to start
- No cap on watchlist size — could grow unbounded
- No way to cycle through watchlist stocks quickly (PMS use case = scanning many stocks)
- CSV upload existed only in Insights, not in Concall Analysis
- Default ticker was BHARTI (Airtel) — not the most recognisable stock for first impressions

### Decision: Default 10 Popular Stocks
When `localStorage` has no watchlist entry, seed with:
`RELIANCE, HDFC, ICICI, INFOSYS, TCS, KOTAKBANK, AXISBANK, SBI, BHARTI, ITC`

These are the top Nifty 50 heavyweights by market cap and brand recognition. They give a new user an immediately usable watchlist without any setup.

### Decision: Max 20 Tickers
Hard cap at 20 in both `toggle` (silently ignores adds beyond 20) and `bulkAdd`/CSV upload (only takes remaining slots). This keeps the watchlist bar scannable without scrolling.

Rationale: TradingView's default watchlist shows ~20 items per panel. 20 is the practical limit for quick visual scanning.

### Decision: TradingView-Style Cycling
- ◀ ▶ buttons appear next to "Watchlist (n/20)" when 2+ stocks are in the list
- `←` / `→` arrow keys cycle through the watchlist **when focus is not in an input or textarea**
- Cycles wrap around (last → first, first → last)
- In Insights, cycling automatically triggers `run()` on the new ticker

Keyboard shortcut is implemented via a `cycleRef` pattern (ref holds latest values of `cycleNext`, `cyclePrev`, `ticker`) so the global `keydown` listener is added once on mount and never re-registered — avoids stale closure bugs.

### Decision: Default Ticker → RELIANCE
Changed from "BHARTI" to "RELIANCE" in both Concall Analysis and Multi-Quarter Insights.

Rationale: Reliance is the highest-weight, most-recognised stock in India. A new user landing on the dashboard should see the most compelling example. BHARTI is a great company but not the automatic first choice for a broad audience.

---

## 2026-05-27 — Per-User Custom Tickers (Outside Nifty 200)

### Problem
Users searching for stocks outside the Nifty 200 universe had no way to add them permanently. The search dropdown showed "No matches" with no action available. Any extra stocks in storage were visible to all users (leaked across accounts).

### Decision: user_tickers Table with RLS

```sql
CREATE TABLE user_tickers (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker  TEXT NOT NULL,
  name    TEXT NOT NULL DEFAULT '',
  sector  TEXT NOT NULL DEFAULT 'Custom',
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, ticker)
);
-- RLS: each user sees and manages only their own rows
```

Row-Level Security policy ensures DB-level isolation — even a compromised API route cannot leak another user's tickers.

### Decision: "Add TICKER to my list — visible only to you"
When a user types a valid ticker format (`/^[A-Z0-9&.-]{1,20}$/`) that matches nothing in the dropdown, a special row appears:

```
[+ icon]  Add ADANIGREEN to my list          visible only to you
```

Clicking this:
1. Optimistically updates local state (instant UI response)
2. POSTs to `/api/v1/user-tickers` (upsert)
3. Sets that ticker as the selected company immediately

The `filteredList` (used by CompanySearch and Watchlist) is: `NIFTY200_LIST + userTickers + storageExtras`. Storage extras are stocks in the transcripts bucket that aren't in Nifty 200 and haven't been claimed by the user yet — these migrate to user-scoped on next add.

---

## 2026-05-27 — Earnings Concall Video Library (Videos Tab)

### Problem
The screener and concall analysis tools are text-heavy. Many users want to watch the actual earnings call recording alongside reading the analysis. Previously there was a single YouTube search link in the screener — no curated video library.

### Decision: Sector-Organized Video Grid for All Nifty 200

`/videos` page shows a grid of company cards organized by sector (sorted by sector size descending). Each card shows:
- YouTube thumbnail (free CDN: `https://img.youtube.com/vi/{videoId}/mqdefault.jpg`)
- Video title and channel name
- "Watch" button (direct video link) or "Search" button (YouTube search fallback)
- Analyse button → navigates to `/dashboard?ticker=TICKER`

### Decision: YouTube Data API v3 with Strict Title Matching

Using YouTube search API (`maxResults=10`) to find the most relevant concall video. The original implementation took `items[0]` blindly — this caused Polycab India to cache a Vikram Solar video because both appeared in the same batch.

**`titleMatchesCompany(title, companyName, ticker)` rules:**
1. Ticker appears in title → strong match (return true)
2. Extract meaningful tokens from company name (strip stop words: india, limited, ltd, industries, etc.; keep tokens length > 2)
3. First key token must appear in title
4. For 2+ key tokens, require at least 2 to match
5. Return false on no match → store YouTube search URL as fallback, not a wrong video

Results are cached in `concall_links` table (ticker, quarter) to stay within the 10,000 quota/day free tier.

### Decision: Concurrency Cap on Sector Fetch
When switching sectors, all companies are marked "loading" and fetched 5 at a time via `fetchConcurrent(tasks, 5)`. This prevents rate-limiting the YouTube API while keeping the sector load fast.

### Decision: State Key Pattern `ticker::quarter`
Video data is cached in React state using `videoData["RELIANCE::Q4_2026"]`. Switching quarters doesn't clear previously loaded sectors — all fetched data accumulates in state for the session.

---

## 2026-05-27 — Rebrand: "Quantalyze Concall Analysis" (Not Numbers)

### Decision
Product positioned as **earnings concall analysis** — what management says, not what the numbers show. Key copy changes:

- Page title: "Quantalyze — Earnings Concall Analysis"
- Hero: "Earnings concall analysis in 60 seconds"
- Dashboard header: "Concall Analysis" (was "Earnings Analysis")
- Subheading: "Track what management says — not the numbers. Detect language shifts, evasiveness, and narrative changes quarter-over-quarter."
- Landing page features: Narrative Screener, Earnings Calendar, Concall Video Library (replaced Slack/Gmail integration cards)

Rationale: The product's moat is qualitative — detecting management evasiveness, guidance consistency, narrative drift. Positioning it alongside financial statement tools (screener.in, moneycontrol) would be a mistake. The positioning is more like a "management language" intelligence layer.

---

## 2026-05-26 — Earnings Calendar: Auto-Seed + Full-Year Coverage

### Problem
The calendar was empty for July and showed nothing after the current quarter. The seed button was not visible, and the calendar only seeded 2 quarters of data (missing Q1 FY27 results due in July).

### Decision: Auto-Seed on First Load
On first calendar visit (when DB has 0 rows), the seed runs automatically — full-page loading state with a progress log shows instead of an empty calendar. No manual "Seed" button required. A subtle "Refresh" icon allows re-seeding if needed.

### Decision: 5 Historical + 1 Upcoming Quarter
Seed covers: `[Q4_2025, Q1_2026, Q2_2026, Q3_2026, Q4_2026, Q1_2027]`
- 5 historical quarters to show past result dates
- Q1_2027 (Apr–Jun 2026, results expected Jul–Aug 2026) — populates July/August in the calendar

A `nextQuarter()` helper handles the `Q4 → Q1` year-rollover edge case.

**Note on June gap**: June 1–14 is genuinely empty — Q4 FY2026 results end by May 31, Q1 FY2027 results start July 15. This is intentional, not a bug.

---

## 2026-05-26 — Screener v2: Confidence Multiplier & Narrative Trap Detection

### Problem
The original screener ranked HCLTech as "TOP GREEN (+10.0)" because:
- Q2 FY26 had a placeholder/empty transcript, so the pipeline saw a huge shift when Q3 had real data
- The jump was IR quality improvement, not business acceleration
- "AI-driven growth" narrative was identical across TCS, Infosys, Wipro — no alpha
- No penalty for management evasion, one-time items, or validation failures

This creates a "narrative trap": a signal that looks strong but is noise.

### Decision: Four-Factor Confidence Multiplier

Every signal is now multiplied by a confidence score (0–100%) before ranking:

| Factor | Source field | Logic |
|--------|-------------|-------|
| Earnings Quality | `validation_score` (0–100) | Maps to 0.5–1.0 factor; <55 score or ≥3 flags → EARNINGS QUALITY flag |
| One-Time Items | `flagged_count` | Each flag = −12% confidence, floor 0.5; ≥2 flags → ONE-TIME ITEMS flag |
| Management Evasion | `executive_evasiveness_score` (0–10) | Maps to 1.0–0.5 factor; >6.5 → MANAGEMENT EVASION flag |
| Disclosure Inflation | Regex on `summary` + `earnings_delta` | If previous quarter was a "placeholder" → −60% flat; DISCLOSURE INFLATION flag |

`adjusted_score = raw_score × (earnings_quality × flag_penalty × evasiveness × disclosure_factor)`

**NARRATIVE TRAP** fires when: raw score >6 AND confidence <50%.
This is exactly the HCL scenario. The adjusted score drops from +10.0 to ~+1.5.

### Decision: Peer Consensus Detection (Frontend)

After loading all signals, the frontend runs 6 theme patterns against every positive signal:
- AI/Digital, Infra/CapEx, Deleveraging, Margin Expansion, Inorganic Growth, Defense/PLI

If **4+ companies** share a theme in the same quarter, all are tagged **INDUSTRY CONSENSUS**.
Rationale: consensus = no alpha. If TCS, Infosys, Wipro, HCL all say "AI-driven growth", HCL's +10.0 is sector noise, not a differentiated signal.

### Decision: Dual Strength Bar
The bar renders the raw score (light fill, behind) AND adjusted score (solid fill, in front) simultaneously. The gap between them is immediately visible — a wide gap signals a narrative trap.

### Decision: Sorting by Adjusted Score (Default)
Screener ranks by `|adjusted_score|` by default. Toggle to "Raw" available for analysts who want to see unpenalised signals. Default is adjusted to surface genuinely reliable signals at the top.

### Decision: Quarter Fallback
The screener API always targets `QUARTERS[0]` and `QUARTERS[1]` (globally defined in `lib/nifty50.ts`). If the most recent quarter pair has no data yet, it silently falls back to the previous pair — so the screener is never empty after a quarter rollover.

### What's Not Implemented (and Why)
- **Organic growth vs. inorganic split**: Requires structured revenue/acquisition data not in transcripts
- **Guidance accuracy tracking (Qn vs Qn+1 reconciliation)**: Needs multi-quarter DB query + lagged matching; deferred to Insights tab which already tracks this
- **Pricing power vs. volume attribution**: Requires actual financial numbers extracted from transcripts; LLM extraction of exact figures was unreliable (dropped financials earlier this session)

---

## 2026-05-26 — Earnings Analysis: Global Quarter Pair + Auto-Fetch

### Problem
The dashboard (formerly "Dashboard", now "Earnings Analysis") was selecting the two most recent quarters *per stock*. This meant:
- ADANI was comparing Q4_2024 → Q4_2025 instead of Q3 → Q4 FY26
- Companies with older transcripts got a different time horizon than companies with current ones
- The company search only showed companies that already had transcripts — making it impossible to analyse a Nifty 200 company not yet in storage

### Decision: Globally Fixed Quarter Pair
`qCurr` and `qPrev` are no longer state. They are module-level constants derived from `QUARTERS[0]` and `QUARTERS[1]`. No per-stock override is allowed. All analyses compare the same time horizon.

Rationale: PMS use case requires comparing companies on the *same quarter*, not each company on its most recent available pair. Cross-company comparisons are meaningless otherwise.

### Decision: Auto-Fetch for Nifty 200
When a user selects a Nifty 200 company with no transcripts:
1. Spinner shows "Fetching transcripts for TICKER…"
2. `POST /api/v1/request` is called automatically (same endpoint the Request tab uses)
3. After completion, `available` list is refreshed and the user can click Analyze

`fetchAttempted` ref prevents re-fetching within a session (avoids loop when `available` state updates trigger the effect again).

### Decision: Outside-Coverage Message
If a company is selected that is NOT in `NIFTY200` (i.e. not in our 200-ticker universe), a message is shown: "X is outside our Nifty 200 coverage" with a link to the Request tab. No auto-fetch is attempted.

### Decision: Show All 200 in Dropdown
Previously `filteredList` only showed companies already in storage. Now it shows the full Nifty 200 universe + any extras in storage. This makes the dropdown useful for discovery, not just confirmation.

---

## 2026-05-26 — Quarter Ordering Fix (Q4_2026 Added)

### Problem
Quarter sort was using `localeCompare` which alphabetically sorted `Q4_2025 > Q3_2026` (wrong — Q3_2026 is newer).

### Decision: Year-First Numeric Sort Key
```
qKey(q) = parseInt(year) * 10 + parseInt(quarter_number)
```
Q3_2026 → 20263, Q4_2025 → 20254. Correct ordering restored everywhere.

`Q4_2026` (Jan–Mar 2026) added to `QUARTERS` as the most recent quarter. As of May 2026, Q4 FY2026 results are fully published.

---

## 2026-05-26 — Financials Dropped from Multi-Quarter Insights

### Decision
Removed quarterly financial snapshot extraction (Revenue, PAT, Margin, CapEx) from the Insights pipeline.

**Reason**: LLM extraction of specific financial numbers from earnings call transcripts is unreliable. Companies state numbers in different formats, sometimes reference YoY/QoQ differently, and occasionally cite non-GAAP figures without labelling them. Showing unreliable numbers in a PMS tool is worse than showing none.

**What's there instead**: The segment narrative, recurring themes, guidance tracking, and management credibility score are more reliable since they are qualitative summaries, not exact figures. Financial numbers should come from structured data sources (BSE filings, screener.in API), not transcript parsing.

---

## 2026-05-26 — Sector Intelligence: Section Name & Dimension Fixes

### Problem
The Sector Intelligence seed was producing zero scores for Margin and CapEx dimensions because it referenced old section names (`"Operational Margin"`, `"Capital & Liquidity"`) that no longer match the pipeline output (`"Margins & Profitability"`, `"CapEx & Balance Sheet"`).

### Decision: Dimension Map Aligned to Current Pipeline
Updated `DIMENSION_KEYWORDS` in the seed route to match current `SECTION_NAMES` exactly:
- `"Margin Trajectory"` → `"Margins & Profitability"` section
- `"CapEx & Allocation"` → `"CapEx & Balance Sheet"` section
- Added `"Cost Pressure"` → `"Cost Structure"` section (new section in pipeline)
- Added `"Macro & Cycle Risk"` → `"Macro & Risk"` section (new section)
- Added `"Earnings Quality"` → `__validation__` pseudo-section (derived from `validation_score` + `flagged_count`, not a transcript section)

**Rule going forward**: Any time `SECTION_NAMES` in `lib/pipeline.ts` changes, the sector seed's `DIMENSION_KEYWORDS` map must be updated in the same commit.

---

## Previous Sessions

### Auth & Infrastructure
- OAuth redirect URIs pinned to `NEXT_PUBLIC_APP_URL` to prevent India ISP Supabase routing issues
- Auth proxy route added to bypass ISP-level blocking of Supabase auth endpoints
- `pdf-parse` and `node-html-parser` added to `serverComponentsExternalPackages` to prevent webpack bundling of Node-native packages

### Transcript Fetching
- A-Z fan-out approach for listing storage files replaced with direct `search: ticker` query — the fan-out was returning 0 results due to Supabase storage search behaviour
- Request route (`/api/v1/request`) fetches from both Screener.in and BSE API, deduplicates by filename, and uploads to `transcripts` bucket

### Watchlist
- Shared between Concall Analysis and Multi-Quarter Insights via `localStorage` key `quantalyze_watchlist`
- Default 10 stocks seeded on first use: RELIANCE, HDFC, ICICI, INFOSYS, TCS, KOTAKBANK, AXISBANK, SBI, BHARTI, ITC
- Max 20 tickers enforced in toggle and bulk-add
- TradingView-style ◀ ▶ cycle buttons + `←`/`→` keyboard shortcuts
- CSV upload available on both Concall Analysis and Insights pages
