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

### Developer API
A metered, API-key-authenticated public API surface (`app/api/public/v1/**`) exposes company and sector data to partners, gated per-key by product entitlement and a daily request quota (`api_keys`, `api_key_products`, `api_usage` tables). See `/developers` on the live site.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React, Tailwind CSS |
| AI Pipeline | Gemini 2.5 Flash Lite via `@google/generative-ai` (parallel structured-output calls, not an agent framework — see [Architecture](#architecture)) |
| Auth | NextAuth (Auth.js v5) + Microsoft Entra External ID |
| Database | Azure Database for PostgreSQL (Flexible Server, private VNet), accessed via `pg` |
| Object Storage | Azure Blob Storage (`transcripts` container) |
| Deployment | Azure Container Apps (Docker, GitHub Actions CI/CD via OIDC) |
| Streaming | NDJSON over `ReadableStream` | Real-time pipeline progress |
| PDF Parsing | pdf-parse |
| PDF Export | jsPDF (+ html2canvas for the Delta report) |

> **Note on this table**: earlier versions of this README described Supabase (Auth/Postgres/Storage) and Vercel. Quantalyze has since migrated fully to the Azure-native stack above — see `docs/superpowers/specs/2026-07-*-azure-*-migration-design.md` for the migration history, and `discussions/07_DATA_ARCHITECTURE.md` / `discussions/14_DEVOPS_CLOUD.md` for a verified, code-cited account of what's actually live today. The repository still contains unused `Supabase*Repository` classes left over from that migration (`lib/repositories/*.ts`) — dead code, not a second live path.

---

## Architecture

```
Earnings Transcript (PDF)
        ↓
   5 Parallel Structured-Output Gemini Calls (per quarter)
   • Revenue & Growth
   • Margins & Profitability
   • Cost Structure
   • CapEx & Balance Sheet
   • Macro & Risk
        ↓
   Temporal Delta Comparison (quarter-over-quarter)
        ↓
   Synthesis Calls (earnings delta + FCF implications + key metrics)
        ↓
   Local Validation (signal/score self-consistency + market alignment — no LLM call)
        ↓
   Dashboard (streaming real-time progress via NDJSON)
```

These are five independently-prompted, schema-constrained Gemini calls run with `Promise.all`, not autonomous agents — there's no tool-calling or dynamic branching. This is a deliberate design choice (parallel LLM-function composition), not a simplification of a "real" agent system; see `discussions/06_AGENT_ARCHITECTURE.md` for the full argument and evidence.

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
│   ├── developers/         # Public API documentation page
│   └── api/
│       ├── v1/              # Internal API routes (frontend-facing)
│       │   ├── analyze/        # Delta analysis (streaming)
│       │   ├── analyze/solo/   # Deep Dive analysis (streaming)
│       │   ├── insights/       # Multi-quarter pipeline
│       │   ├── concall/        # YouTube video lookup
│       │   ├── divergence/     # Promoter pledge activity
│       │   ├── screener/       # Signal ranking
│       │   ├── sectors/        # Sector intelligence
│       │   └── calendar/       # Earnings calendar
│       └── public/v1/       # External, API-key-authenticated partner API
├── lib/
│   ├── pipeline.ts          # Delta analysis pipeline (5 parallel LLM calls)
│   ├── solo-pipeline.ts     # Deep Dive pipeline
│   ├── insights-pipeline.ts # Multi-quarter pipeline
│   ├── divergence-score.ts  # Promoter pledge scoring
│   ├── credits.ts           # Per-user monthly credit metering
│   ├── public-api/          # Partner API routing + entitlement checks
│   ├── repositories/        # Data access layer (Postgres + Azure Blob)
│   ├── listed-companies.ts  # Top 500 by market cap
│   ├── nifty200.ts          # Nifty 200 registry
│   └── nifty50.ts           # Nifty 50 registry
├── components/
│   ├── EarningsReport.tsx   # Delta analysis result display
│   ├── AgentPanel.tsx       # Live pipeline progress panel (presentational)
│   └── Nav.tsx              # Navigation
├── auth.ts                  # NextAuth + Microsoft Entra External ID config
├── supabase/migrations/     # Database schema history (001-011; applied to Azure Postgres, not Supabase — name is historical)
├── discussions/             # Full engineering case study — architecture, AI internals,
│                             #   JD mapping, interview prep, known gaps (26 files, start with
│                             #   discussions/QUANTALYZE_ENGINEERING_MASTER_MAP.md)
├── finance-agent/           # Archived prototype ("NotionWealth Intelligence") — the original
│                             #   Python multi-agent/RAG platform this product replaced in Feb 2026.
│                             #   Not part of the live app.
├── disclosure-analysis-pipeline/  # Archived, part of the same earlier prototype.
├── bank/                    # Stray sample broker report (not application code)
├── wealth/                  # Stray SEBI market cap reference file (not application code)
└── xl/                      # Stray earnings pointer sheet template (not application code)
```

---

## Setup

```bash
# Install
npm install

# Environment variables (.env.local) — see .env.local.example for the full list
POSTGRES_CONNECTION_STRING=...        # Azure Database for PostgreSQL
AZURE_STORAGE_CONNECTION_STRING=...   # Azure Blob Storage
AZURE_STORAGE_CONTAINER=transcripts   # optional, defaults to "transcripts"
AUTH_MICROSOFT_ENTRA_ID_ID=...        # NextAuth Microsoft Entra External ID app
AUTH_MICROSOFT_ENTRA_ID_SECRET=...
AUTH_MICROSOFT_ENTRA_ID_ISSUER=...
GOOGLE_API_KEY=...                    # Gemini (Gemini Developer API, not Vertex AI)
YOUTUBE_API_KEY=...                   # Optional, for video lookup

# Run migrations
# Apply supabase/migrations/001-011 in order against your Azure Postgres instance
# (scripts/migrate-schema-to-azure.ts strips the RLS statements in 001/006/010 at
# apply time — Azure Postgres has no auth.uid(); authorization is enforced in
# application code instead. See discussions/07_DATA_ARCHITECTURE.md.)

# Dev
npm run dev

# Build
npm run build
```

There is no automated test suite for this app today (`npm run build`'s TypeScript compilation is the only CI gate — see `.github/workflows/deploy-azure.yml`). See `discussions/13_TESTING.md` for the honest state of test coverage.

---

## Deeper engineering documentation

The `discussions/` folder is a from-scratch, code-cited engineering case study of this repository — repository map, product/system architecture, every runtime flow traced file-by-file, the full AI/agent mechanics, data architecture, production-readiness assessment, known technical debt, and an architecture decision log. Start at `discussions/QUANTALYZE_ENGINEERING_MASTER_MAP.md`.

---

## Release

**v2.0.0** — Launch Release ([changelog](https://github.com/Notion-Demand/notionwealth-engine-research/releases/tag/v2.0.0))

---

Built by [Demandion](https://demandion.ai) | Contact: support@demandion.ai
