# Quantalyze — DevOps & Cloud

*Evidence-based trace of CODE → BUILD → TEST → CONTAINER → DEPLOY → CONFIG → RUNTIME → OBSERVABILITY for the live product, plus what the dated engineering-plan documents reveal about how this infrastructure actually got built (including a real, undocumented gap between what the plans describe and what's live today). Labels: IMPLEMENTED / PARTIALLY IMPLEMENTED / IMPLIED-ARCHITECTURALLY-PREPARED / NOT IMPLEMENTED.*

---

## 0. The one-sentence verdict

Quantalyze deploys to **Azure Container Apps** via a Docker multi-stage build and a GitHub Actions workflow authenticated with OIDC federated credentials (a genuine security best practice) — but that pipeline has **no test step, no staging environment, no automated database-migration step, and no post-deploy health verification**: every push to `main` builds, pushes, and deploys straight to production, unattended, with the only gate being "did `docker build`/`npm run build` succeed." This is a real, specific, and important gap to name precisely, because the *rest* of the pipeline (OIDC auth, multi-stage Docker, standalone Next.js output) is genuinely well-built — the gap isn't sloppiness, it's scope that was never added.

A second finding worth naming up front: the **live deployment target (Azure Container Apps + Docker) does not match what the repo's own dated migration documents describe (Azure App Service, explicitly *without* Docker)**. This is documentation drift with no recorded second migration — traced in full in §7.

---

## 1. CODE

Single Next.js 14.2.29 App Router monorepo at the root — `app/`, `lib/`, `components/`, `types/`, `supabase/migrations/` (11 `.sql` files, despite the directory name still being `supabase/` post-migration — see §8). No monorepo tooling (no Turborepo/Nx), no separate packages — one `package.json`, one `tsconfig`. The archived `finance-agent/` (Python/FastAPI) and `disclosure-analysis-pipeline/` live in the same git tree but are **not part of the deploy pipeline in any way** — confirmed: `.github/workflows/deploy-azure.yml` never references `finance-agent/`, and the `Dockerfile`'s build context copies the whole repo (`COPY . .`, see §3) but only `npm run build`s the Next.js app; nothing installs Python dependencies or runs any Python code during the Docker build.

---

## 2. BUILD

`Dockerfile`'s `builder` stage runs `npm run build` (`package.json`'s `build` script: `"build": "next build"`), configured via `next.config.mjs`:

```js
const nextConfig = {
  output: "standalone",
  images: { remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }] },
  experimental: {
    outputFileTracingIncludes: {
      "/api/v1/analyze": ["./finance-agent/multiagent_analysis/all-pdfs/**"],
      "/api/v1/available": ["./finance-agent/multiagent_analysis/all-pdfs/**"],
      "/api/slack/command": ["./finance-agent/multiagent_analysis/all-pdfs/**"],
    },
    serverComponentsExternalPackages: ["pdf-parse", "node-html-parser"],
  },
  async redirects() { /* www.quantalyze.me -> quantalyze.me, host-based */ },
};
```

**`output: "standalone"`** produces a minimal, dependency-traced server bundle (`.next/standalone/`) rather than requiring `node_modules` + full source in the runtime image — this is why the Dockerfile's `runner` stage (§3) can be so small. **`outputFileTracingIncludes`** force-bundles the 10 sample PDFs in `finance-agent/multiagent_analysis/all-pdfs/` into three specific serverless-function bundles — notably including `/api/slack/command`, a route that **does not exist anywhere in the live `app/api/` tree** (confirmed: `find app/api -iname "*slack*"` returns nothing). This is a small, harmless piece of dead config — almost certainly a leftover from when a Slack-integration route was planned or existed and was later removed without cleaning up this reference. `serverComponentsExternalPackages` correctly excludes `pdf-parse` and `node-html-parser` (genuine Node-native/non-Edge-compatible packages, used by `lib/transcript-fetcher.ts` and `lib/pipeline.ts`'s PDF-text extraction) from webpack bundling.

**No CI test step exists between BUILD and CONTAINER** — see §5.

---

