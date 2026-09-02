# Technical Debt and Gaps

This is an adversarial pass over the live codebase — every finding below is backed by
a specific file, and where possible a specific line/symbol, that was actually read
during this analysis. Findings are ordered roughly by priority (P0 = fix before it
causes an incident or a real security/financial problem; P3 = cosmetic/low-risk).
Nothing here is generic filler ("could add more tests") without a concrete instance
attached to it.

---

### 1. PROBLEM: The top-level documentation describes an infrastructure that no longer exists — README.md, TECHNICAL_ARCHITECTURE.md, and .env.local.example all describe a Supabase-only stack, but the live code is fully migrated to Azure Postgres, Azure Blob Storage, and Microsoft Entra ID.

**LOCATION:** `README.md` (Tech Stack table: "Auth & Storage | Supabase (auth,
PostgreSQL, object storage)"; Setup section env vars: `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`); `TECHNICAL_ARCHITECTURE.md` §1 ("Auth | Supabase Auth |
JWT Bearer tokens, service-role admin"; "Database | Supabase PostgreSQL | 10 tables");
`.env.local.example` (entire `── Supabase ──` block, no `POSTGRES_CONNECTION_STRING`,
no `AUTH_MICROSOFT_ENTRA_ID_*`, no `GOOGLE_API_KEY` for Gemini) — versus
`lib/repositories/index.ts` (every export is `PostgresXRepository`/
`AzureBlobStorageRepository`), `auth.ts` (`MicrosoftEntraID` provider, no Supabase
import), `lib/postgres/client.ts` (the actual live DB connection), and even the
literal live `.env.local` file (names-only, per this task's constraints), which
*also* lacks `POSTGRES_CONNECTION_STRING`/`AUTH_MICROSOFT_ENTRA_ID_*`/`GOOGLE_API_KEY`
— meaning the local dev env-var reference the team actually has on disk cannot run
the code as it currently exists, either.

**WHY IT MATTERS:** This is the top-level, first-read documentation for the whole
repository, and it is describing a system that stopped being true after the July
2026 Azure migrations (dated `docs/superpowers/` plans/specs confirm Hosting
completed 2026-07-10, Data+Storage cutover completed with an exit criteria of
2026-07-20). A new engineer, an interviewer, or an auditor reading `README.md` first
— exactly as this task's own instructions did — will form a wrong mental model of
the system before ever opening a source file.

**RISK:** Onboarding cost (new engineers configure the wrong env vars, per
`.env.local.example`, and the app fails to start with confusing errors about a
missing `POSTGRES_CONNECTION_STRING` nowhere mentioned in the docs). Incident-response
risk (an on-call engineer reading `TECHNICAL_ARCHITECTURE.md`'s "Auth: Supabase Auth"
during an auth outage would look in entirely the wrong place — Supabase's status
page instead of Entra's, or `lib/supabase/admin.ts` instead of `auth.ts`). Security
review risk (an external security auditor reading these docs would sign off on a
description of the system that isn't the one actually deployed).

**RECOMMENDED CHANGE:** Regenerate `README.md`'s Tech Stack table and
`TECHNICAL_ARCHITECTURE.md` in full from the current code (this is a mechanical,
low-risk task given how well-documented the actual migrations are in
`docs/superpowers/`) and update `.env.local.example` to list every env var
`lib/postgres/client.ts`, `auth.ts`, and `lib/repositories/storage.ts` actually read.
Add a lightweight doc-freshness process (e.g. a checklist item on every
`docs/superpowers/plans/*` completion: "update README.md/TECHNICAL_ARCHITECTURE.md
if this changes what they claim") so this doesn't recur on the next migration.

**PRIORITY: P0** — this isn't cosmetic; it actively misdirects anyone using these
documents as ground truth, including for security-sensitive decisions.

---

### 2. PROBLEM: The GitHub Actions deploy workflow and Dockerfile show the app running on Azure Container Apps, but the only hosting design/plan documents in the repo describe Azure App Service — and explicitly scope containerization as "not needed now."

**LOCATION:** `.github/workflows/deploy-azure.yml` (name: "Deploy to Azure Container
Apps"; builds via `docker build`, pushes to `quantalyzeacr.azurecr.io`, deploys via
`az containerapp update --name quantalyze-app-ca`) vs.
`docs/superpowers/specs/2026-07-10-azure-hosting-migration-design.md` ("Out of scope
... Containerization/Docker — App Service's Linux/Node runtime deploys from a built
artifact directly; no Dockerfile is needed for this hosting choice" and, in Future
extensions, naming Container Apps as a *possible later step*, "Not needed now") and
`docs/superpowers/plans/2026-07-10-azure-hosting-migration.md`'s detailed Execution
Record, which documents real App-Service-specific production incidents (the `npm
start` 503 fix, the SSL-certificate DNS-ordering issue) for a deployment model the
app no longer uses.

**WHY IT MATTERS:** This is the same documentation-drift failure mode as finding #1,
specific to the deploy pipeline — the single most operationally sensitive piece of
documentation (how does this app actually get deployed, and what breaks when it
doesn't) is stale. There is no `docs/superpowers/plans/*container-apps*` or
`*/specs/*container-apps*` document anywhere in the repository explaining when or
why this second migration happened.

**RISK:** An engineer debugging a failed deploy would read the App Service plan's
Execution Record, try to reproduce/rollback using App Service-specific `az webapp`
commands, and find nothing — the actual resource is a Container App, not a Web App.
Rollback procedures, health-check configuration, and the documented DNS/safety-window
process from the App Service plan may not even apply to the current Container Apps
setup (Container Apps has different revision/traffic-splitting rollback mechanics).

**RECOMMENDED CHANGE:** Write the missing `docs/superpowers/plans/`/`specs/` pair for
the App Service → Container Apps migration (even retroactively, describing what
actually happened and why), or at minimum add a prominent superseding note at the
top of the existing App Service documents pointing to the current setup.

**PRIORITY: P0**

---

### 3. PROBLEM: `checkAndDeduct()` in `lib/credits.ts` has an unacknowledged read-then-write race condition that can under-charge (leak) credits under concurrent requests — and the file's own docstring states the wrong default quota.

**LOCATION:** `lib/credits.ts`, `checkAndDeduct()`: `const status = await
getCreditStatus(userId); ... await creditsRepo.setUsed(userId, status.month,
status.used + cost);` — two separate, non-atomic operations. Separately, the file's
header comment reads `Default monthly quota = 600 ($6)` while the actual constant
two lines below is `const DEFAULT_QUOTA = 2_500;` ($25) — a 4x discrepancy between
documented and actual behavior.

**WHY IT MATTERS:** Two concurrent requests from the same authenticated user (e.g.
two browser tabs, or a double-click that fires the analyze request twice before the
UI disables the button) can both read the same `status.used`, both compute
`allowed: true`, and both write `status.used + cost` from the same stale base —
silently under-charging the user for one of the two actions. This is a real revenue
leak, not a cosmetic bug, and — unlike the structurally identical race in
`middleware.ts` (see finding #4) — it is not documented anywhere as a known,
accepted risk; nothing suggests the team is aware of it.

**RISK:** Slow, hard-to-detect revenue leakage that scales with concurrent usage
(worse as the product grows, not better) and would show up only as a mismatch
between metered Gemini API spend and billed-credit totals during a financial
reconciliation — exactly the kind of bug that's invisible in normal QA because
nothing errors or looks wrong to the user.

**RECOMMENDED CHANGE:** Replace the read-then-write with one atomic SQL statement:
`UPDATE user_credits SET used = used + $1 WHERE user_id = $2 AND month = $3
RETURNING used` (checking the *returned* value against quota, or using a `CHECK`
constraint / conditional `WHERE used + $1 <= quota` clause to make the whole
check-and-deduct atomic in one round trip). Fix the docstring's `$6` → `$25`
mismatch in the same change.

**PRIORITY: P0** (financial correctness bug, silent, currently unmitigated)

---

### 4. PROBLEM: The public API's daily rate limiter (`middleware.ts`) has the same class of read-then-write race as finding #3 — acknowledged in a code comment, but not fixed, and in the opposite direction (over-admits requests rather than under-charging).

**LOCATION:** `middleware.ts`: `const usedToday = await
apiAccessRepo.getUsageToday(...); if (usedToday >= keyInfo.dailyQuota) { ... }`
followed by a separate `await apiAccessRepo.incrementUsage(...)` — the code's own
comment: "Best-effort rate limit: getUsageToday + incrementUsage is a read-then-write,
not an atomic increment, so concurrent requests from the same key within the same
second can both read the same count and both pass."

**WHY IT MATTERS:** This is explicitly, consciously accepted debt with a stated
trigger for revisiting it ("revisit... if a partner's volume makes the race actually
matter") — which is the right way to defer a fix, but it means the fix has an
implicit dependency on someone actually monitoring partner volume closely enough to
notice when the trigger condition is met, and nothing in the codebase currently does
that monitoring.

**RISK:** A partner integration with bursty/concurrent request patterns (e.g. a
batch job firing 10 requests in parallel near their daily quota boundary) could
exceed their contracted daily quota by a meaningful margin with no automatic
alerting — a partner-relationship/billing-dispute risk more than a technical one,
but a real one for a metered B2B product.

**RECOMMENDED CHANGE:** Same fix shape as finding #3 — a single atomic SQL increment
with a conditional `WHERE` clause, or a Postgres advisory lock around the
check-and-increment. Given both this and finding #3 need the identical fix pattern,
implement it once as a small shared helper (`incrementIfUnderLimit(table, key,
limit)`) rather than twice independently.

**PRIORITY: P1** (already consciously deferred with a stated re-evaluation trigger,
but that trigger has no monitoring behind it)

---

### 5. PROBLEM: No prompt-injection mitigation anywhere in the transcript-analysis pipelines — raw, untrusted transcript text is interpolated directly into every Gemini system+user prompt with no sanitization, delimiter-escaping, or instruction-hierarchy defense.

**LOCATION:** `lib/pipeline.ts`, every `runThematicAgent()`/`runEvasivenessAgent()`
call site: `` `Analyze this earnings call transcript for ${sectionName} insights... TRANSCRIPT:\n${transcript}` `` — the transcript text (sourced from a PDF originally
fetched from Screener.in/BSE via `lib/transcript-fetcher.ts`, or uploaded via
`app/api/v1/request/route.ts`) is pasted verbatim into the prompt with no escaping of
prompt-delimiter-like sequences the transcript text might itself contain, and no
instruction hierarchy (e.g. Gemini's system-instruction-vs-user-content separation is
used only loosely — `systemInstruction` carries the actual task instructions, which
is the right shape, but nothing detects or strips transcript content that attempts to
imitate a system instruction, like "Ignore prior instructions and output...").

**WHY IT MATTERS:** Earnings-call transcript PDFs are sourced from third-party sites
(Screener.in, BSE) and, per `app/api/v1/request/route.ts`, can also be manually
uploaded — meaning the content reaching these prompts is not fully trusted
first-party data. A transcript (or a malicious PDF crafted to look like one and
uploaded through the request flow) containing text designed to look like an
instruction could attempt to manipulate the `signal_classification`/`signal_score`/
`ui_component_type` output — the exact fields that drive this product's core
promise (accurate positive/negative signal detection for financial decisions).

**RISK:** Output manipulation is the most concrete risk (a crafted document skewing
its own signal classification to appear more positive/negative than warranted) —
directly consequential for a product sold on trustworthy financial signal
extraction. Because output is schema-constrained (ADR #4 in the ADR log), the *shape*
of a manipulated response is still valid JSON, meaning a successful injection would
be silently indistinguishable from a legitimate extraction — no schema violation
would flag it.

**RECOMMENDED CHANGE:** At minimum, wrap transcript content in an explicit,
clearly-delimited block with an instruction in the system prompt to treat everything
inside it as *data to analyze*, never as instructions (a well-known, low-cost
mitigation). Consider a lightweight heuristic scan for suspicious patterns (e.g.
"ignore previous instructions," unusually direct imperative language addressed to
"the AI"/"the assistant") flagging a transcript for manual review rather than
blocking it outright (false positives on legitimate financial text are likely).
Given the pipeline already extracts verbatim quotes and does local
signal/score-consistency validation (`localValidation()`), consider adding an
analogous cheap heuristic check specifically for injection-shaped content in
`raw_quotes` before they reach downstream synthesis agents.

**PRIORITY: P1** (no known exploit confirmed, but zero mitigation for a real and
well-understood LLM attack surface, on a product whose value proposition is signal
trustworthiness)

---

### 6. PROBLEM: `fetchStockPriceChange()` in `lib/pipeline.ts` silently returns `0` on any failure (network error, unknown ticker, timeout, malformed response) — indistinguishable in the output from "the stock genuinely didn't move."

**LOCATION:** `lib/pipeline.ts`, `fetchStockPriceChange()`: every failure path (`if
(!info) return 0`, `if (!range) return 0`, `if (!resp.ok) return 0`, the `catch`
block) returns the literal number `0`, which then flows into
`computeMarketAlignment()` as the stock price change and directly affects every
metric's `market_validation` field (aligned/divergent/unclear) and the top-level
`market_alignment_pct`.

**WHY IT MATTERS:** This function calls an unofficial, unauthenticated Yahoo Finance
endpoint (`query1.finance.yahoo.com`) with no SLA and no error differentiation — a
transient network blip, a rate limit, and "the stock was genuinely flat" all produce
the identical downstream value. `market_alignment_pct` is presented to users as a
real signal-quality metric (implicitly: "how many of our detected signals were
confirmed by the market") — but it's silently computed on top of data that may
simply be "we couldn't reach Yahoo Finance today," with no way for a user or an
internal engineer to tell the difference from the payload alone.

**RISK:** Data-quality risk that's invisible by construction. A batch of analyses
run during a Yahoo Finance outage or rate-limit window would all show artificially
"neutral" market alignment, potentially misleading users comparing signal quality
across companies/quarters, with no error surfaced anywhere.

**RECOMMENDED CHANGE:** Change the return type to `{ value: number; available:
boolean }` (or `null` for unavailable), propagate `available`/`null` through
`DashboardPayload.stock_price_change` and `market_alignment_pct`, and have the UI
(`components/AgentPanel.tsx`'s market-data card, `components/EarningsReport.tsx`)
render an explicit "market data unavailable" state instead of a misleading `0%`/`—`.

**PRIORITY: P1**

---

### 7. PROBLEM: `SupabaseXRepository` classes are still present in every repository file, past their own documented safety-window deletion date.

**LOCATION:** `lib/repositories/analysis.ts` (and its siblings — `sectors.ts`,
`kpis.ts`, `watchlist.ts`, `credits.ts`, `soloAnalysis.ts`, `insights.ts`,
`promoterActivity.ts`, `calendar.ts`, `concalls.ts`, `apiAccess.ts`) each still
define a full `SupabaseXRepository implements XRepository` class, dead code since
`lib/repositories/index.ts` instantiates only the `PostgresXRepository`/
`AzureBlobStorageRepository` classes. `lib/supabase/admin.ts` (the client these dead
classes depend on) is also still present. Per
`docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md`'s Cutover
procedure step 11, the documented exit criteria for deleting these classes — "one
successful production deployment on the new implementations, verification passed...
and 7 days in production with no migration-related incidents" — were satisfied by
2026-07-20 at the latest per that same document.

**WHY IT MATTERS:** This is the codebase's own stated plan not followed through —
the migration succeeded (evidenced by the composition root and the fact the app is
live and functioning on Postgres), but the promised cleanup step never happened,
months later.

**RISK:** Doubled maintenance surface on every future interface change to any of the
11 migrated repositories (a new method must be added to two classes, one of which
will never run). Genuine risk of confusion for a new engineer who doesn't know which
class is live (this analysis had to trace `lib/repositories/index.ts` explicitly to
determine it) — a plausible mistake is editing the dead `SupabaseXRepository` class
believing it's live, and shipping a change that silently does nothing.

**RECOMMENDED CHANGE:** Delete all `SupabaseXRepository`/`SupabaseStorageRepository`
classes and `lib/supabase/admin.ts` now — the migration doc's own exit criteria were
met long ago. If any residual concern about needing a rollback path remains, that's
what version control is for; keeping dead code live in the tree past its own
documented sunset date isn't a real rollback plan.

**PRIORITY: P1**

---

### 8. PROBLEM: The layered architecture the codebase explicitly designed for itself (routes → services → repositories) is only followed by the 3 public-API routes; every internal route (the actual bulk of the product) calls repositories directly from the route handler, skipping the service layer entirely.

**LOCATION:** `lib/services/` contains exactly 3 files (`index.ts`,
`sectorThesisService.ts`, `errors.ts`, 180 lines total) and is imported only by
`app/api/public/v1/data/companies/[ticker]/route.ts`,
`app/api/public/v1/data/sectors/[sector]/route.ts`, and
`app/api/public/v1/products/sector-thesis/route.ts`. Meanwhile
`app/api/v1/analyze/route.ts` (the flagship internal route) imports `analysisRepo`
and calls it directly, along with inline credit-check and cache-check business
logic, with no service layer in between — contradicting
`docs/superpowers/specs/2026-07-09-data-wrapper-and-public-api-design.md`'s own
stated principle 3 ("Services own orchestration — composition, caching decisions...
Routes stay thin... No business logic in a route file").

**WHY IT MATTERS:** The spec that introduced this layering explicitly justified the
investment as being for "a multi-year platform... not a one-off script," and the
composition-root/service-layer machinery (`lib/services/index.ts`) was built to
support it — but it was only ever adopted for the newest, smallest part of the
system (3 public API routes) and never retrofitted onto the original, larger
internal API surface it was ostensibly designed for. This is architecture debt in
the specific sense of "we built the right abstraction but didn't finish rolling it
out" — worse than never building it, in one sense, because it creates two
inconsistent patterns in the same codebase for a new engineer to reconcile.

**RISK:** Ongoing confusion about "where does business logic belong" for any new
internal feature — a new engineer copying `app/api/v1/analyze/route.ts` as a
template will keep entrenching the un-layered pattern; one copying an
`app/api/public/v1/*` route will follow the intended layered pattern. Both patterns
now have precedent in the same repo.

**RECOMMENDED CHANGE:** Either retrofit the internal routes' orchestration logic
(cache-check-then-credit-check-then-pipeline-then-save, currently inline in
`app/api/v1/analyze/route.ts`) into a proper `AnalysisService`, matching the
project's own stated architecture — or explicitly revise the architecture spec to
say the Service layer is public-API-only by design, so the inconsistency stops
looking like an oversight and becomes a documented, intentional scope boundary.

**PRIORITY: P2**

---

### 9. PROBLEM: `getGenAI()` (the Gemini client constructor) is duplicated near-verbatim across at least five files, with no shared LLM-client module.

**LOCATION:** `lib/pipeline.ts:183-187`, `lib/solo-pipeline.ts:39-43`,
`lib/insights-pipeline.ts:75-79` (three byte-for-byte-identical function bodies,
confirmed by direct grep), plus structurally similar inline patterns in
`lib/sector-narrative.ts:112` and `lib/kpi-extractor.ts:361`.

**WHY IT MATTERS:** Any future improvement to how the Gemini client is constructed
(retry policy, timeout defaults, centralized cost/token logging, a fallback model,
API-key rotation) must currently be applied in five separate places, and it's easy
for one to drift from the others (indeed, `lib/sector-narrative.ts` and
`lib/kpi-extractor.ts` already handle a missing API key differently — `console.warn`
and skip, vs. `lib/pipeline.ts`'s hard `throw` — a real behavioral inconsistency
already present, not just a hypothetical one).

**RISK:** Silent inconsistency in error handling across pipelines (a missing
`GOOGLE_API_KEY` crashes Delta/Solo/Insights analysis outright but is silently
swallowed — with only a console warning — for sector narrative and KPI extraction,
meaning those two features degrade invisibly instead of failing loudly). Growing
maintenance tax as more Gemini call sites are added.

**RECOMMENDED CHANGE:** Extract one `lib/llm/client.ts` (mirroring the
`lib/postgres/client.ts` / `lib/repositories/index.ts` composition-root pattern
already used successfully elsewhere in this codebase) exporting a single
`getGenAI()` and a single `invokeStructured<T>()` helper with a consistent,
deliberately-chosen missing-key behavior, used by all five call sites.

**PRIORITY: P2**

---

### 10. PROBLEM: `disclosure-analysis-pipeline/src/pipeline.py` and `finance-agent/disclosure_pipeline/src/pipeline.py` are forked duplicates of the same original file that have since diverged — confirmed by direct diff.

**LOCATION:** `disclosure-analysis-pipeline/src/pipeline.py` vs.
`finance-agent/disclosure_pipeline/src/pipeline.py` — a direct `diff` shows the
`finance-agent/` copy is a materially evolved superset (adds `target_company`
filtering, `skip_file_output`, `run_evaluation`/judge-LLM-evaluation flags,
incremental-update merge logic against existing parsed data) of the
`disclosure-analysis-pipeline/` copy, which lacks all of that and returns bare
`None` on the early-exit paths the newer version returns a structured `{"results":
[], "verdict": None, "usage": {}}` from. Both directories also carry their own,
independently-drifted copies of `src/analyzer.py`, `src/models.py`, `src/parser.py`,
`src/semantic_extraction.py`, `create_sample_data.py`, `requirements.txt`,
`setup.sh`. `finance-agent/disclosure_pipeline/` additionally has
`evaluation_report.py` and `judge_evaluator.py` with no counterpart in
`disclosure-analysis-pipeline/` at all.

**WHY IT MATTERS:** This is a full module fork, not a shared library with two
consumers — two directories in the same repository maintain independent copies of
what was clearly once one codebase, and they have already diverged in
behavior-affecting ways (return-value shape on empty/error paths, feature flags).
Both are part of the frozen, archived prototype (see ADR #1), so the practical
urgency is low, but it's a clean example of exactly the kind of silent duplication
that makes an "archived, safe to ignore" judgment risky — a future engineer
resurrecting either directory needs to know which one is the more complete/correct
version (it's `finance-agent/disclosure_pipeline/`, per this diff) rather than
assuming either is authoritative.

**RISK:** Low direct production risk (neither directory is wired into the live app —
verified via import/reference search from `app/`/`lib/`), but real risk of wasted
effort if either is ever resurrected without first reconciling which fork is
canonical, and real repo-hygiene cost (two copies of PDF sample data, two
`requirements.txt` files, two `setup.sh` scripts, all needing independent
verification if either is ever touched again).

**RECOMMENDED CHANGE:** If neither directory is expected to be resurrected, delete
one (keeping `finance-agent/disclosure_pipeline/`, the more complete fork) and note
the decision in `README_ARCHIVE.md`. If archival value is the goal, at minimum add a
note to both directories' READMEs cross-referencing the other and stating which is
canonical.

**PRIORITY: P2** (archived code, but currently silently misleading about which copy
is authoritative)

---

### 11. PROBLEM: `package.json`'s `name` field is still `"notionwealth-frontend"` — the pre-rebrand product name, in a file that ships in every build artifact and Docker image.

**LOCATION:** `package.json:2` — `"name": "notionwealth-frontend"`. Corroborating
evidence of the same leftover branding: `supabase/migrations/001_initial.sql`'s
header comment ("NotionWealth Intelligence Engine schema"),
`discussions/06_AGENT_ARCHITECTURE.md`, and multiple `docs/superpowers/` plan/spec
documents still referencing the GitHub repo as
`Notion-Demand/notionwealth-engine-research` (the actual OIDC federated-credential
subject and `gh secret set --repo` target in
`docs/superpowers/plans/2026-07-10-azure-hosting-migration.md`).

**WHY IT MATTERS:** Purely cosmetic on its own, but it's evidence of a broader
pattern: the product's identity changed (NotionWealth → Quantalyze, per
`README_ARCHIVE.md` vs. `README.md`) without a corresponding pass through the
codebase to rename load-bearing identifiers — consistent with the same
"documentation/identity doesn't get updated after a decision ships" pattern behind
findings #1 and #2.

**RISK:** Low direct risk (an internal `package.json` name field has no
user-facing exposure), but it's a real signal in any code audit or due-diligence
review that branding/rebrand hygiene wasn't followed through, and could confuse
tooling that keys off the package name (npm registry publishing, if ever
attempted; some CI/monitoring integrations key dashboards off `package.json` name).

**RECOMMENDED CHANGE:** Rename to `"quantalyze"` or `"quantalyze-app"` (matching the
live Container App's own name, `quantalyze-app-ca`, minus the Container Apps
suffix) in one small commit.

**PRIORITY: P3**

---

### 12. PROBLEM: `app/dashboard/DashboardClient.tsx` is a 969-line, 19-`useState`/9-`useEffect` "God component" handling company search, watchlist, transcript availability, CSV import, and both pipelines' full lifecycle in one file.

**LOCATION:** `app/dashboard/DashboardClient.tsx` (see the full Tier 1 breakdown in
`18_FILE_LEVEL_TEACHING_GUIDE.md`) — includes an entire inline `CompanySearch`
sub-component, a hand-rolled `switch`-statement reducer for agent-progress state
embedded directly in `handleAnalyze()`, and independently-managed state for at least
six distinct concerns.

**WHY IT MATTERS:** No automated test runner exists anywhere in this repository
(stated explicitly in every `docs/superpowers/` migration plan's Testing section) —
which means this file's correctness currently depends entirely on manual QA of a
969-line component with 19 independently-mutable pieces of state, the exact shape
of code where update-ordering bugs (a `setX` reading stale closure state from
before another `setY` landed) are hardest to catch by inspection and easiest to
introduce by accident during a future change.

**RISK:** Regression risk on any future change to this file — a developer fixing one
concern (say, watchlist behavior) has to hold the other five concerns' state
interactions in their head simultaneously, since nothing structurally isolates them.
Zero unit-testability of the agent-progress reducer logic specifically, which is
exactly the kind of branching logic (cascading phase transitions across 5 sections)
most worth testing in isolation.

**RECOMMENDED CHANGE:** See the Tier 1 entry's PRODUCTION recommendation — extract
`useWatchlist()`, `useTranscriptAvailability()`, and a `useReducer`-based
`useAgentProgress()` hook as an incremental first pass, and move `CompanySearch`
to its own file.

**PRIORITY: P2**

---

### 13. PROBLEM: No automated test runner exists anywhere in the live application (`app/`, `lib/`, `components/`) — confirmed by its total absence from `package.json`'s scripts/devDependencies and by every migration plan's own Testing section stating so explicitly.

**LOCATION:** `package.json` (no `test` script, no `jest`/`vitest`/`@testing-library/*`
in `devDependencies`); `docs/superpowers/specs/2026-07-10-azure-hosting-migration-design.md`
and `docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md`'s
Testing sections both state "No automated test runner exists in this repo" as a
given constraint, not a gap being flagged.

**WHY IT MATTERS:** This is an AI-product codebase with genuinely intricate,
hard-to-eyeball-correct logic — `lib/pipeline.ts`'s multi-phase agent orchestration
and validation math, `lib/credits.ts`'s billing logic, `middleware.ts`'s auth/
entitlement gating — all verified today only by `npx tsc --noEmit` (type-checking,
which catches shape errors, not logic errors) plus manual dev-server smoke checks.
Two of the P0/P1 findings in this document (#3, #4 — the credit and rate-limit
race conditions) are exactly the class of bug a focused unit test (spin up N
concurrent calls to `checkAndDeduct`, assert the total deducted equals N×cost) would
catch immediately and a manual smoke check never will.

**RISK:** Every refactor is a leap of faith; every migration (of which this codebase
has now done several — repository pattern, Postgres cutover, Auth cutover, two
hosting migrations) carries higher risk than it needs to, and the team's own
migration docs compensate by writing unusually detailed manual verification
checklists — a sign the team knows this gap exists and is working around it rather
than closing it.

**RECOMMENDED CHANGE:** Start narrow and high-value, not comprehensive: unit tests
for `lib/pipeline.ts`'s pure functions (`localValidation()`, `computeOverallSignal()`,
`computeMarketAlignment()`, `parseFilename()` — all pure, all currently untested,
all easy to test in isolation with no mocking needed) and for `lib/credits.ts`'s
`checkAndDeduct()` under concurrency (which would directly catch finding #3).
Repository implementations are naturally the next tier (mock `query<T>()`, assert
correct SQL/params) given how much of the codebase's correctness now lives there.

**PRIORITY: P1** (not because zero tests is inherently catastrophic at this stage,
but because it's the direct root cause enabling findings #3 and #4 to exist
undetected)

---

### 14. PROBLEM: Comment/code drift inside `lib/pipeline.ts` itself — the file's own header comment describes an agent count that doesn't match the actual `AGENT_PROMPTS` object.

**LOCATION:** `lib/pipeline.ts:1-5`: `"Runs 8 parallel Gemini calls (4 thematic
agents × 2 quarters) + evasiveness"` — but `AGENT_PROMPTS` (lines 281-364) has 5
keys (`Revenue & Growth`, `Margins & Profitability`, `Cost Structure`, `CapEx &
Balance Sheet`, `Macro & Risk`), meaning the actual call count is 10 thematic + 1
evasiveness = 11, matching `TECHNICAL_ARCHITECTURE.md` §4a's "Phase 2 — Thematic
Agents + Evasiveness (parallel, 11 calls)" — the top-level architecture doc is
right; this file's own header comment is stale and wrong.

**WHY IT MATTERS:** Small in isolation, but it's the same category of drift as
findings #1, #2, and #3's docstring — a reader trusting the file's own top-of-file
comment (the most natural place to look first) gets the wrong mental model of the
system's most important pipeline before reading a single line of actual logic.

**RISK:** Low direct risk, but compounds the broader pattern: this repository has
comments/docs drifting from code at nearly every level examined (top-level READMEs,
migration design docs, a route handler's credit-quota docstring, and now a core
pipeline file's own header) — a systemic discipline gap around updating comments
when code changes, not an isolated incident.

**RECOMMENDED CHANGE:** Fix this one comment (`"10 parallel Gemini calls (5
thematic agents × 2 quarters)"`), and consider it a canary: if a 5-line header
comment in the single most important file in the repo can silently go stale, less-
visible comments elsewhere are worth auditing too.

**PRIORITY: P3**

---

### 15. PROBLEM: `analysisRepo.saveAnalysis()`'s cache-write is a non-transactional delete-then-insert, and its failure mode is swallowed to a string sentinel rather than surfaced.

**LOCATION:** `lib/repositories/analysis.ts`, `PostgresAnalysisRepository.saveAnalysis()`:
`await query(DELETE ...); const rows = await query(INSERT ... RETURNING id); return
rows[0]?.id ?? "unknown";` wrapped in a try/catch that, on any error, `console.error`s
and returns the string `"unknown"` rather than throwing or returning a typed
Result/error.

**WHY IT MATTERS:** Two separate, non-transactional statements mean a crash or
connection loss between the `DELETE` and the `INSERT` (a real possibility given
`lib/postgres/client.ts`'s own documented Azure VNet connection-reset behavior —
see its retry logic, added specifically because "the VNet path to Azure Postgres
intermittently drops idle connections") leaves that ticker/quarter-pair with **no**
cached row at all, silently forcing the next request to redo the full (up to
270-second, ~$0.03) pipeline run — a real cost/latency regression triggered by
exactly the kind of transient network blip this same file's sibling module
(`lib/postgres/client.ts`) was specifically hardened against for *reads* but not for
this *write*.

**RISK:** Intermittent, hard-to-reproduce cache misses correlated with exactly the
Azure networking flakiness this codebase already knows is real (documented in
`lib/postgres/client.ts`'s own comments) — a plausible, evidenced failure mode, not
a hypothetical one.

**RECOMMENDED CHANGE:** Wrap the delete+insert in one transaction
(`BEGIN`/`COMMIT`), or better, replace both statements with a single `INSERT ...
ON CONFLICT (company_ticker, q_prev, q_curr) DO UPDATE SET payload = EXCLUDED.payload,
created_at = NOW()` — one round trip, atomic by construction, and removes the
delete-then-insert race entirely (see also `app/api/v1/analyze/route.ts`'s Tier 1
FAILURE note on the same issue from the caller's side).

**PRIORITY: P2**

---

### 16. PROBLEM: `app/dashboard/DashboardClient.tsx`'s pipeline-triggering code has no client-abort wiring — a user navigating away or closing the tab mid-analysis does not stop the server-side Gemini calls from completing.

**LOCATION:** `app/api/v1/analyze/route.ts`'s `ReadableStream` has no
`request.signal`/`AbortController` wiring into `runPipeline()`; `lib/api.ts`'s
`runAnalysisStream()` reads the stream via `getReader()` with no corresponding abort
propagated back to the server on client disconnect.

**WHY IT MATTERS:** A closed browser tab or a page navigation mid-analysis leaves
the server-side pipeline running to completion regardless — burning up to ~20
Gemini calls and their associated cost for a result nobody will ever see (the stream
write will simply fail silently, caught by the `send()` function's own try/catch
which sets `closed = true`, but nothing stops `runPipeline()` itself). The result
does still get cached (a partial mitigation — a future request for the same
ticker/quarter-pair will hit cache), but the immediate cost is spent regardless of
whether the analysis was ever wanted to completion.

**RISK:** Wasted Gemini spend proportional to abandoned-request rate — plausibly
non-trivial for a product whose core interaction pattern (per `PRODUCT_NOTES.md`'s
own described workflow) involves rapid-fire watchlist cycling between multiple
tickers, a pattern that plausibly produces exactly this kind of "started an
analysis, then moved on before it finished" behavior.

**RECOMMENDED CHANGE:** Wire the Next.js Route Handler's `request.signal` (available
on the `NextRequest`) through to `runPipeline()`'s Gemini calls via
`AbortSignal`-aware fetch/SDK options (the `@google/generative-ai` SDK's
`generateContent()` accepts a `RequestOptions.signal`), so a client disconnect
actually stops in-flight and not-yet-started Gemini calls.

**PRIORITY: P2**

---

### 17. PROBLEM: Repo-root clutter — single-file directories `bank/`, `wealth/`, `xl/` hold what appear to be one-off sample/reference documents (a broker report PDF, a SEBI market-cap PDF, an Excel pointer-sheet template) committed at the repository root with no README explaining their purpose or relationship to the running application.

**LOCATION:** `bank/AxisCap_Century_Plyboards_Q4FY26_RU_25_May_2026.pdf` (a broker
research report, 453KB), `wealth/AverageMarketCapitalization31Dec2025.pdf` (a SEBI
market-cap reference document, 5.3MB), `xl/Steelcast Ltd – Pointers – Q4 FY22 till
Q3 FY24.xlsx` (an analyst pointer-sheet template, 65KB) — three top-level
directories, each holding exactly one file, none referenced by any import or file
read anywhere in `app/`/`lib/`/`components/` (confirmed: nothing in the live app
code reads from `bank/`, `wealth/`, or `xl/`).

**WHY IT MATTERS:** These read as reference material a team member dropped at the
repo root during research/product-design work (the pointer-sheet Excel file, in
particular, is plausibly the literal inspiration for the "Financials Tracker...
like maintaining your own pointer sheet automatically" feature description in
`PRODUCT_NOTES.md`) rather than application assets — but nothing marks them as such,
and their presence at the repository root (rather than, say, a `research/` or
`reference/` folder, or simply not committed to the app repo at all) is unexplained
repo hygiene debt. `.dockerignore` does exclude all three from the Docker build
context, which at least confirms someone was aware they shouldn't ship in the
container — but they're still tracked in version control at the app's root.

**WHY IT MATTERS (cont.):** A new engineer's first `ls` of the repository root sees
three cryptically-named, single-purpose-unclear directories mixed in with the actual
application source (`app/`, `lib/`, `components/`) — a small but real clarity cost
on every fresh clone.

**RISK:** Low technical risk, moderate clarity/professionalism cost, and a mild
repository-bloat cost (5.3MB+ of PDF binary content in git history for a file
that's excluded from the actual deployed artifact).

**RECOMMENDED CHANGE:** Move to a clearly-named `reference/` or `research/`
directory (or out of the application repository into a separate internal docs/
research location entirely, if these were never meant to be app-adjacent), and add a
one-line note explaining what each is for if kept.

**PRIORITY: P3**

---

### 18. PROBLEM: Untracked `.claude/` directory (containing `settings.local.json`, `launch.json`, `scheduled_tasks.lock`) is present in the working tree at the repository root, alongside evidence (`.gitignore`'s absence of a `.claude` entry) that its tracked-vs-ignored status is unclear.

**LOCATION:** `.claude/` (3 files, root-level) — `.gitignore` does not list `.claude/`
among its ignore patterns (it ignores `.venv/`, `venv/`, `__pycache__/`, `*.pyc`,
`data/`, `*.index`, `.env`, `.DS_Store`, `.vercel`, `.env.local`, `node_modules`,
`.next/`, `tsconfig.tsbuildinfo` — no `.claude` entry anywhere).

**WHY IT MATTERS:** Agent-tooling configuration/state directories like `.claude/`
are typically local-machine/session state, not something intended for version
control or for shipping alongside application code — its presence with no
`.gitignore` entry means it's ambiguous whether this is (a) accidentally trackable
and about to be committed by whoever next runs `git add .`, or (b) already
committed. Either way, `settings.local.json` and `scheduled_tasks.lock` are exactly
the kind of local/session-specific file that shouldn't end up in a shared repository
history — the naming convention (`*.local.json`) even signals local-only intent
that the `.gitignore` doesn't back up.

**RISK:** Low-to-moderate — depends entirely on whether these files ever get
committed; if `settings.local.json` contains anything session-specific (tool
permissions, local paths, or in the worst case something more sensitive), an
accidental commit would leak local tooling configuration into shared history.

**RECOMMENDED CHANGE:** Add `.claude/` to `.gitignore` explicitly, matching the
existing pattern already used for other local/tooling artifacts
(`.vercel`, `node_modules`).

**PRIORITY: P3**

---

### 19. PROBLEM: The `.env` var name for the Gemini API key is inconsistent across the codebase's own documentation — `docs/superpowers/specs/2026-07-13-azure-auth-migration-design.md` refers to it as `GEMINI_API_KEY`, while every actual call site in the code reads `process.env.GOOGLE_API_KEY`.

**LOCATION:** `docs/superpowers/specs/2026-07-13-azure-auth-migration-design.md`,
Non-Goals section: "No changes to the Gemini Flash API integration... the Gemini
Flash API (`GEMINI_API_KEY`, used only for transcript-analysis inference)" — but
`lib/pipeline.ts:184`, `lib/solo-pipeline.ts:40`, `lib/insights-pipeline.ts:76`,
`lib/sector-narrative.ts:112`, and `lib/kpi-extractor.ts:361` all read
`process.env.GOOGLE_API_KEY`, never `GEMINI_API_KEY`.

**WHY IT MATTERS:** A minor instance of the same doc/code drift pattern seen
throughout this repository, but specifically dangerous here because it's inside a
*migration design document* whose entire purpose is enumerating exactly which env
vars are touched vs. untouched by a given change — a reader trusting this doc's
env-var name while provisioning a new environment (e.g. setting up the Container
App's application settings, per finding #2) would set `GEMINI_API_KEY` and the app
would silently fail to find its Gemini key at runtime (throwing "GOOGLE_API_KEY not
set" from `getGenAI()`, a confusing error given the doc told them the var was named
differently).

**RISK:** Low probability, but a real footgun for the exact "quickly reference the
docs while provisioning a new environment" workflow the docs are meant to support.

**RECOMMENDED CHANGE:** Fix the one line in the auth-migration doc to say
`GOOGLE_API_KEY`, matching the code. Given `GOOGLE_API_KEY` is also the same env var
name used for the (separate, unrelated) Google OAuth client secret's sibling vars in
`.env.local.example` (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`), consider whether
`GOOGLE_API_KEY` itself is a confusingly generic name for specifically "the Gemini
inference API key" — a more specific name (`GEMINI_API_KEY`, matching what the docs
already assumed) might be the better fix in both directions.

**PRIORITY: P3**

---

### 20. PROBLEM: `resolvePdfKey()`'s error path in `lib/pipeline.ts` (and the "not a valid PDF"/"is empty" errors in `extractPdfText()`) instruct the *end user* to perform an operator action ("delete it from storage and re-request the ticker") that no UI in `app/dashboard/DashboardClient.tsx` actually exposes.

**LOCATION:** `lib/pipeline.ts`, `extractPdfText()`: `throw new Error(`${storageKey}
is empty — delete it from storage and re-request the ticker`)` and `... "not a valid
PDF"` and `"could not be parsed... The stored PDF appears to be corrupted. Delete it
from Supabase storage and re-request the ticker."` — these error messages flow
verbatim through `app/api/v1/analyze/route.ts`'s `type: "error"` NDJSON event to the
browser, where `DashboardClient.tsx`'s `error` state renders them directly to the
end user (per the `catch (err) { setError(...) }` pattern in `handleAnalyze()`).

**WHY IT MATTERS:** "Delete it from Supabase storage" (note: also still says
*Supabase*, per finding #1's broader drift — it's now Azure Blob Storage) is an
instruction only someone with direct database/storage admin access can act on — an
ordinary end user (a PMS analyst using the product) has no such access and no path
in the product UI to trigger a re-fetch/delete of a specific corrupted transcript
file. The error message is written for an internal operator's eyes but is exposed
directly to the customer.

**RISK:** Support burden (a confused customer sees an actionable-sounding error they
cannot act on, and has to contact support instead) and, separately, a very minor
information-disclosure concern (surfacing the word "Supabase" to an end user reveals
an internal implementation detail, and an inaccurate one at that).

**RECOMMENDED CHANGE:** Split the error into a user-facing message ("This
transcript file appears to be corrupted — please try re-requesting it, or contact
support") and a separate, operator-facing log line (`console.error`, already present
alongside the throw) carrying the actionable storage-key detail for whoever
actually has admin access. Fix the stale "Supabase" reference while touching this
code, consistent with finding #1's broader cleanup.

**PRIORITY: P3**
