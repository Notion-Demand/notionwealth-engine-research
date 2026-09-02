# Quantalyze — Testing

*Evidence-based map of every test-shaped artifact in the repo — live and archived — with an honest verdict per production component: what actually proves it works. Labels: IMPLEMENTED / PARTIALLY IMPLEMENTED / IMPLIED-ARCHITECTURALLY-PREPARED / NOT IMPLEMENTED / IMPLEMENTED-BUT-ARCHIVED.*

---

## 0. The one-sentence verdict

The live Next.js product (`app/`, `lib/`) has **zero automated tests of any kind** — no unit tests, no integration tests, no API tests, no database tests, no frontend tests, no E2E tests. **NOT IMPLEMENTED**, confirmed by direct inspection of `package.json` (no `jest`/`vitest`/`playwright`/`@testing-library/*` in `devDependencies`, no `test` script defined) and by an empty result from searching the whole tree for `*.test.*`, `*.spec.*`, `__tests__/`, or any `tests/`/`test/` directory under `app/`, `lib/`, `components/`, `types/`, or `scripts/`. This is not an oversight the codebase hides — it is stated explicitly, twice, by the project's own engineering-plan documents: `docs/superpowers/specs/2026-07-10-azure-hosting-migration-design.md:101` ("No automated test runner exists in this repo. Verification is `npx tsc --noEmit`...") and `docs/superpowers/plans/2026-07-09-company-memory-phase1.md:18` ("No test runner exists in this repo (`npm test` is not defined) — verification is via manual scripts (`npx tsx`) and `npm run dev` + `curl`/browser checks, not an automated test suite."). Every production component's correctness today rests on TypeScript's type checker plus manual verification by a human reading output in a browser or terminal.

The archived Python prototype (`finance-agent/`) has nine scripts named `test_*.py` and one `genai_test.py` — but **none of them are automated tests** in the pytest/unittest sense (no `conftest.py`, no `pytest.ini`, no `assert` statements driving pass/fail, confirmed by reading three of them in full below). They are manual smoke-test scripts: each has a `main()` that runs one hardcoded scenario and `print()`s the result for a human to read.

---

## 1. Live product (`app/`, `lib/`, `components/`) — the full test inventory

### 1.1 Frameworks/tooling actually present

