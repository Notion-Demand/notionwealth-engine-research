# 09 — Frontend Architecture (Next.js 14 App Router)

Scope: `app/`, `components/`, `lib/api.ts`, `tailwind.config.ts`, `app/globals.css`, `next.config.mjs`.
Method: every claim below is anchored to a file path and, where useful, a line range. Nothing here is inferred from naming conventions alone — where I couldn't find code proving a mechanism exists, it's labeled NOT IMPLEMENTED rather than assumed.

---

## 1. Framework & routing — is Server/Client actually split correctly?

Quantalyze runs **Next.js 14.2.29** App Router (`package.json:16`) with **React 18.3.1**. The `page.tsx` / `<Route>Client.tsx` pairing is used consistently, but **the split is not "Server Component fetches data, Client renders it."** It's narrower: **the Server Component's only job is auth gating (session check + redirect); every page's actual data fetching happens client-side inside the paired Client component's `useEffect`.**

Verified by reading both halves of three routes:

### `app/dashboard/page.tsx` (Server Component, 16 lines total)
```tsx
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <Suspense>
      <DashboardClient />
    </Suspense>
  );
}
```
No props are passed to `<DashboardClient />`. `getCurrentUser()` (`lib/auth.ts:17`) wraps NextAuth's `auth()` and is the *only* server-side work done — its result is used purely to decide `redirect()` vs render, and is not forwarded to the client. `DashboardClient.tsx` then does its own fetching in `useEffect` (`fetchAvailable.current` at line 327, `useUserTickers()` at line 276) once it mounts in the browser. **IMPLEMENTED**, but not the "SSR-hydrated initial data" pattern — it's closer to a client-rendered SPA screen wrapped in an auth-gated server shell.

### `app/kpis/page.tsx` and `app/screener/page.tsx`
Identical shape: `getCurrentUser()` → `redirect("/login")` if absent, then render `<KPIsClient />` / `<ScreenerClient />` with zero props. `KPIsClient.tsx:287-296` and `ScreenerClient.tsx:418-431` each independently `fetch()` their own data in `useEffect` on mount. Confirmed by grep — no route's `page.tsx` passes any fetched data as a prop into its Client component anywhere in the codebase.

### `app/insights/page.tsx`, `app/calendar/page.tsx`, `app/videos/page.tsx`
These three don't even do auth gating server-side — no `getCurrentUser()` call at all, just `<Suspense><XClient /></Suspense>`. Auth enforcement for these pages, if any, happens only at the API-route layer (each API route independently calls `getCurrentUser()` — e.g. `app/api/v1/analyze/route.ts:12`). This means **`/insights` and `/calendar` are publicly reachable as empty shells**; only their data-fetching calls will 401. **PARTIALLY IMPLEMENTED** — auth is enforced at the data layer, not uniformly at the route layer, which is inconsistent with `/dashboard`, `/kpis`, `/screener`, `/sectors`, `/request` (all of which do redirect server-side).

### `app/login/page.tsx`
Notable outlier: it carries `export const dynamic = "force-dynamic"` with an explanatory code comment (lines 4-10) describing a real production incident — a stale Next.js full-route-cache entry (1-year `s-maxage` from a pre-migration test request) was serving `www.quantalyze.me/login` and bypassing `next.config.mjs`'s www→bare-domain redirect, which could reproduce an `AADSTS50011` Entra redirect-URI mismatch. This is a genuine post-incident hardening comment, not a template artifact.

**Verdict**: Server/Client separation is IMPLEMENTED but shallow — Server Components exist almost solely for the `redirect()` side effect of route guarding (only possible from server context in App Router), not for data prefetching, streaming SSR payload, or reducing client JS. There's no `generateMetadata` data-driven pattern either, except `app/kpis/page.tsx:6-10` and `app/calendar/page.tsx:4-6`, which have **static** metadata objects, not `generateMetadata()` functions.

---

## 2. Route inventory

| Route | `page.tsx` type | Auth-gated server-side? | Client component | Purpose |
|---|---|---|---|---|
| `/` | Server (async) | No (redirects logged-in users away) | — (marketing page, no `"use client"` split) | Public landing page, hero, CTA to `/login` and Calendly demo booking |
| `/login` | Server, `force-dynamic` | N/A | `LoginClient.tsx` | Microsoft Entra ID SSO sign-in button |
| `/dashboard` | Server (async) | Yes — `redirect("/login")` | `DashboardClient.tsx` (969 lines) | Core product: Delta Analysis (QoQ) and Solo Deep Dive per ticker |
| `/kpis` | Server (async) | Yes | `KPIsClient.tsx` (537 lines) | KPI Tracker — cross-company quarterly metric changes |
| `/insights` | Server (non-async) | **No** | `InsightsClient.tsx` (926 lines) | Multi-quarter narrative synthesis per ticker |
| `/screener` | Server (async) | Yes | `ScreenerClient.tsx` (674 lines) | Cross-company signal screener with confidence scoring |
| `/sectors` | Server (async) | Yes | `SectorsClient.tsx` (1039 lines) | Sector-level thesis / narrative rollup |
| `/calendar` | Server (non-async) | **No** | `CalendarClient.tsx` (510 lines) | Earnings calendar (month view) |
| `/videos` | Server (non-async) | **No** | `VideosClient.tsx` | Curated video content |
| `/request` | Server (async) | Yes | `RequestClient.tsx` (219 lines) | Transcript request/ingestion form |
| `/developers` | Server (non-async, static) | No | none — pure server-rendered docs page | Public API v1 reference docs, hand-rolled JSON syntax highlighter |
| `/why-quantalyze` | Server, static | No | none | Marketing / positioning page |
| `/privacy`, `/terms` | Server, static | No | none | Legal boilerplate |
| `app/api/og/route.tsx` | Edge Route Handler | N/A | N/A | OG image generation via `next/og` `ImageResponse`, `runtime = "edge"` (line 3) |

