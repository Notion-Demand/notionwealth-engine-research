# MCP Architecture (v0 — one tool, traced end to end)

**Status: first vertical slice.** This document describes exactly what's
implemented today — one real MCP tool, wired through the existing
application layer, protected by the existing auth pipeline. It does not
describe a roadmap or an aspiration. Where something isn't built, this
document says so explicitly rather than implying it exists.

This is intentional: Quantalyze's own engineering case study
(`discussions/`) exists specifically to distinguish IMPLEMENTED from
NOT-IMPLEMENTED, and this document holds itself to the same standard for
the platform work built on top of it.

---

## What this is

An [MCP](https://modelcontextprotocol.io) server that lets an external
agent (Claude, ChatGPT, an internal script — anything speaking MCP) call
into Quantalyze's domain layer as a typed tool, instead of scraping the UI
or hand-rolling a REST integration.

```
External Agent (Claude / ChatGPT / internal script)
        │  MCP (Streamable HTTP, JSON-RPC)
        ▼
POST /api/mcp  (app/api/mcp/route.ts)
        │
        ▼
middleware.ts  ──── same API-key / entitlement / quota pipeline
        │            the public REST API already uses
        ▼
lib/mcp/server.ts  ──  registers tools, has ZERO business logic
        │
        ▼
lib/mcp/tools/getCompanyAnalysis.ts
        │
        ▼
lib/repositories/analysis.ts (analysisRepo)  ──  the SAME repository
        │                                         app/api/public/v1/data/
        ▼                                         companies/[ticker]/route.ts
Azure Database for PostgreSQL (analysis_results)  already calls
```

The one property this whole design optimizes for: **the MCP layer adapts,
it never duplicates.** `get_company_analysis` and the pre-existing REST
endpoint `GET /api/public/v1/data/companies/{ticker}` call the identical
`analysisRepo` method (`getLatestByTickerWithMeta`, extended from the
pre-existing `getLatestByTicker` — see "What changed in the domain layer"
below) and share the identical response DTO (`toCompanyResponseV1`). Two
transports, one domain capability. That's the whole architectural point of
putting MCP behind the application layer instead of beside it.

---

## What's implemented

| Component | File | What it does |
|---|---|---|
| MCP route handler | `app/api/mcp/route.ts` | Next.js Route Handler, stateless Streamable HTTP transport, one instance per request |
| Server + tool registry | `lib/mcp/server.ts` | Builds an `McpServer`, registers tools, converts tool outcomes into `CallToolResult` |
| The one tool | `lib/mcp/tools/getCompanyAnalysis.ts` | `get_company_analysis(ticker)` — pure, independently-testable `run*` function plus zod input/output schemas |
| Envelope + shared types | `lib/mcp/types.ts` | `McpToolEnvelope<T>` — `{ data, metadata: { source, confidence, timestamp, provenance, warnings } }` |
| Audit logging | `lib/mcp/log.ts` | One structured JSON log line per tool call — reuses `middleware.ts`'s existing console.log convention, doesn't invent a new one |
| Auth (reused, not rebuilt) | `middleware.ts`, `lib/public-api/product-routes.ts` | Matcher extended to `/api/mcp/:path*`; new `mcp:tools` product entry; same Bearer-key → `apiAccessRepo` → entitlement → atomic quota pipeline the public REST API already runs |
| Domain layer extension | `lib/repositories/analysis.ts` | New `getLatestByTickerWithMeta()` — see below |
| Tests | `lib/mcp/**/__tests__/*.test.ts`, `lib/public-api/__tests__/*.test.ts`, `app/api/mcp/__tests__/*.test.ts` | 18 tests: input schema validation, tool logic (found/not-found/warnings/confidence-clamping), auth-header parsing, product-route resolution |

### What changed in the domain layer

`analysisRepo.getLatestByTicker()` (the method the existing REST endpoint
uses) silently discards the row's `created_at` — the REST route
compensates by stamping `generatedAt: new Date().toISOString()`, i.e. the
*response* time, not when the analysis was actually produced. That's a
pre-existing, small inaccuracy this slice chose not to inherit: the new
`getLatestByTickerWithMeta()` method (added to `AnalysisRepository` and
implemented in both `PostgresAnalysisRepository` and the dead
`SupabaseAnalysisRepository`, to keep both compiling) returns the real
`created_at` alongside the `Analysis` entity, and `get_company_analysis`
uses that for its `metadata.provenance` field. The REST endpoint is
untouched — this is a new method, not a breaking change to an existing one.

### The envelope

Every tool result is `{ data, metadata }`. `metadata.confidence` is only
ever populated from a real, already-computed signal — here, Quantalyze's
own local self-consistency check (`Analysis.validationScore`, see
`discussions/05_AI_ARCHITECTURE.md` for exactly what that check does and
doesn't verify). No tool in this codebase should ever put a fabricated
number in `confidence`; if a future tool has no real confidence signal,
that field should be omitted, not invented.

### Auth model

No new auth system. `get_company_analysis` is reachable at `POST /api/mcp`
with the exact same kind of Bearer API key the public REST partner API
uses, provisioned the same way:

```bash
npx tsx scripts/provision-api-key.ts "Some Partner" 1000 mcp:tools
```

`middleware.ts`'s matcher was extended from `/api/public/:path*` to
`["/api/public/:path*", "/api/mcp/:path*"]`, and one new entry was added to
`lib/public-api/product-routes.ts` (`{ pattern: /^\/api\/mcp$/, product:
"mcp:tools" }`). That's the entire auth diff — the actual authentication,
entitlement check, and atomic quota increment logic in `middleware.ts` was
not touched. `app/api/mcp/route.ts` reads the `x-api-key-id` /
`x-api-partner-id` / `x-api-product` headers middleware forwards and fails
closed (401) if they're missing, rather than trusting an unauthenticated
request.

---

## How to trace this end to end

1. `middleware.ts` — see the extended `matcher` and the new
   `x-api-product` header forward.
2. `lib/public-api/product-routes.ts` — the `mcp:tools` entry that makes
   step 1's entitlement check possible.
3. `app/api/mcp/route.ts` — `authInfoFromRequest()` turns the forwarded
   headers into an MCP `AuthInfo`; `POST` builds a fresh transport + server
   per request and hands control to the SDK.
4. `lib/mcp/server.ts` — `buildQuantalyzeMcpServer()` registers
   `get_company_analysis` with its title/description/schemas/annotations,
   and the callback that turns a tool outcome into `CallToolResult` +
   an audit log line.
5. `lib/mcp/tools/getCompanyAnalysis.ts` — `runGetCompanyAnalysis()`, the
   actual capability. Everything above this line is transport and auth;
   everything at and below it is domain logic reused from elsewhere.
6. `lib/repositories/analysis.ts` — `getLatestByTickerWithMeta()`, one raw
   SQL `SELECT` against `analysis_results`.
7. `lib/api-contracts/v1/company.ts` — `toCompanyResponseV1()`, the exact
   same DTO shaping the REST endpoint uses.

Run it locally:

```bash
npm run dev
npx tsx scripts/provision-api-key.ts "Local Test" 1000 mcp:tools
# copy the printed raw key, then:
curl -s http://localhost:3000/api/mcp \
  -H "Authorization: Bearer <raw key>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_company_analysis","arguments":{"ticker":"RELIANCE"}}}'
```

---

## What's explicitly NOT implemented (don't claim this exists)

- **Only one tool.** The category list a platform prompt might sketch
  (`search_companies`, `analyze_sector`, `graph_query`, ...) is not built.
  Adding the next one means: write it in `lib/mcp/tools/` following
  `getCompanyAnalysis.ts`'s shape, register it in `server.ts`, write its
  tests. Nothing about auth, logging, or the route handler should need to
  change for tool #2 — if it does, that's a sign the abstraction leaked.
- **No RAG, no knowledge graph, no CAG.** This slice is the tool/transport
  layer only. There is no retrieval router, no vector store, no entity
  graph behind this yet.
- **No autonomous agents.** This is a request/response tool a caller
  invokes; nothing here observes data or acts on its own.
- **No metrics/traces beyond the one structured log line.** `log.ts`
  writes a JSON line per call to `console.log`, same as the rest of this
  codebase (see `discussions/11_PRODUCTION_ENGINEERING.md`). There's no
  latency histogram, no dashboard, no alerting on tool failure rate.
- **No stateful MCP sessions, no resumability, no SSE notifications.**
  Stateless mode only — `GET`/`DELETE /api/mcp` return 405. Fine for a
  single request/response tool; would need real design work before adding
  a long-running or streaming tool.
- **`mcp:tools` is one undifferentiated product entitlement.** Every key
  entitled to it can call every registered tool. Splitting entitlements
  per tool or tool-group is a real gap once a second or third tool exists
  with a materially different risk profile (e.g. a future tool that
  triggers a paid Gemini call needs its own quota story, not this one).
- **CI does not yet run `npm test`.** `.github/workflows/deploy-azure.yml`
  still only runs `next build` (which includes `tsc`). Wiring `npm test`
  into that pipeline is a real, small, valuable next step — not done in
  this slice because it affects the shared deploy workflow, not just new
  code, and deserves its own review.

---

## Next slices (not started)

Per the vertical-slice plan this was built under: trace this one tool end
to end, understand it, then add roughly five more read-only tools
(`search_companies`, `get_sector`, `get_latest_earnings`, ...) reusing this
exact same pattern before touching retrieval, the knowledge graph, or
agents. Each new tool should be small enough to review in one sitting —
if it isn't, it's probably doing too much.