`package.json` `dependencies` + `devDependencies` (full list already reproduced): **no** test runner (`jest`, `vitest`, `mocha`, `ava`), **no** component-testing library (`@testing-library/react`, `@testing-library/jest-dom`), **no** E2E tool (`playwright`, `cypress`), **no** API-mocking library (`msw`, `nock`), **no** DB-testing tooling (`testcontainers`, an in-memory Postgres). The only quality gates that exist are `eslint`/`eslint-config-next` (lint, not test) and `typescript` (`npx tsc --noEmit`, referenced as the project's actual verification method in the migration plans cited above). **NOT IMPLEMENTED.**

### 1.2 Test files

Zero. Confirmed via `find app lib components types scripts -iname "*.test.*" -o -iname "*.spec.*"` (empty result) and `find . -type d -iname "__tests__" -o -type d -iname "tests"` (empty result, excluding `node_modules`).

### 1.3 Fixtures / mocks / test data

None purpose-built for testing. The closest things that exist are **development conveniences repurposed as manual verification aids**, not test fixtures:
- `app/api/v1/seed-transcripts/route.ts`, `app/api/v1/seed-analysis/route.ts`, `app/api/v1/sectors/seed/route.ts`, `app/api/v1/calendar/seed/route.ts` — these are one-shot data-seeding API routes (populate the database with sample rows), used for manual local setup and demoing, not invoked by any test harness.
- `bank/` (sample broker reports) and `xl/` (an earnings-pointer-sheet Excel template) — reference/sample business artifacts cited in `README.md`'s product description, not test fixtures.
- `finance-agent/multiagent_analysis/all-pdfs/*.pdf` (10 real transcripts) — genuinely reusable as golden-set seed data for a *future* regression suite (see `12_AI_EVALUATION.md §4.1`), but as of today nothing in the repo reads them for test purposes; `next.config.js`'s `outputFileTracingIncludes` bundles this directory into the `/api/v1/analyze` and `/api/v1/available` serverless functions for *production* use (a fallback/demo dataset), not for testing.

### 1.4 What "verification" means today, per the engineering plans themselves

Both cited plan documents converge on the same three-step manual pattern for verifying a change: (1) `npx tsc --noEmit` (type-check only — catches type errors, not logic errors, not runtime behavior, not whether an API route returns the right data), (2) `npm run dev` + manual `curl` against the route, (3) a human clicking through the browser. The Azure hosting migration plan's own cutover checklist (`docs/superpowers/plans/2026-07-10-azure-hosting-migration.md`, Task 6 Step 5 / Task 7 Step 5) is explicit about this being **manual**: "Manually, in a browser, visit `https://quantalyze-app.azurewebsites.net` and confirm: the login page loads, logging in with an existing account works... and at least one data-bearing page... loads with real data" and "specifically test both Google and Slack OAuth login end-to-end" — a human, not a script, performs these checks on every production deploy.

---

## 2. Component-by-component: what proves each one works?

| Component | File(s) | What proves it works? |
|---|---|---|
| Delta Analysis pipeline | `lib/pipeline.ts` (881 lines, 5+ Gemini "agents") | **Nothing automated.** `npx tsc --noEmit` confirms it compiles; a human runs Delta Analysis in the browser and reads the output. No test ever calls `runPipeline()` directly and asserts on its return shape or values. |
| Deep Dive pipeline | `lib/solo-pipeline.ts` (200 lines) | Same — none. Manually verified by reading the dashboard UI. |
| Multi-Quarter Insights pipeline | `lib/insights-pipeline.ts` (437 lines) | Same — none. |
| KPI extraction | `lib/kpi-extractor.ts` (464 lines) | Same — none. |
| Sector narrative generation | `lib/sector-narrative.ts` (199 lines) | Same — none. |
| Divergence/promoter-pledge scoring | `lib/divergence-score.ts` (102 lines, pure arithmetic, no LLM) | None — despite being the one module in this list that's pure deterministic logic and therefore the *cheapest* to unit-test (no mocking Gemini needed), it has zero test coverage. |
| `POST /api/v1/analyze` (Delta Analysis API) | `app/api/v1/analyze/route.ts` | None — no test exercises auth-rejection (401), validation-rejection (422 on missing/equal quarters), the cache-hit streaming path, the credit-check-rejection (429) path, or the cache-miss pipeline-run path. All five distinct response paths in this one route file are unverified except by a human manually triggering each condition in a browser, if they even think to. |
| Every other `app/api/v1/*/route.ts` (screener, kpis, sectors, calendar, credits, insights, divergence, transcript, user-tickers, request) | `app/api/v1/**/route.ts` (23 route files total) | None. Zero API-route tests exist anywhere in the repo. |
| Public partner API (`app/api/public/v1/**`) + `middleware.ts`'s Bearer-key/SHA-256 gating | `app/api/public/v1/data/companies/[ticker]/route.ts`, `.../sectors/[sector]/route.ts`, `.../products/sector-thesis/route.ts` | None — this is the one surface with an actual external-partner contract (real paying/trial customers hitting it), and it has no test proving the auth-key hashing, entitlement check, or response-contract shape (`lib/api-contracts/v1/*.ts`) hold under any condition. Its own migration plan (`docs/superpowers/plans/2026-07-10-services-and-public-api.md:348`) says outright: "This task has no automated test (no test runner in this repo, and Next.js middleware only runs behind the dev/prod server, not `tsc`). Verification is `npx tsc --noEmit` plus the manual `curl` checks in Step 3." |
| Repositories (`lib/repositories/*.ts` — 12 interfaces, each with a `Postgres*Repository` live implementation and a dead `Supabase*Repository` implementation) | `lib/repositories/analysis.ts`, `sectors.ts`, `kpis.ts`, `watchlist.ts`, `credits.ts`, `soloAnalysis.ts`, `insights.ts`, `promoterActivity.ts`, `calendar.ts`, `concalls.ts`, `storage.ts`, `apiAccess.ts` | None — no test ever runs a `PostgresXRepository` method against a real or mocked Postgres connection and asserts on the resulting rows. Given the repository *interface* pattern was deliberately built specifically to make swapping Supabase→Azure Postgres safe (`docs/superpowers/plans/2026-07-09-repositories-and-migration.md`), the absence of interface-conformance tests (the exact kind of test that pattern exists to make cheap and valuable — run the same test suite against both implementations to prove behavioral equivalence) is a real, specific gap: the actual Supabase→Azure Postgres data-migration cutover (`docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md`) was verified via `scripts/verify-migration.ts` (a one-time hash-based row-count/checksum comparison script, not a reusable regression suite) rather than by re-running a shared test suite against both backends. |
| Auth (`auth.ts`, NextAuth + Microsoft Entra External ID) | `auth.ts`, `lib/auth.ts` | None — no test exercises the `jwt`/`session` callbacks (`auth.ts`'s `token.sub = profile?.oid ?? account.providerAccountId` logic, which the auth-migration plan itself documents as having broken production once already — "found by testing the real deployment, not caught by type-checking," `auth.ts` comment above the `jwt` callback) or the `getCurrentUser()` null-vs-populated paths (`lib/auth.ts`). |
| Credits/quota system | `lib/credits.ts` (`checkAndDeduct`, `ACTION_COSTS`) | None — the exact-boundary behavior (`status.remaining < cost` → reject with 429) that gates real revenue/cost-control has no test proving it doesn't have an off-by-one, doesn't double-deduct on a retry, or correctly resets `currentMonth()` across a month boundary. |
| Frontend components | `components/*.tsx` (e.g. `EarningsReport.tsx`, `AgentPanel.tsx`, `Nav.tsx`) and every `app/**/​*Client.tsx` | None — no React Testing Library, no component test of any kind. Every UI state (loading, error, empty, populated, the SSE-driven live agent-progress panel in `AgentPanel.tsx`) is verified, per the migration plans' own stated process, by a human loading the page. |
| Database migrations | `supabase/migrations/001_initial.sql` through `011_api_access.sql` | None — no migration is tested for idempotency, rollback safety, or schema-conformance before being applied. Applied manually (see `14_DEVOPS_CLOUD.md`). |
| Health check | `app/api/health/route.ts` | Ironically the one route with an explicit external verification step — but it's a manual `curl` in the deploy runbook (`docs/superpowers/plans/2026-07-10-azure-hosting-migration.md`, Task 6 Step 4: `curl -i https://.../api/health`), not an automated CI/CD gate (see `14_DEVOPS_CLOUD.md` for whether the actual `deploy-azure.yml` workflow calls it — it does not). |

**Every single row's honest answer is: "none — it's tested manually by a human running the app locally or in production and reading the output."** This is stated plainly per the task's requirement, not softened.

---

## 3. Archived prototype (`finance-agent/`) — is `test_*.py` real testing?

**Labeled IMPLEMENTED-BUT-ARCHIVED where anything real exists; the honest answer for most of these is that they are manual smoke scripts, not tests.**

### 3.1 No pytest/unittest infrastructure

Confirmed absent: no `conftest.py`, no `pytest.ini`, no `setup.cfg`/`pyproject.toml` with a `[tool.pytest]` section, anywhere under `finance-agent/`. `pytest` is not a listed dependency search hit either. This alone is close to conclusive — a real pytest suite needs at minimum a discoverable config or `conftest.py` for fixtures, and neither exists.

### 3.2 Full inventory: `finance-agent/genai_test.py`, `finance-agent/scripts/test_capital_agent.py`, `test_competitive_agent.py`, `test_control_plane.py`, `test_financial_agent.py`, `test_financial_ingest.py`, `test_memo_agent.py`, `test_portfolio_agent.py`, `test_replay.py`, `test_risk_agent.py` — 10 files total.

### 3.3 Read in full — three representative examples

**`finance-agent/scripts/test_capital_agent.py`** (19 lines, read in full):
```python
def main():
    task = "Capital outlook for Apple given services growth and China risk"
    print(f"Running Capital Allocation Modeling for: {task}\n" + "="*60)
    report = model_capital_allocation(task)
    print("\n--- CAPITAL STRATEGY REPORT ---\n")
    print(report)

if __name__ == "__main__":
    main()
```
No `assert`, no exit code signaling failure, no comparison against an expected value. This is a script you run and read — a manual smoke test — not an automated test. Structurally identical to `test_financial_agent.py` (calls `analyze_financials()` with one hardcoded query, prints the response) and five of the other seven `test_*.py` files.

**`finance-agent/scripts/test_replay.py`** (37 lines, read in full) is the one file in this set with any conditional logic resembling an assertion:
```python
if replay_data["replay_summary"]["match_score"] >= 0.9:
    print("\n[SUCCESS] Replay matches original session.")
else:
    print("\n[WARNING] Replay detailed changed.")
```
This is the closest thing to a pass/fail check anywhere in `finance-agent/` — it computes a `match_score` from `control.research_replay.replay_research()` and branches on a 0.9 threshold. But critically: **it only prints** `[SUCCESS]`/`[WARNING]` — it does not `raise`, does not call `sys.exit(1)`, does not set a pytest/unittest assertion. Running this script under a CI runner would report success (exit code 0) regardless of whether the replay matched. It is a manual smoke test with a built-in eyeball-this-number hint, not an automated regression gate.

**`finance-agent/scripts/test_control_plane.py`** (37 lines, read in full): calls `run_research_task()` with one hardcoded query, then prints the `verification_report`'s `summary_score` and per-item `[status] claim` lines, plus the full `trace`. Same pattern — no assertion, pure print-and-read.

### 3.4 Verdict

**All 10 files in this set are manual smoke-test scripts, not automated tests.** Every one follows the same shape: `sys.path.append(os.getcwd())` → import one agent/module → call it with one hardcoded example → `print()` the result for a human to read. None can be run under `pytest`/`unittest` and produce a meaningful pass/fail signal; none are referenced from any CI workflow (`.github/workflows/` contains only `deploy-azure.yml`, which never touches `finance-agent/` at all — see `14_DEVOPS_CLOUD.md`). This distinction matters precisely because the file names (`test_*.py`) invite the assumption that this is a real test suite, and it is not — this is the exact conflation the task instructions warn against, made concrete: a script that runs code and prints output is not equivalent to a test that asserts a property and fails loudly when it doesn't hold.

### 3.5 The one piece of genuine AI-output evaluation in the whole repo

Covered fully in `12_AI_EVALUATION.md` — `finance-agent/disclosure_pipeline/src/judge_evaluator.py` + `evaluation_report.py` is real LLM-as-judge evaluation code, invoked via an opt-in `--evaluate` CLI flag on the archived disclosure pipeline (`finance-agent/disclosure_pipeline/src/pipeline.py:274-299`). It is **not** a unit/integration test in the pytest sense either — it produces graded scores (0-100), not pass/fail assertions — and it is, again, archived and disconnected from the live product.

---

## 4. What's missing, prioritized

1. **A TypeScript test runner, at all.** Vitest is the lowest-friction choice for a Next.js 14 App Router codebase already on TypeScript/ESM (no Babel config to fight, fast, Jest-compatible API) — this is the single highest-leverage gap because nothing else on this list is buildable without it.
2. **Unit tests for the pure-logic, non-LLM modules first** — `lib/divergence-score.ts`, `localValidation()` and `computeOverallSignal()`/`computeMarketAlignment()` in `lib/pipeline.ts`, `computeConfidence()` in `app/api/v1/screener/route.ts`. These are deterministic, need no Gemini mocking or database, and are exactly the kind of scoring/threshold logic (magic numbers like `-12%` per flag, `0.5` floors, `> 2`/`< -2` signal thresholds) most prone to silent off-by-one/threshold regressions when someone tweaks a constant.
3. **API route tests for the five-path `analyze` route** (`app/api/v1/analyze/route.ts`) and the public partner API (`app/api/public/v1/**` + `middleware.ts`'s key-hashing/entitlement gate) — the latter is the one surface with an external contractual guarantee to partners and currently has the least verification of any component in the repo.
4. **A mocked-Gemini test harness** for the pipeline orchestration logic in `lib/pipeline.ts`/`lib/insights-pipeline.ts` — not to test Gemini's output quality (that's `12_AI_EVALUATION.md`'s domain), but to test *this codebase's* orchestration: does a timed-out agent (`AGENT_TIMEOUT_MS`) get correctly filtered out and not crash the whole pipeline (`runThematicAgent`'s catch-and-null pattern, `lib/pipeline.ts` ~line 471), does `Promise.all()` fan-out correctly aggregate partial failures, does the 270s `PIPELINE_TIMEOUT_MS` race actually fire and send the right error shape?
5. **Repository conformance tests** — one shared test suite run against both a `Postgres*Repository` and (while it still exists in the tree) its dead `Supabase*Repository` counterpart, to actually exercise the interface-based design's stated purpose, and going forward, to catch any repository-level regression before a future Postgres/blob-storage change ships.
6. **Playwright E2E for the two or three highest-value manual flows already documented as manual checklist items in the ops runbooks** — login (Entra OAuth), Delta Analysis end-to-end, and the health endpoint — replacing the "visit in a browser and confirm" step in `docs/superpowers/plans/2026-07-10-azure-hosting-migration.md`'s cutover checklist with something that runs unattended on every deploy.
7. **A CI gate that actually runs any of the above** — even once tests exist, they only prevent regressions if `.github/workflows/deploy-azure.yml` (or a new workflow) fails the build on a test failure; today's workflow has no test step of any kind (see `14_DEVOPS_CLOUD.md` for the full trace of what that workflow does and doesn't do).