`developers/page.tsx`, `privacy/page.tsx`, `terms/page.tsx`, `why-quantalyze/page.tsx` have **no paired Client component at all** — they're pure Server Components with no interactivity, which is the *correct* App Router pattern for static content (IMPLEMENTED correctly, unlike the data-bearing routes above which use Server Components only as auth gates).

---

## 3. State management

**No global state library.** `package.json` dependencies (`/tmp/quantalyze/package.json:16-29`) list only `@supabase/supabase-js`, `@google/generative-ai`, `clsx`, `html2canvas`, `jspdf`, `lucide-react`, `next`, `next-auth`, `node-html-parser`, `pdf-parse`, `pg` — no `redux`, `zustand`, `jotai`, `recoil`, `@tanstack/react-query`, or `swr`. Confirmed further: `grep -rl "createContext\|useContext"` across `app/`, `components/`, `lib/` returns **zero matches** — there isn't even a single React Context provider anywhere in the app.

State is 100% local to each Client component via `useState`/`useEffect`/`useRef`/`useMemo`/`useCallback`, occasionally factored into a same-file custom hook:

- `DashboardClient.tsx:190` `useWatchlist(options)` — manages the ticker watchlist chips, backed by `localStorage` (`WATCHLIST_KEY = "quantalyze_watchlist"`, line 30), capped at `MAX_WATCHLIST = 20` (line 31), seeded with `DEFAULT_WATCHLIST_TICKERS` (lines 32-35) on first load.
- `DashboardClient.tsx:273` `useUserTickers()` — a **separate, server-backed** concept: fetches `/api/v1/user-tickers` on mount and does optimistic add/remove against `POST`/`DELETE /api/v1/user-tickers`, which is backed by `watchlistRepo` → `lib/repositories/watchlist.ts` (`PostgresWatchlistRepository`, wired in `lib/repositories/index.ts:17`) → Postgres table introduced in `supabase/migrations/006_user_tickers.sql`.
- `InsightsClient.tsx:48` `useInsightsWatchlist()` — an independent, third watchlist implementation, local to the Insights page (not shared with Dashboard's `useWatchlist`).

**Important nuance**: there are *two unrelated "watchlist" concepts in the same app* — the star/bookmark ticker chips on `/dashboard` (`useWatchlist`, pure `localStorage`, never touches the server) and "Add \<TICKER\> to my list" from the company search's fallback UI (`addUserTicker`, wired to `useUserTickers`, which *is* server/DB-backed). They are not synchronized with each other. This is a real architectural seam, not a design flaw called out in comments — worth knowing before assuming "watchlist" means one thing.

No shared hooks file (no `lib/hooks.ts` or `hooks/` directory) — each hook is defined and used only in the file it lives in. **IMPLEMENTED** (local state, hooks-as-composition) — **NOT IMPLEMENTED**: any cross-page or app-wide state layer.

---

## 4. API client — `lib/api.ts`

`lib/api.ts` (260 lines) is a genuine shared client, not boilerplate every component reinvents — but it isn't fully DRY internally.

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { ...options, headers: {...} });
  if (!res.ok) { const error = await res.text(); throw new Error(`API ${res.status}: ${error}`); }
  return res.json() as Promise<T>;
}
```
(`lib/api.ts:8-26`) — a normal JSON fetch wrapper used by `runAnalysis()` and `getAnalysisHistory()`.

But the three **streaming** functions — `runAnalysisStream` (lines 55-109), `runInsightsStream` (147-195), `runSoloAnalysisStream` (206-259) — each hand-roll an **identical** `reader.read()` / buffer / `split("\n")` NDJSON parse loop rather than sharing one generic `streamNdjson<T>()` helper. This is real, confirmable code duplication (same ~20-line block copy-pasted three times with only the event-type union changed) — worth flagging as a refactor opportunity in an interview answer, not a defect.

Not every Client component goes through `lib/api.ts`, though: many components bypass it and call `fetch()` directly against `/api/v1/*` routes for simple GET/POST calls that don't need streaming or don't need the `apiFetch` error-formatting — e.g. `Nav.tsx:42` (`fetch('/api/v1/calendar?...')`), `Nav.tsx:198` (`/api/v1/credits`), `DashboardClient.tsx:277` (`/api/v1/user-tickers`), `EarningsReport.tsx:120` (`/api/v1/divergence?ticker=...`). So the pattern is: **`lib/api.ts` owns the streaming/analysis endpoints; everything else is ad hoc `fetch()` inline in the component that needs it.** **PARTIALLY IMPLEMENTED** as "shared API client" — it's shared for the hard part (NDJSON streaming), not enforced as the only way to talk to the backend.

---

## 5. Custom hooks (full inventory)

`grep -rn "^function use[A-Z]"` across `app/`, `components/`, `lib/` returns exactly three hits, all covered above:

- `app/dashboard/DashboardClient.tsx:190` — `useWatchlist`
- `app/dashboard/DashboardClient.tsx:273` — `useUserTickers`
- `app/insights/InsightsClient.tsx:48` — `useInsightsWatchlist`

No `hooks/` directory exists. No hook is exported or reused across files. **IMPLEMENTED** (as file-local composition), **NOT IMPLEMENTED** as a shared hooks library.

---

## 6. Loading / error / done state machines

There is no single reusable "async state" abstraction (no `useSWR`, no reducer, no state machine library like XState). Each Client component encodes its own ad hoc state machine with parallel `useState` calls. Two representative examples, read precisely:

### `DashboardClient.tsx` — Delta Analysis flow (lines 458-556)
Four pieces of state drive the UI: `loading: boolean`, `error: string | null`, `result: Record<string, unknown> | null`, `agentState: AgentPanelState | null`. `handleAnalyze` (line 467):
1. Resets all four (`setError(null); setResult(null); setSoloResult(null); setLoading(true); setAgentState(null)`).
2. Calls `runAnalysisStream(...)`, whose `onEvent` callback progressively mutates `agentState` via `setAgentState((prev) => ...)` (line 481) as NDJSON lines arrive — see §8 below for the byte-level trace.
3. On stream resolution, `setResult(res.payload)` (line 549).
4. On throw, `catch` sets `error` (line 551).
5. `finally` sets `loading = false` and **clears `agentState` back to null** (lines 553-554) — meaning the moment the stream ends, `AgentPanel` disappears (its render guard at line 940 is `{loading && agentState && (...)}`) and `EarningsReport` takes over (guard at line 952 is `{result && !loading && (...)}`). This is a deliberate hand-off, not a bug: progress UI and final-report UI are mutually exclusive by construction.

The same four-state shape repeats for the parallel "Solo Deep Dive" flow (`soloLoading`, `soloPhase`, `soloResult`, shared `error`) at lines 558-584 and lines 791-937 for rendering.

### `RequestClient.tsx` — an explicit typed state machine
```ts
type Status = "idle" | "loading" | "success" | "not_found" | "error";
const [status, setStatus] = useState<Status>("idle");
```
(`app/request/RequestClient.tsx:7,11`) This is the cleanest state machine in the codebase — a real discriminated union with five states, each rendered as a distinct UI branch (lines 96-215: idle/loading share a form; `success`, `not_found`, `error` each get a dedicated colored panel with a `reset()` escape hatch). **IMPLEMENTED**, and notably more disciplined than the boolean-soup pattern used elsewhere.

**Honest assessment**: "loading" is IMPLEMENTED everywhere (spinners, disabled buttons, `Loader2` icons from `lucide-react`). "Error" is IMPLEMENTED as a single flat string surfaced in a red box — there's no error taxonomy, retry-with-backoff, or error boundary component (`grep -r "componentDidCatch\|ErrorBoundary\|error.tsx"` under `app/` finds **no `error.tsx` files anywhere** — Next.js App Router's built-in error-boundary convention is **NOT IMPLEMENTED** at any route level). A thrown render error in `EarningsReport` or `KPIsClient` has no route-level fallback UI; it would surface as Next.js's default error screen.

---

## 7. Streaming consumption — byte-for-byte trace (the most important part)

**Verdict up front: streaming is genuinely, byte-for-byte incremental — not "wait for the whole response then render once."** Confirmed by reading `lib/api.ts` and the server route together.

### Server side — `app/api/v1/analyze/route.ts:87-126`
```ts
const stream = new ReadableStream({
  async start(controller) {
    const send = (data: object) => {
      controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
    };
    ...
    const payload = await runPipeline(qPrevKey, qCurrKey, send);   // send() called repeatedly DURING the pipeline
    const savedId = await analysisRepo.saveAnalysis(...);
    send({ type: "done", payload, id: savedId });
    ...
  },
});
return new Response(stream, {
  headers: {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",   // explicitly disables reverse-proxy buffering
  },
});
```
`send()` is passed directly into `runPipeline()` (`lib/pipeline.ts`) as a `ProgressCallback` (`type ProgressCallback = (event: ProgressEvent) => void`, `lib/pipeline.ts:22`) and is invoked from *inside* the 8-parallel-Gemini-call pipeline as each thematic agent / evasiveness / delta-comparison / stock-fetch step completes — each call to `send()` immediately `controller.enqueue()`s one JSON line into the live HTTP response body. The `X-Accel-Buffering: no` header is a deliberate signal to any reverse proxy (nginx/Azure App Service) not to buffer the chunked response — strong evidence this was built and tuned for true incremental delivery, not just NDJSON-shaped batch output.

### Client side — `lib/api.ts:73-105` (`runAnalysisStream`)
```ts
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

const processLine = (line: string) => {
  if (!line.trim()) return;
  const event = JSON.parse(line) as PipelineProgressEvent;
  onEvent(event);                     // ← fires synchronously, per line, as soon as it's parseable
  if (event.type === "done") result = { id: event.id, payload: event.payload };
  if (event.type === "error") throw new Error(event.detail);
};

while (true) {
  const { done, value } = await reader.read();   // ← resolves as soon as ANY chunk of bytes arrives
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";          // keep the trailing partial line in buffer
  for (const line of lines) processLine(line);
}
if (buffer.trim()) processLine(buffer);
```
This is a textbook correct incremental NDJSON reader: `response.body.getReader()` (the Fetch API streaming reader, not `EventSource` and not a polling loop), a `TextDecoder` fed with `{ stream: true }` (correctly handles multi-byte UTF-8 characters split across chunk boundaries), and a buffer that always holds back the last, possibly-incomplete line until more bytes arrive. Every complete line is dispatched to `onEvent` the instant it's available — not batched, not deferred to stream end.

### The bridge from `onEvent` → UI: `DashboardClient.tsx:480-546`
`onEvent` is the closure passed into `runAnalysisStream` at call time (line 480), and it calls `setAgentState((prev) => {...})` synchronously for every event — `"start"`, `"thematic_done"`, `"evasiveness_done"`, `"delta_done"`, `"stock_done"`. Each `setAgentState` call is a genuine React state update, meaning **React re-renders `AgentPanel` after every single NDJSON line**, not after the stream closes. Concretely: when a `"thematic_done"` event for e.g. `"Margins & Profitability"` / `which: "curr"` arrives (line 508-524), only that section's `currStatus` flips to `"done"` in the state object, and if `deltaStatus` for that section becomes eligible it flips to `"running"` — this is then rendered per-card by `AgentPanel.tsx`'s `StatusIcon` (line 44-55: idle=gray circle, running=spinning blue `Loader2`, done=green check, error=red X) inside a `grid grid-cols-3` of section cards (`AgentPanel.tsx:114-163`).

**`AgentPanel.tsx` itself is a pure presentational component** — it takes `state: AgentPanelState` as a prop and has no `fetch`, no `EventSource`, no stream-reading logic of its own (confirmed: zero `fetch`/`EventSource`/`getReader` references in `components/AgentPanel.tsx`). All stream consumption lives in `DashboardClient.tsx` (via `lib/api.ts`); `AgentPanel` only renders whatever `AgentPanelState` it's handed. This is a clean container/presentational split.

**Mermaid diagram — end-to-end NDJSON flow for a Delta Analysis run:**

```mermaid
sequenceDiagram
    participant U as User (clicks "Delta Analysis")
    participant DC as DashboardClient.tsx<br/>handleAnalyze()
    participant API as lib/api.ts<br/>runAnalysisStream()
    participant RT as app/api/v1/analyze/route.ts<br/>POST handler
    participant PL as lib/pipeline.ts<br/>runPipeline()
    participant AP as AgentPanel.tsx (presentational)

    U->>DC: submit form
    DC->>DC: setLoading(true); setAgentState(null)
    DC->>API: runAnalysisStream(params, onEvent)
    API->>RT: fetch POST /api/v1/analyze (streamed body)
    RT->>PL: runPipeline(qPrevKey, qCurrKey, send)
    activate PL
    PL-->>RT: send({type:"start", sections})
    RT-->>API: chunk: {"type":"start",...}\n
    API->>API: reader.read() resolves, line parsed
    API->>DC: onEvent({type:"start"})
    DC->>DC: setAgentState(fresh running state)
    DC->>AP: re-render with new state prop
    Note over PL: 8 parallel Gemini calls<br/>(4 sections × 2 quarters)
    PL-->>RT: send({type:"thematic_done", section, which})  ×8
    RT-->>API: 8 more NDJSON lines, streamed as each resolves
    API->>DC: onEvent() ×8, each triggers setAgentState
    DC->>AP: re-render after EACH event (incremental)
    PL-->>RT: send({type:"evasiveness_done", score})
    PL-->>RT: send({type:"delta_done", section}) ×4
    PL-->>RT: send({type:"stock_done", stockPriceChange})
    deactivate PL
    RT->>RT: analysisRepo.saveAnalysis(...) → Postgres analysis_results
    RT-->>API: {"type":"done", payload, id}\n
    API->>DC: resolves runAnalysisStream() promise
    DC->>DC: setResult(payload); setLoading(false); setAgentState(null)
    DC->>DC: swaps AgentPanel for EarningsReport
```

**Summary answer to the prompt's key question**: incremental, confirmed at every layer (server `ReadableStream.enqueue` per pipeline step with anti-buffering header → client `reader.read()` loop dispatching per parsed line → React `setState` per event → per-card icon transitions in `AgentPanel`). Not simulated with `setTimeout`, not client-side chunking of an already-complete response.

The identical pattern is reused for `runInsightsStream` (`lib/api.ts:147`, consumed by `InsightsClient.tsx`) and `runSoloAnalysisStream` (`lib/api.ts:206`, consumed by `DashboardClient.tsx`'s `handleSoloAnalyze`, though that flow only has two granular phases — `"extracting"` and `"analyzing"` — mapped to a single `soloPhase` string rather than a per-section panel like `AgentPanel`).

---

## 8. Forms & validation

### `LoginClient.tsx` (58 lines)
No form fields at all — a single button that calls `signIn("microsoft-entra-id", { callbackUrl: "/dashboard" })` (line 25) from `next-auth/react`. "Validation" is limited to mapping a `?error=` query param to a human message (`AccessDenied` → "Access is by invitation only", lines 12-16) and a `loading` boolean disabling the button during the redirect. There is no email/password field to validate because auth is entirely SSO-delegated. **IMPLEMENTED** (as much as an SSO button needs) — **NOT** a traditional validated form.

### `RequestClient.tsx` (219 lines)
Real, if minimal, client-side input sanitization: the ticker `<input>` (line 102-111) has `maxLength={12}`, `required`, and its `onChange` (line 105) actively strips input to uppercase alphanumerics only: `e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")` — so invalid characters never even land in state. Submit is additionally guarded with `disabled={status === "loading" || !ticker.trim()}` (line 116). The submit handler re-derives and re-sanitizes the ticker again defensively (line 20) before using it. This is real defensive coding, not just an HTML5 `required` attribute — **IMPLEMENTED**.

### `DashboardClient.tsx`'s `CompanySearch` (lines 39-186)
Not a traditional form, but has notable input handling: free-typed tickers that don't match the known list are validated against `/^[A-Z0-9&.-]{1,20}$/` (line 72) before being offered as an "Add \<TICKER\> to my list" affordance (lines 168-183) — preventing garbage tickers from being persisted via `useUserTickers`.

---

## 9. Visualization / charts

**Confirmed: no charting library.** `package.json` dependencies (lines 16-29) contain no `recharts`, `chart.js`, `d3`, `victory`, `visx`, `nivo`, or similar. `grep -r` for these package names across `app/` and `components/` imports returns nothing.

All numeric data is rendered as **text, cards, badges, and tables** — never as an SVG/canvas chart:
- `KPIsClient.tsx`'s `KPICard` (lines 124-268): highlighted KPIs as a `grid grid-cols-2 ... lg:grid-cols-5` of stat tiles (value + up/down arrow icon + percentage), and an expandable HTML `<table>` (lines 217-251) for the full metric list.
- `EarningsReport.tsx`'s `MetricsPanel` (lines 436-587): "chart-like" visuals are hand-built `<div>` progress bars — e.g. the evasiveness gauge is literally `<div style={{ width: `${evasiveness * 10}%` }} className="h-1.5 rounded-full bg-emerald-400 ...">` (lines 481-491), a manually-computed percentage-width `<div>`, not an SVG gauge or chart component. Same pattern for validation score, market alignment, and stock-price-change bars.
- Stock price / evasiveness score direction is conveyed with `lucide-react`'s `TrendingUp`/`TrendingDown` icons plus colored text (green/red), never a sparkline or line chart.

**NOT IMPLEMENTED**: any time-series chart, sparkline, bar chart, or visualization library of any kind. Every "chart" in the product is a styled `<div>` percentage bar or a stat tile.

---

## 10. Tables — sorting/filtering: client-side or server-side?

Checked `ScreenerClient.tsx`, `KPIsClient.tsx`, `SectorsClient.tsx`, `CalendarClient.tsx`. **All filtering and sorting is client-side**, over a single full fetch — none of these routes pass sort/filter params to the API.

### `ScreenerClient.tsx` (lines 406-459)
One `useEffect` (`fetch("/api/v1/screener")`, line 419) populates the full `signals` array on mount. Category filter (`selectedCategory`), signal filter (`selectedSignal`), a "traps only" toggle (`showTrapsOnly`), and sort mode (`sortMode: "adjusted" | "raw"`, line 403) are all applied inside a single `useMemo` (lines 433-459) that filters/sorts the in-memory array — `result.filter(...)`, `.sort((a,b) => Math.abs(b.adjusted_score) - Math.abs(a.adjusted_score))` (line 453). The backend (`app/api/v1/screener/route.ts`) returns one fixed, server-side-ranked list (sorted by `is_current_quarter` then `|adjusted_score|`, lines 264-270) and does not accept any query parameters for filtering.

### `KPIsClient.tsx` (lines 340-375)
Identical shape: `fetch("/api/v1/kpis?all=1")` once (line 289), then a `useMemo` filters by `sector` and `searchQuery` and sorts by `sortMode` (`"biggest_gain" | "biggest_drop" | "alphabetical"`) purely client-side (lines 340-375). The one exception: a **single-ticker "Extract"** action (`handleExtract`, line 299) does hit the server fresh (`GET /api/v1/kpis?ticker=X&force=1`), but that's a distinct on-demand extraction flow, not filtering the existing table.

**Verdict**: server-side work here is limited to *building* the initial dataset (screener's two-pass Nifty50/Nifty200 merge, KPI dedup-by-ticker) — all *interactive* sorting/filtering the user does afterward is **client-side only, IMPLEMENTED** via `useMemo`, with **no server round-trip per filter change**. This is a reasonable choice at current data volumes (tens to low hundreds of rows) but would not scale to a paginated, server-driven table.

---

## 11. PDF export — html2canvas + jsPDF, traced exactly

Two independent PDF export code paths exist, both entirely client-side (no server PDF-rendering endpoint):

### A. `EarningsReport.tsx:601-647` — `handleExportPDF` (screenshot-based)
Triggered by the "Quantalyze — Export Delta PDF" button (line 762-769, inside the `data-no-print` actions row). Captures the **rendered DOM** via `html2canvas`:
```ts
const { default: html2canvas } = await import("html2canvas");   // dynamic import — not in the initial bundle
const { jsPDF } = await import("jspdf");
const canvas = await html2canvas(reportRef.current, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
const imgData = canvas.toDataURL("image/png");
```
`reportRef` (line 599, `useRef<HTMLDivElement>`) is attached to the wrapping `<div ref={reportRef}>` at line 690, which encloses everything **except** the actions row itself (marked `data-no-print`, line 761) — so the export deliberately excludes its own buttons from the screenshot. The resulting single tall PNG is then sliced across multiple A4 pages by repeatedly calling `pdf.addImage()` with a growing negative Y offset (`while (yOffset < imgH) { ...; yOffset += pageH; }`, lines 629-637) — i.e. **the whole report is captured as one image and split visually**, not re-laid-out as native PDF text. Header/footer branding text ("Quantalyze by Demandion...") is added natively via `pdf.text()` on each page. Filename: `Quantalyze_${ticker}_${quarter}_Delta.pdf` (line 640).

### B. `DashboardClient.tsx:861-928` — Solo Deep Dive PDF export (native-text based)
A second, structurally different export for the "Deep Dive" flow — **does not use `html2canvas` at all**, only `jsPDF`:
```ts
const { jsPDF } = await import("jspdf");
...
const headlineLines = pdf.splitTextToSize(headline, maxW);
pdf.text(headlineLines, margin, y);
sections.forEach((s) => { ...; pdf.text(s.title, margin, y); s.bullets.forEach((b) => { const lines = pdf.splitTextToSize(`• ${b}`, maxW - 4); pdf.text(lines, margin + 2, y); ... }); });
```
This path manually lays out text with `pdf.splitTextToSize()` and manual pagination via a `checkPage(needed)` helper (line 877) that calls `pdf.addPage()` when content would overflow — a proper native-text PDF, not a screenshot. Filename: `Quantalyze_${company}_${q}_Deep_Dive.pdf` (line 928).

**So the two export buttons in the same app use two genuinely different PDF-generation strategies** (image-capture-and-slice vs. native text layout) — worth naming explicitly, since it's easy to assume "PDF export" is one code path. Both are **100% client-side** — no server route generates PDFs (confirmed: no `pdfkit`, `puppeteer`, or similar in `package.json`, and no `/api/v1/*pdf*` route exists).

---

## 12. Auth UI — is session state gating anything real?

`Nav.tsx:230` calls `signOut({ callbackUrl: "/login" })` from `next-auth/react` on the sign-out button — this is the **only** `next-auth/react` client hook usage found in any component (`grep -rn "useSession\|signIn\|signOut" components/ app/` — `useSession()` is **not used anywhere**; components rely on server-side gating instead, matching §1's finding that gating happens in `page.tsx`, not in the client tree).

Real gating chain, confirmed:
- Server: `getCurrentUser()` (`lib/auth.ts:17-21`) wraps `auth()` from a root `auth.ts` (NextAuth v5 beta config, imported at `lib/auth.ts:1` as `import { auth } from "@/auth"`) and is called in every protected `page.tsx` (`dashboard`, `kpis`, `screener`, `sectors`, `request`) to `redirect("/login")` server-side before any client bundle for that route even renders.
- API layer: every mutating/data API route independently re-checks `getCurrentUser()` — e.g. `app/api/v1/analyze/route.ts:12-14` returns a `401 { detail: "Unauthorized" }` `NextResponse.json` if there's no session, *before* touching the pipeline or the credit system. This means auth isn't just a UI nicety — the streaming analyze endpoint itself is genuinely locked down at the route handler, independent of whether the Client component bothered to check.

**IMPLEMENTED, and functionally load-bearing** (not decorative) — both the page-level redirect and the independent API-level 401 exist, so even a user who bypasses the client (e.g. calls the API directly) is blocked. What's **NOT IMPLEMENTED**: any client-side reactive session state (`useSession`) — the UI has no "logged in as X" display, no session-expiry countdown, no client-side re-auth prompt; a session expiring mid-session would only surface as a failed `fetch()` (401) the next time a Client component calls an API route, handled generically as `error` text, not as a "please sign in again" flow.

---

## 13. Responsive behavior

Real but modest. `grep -roE "\b(sm|md|lg|xl):[a-z-]+"` across `app/` and `components/` finds responsive Tailwind prefixes used in only **11 of ~25 route/component files**, concentrated in content-heavy pages:

| File | responsive-prefixed classes |
|---|---|
| `app/page.tsx` (marketing landing) | 7 |
| `components/EarningsReport.tsx` | 6 |
| `app/sectors/SectorsClient.tsx` | 5 |
| `app/kpis/KPIsClient.tsx` | 3 (e.g. `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` for the KPI stat tiles, line 165) |
| `app/why-quantalyze/page.tsx` | 2 |
| `app/developers/page.tsx`, `videos/VideosClient.tsx`, `terms/page.tsx`, `screener/ScreenerClient.tsx`, `privacy/page.tsx`, `insights/InsightsClient.tsx` | 1 each |

**Zero** responsive prefixes in `DashboardClient.tsx` (the primary, most-used product screen), `AgentPanel.tsx`, `Nav.tsx`, `CalendarClient.tsx`, `RequestClient.tsx`, or `LoginClient.tsx`. `Nav.tsx`'s top nav bar (line 234-257) is a fixed `flex items-center gap-6` row with no mobile collapse/hamburger menu — on a narrow viewport it will simply overflow or wrap uncontrolled. `AgentPanel.tsx`'s section grid is hardcoded `grid-cols-3` (line 114) with no breakpoint variants, and the code comment even says "3 cols so 5 fit cleanly" (line 113) — an explicitly desktop-width layout decision.

**Honest assessment**: responsive design got real, deliberate effort on the public marketing page and a few data-display components (KPI grid, sector cards), but the core authenticated workflow (Dashboard, the live Agent Panel, the top nav) is **effectively desktop-only** — this is a genuine gap, not a subtle one.

---

## 14. Accessibility — honest assessment

**No accessibility effort found.** Exhaustive greps across `app/` and `components/`:
- `grep -rl "aria-"` → **zero files**.
- `grep -rn "alt="` → **zero matches** (no `<img>` tags with alt text checked — worth noting there are also very few raw `<img>` elements at all; icons are `lucide-react` SVG components, which themselves carry no `aria-hidden` or accessible-name props in this codebase).
- `grep -rl 'role="'` → **zero files**.

Concretely, this means: `AgentPanel.tsx`'s live-updating progress state (status icons flipping from idle→running→done) has no `aria-live` region, so a screen-reader user gets no announcement as the Delta Analysis progresses — the entire "live agent progress" UX (the feature this document is asked to trace in detail) is **visual-only**. `CompanySearch`'s custom combobox (`DashboardClient.tsx:39-186`) implements arrow-key/Enter/Escape keyboard handling (lines 105-127) but has none of the ARIA combobox pattern (`role="combobox"`, `aria-expanded`, `aria-activedescendant`, `role="listbox"`/`role="option"`) that would make it usable via assistive tech — it's keyboard-navigable for sighted mouse-alternative users only. Modal-like dropdowns (`Nav.tsx`'s `EarningsBell`, lines 34-190) have no focus trap and no `role="dialog"`.

This is a straightforward, verifiable **NOT IMPLEMENTED** across the whole accessibility surface — consistent with "most side projects skip this," and here it's total, not partial.

---

## 15. UX patterns worth naming

- **Progressive disclosure**: real and IMPLEMENTED in multiple places — `EarningsReport.tsx`'s `Section` (collapsible per-section insights, `open` state defaulting to `true`, lines 264-325) and `MetricCard` (collapsible quote comparison, `expanded` state, lines 162-251); `KPIsClient.tsx`'s `KPICard` "View all N KPIs" expand toggle (lines 200-213); `ScreenerClient.tsx`'s per-row `expanded` state (line 204) revealing extra flags.
- **Skeleton loaders**: **NOT IMPLEMENTED**. Every loading state found is a spinner (`Loader2` from `lucide-react`, `animate-spin`) with text, e.g. `KPIsClient.tsx:507-510` (`"Loading KPI snapshots…"`), never a content-shaped skeleton placeholder.
- **Toast/error messaging**: **NOT IMPLEMENTED** as toasts — there's no toast library (`react-hot-toast`, `sonner`, etc. absent from `package.json`) and no toast component. Errors are rendered as static inline red boxes at the top of the affected section (e.g. `DashboardClient.tsx:787-789`, `KPIsClient.tsx:454-458`) that persist until the next action clears them — not ephemeral, auto-dismissing notifications. One partial exception: `DashboardClient.tsx`'s CSV-upload confirmation message (`csvMsg`, lines 355, 372) **does** self-dismiss via `setTimeout(() => setCsvMsg(null), 4000)` (line 373) — the one genuinely toast-like, auto-expiring message in the codebase.
- **Keyboard navigation for Watchlist — verified real, not just a README claim**: `DashboardClient.tsx:387-401` registers a `document`-level `keydown` listener (mounted once via `useEffect` with `[]` deps) that checks `document.activeElement` isn't an `<input>`/`<textarea>` (line 389-390) before handling `ArrowRight`/`ArrowLeft` to call `cycleNext`/`cyclePrev` (defined at lines 249-261 inside `useWatchlist`) and switch the active ticker via `handleTickerChange`. A `cycleRef` (line 380) is used specifically to give the stable-identity `keydown` listener access to always-current `cycleNext`/`cyclePrev`/`ticker`/`handleTickerChange` closures without needing to re-register the listener on every state change — a correct, deliberate pattern for avoiding stale closures in a `useEffect([])`. The watchlist chip row also renders explicit ◀ ▶ buttons wired to the same `cyclePrev`/`cycleNext` functions (lines 624-644) with `title="Previous stock (←)"` tooltips documenting the keyboard shortcut inline. **CONFIRMED IMPLEMENTED**, precisely as claimed.
- **Optimistic UI updates**: IMPLEMENTED narrowly — `useUserTickers().add()` (`DashboardClient.tsx:283-294`) updates local state immediately before the `POST /api/v1/user-tickers` call resolves ("Optimistic add" comment at line 284), with no rollback logic if the request fails (the `.catch(() => {})` at line 293 silently swallows errors — a stale/optimistic entry can persist in UI even if the server write failed). Same pattern for `.remove()` (lines 296-299).

---

## 16. Feature trace 1 — KPI card/table (`KPIsClient.tsx`)

```
KPICard (KPIsClient.tsx:124-268)
  ← props: snapshot: KPISnapshot, onDeepDive: () => void
  ← state: KPIsClient's `snapshots: KPISnapshot[]` (line 274), filtered/sorted via useMemo (lines 340-375)
  ← populated by: useEffect (line 287) → fetch("/api/v1/kpis?all=1")
    → GET /api/v1/kpis (app/api/v1/kpis/route.ts:14-105), `all` branch (lines 75-99)
      → kpiRepo.listAll(sectorFilter) (lib/repositories/kpis.ts:88-105)
        → SupabaseKpiRepository.listAll(): supabaseAdmin().from("kpi_snapshots").select("*").order("created_at", desc)
          → Postgres/Supabase table `kpi_snapshots` (created in supabase/migrations/002_kpi_snapshots.sql)
        → in-memory de-dup: first row per company_ticker wins (most recent, lines 94-99 of kpis.ts)
      → route shapes response: { snapshots: KPISnapshot[], count } — company name/sector backfilled from the static NIFTY50 registry (kpis/route.ts:88-89) when not stored
  ← for a fresh single-ticker extraction (the "Extract" button, KPIsClient.tsx:299-323):
    → GET /api/v1/kpis?ticker=X&force=1 (kpis/route.ts:22-72, cache-bypass branch since force=1)
      → extractKPIs(ticker) (lib/kpi-extractor.ts:410+)
        → resolves a screener.in slug (SCREENER_SLUGS map or getScreenerSlug() search fallback, kpi-extractor.ts:418)
        → scrapes screener.in's quarterly-results table via node-html-parser
        → extractStandardKPIs() (kpi-extractor.ts:281-349): converts ISO quarter-end dates to Indian-FY quarter labels (toFYQuarter, lines 285-295), computes current vs previous column per METRIC_MAP row, derives change via computeChange() → {change_pct, change_abs, change_bps}
        → derived calc: top-5-by-|magnitude| KPIs flagged is_highlight=true (lines 336-346) — this is exactly what drives which stat tiles render as the "highlighted" grid vs the collapsed table
        → optionally extractSectorKPIs() calls Gemini (gemini-2.5-flash-lite, structured JSON schema) for sector-specific KPIs not in the standard screener.in table (kpi-extractor.ts:353-406)
      → kpiRepo.upsertSnapshot() persists the fresh result back to kpi_snapshots (upsert on (company_ticker, quarter), kpis/route.ts:53-64)
      → response: KPISnapshot JSON
  → back to KPICard: renders formatValue()/formatChange()/isPositive() (KPIsClient.tsx:89-113) purely from the KPIEntry[] shape — highlight tiles (lines 165-195) vs expandable full table (lines 216-253)
```

---

## 17. Feature trace 2 — Live agent progress panel during Delta Analysis (already traced byte-for-byte in §7; condensed chain form)

```
AgentPanel (components/AgentPanel.tsx:84-215)
  ← props: state: AgentPanelState (sections/prevStatus/currStatus/deltaStatus/evasivenessStatus/stockStatus/phase)
  ← owned entirely by DashboardClient's agentState useState (DashboardClient.tsx:462)
  ← mutated inside handleAnalyze's onEvent callback (lines 480-546), one setAgentState per NDJSON line
  ← fed by: runAnalysisStream() (lib/api.ts:55-109) — fetch POST + reader.getReader() NDJSON parse loop
    → POST /api/v1/analyze (app/api/v1/analyze/route.ts:10-127)
      → auth: getCurrentUser() → 401 if absent (lines 12-14)
      → cache check: analysisRepo.getCachedAnalysis(ticker, q_prev, q_curr) (line 53) — if hit, single "done" line streamed instantly, no pipeline run
      → credit check on cache miss only: checkAndDeduct(userId, "delta") (lib/credits.ts, line 76) — 429 if quota exhausted
      → runPipeline(qPrevKey, qCurrKey, send) (lib/pipeline.ts) — the actual multi-agent work:
        → 4 thematic sections × 2 quarters = 8 parallel Gemini calls (each completion fires send({type:"thematic_done",...}))
        → 1 evasiveness-scoring Gemini call (send({type:"evasiveness_done", score}))
        → 4 QoQ delta-comparison Gemini calls, one per section (send({type:"delta_done", section}) ×4)
        → 1 market-data / stock-price-change fetch (send({type:"stock_done", stockPriceChange}))
      → on pipeline resolve: analysisRepo.saveAnalysis(userId, ticker, q_prev, q_curr, payload) (analysis.ts:161+)
        → Postgres/Supabase table `analysis_results` (columns: user_id, company_ticker, q_prev, q_curr, payload; upserts by deleting the (ticker,q_prev,q_curr) row first, analysis.ts:169/314)
      → send({type:"done", payload, id: savedId}) — final NDJSON line
  → runAnalysisStream() resolves with {id, payload} → DashboardClient.setResult(payload) (line 549)
  → AgentPanel unmounts (loading=false), EarningsReport(payload=result) mounts (DashboardClient.tsx:963) — see §11 for its render tree
```

---

## 18. Feature trace 3 — Screener signal table (`ScreenerClient.tsx`)

```
ScreenerClient's signal table rows (ScreenerClient.tsx, filtered useMemo lines 433-459, rendered from line 646)
  ← props/state: signals: ScreenerSignal[] (line 406), filtered client-side by selectedCategory/selectedSignal/showTrapsOnly/sortMode
  ← populated by: single useEffect (line 418) → fetch("/api/v1/screener")
    → GET /api/v1/screener (app/api/v1/screener/route.ts:207-284)
      → Pass 1 (Nifty 50): analysisRepo.listAllByTickers(nifty50Tickers) (line 215) → best (highest q_curr) row per ticker kept (lines 222-229)
      → Pass 2 (Nifty 200 ex-50): analysisRepo.listByTickersAndQuarterPair(nifty200OnlyTickers, Q_PREV, Q_CURR) (line 232) — current-quarter-pair only
      → both passes read from the same `analysis_results` table used by the Delta Analysis save path in trace #2 above — i.e. the screener is entirely derived from cached Delta Analysis runs, it never runs its own pipeline
      → buildSignal(ticker, record, isNifty50) (lines 133-190) per row:
        → picks the single highest-|signal_score| non-Noise metric across all sections as the row's headline subtopic (lines 142-154)
        → detectDisclosureInflation(summary, earningsDelta) (lines 65-68): regex heuristic over the stored summary/earnings_delta text looking for phrases like "no prior data"/"lack of actionable" that would mean the QoQ delta is an artifact of poor prior-quarter disclosure, not real business change
        → computeConfidence(validationScore, flaggedCount, evasiveness, disclosureInflation, rawScore) (lines 76-118): multiplies four independent 0–1 factors (earnings-quality, one-time-item penalty, evasiveness penalty, disclosure-inflation penalty) into one multiplier, derives confidence_pct and a flags[] array (DISCLOSURE INFLATION / EARNINGS QUALITY / ONE-TIME ITEMS / MANAGEMENT EVASION / NARRATIVE TRAP)
        → adjusted_score = round(signal_score × multiplier, 2) (line 185) — this, not the raw score, is what "Sort: Adjusted" (the default) ranks by
      → merges both passes, sorts current-quarter rows first then by |adjusted_score| desc (lines 264-270)
      → response: { signals: ScreenerSignal[], quarter, quarter_previous, companies_analyzed, current_quarter_count }
  → back to ScreenerClient: client-side useMemo re-filters/re-sorts (never re-fetches) whenever selectedCategory/selectedSignal/showTrapsOnly/sortMode change (lines 433-459), rendered as an HTML table with per-row expand for extra flags (ScreenerClient.tsx line 204 `expanded` state)
```

Note the derived-calculation chain here (`detectDisclosureInflation` → `computeConfidence` → `adjusted_score` → sort order) is the most analytically dense piece of frontend-adjacent business logic in the app, and it lives entirely in the Route Handler (`app/api/v1/screener/route.ts`), not in a `lib/services/` module — worth flagging if the interview probes "where does business logic live," since it's inconsistent with, e.g., `lib/services/sectorThesisService.ts` existing as a proper service-layer file for the Sectors feature.

---

## 19. Summary table — implementation status by claim

| Claim | Status | Evidence |
|---|---|---|
| Server Component fetches data, Client renders it | PARTIALLY IMPLEMENTED | Server side only does auth redirect (`dashboard/page.tsx`); all data fetching is client `useEffect` |
| NDJSON streaming is truly incremental | IMPLEMENTED | `lib/api.ts:73-105` reader loop + `X-Accel-Buffering: no` header in `analyze/route.ts:70` |
| Global state library (Redux/Zustand/Context) | NOT IMPLEMENTED | Zero `createContext`/`useContext`, no state lib in `package.json` |
| Shared API client for all endpoints | PARTIALLY IMPLEMENTED | `lib/api.ts` owns streaming calls; many components `fetch()` directly |
| Custom hooks | IMPLEMENTED (narrow) | 3 hooks, all file-local, none shared |
| Loading/error/done state machine | IMPLEMENTED (ad hoc) | Cleanest form: `RequestClient.tsx`'s `Status` union; elsewhere parallel booleans |
| Route-level error boundaries (`error.tsx`) | NOT IMPLEMENTED | No `error.tsx` file anywhere under `app/` |
| Charting library / visualizations | NOT IMPLEMENTED | No chart lib in `package.json`; all numeric UI is text/cards/percentage-width divs |
| Client-side table sort/filter | IMPLEMENTED | `ScreenerClient.tsx`/`KPIsClient.tsx` `useMemo` over one full fetch |
| Server-side table sort/filter | NOT IMPLEMENTED | Neither `/api/v1/screener` nor `/api/v1/kpis` accepts sort/filter query params |
| PDF export, client-side | IMPLEMENTED (two distinct paths) | `EarningsReport.tsx` (html2canvas screenshot) vs `DashboardClient.tsx` solo export (native jsPDF text) |
| Auth gating UI is load-bearing, not decorative | IMPLEMENTED | Server `redirect()` + independent API-route 401 checks |
| `useSession()` reactive client auth state | NOT IMPLEMENTED | Only `signOut()` used client-side; no `useSession` anywhere |
| Responsive design | PARTIALLY IMPLEMENTED | Real on marketing/KPI pages; absent on Dashboard/Nav/AgentPanel |
| Accessibility (aria/alt/role) | NOT IMPLEMENTED | Zero `aria-`, zero `alt=`, zero `role=` across the whole `app/`+`components/` tree |
| Progressive disclosure | IMPLEMENTED | Collapsible sections/cards in `EarningsReport.tsx`, `KPIsClient.tsx` |
| Skeleton loaders | NOT IMPLEMENTED | Every loading state is a spinner + text, never a content skeleton |
| Toast notifications | NOT IMPLEMENTED (one near-exception) | No toast lib; one self-dismissing CSV-upload message in `DashboardClient.tsx:373` |
| Keyboard navigation for Watchlist | IMPLEMENTED (verified, matches README) | `DashboardClient.tsx:387-401`, arrow-key cycling + visible ◀▶ buttons |
| Optimistic UI updates | IMPLEMENTED (narrow, no rollback) | `useUserTickers().add()/.remove()` in `DashboardClient.tsx:283-299` |