## 3. CONTAINER — the Dockerfile, precisely

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]
```

Three named stages, each with a distinct job:

- **`deps`**: installs *only* production+dev dependencies (`npm ci`, deterministic install from `package-lock.json`) in isolation from the rest of the source tree — this stage's Docker layer is cached and only invalidates when `package.json`/`package-lock.json` change, not on every source-code edit, which is the entire point of splitting it out rather than doing `COPY . .` before `npm ci`.
- **`builder`**: reuses `deps`'s `node_modules` (`COPY --from=deps`), copies the full source (`COPY . .`), and runs `next build` — this is the only stage that ever holds the full source tree, dev dependencies, and build tooling.
- **`runner`**: the actual production image. It does **not** inherit anything from `builder` except three specific artifacts — `public/`, `.next/standalone/`, `.next/static/` — meaning the final image contains no source code, no dev dependencies, no build tooling, no `node_modules` beyond what standalone-mode already traced into `.next/standalone/node_modules`. This is exactly the size/attack-surface benefit `output: "standalone"` (§2) exists to unlock in a Docker context.

**Non-root user**: `addgroup -S nodejs && adduser -S nextjs -G nodejs` creates a dedicated, unprivileged system user/group, and `USER nextjs` switches to it before `CMD` runs — the container process never runs as `root`. This is a genuine security best practice, correctly applied.

**No `HEALTHCHECK` instruction** in the Dockerfile itself — container-level health checking, if it happens at all, would have to come from Azure Container Apps' own probe configuration (not visible in this repo — Container Apps probes are typically set via `az containerapp` flags or a Bicep/ARM template, neither of which exists here; see §6/§9). **IMPLIED-ARCHITECTURALLY-PREPARED at best**: `app/api/health/route.ts` exists and would be a correct target for such a probe, but nothing in this repo's tracked files configures Container Apps to actually poll it.

---

## 4. Docker Compose / Kubernetes / Terraform — confirmed absent

- **Docker Compose**: no `docker-compose.yml`/`compose.yaml` anywhere in the repo. **NOT IMPLEMENTED.** There is exactly one container (the app itself) and no local multi-service orchestration need (Postgres/Blob are cloud-managed Azure services the app connects to over the network, not local containers).
- **Kubernetes**: no `k8s/`, no Helm charts, no `kubectl` manifests anywhere. **NOT IMPLEMENTED.** Azure Container Apps is itself a managed, Kubernetes-based serverless-container platform — it gives Quantalyze several Kubernetes-adjacent benefits (revision-based deploys, autoscaling) without the app needing to own or author any Kubernetes YAML directly, which is a reasonable trade for a single-service, pre-launch app.
- **Terraform/Bicep/any IaC**: no `.tf`, `.bicep`, or ARM template files anywhere in the repo. **NOT IMPLEMENTED as code.** Every Azure resource visible in this repo (`quantalyze-prod-rg`, `quantalyzeacr`, `quantalyze-app-ca`, plus — per the dated plan documents — an App Service plan, a VNet, an Application Insights component, and later a Postgres Flexible Server) was provisioned via one-off `az` CLI commands run by a human operator and recorded as literal shell commands *inside the markdown plan documents themselves* (e.g. `docs/superpowers/plans/2026-07-10-azure-hosting-migration.md`, Task 2: `az group create --name quantalyze-prod-rg --location centralindia`). The plan documents explicitly name this as a deliberate, scoped decision, not an oversight: `docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md`'s Out-of-scope section states "**Infrastructure-as-code** (Bicep/Terraform) for provisioning — one-time manual/CLI provisioning is proportionate for a single environment at this stage. Can be revisited if/when a second environment (staging) is needed." This is a real, self-aware, and honestly-documented gap rather than an unconsidered one — but it is still a gap: today, the *only* record of what infrastructure exists and why is prose in `docs/superpowers/`, not a reproducible, diffable, version-controlled definition. A dropped/misconfigured resource has no `terraform apply` to restore it from.

---

## 5. GitHub Actions — `.github/workflows/deploy-azure.yml`, traced completely

This is the **only** workflow file in the repo (`.github/workflows/` contains exactly one file).

```yaml
name: Deploy to Azure Container Apps

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

env:
  REGISTRY: quantalyzeacr.azurecr.io
  IMAGE_NAME: quantalyze-app

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Log in to ACR
        run: az acr login --name quantalyzeacr

      - name: Build and push image
        run: |
          docker build -t ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} -t ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest .
          docker push ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          docker push ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest

      - name: Deploy to Azure Container Apps
        uses: azure/CLI@v2
        with:
          inlineScript: |
            az containerapp update \
              --name quantalyze-app-ca \
              --resource-group quantalyze-prod-rg \
              --image ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
