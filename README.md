# Quantalyze

**Earnings concall intelligence in 60 seconds.**

Quantalyze is an AI-powered earnings intelligence platform that extracts management credibility, narrative shifts, guidance quality, promoter behavior, and sector signals from earnings call transcripts — across 200+ companies, every quarter.

10x more comprehensive than anything in the market.

**Live at** [quantalyze.demandion.ai](https://quantalyze.demandion.ai) | **Book a demo** [calendly.com/quantalyze/say-hi](https://calendly.com/quantalyze/say-hi)

---

## What It Does

### Concall Analysis Engine
- **Deep Dive Analysis** — 8-14 section single-quarter earnings brief covering segment performance, pricing mechanics, channel dynamics, capex, and growth outlook with management quotes and causation links
- **Delta Analysis** — Quarter-over-quarter narrative shift detection across Revenue, Margins, Costs, CapEx, and Macro/Risk
- **Promoter Pledge Monitor** — SEBI Reg. 31 disclosures scanned, 90-day vs 15-month baseline, cross-referenced with concall sentiment
- **Executive Evasiveness Score** — Quantifies management deflection in Q&A (0-10)
- **Branded PDF Exports** — Professional downloads with Quantalyze branding

### Multi-Quarter Insights (11 Tabs)
Financials | Growth Outlook | Margins | Cost Control | Capex & Capacity | Customers & Market | Macro & News | Segments | Product Updates | Recurring Themes | Guidance Tracker

Each dimension tracked across quarters with exact numbers and management quotes — like an automated earnings pointer sheet.

### Coverage & Discovery
- **Nifty 200** full coverage with automatic transcript fetching
- **500 companies** in the concall video library (Large Cap / Mid Cap / Small Cap)
- **17 sectors** with PM-grade narrative intelligence
- **Earnings Calendar** — upcoming concall dates
- **Screener** — signal strength, evasiveness, divergence filtering
- **Watchlist** — 20 stocks, CSV import, keyboard navigation

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React, Tailwind CSS |
| AI Pipeline | Gemini 2.5 Flash Lite (multi-agent, structured JSON output) |
| Auth & Storage | Supabase (auth, PostgreSQL, object storage) |
| Deployment | Vercel (streaming NDJSON, 300s function limit) |
| PDF Parsing | pdf-parse |
| Exports | jsPDF |

---

## Architecture

```
Earnings Transcript (PDF)
        ↓
   Multi-Agent Pipeline (5 specialist agents in parallel)
   • Revenue & Growth
   • Margins & Profitability
   • Cost Structure
   • CapEx & Balance Sheet
   • Macro & Risk
        ↓
   Temporal Delta Comparison (quarter-over-quarter)
        ↓
   Synthesis Agents (earnings delta + FCF implications + key metrics)
        ↓
   Validation Layer (signal/score consistency + market alignment)
        ↓
   Dashboard (streaming real-time progress via NDJSON)
```

### Single-Quarter Deep Dive
```
Transcript → Single comprehensive Gemini call → 8-14 section brief
```

### Multi-Quarter Insights
```
4-8 transcripts → Per-quarter brief extraction (parallel) → Cross-quarter synthesis
→ Recurring themes, guidance tracker, credibility score
```

---

## Project Structure

```
├── app/
│   ├── dashboard/          # Concall Analysis (Delta + Deep Dive)
│   ├── insights/           # Multi-Quarter Insights (11 tabs)
│   ├── screener/           # Narrative Screener
│   ├── sectors/            # Sector Intelligence
│   ├── calendar/           # Earnings Calendar
│   ├── videos/             # Concall Video Library (500 companies)
│   ├── request/            # Transcript Request
│   └── api/v1/             # API routes
│       ├── analyze/        # Delta analysis (streaming)
│       ├── analyze/solo/   # Deep Dive analysis (streaming)
│       ├── insights/       # Multi-quarter pipeline
│       ├── concall/        # YouTube video lookup
│       ├── divergence/     # Promoter pledge activity
│       ├── screener/       # Signal ranking
│       ├── sectors/        # Sector intelligence
│       └── calendar/       # Earnings calendar
├── lib/
│   ├── pipeline.ts         # Delta analysis pipeline (5 agents)
│   ├── solo-pipeline.ts    # Deep Dive pipeline
│   ├── insights-pipeline.ts # Multi-quarter pipeline
│   ├── divergence-score.ts # Promoter pledge scoring
│   ├── listed-companies.ts # Top 500 by market cap
│   ├── nifty200.ts         # Nifty 200 registry
│   └── nifty50.ts          # Nifty 50 registry
├── components/
│   ├── EarningsReport.tsx  # Delta analysis result display
│   ├── AgentPanel.tsx      # Live agent progress panel
│   └── Nav.tsx             # Navigation
├── supabase/migrations/    # Database schema (001-009)
├── bank/                   # Sample broker reports
├── wealth/                 # SEBI market cap data
└── xl/                     # Earnings pointer sheet template
```

---

## Setup

```bash
# Install
npm install

# Environment variables (.env.local)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_API_KEY=...              # Gemini
YOUTUBE_API_KEY=...             # Optional, for video lookup

# Run migrations
# Apply supabase/migrations/001-009 in order via Supabase SQL editor

# Dev
npm run dev

# Build
npm run build
```

---

## Release

**v2.0.0** — Launch Release ([changelog](https://github.com/Notion-Demand/notionwealth-engine-research/releases/tag/v2.0.0))

---

Built by [Demandion](https://demandion.ai) | Contact: support@demandion.ai
