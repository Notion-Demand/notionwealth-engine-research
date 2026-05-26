# Quantalyze — Product Notes & Design Decisions

Running log of key product decisions, reasoning, and trade-offs made during development.
Newest entries at the top.

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