```

### 5.1 Trigger — no staging environment, ever

`on: push: branches: [main]` (plus manual `workflow_dispatch`). **There is no staging/dev workflow, no branch-based environment separation, no required PR review gate visible in this workflow file.** Every merge to `main` — the instant `git push origin main` succeeds — triggers a build, a push to the production container registry, and an update to the production Container App, in one unbroken automated sequence. This confirms the task's suspicion precisely: **main branch pushes straight to prod on every merge**, with zero automated gate in between. Whether a PR review is *required* by GitHub branch-protection settings is not visible from this repo's tracked files (branch protection is a GitHub repo setting, not something expressed in `.github/workflows/*.yml`), but even if it is, no *automated* check (test, lint-as-a-gate, build-preview) runs before merge — `deploy-azure.yml` only runs *after* the push to `main` has already happened.

### 5.2 Auth mechanism — OIDC federated credentials, a genuine positive

`permissions: id-token: write` + `azure/login@v2` with `client-id`/`tenant-id`/`subscription-id` secrets (no `client-secret`, no stored publish-profile) is Azure AD Workload Identity Federation: GitHub's OIDC token issuer exchanges a short-lived, run-scoped token for Azure access, with **no long-lived credential stored in GitHub Actions secrets at all** — only the three non-secret identifiers needed to know *which* federated trust to use. This is exactly what the migration plan set out to build and is worth calling out as unambiguously good practice: `docs/superpowers/plans/2026-07-10-azure-hosting-migration.md`, Task 3, Step 4 shows the actual federated-credential creation, scoped narrowly to `"repo:Notion-Demand/notionwealth-engine-research:ref:refs/heads/main"` — meaning **only a workflow run triggered from a push to `main` in this exact repository** can exchange a token for Azure access, not any branch, not any fork, not any other repo. The role assignment (Task 3, Step 5) is likewise scoped to the resource group only (`Contributor` on `quantalyze-prod-rg`), not the whole subscription — a second, independent instance of least-privilege being actually applied, not just claimed.

### 5.3 Is there a TEST step? — verified precisely: no

Reading the workflow's five steps top to bottom: Checkout → Azure login (OIDC) → `az acr login` → `docker build`+`docker push` → `az containerapp update`. **There is no `npm test`, no `npm run lint`, no `tsc --noEmit`, no `npm ci` even (the workflow never runs `npm install`/`npm ci` at all outside the Docker build itself), and no security/dependency scan step anywhere in this file.** The *only* gate a change to `main` has to pass before reaching production is `docker build` succeeding — which internally runs `npm ci` (in the `deps` stage) and `npm run build`/`next build` (in the `builder` stage, which does perform TypeScript type-checking as part of `next build`'s own compilation — a real, if incidental, gate). So the honest characterization is: **the only quality gate between a `main` push and production is "does the app type-check and build," with zero behavioral verification of any kind** — matching exactly what `13_TESTING.md` documents about the repo having no automated test suite for this workflow to run even if a step were added.

### 5.4 Rollback strategy — Container Apps revisions exist, but the workflow doesn't use them for rollback

Azure Container Apps is inherently **revision-based** — every `az containerapp update` with a new `--image` creates a new immutable revision, and (depending on the app's traffic-split/mode configuration, not visible in this repo) old revisions typically remain available for manual traffic-shifting via `az containerapp revision` commands. But `deploy-azure.yml` **always deploys `:${{ github.sha }}`** as an explicit, unique tag per commit (in addition to floating `:latest`), which is good practice — a *specific* rollback target (a prior commit SHA's image) genuinely exists in ACR and could be redeployed by re-running `az containerapp update --image ...:<old-sha>` manually. But there is **no automated rollback mechanism** — no workflow step that detects a failed deploy and reverts, no `workflow_dispatch` input for "roll back to SHA X," and no health-check-gated revision promotion (Container Apps supports traffic-splitting between an old and new revision to canary a deploy, but nothing in this workflow configures or uses that). **PARTIALLY IMPLEMENTED**: the *raw material* for rollback (immutable, SHA-tagged images) is there by accident of good tagging discipline; the *procedure* for actually rolling back is entirely manual and undocumented anywhere in this repo (contrast with the Vercel→App Service migration's explicit, written rollback plan — §7 — which has no Container Apps equivalent).

### 5.5 Post-deploy health verification — fire-and-forget, verified precisely: yes, fire-and-forget

`az containerapp update` is the workflow's last step. There is **no subsequent step** that curls `app/api/health/route.ts`, checks the new revision's provisioning state, or waits for traffic to confirm healthy before declaring the workflow done. The workflow run reports green (success) the moment the Azure CLI call to *initiate* the image update returns, regardless of whether the new revision ever actually starts serving traffic successfully. This is a real gap: the health endpoint exists (`app/api/health/route.ts`, `export async function GET() { return NextResponse.json({ status: "ok" }) }`, deliberately minimal per its own design doc — no Supabase/DB/Gemini calls, "a health check that fails when an *external* dependency has a transient blip would cause App Service to needlessly recycle a perfectly healthy instance," `docs/superpowers/specs/2026-07-10-azure-hosting-migration-design.md`) — but nothing in the *current* Container Apps deploy path actually calls it post-deploy. The only place `curl .../api/health` appears anywhere in this repo is inside the App Service-era migration runbook's manual verification steps (§7) — a procedure that predates, and was never carried forward into, the current automated Container Apps workflow.

### 5.6 Secrets referenced

`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` — all three are non-sensitive *identifiers* (not credentials) required to establish the OIDC trust, per §5.2. No application secrets (`GOOGLE_API_KEY`, database connection strings, etc.) are referenced anywhere in this workflow — those are Container App environment/secret configuration set separately via `az containerapp` commands (per the pattern shown for App Service in `docs/superpowers/plans/2026-07-10-azure-hosting-migration.md`, Task 5), not part of the CI/CD pipeline itself. `.env.local` (present locally, git-ignored) is never read or referenced by this workflow — confirmed by its absence from `deploy-azure.yml`.

---

## 6. DEPLOY / CONFIG / RUNTIME — what's actually provisioned, per the dated migration docs

No IaC exists (§4), so the plan/spec markdown files are the *only* record of what was provisioned and why. Names visible directly in `deploy-azure.yml` itself: `quantalyze-prod-rg` (resource group), `quantalyzeacr` (Azure Container Registry, `quantalyzeacr.azurecr.io`), `quantalyze-app-ca` (the Container App). Per `docs/superpowers/plans/2026-07-10-azure-hosting-migration.md`'s Execution Record (§7 below) and its Task 5, the following were also provisioned during the hosting effort: an App Service Plan (`quantalyze-prod-plan`, B1 SKU — later superseded, see §7), an Application Insights component (`quantalyze-appinsights`), and — per the plan's own "Post-completion addendum" — a VNet (`quantalyze-prod-vnet`, `10.0.0.0/16`) with a delegated subnet (`appservice-integration-subnet`, `10.0.1.0/24`) added specifically to support private Postgres connectivity for the *next* migration (Data + Storage). The Data + Storage migration spec (`docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md`) confirms an Azure Database for PostgreSQL Flexible Server (Postgres 17) and an Azure Storage account (Blob, container `transcripts`) were provisioned on private/VNet-only networking into that same VNet — matching what `lib/postgres/client.ts`'s comments describe operationally live today ("Azure Database for PostgreSQL Flexible Server enforces TLS by default," "Azure's outbound network path (App Service VNet integration -> NAT/LB) silently reaps TCP flows that appear idle").

**Environment configuration across environments**: confirmed **no staging environment exists** — one Container App (`quantalyze-app-ca`), one resource group, one set of application settings/secrets, matching §5.1's trigger analysis. The Data+Storage migration spec's own Out-of-scope note ("Infrastructure-as-code... Can be revisited if/when a second environment (staging) is needed," §4 above) confirms this was a deliberate, named, current-scale-appropriate trade-off, not an unconsidered gap — but it remains true today that there is exactly one environment, and every `main` push deploys directly into it.

---

## 7. A real, documented-vs-actual mismatch: App Service in the docs, Container Apps in production

This is worth stating precisely because it's a genuine finding, not editorializing. `docs/superpowers/plans/2026-07-10-azure-hosting-migration.md` and its paired spec (`docs/superpowers/specs/2026-07-10-azure-hosting-migration-design.md`) describe, in exhaustive step-by-step detail, migrating Quantalyze's hosting to **Azure App Service** (Linux, Node.js runtime) — explicitly and repeatedly **not** using Docker: the spec's Out-of-scope section states "**Containerization/Docker** — App Service's Linux/Node runtime deploys from a built artifact directly; no Dockerfile is needed for this hosting choice," and later, under Future extensions: "**Containerization** — if the app's runtime needs ever outgrow what App Service's Node runtime offers... Azure Container Apps (Docker-based) is the natural next step. Not needed now." The plan's own **Execution Record** (dated 2026-07-10) documents this migration as fully completed against App Service — including App Service-specific troubleshooting (a 503 fixed by setting an explicit `--startup-file "node server.js"` because App Service's default `npm start` tried to run the full Next.js CLI against the trimmed standalone bundle; a managed-SSL-certificate ordering issue; two required GoDaddy A-records for the apex domain) — and closes with "Safety window: cutover completed and fully verified... on 2026-07-10."

**The live repository's actual deployment artifacts — `Dockerfile` (present, and clearly production-maintained, not a leftover experiment) and `.github/workflows/deploy-azure.yml` (targeting `quantalyze-app-ca`/Azure Container Apps/ACR) — contradict this.** The app is not running on App Service today; it is running on Container Apps, with a Dockerfile as the build artifact — exactly the "natural next step... not needed now" the hosting spec explicitly deferred. **No plan or spec document anywhere in `docs/superpowers/plans/` or `docs/superpowers/specs/` describes this second migration** (App Service → Container Apps) — there is no `*-container-apps-migration.md`, no addendum to the existing hosting plan recording it, and no execution record for it anywhere in this repo. Corroborating evidence that a second, undocumented hop happened rather than the App Service plan simply being aspirational and never executed: the Execution Record's specificity (real troubleshooting detail, a real completion date, a real safety-window exit-criteria note) reads as genuine completed work, not a draft — and `02_PRODUCT_ARCHITECTURE.md` (§ documentation-drift notice) independently reaches the same conclusion, describing this as "a completed Strangler Fig migration" with the Supabase-era docs left stale. The most likely honest explanation is that the App Service → Container Apps move happened as a real but *undocumented* follow-on decision — engineering work that shipped without the same planning-artifact discipline the rest of this codebase's `docs/superpowers/` process otherwise consistently demonstrates. Whatever the cause, the practical consequence for an incoming engineer is real: **reading `docs/superpowers/plans/2026-07-10-azure-hosting-migration.md` today gives an inaccurate picture of the current production topology** — the resource group name (`quantalyze-prod-rg`) and the OIDC/GitHub Actions trust setup (§5.2) both carried forward correctly, but the compute layer itself (App Service Plan/Web App vs. Container App/ACR) did not.

---

## 8. Database migrations — applied manually, and the README is stale about it

`supabase/migrations/001_initial.sql` through `011_api_access.sql` (11 files) are plain, hand-written `.sql` files — no Prisma/Drizzle/other migration-tooling framework, confirmed absent from `package.json`, and explicitly a deliberate choice: the Data+Storage migration spec's Out-of-scope section states "**An ORM** (Prisma, Drizzle) — raw `pg` (node-postgres) with hand-written parameterized SQL, matching this codebase's existing style... migrations stay plain `.sql` files."

**They are not applied automatically in CI/CD.** `deploy-azure.yml` never references `supabase/migrations/`, never runs `psql`, and has no migration step of any kind (§5.3's full step trace confirms this). `README.md`'s own Setup section instructs: *"# Apply supabase/migrations/001-009 in order via Supabase SQL editor"* (`README.md:138`) — this is doubly stale: (1) it names a "Supabase SQL editor," but the database has since migrated to Azure Database for PostgreSQL Flexible Server (§6; `lib/postgres/client.ts`, `lib/repositories/index.ts`'s `Postgres*Repository` wiring) — there is no Supabase SQL editor to apply anything in anymore, since Postgres is no longer Supabase-hosted; and (2) it says "001-009" when 11 migrations exist (`010_user_credits.sql`, `011_api_access.sql` postdate whatever last updated this README line). The actual mechanism used for the one-time schema replay onto Azure Postgres was `scripts/migrate-schema-to-azure.ts` — a purpose-built script (not a general migration runner) that reads every file in `supabase/migrations/`, adapts each statement for Azure Postgres (drops `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY` statements — Azure Postgres has no `auth.uid()` function since Auth stayed on Supabase at that point in the migration sequence — and strips `REFERENCES auth.users(id)` foreign keys), and executes the result via `pgPool()` — a genuinely careful, one-time cutover script, not a reusable migration runner a new `012_*.sql` file could be applied through today. **This is a real, concrete gap**: there is no evidence of *any* mechanism — automated or documented-manual — for applying a future new migration file to the live Azure Postgres database. A new `012_*.sql` would have to be applied by a human running `psql`/an ad-hoc script directly against the production connection string, with no CI gate, no dry-run, and no rollback tooling.

---

## 9. `vercel.json` — confirmed dead, leftover pre-Azure config

```json
{
  "framework": "nextjs"
}
```
This is the entirety of `vercel.json`'s content — no rewrites, redirects, function config, or region pinning. The hosting migration spec confirms this was already minimal *before* the migration ("no meaningful Vercel-specific code (`@vercel/functions` is a declared dependency but unused; `vercel.json` has no special config beyond `{"framework": "nextjs"}`)," `docs/superpowers/specs/2026-07-10-azure-hosting-migration-design.md`). It is dead, unused configuration today — Vercel is not the deploy target (Container Apps is, per §5/§7), and per the migration's own exit criteria (one successful production deployment, verification passed, 7 days with no migration-related incidents from the 2026-07-10 cutover) Vercel was slated for decommissioning shortly after — but `vercel.json` and the unused `@vercel/functions` dependency in `package.json` were never removed from the tree. Harmless (Vercel-specific config that simply does nothing when deployed via Docker/Container Apps), but it is exactly the kind of small drift that accumulates when a migration's own cleanup step (deleting the old platform's config once the safety window passes) doesn't get a tracked follow-up task.

---

## 10. What would be required for genuinely enterprise-grade deployment

1. **A staging environment.** A second Container App (or App Service slot) + a second, narrower-scoped OIDC federated credential (`ref:refs/heads/staging` instead of `main`) + a workflow trigger split (PR → staging deploy + smoke test; merge to `main` → production deploy) would close §5.1's single biggest gap. The Data+Storage spec already names this exact trigger ("Can be revisited if/when a second environment (staging) is needed") — it's a recognized, deferred decision, not an unconsidered one.
2. **A TEST step in `deploy-azure.yml`, gating the build.** At minimum: `npm ci && npx tsc --noEmit && npm run lint` as a required job before `docker build` even starts — cheap to add today with zero new test-authoring required, and would have caught the exact class of "found by testing the real deployment, not caught by type-checking" issues the migration plans themselves report hitting live (the `trustHost: true` Auth.js issue, the `oid` vs `providerAccountId` UUID mismatch — both in `auth.ts`'s own comments). Layering in the actual test suite proposed in `13_TESTING.md` §4 is the deeper fix.
3. **Infrastructure as Code** (Bicep, given this is an all-Azure stack, or Terraform) — turning the `az` CLI commands scattered across five markdown plan files into a single, diffable, version-controlled source of truth for `quantalyze-prod-rg`'s contents. This would also have prevented §7's documentation-vs-reality drift: an IaC change from App Service to Container Apps would itself be the record of that migration, reviewable in a PR, rather than a change that happened somewhere outside this repo's tracked process entirely.
4. **Automated database migrations in CI/CD**, replacing §8's one-time cutover script with a real migration runner (even a minimal one — a small script that tracks applied-migration state in a `schema_migrations` table and applies any new `NNN_*.sql` file not yet recorded there, run as an explicit, reviewable CI/CD step before the new image is deployed) — with a documented rollback/down-migration story, which does not exist today in any form.
5. **A real health-gated deploy and rollback procedure**: a post-`az containerapp update` step that polls `/api/health` against the new revision specifically (Container Apps' revision-scoped URLs make this possible) before shifting 100% of traffic to it, plus a documented, ideally scripted, rollback command (`az containerapp revision activate --revision <previous>` / redeploy the prior commit SHA's already-pushed image) — turning §5.4's "the raw material for rollback exists by accident" into an actual, exercised procedure.
6. **Smoke/E2E tests run automatically against the newly deployed revision** before it's promoted to receive production traffic — the manual browser checklist in `docs/superpowers/plans/2026-07-10-azure-hosting-migration.md` Task 6/7 (login works, a data-bearing page loads, OAuth completes end-to-end) is exactly the right checklist; it is simply not automated, and per §5, not even *run* consistently today against the current Container Apps pipeline (it was written for, and executed once against, the now-superseded App Service target).
7. **A cleanup pass on confirmed-dead artifacts** — `vercel.json`, the unused `@vercel/functions` dependency, `lib/supabase/admin.ts` and every `Supabase*Repository` class (kept, per the auth-migration plan, only until a safety window ending 2026-07-20 — today's date per this review is 2026-09-01, well past that window, yet the code is still present in the tree), and the stray `/api/slack/command` reference in `next.config.mjs`'s `outputFileTracingIncludes` (§2) — none of these are urgent, but each is a small, easily-fixed piece of the same underlying pattern: this codebase does real migrations well but has no tracked follow-up mechanism to close out each migration's own named cleanup step once its safety window passes.
