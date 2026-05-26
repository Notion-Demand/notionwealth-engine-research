# Quantalyze — Product Notes & Design Decisions

Running log of key product decisions, reasoning, and trade-offs made during development.
Newest entries at the top.

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
- Shared between Earnings Analysis and Multi-Quarter Insights via `localStorage` key `quantalyze_watchlist`
- Insights supports CSV bulk-import: paste comma/whitespace-separated tickers, filters to 2–12 char tokens starting with a letter
