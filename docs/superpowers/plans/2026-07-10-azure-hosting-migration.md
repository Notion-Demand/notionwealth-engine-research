# Azure Hosting Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Quantalyze's hosting from Vercel to Azure App Service (Linux, Node.js), with GitHub Actions CI/CD via OIDC, Application Insights observability, and a DNS-based cutover — with zero application-code changes beyond a build-output mode and a new health endpoint.

**Architecture:** GitHub Actions builds the Next.js app in standalone output mode and deploys the resulting artifact (`.next/standalone` + `.next/static` + `public/`) to an Azure App Service (Linux, Node.js runtime, Central India) via `azure/webapps-deploy`, authenticated through an OIDC federated credential (no stored secrets). Application Insights auto-instruments the running app. Cutover is a DNS repoint of the already-live custom domain; Vercel stays untouched as a rollback target through a safety window.

**Tech Stack:** Next.js 14.2.29 (`output: "standalone"`), Azure App Service (Linux, Node 22 LTS — Node 20 LTS had reached end-of-life and was no longer offered by Azure App Service at execution time, per this plan's own anticipated open question), Azure Application Insights, GitHub Actions, Azure CLI (`az`), GitHub CLI (`gh`).

## Global Constraints

- No application code changes beyond `next.config.mjs`'s `output: "standalone"` and the new `app/api/health/route.ts` — routes, services, repositories, auth, and the public API stay untouched (spec: Hosting invariants).
- No Dockerfile / containerization — App Service's Linux/Node runtime deploys from a built artifact directly (spec: Out of scope).
- No Azure Key Vault, no deployment slots — named future extensions, not built now (spec: Future extensions).
- Region: Central India (`centralindia`) for every Azure resource, to co-locate with the not-yet-built Data + Storage spec's Postgres/Blob Storage (spec: Architecture, Open questions).
- OIDC federated credential authentication for GitHub Actions → Azure — no publish-profile secret stored in GitHub (spec: Architecture, Build artifact).
- The deployed artifact is exactly what CI built and tested — App Service does not run its own build step (spec: Build artifact).
- Health endpoint is a shallow liveness check only — no Supabase, database, storage, or Gemini API calls (spec: Health endpoint).
- Application Insights: request-level auto-instrumentation only. No custom business-metric instrumentation (spec: Observability).
- Custom domain repoint for cutover — no OAuth redirect URI changes expected, but verified live, not assumed (spec: Cutover procedure).
- Vercel stays live, untouched, as the rollback target until the safety window passes: one successful production deployment + verification passed + 7 days with no migration-related incidents (spec: Cutover procedure, Rollback plan).
- No automated test runner exists in this repo. Verification is `npx tsc --noEmit` for code changes, plus the manual cutover checklist (spec: Testing).

---

### Task 1: Next.js standalone output + health endpoint

**Files:**
- Modify: `next.config.mjs`
- Create: `app/api/health/route.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `GET /api/health` → `200 { "status": "ok" }`, consumed by Task 6 (App Service health check config) and Task 7 (cutover smoke tests).

- [ ] **Step 1: Add standalone output mode**

Modify `next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  experimental: {
    // Include PDF files in the analyze route's serverless bundle
    outputFileTracingIncludes: {
      "/api/v1/analyze": [
        "./finance-agent/multiagent_analysis/all-pdfs/**",
      ],
      "/api/v1/available": [
        "./finance-agent/multiagent_analysis/all-pdfs/**",
      ],
      "/api/slack/command": [
        "./finance-agent/multiagent_analysis/all-pdfs/**",
      ],
    },
    // Prevent these Node-native packages from being bundled by webpack
    serverComponentsExternalPackages: ["pdf-parse", "node-html-parser"],
  },
};

export default nextConfig;
```

(Only the `output: "standalone"` line is new — everything else in this file is unchanged from today.)

- [ ] **Step 2: Add the health endpoint**

Create `app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}
```

- [ ] **Step 3: Build and verify locally**

Run: `npm run build`
Expected: build succeeds, and the build output log shows a line indicating standalone output was produced (Next.js prints a note about `node .next/standalone/server.js` being the way to start it in standalone mode).

Run: `node .next/standalone/server.js &` then `curl http://localhost:3000/api/health`
Expected: `{"status":"ok"}`. Stop the background process afterward (`kill %1` or equivalent).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add next.config.mjs app/api/health/route.ts
git commit -m "feat: add standalone output mode and health endpoint for Azure App Service"
```

---

### Task 2: Provision Azure App Service infrastructure

**Files:** none (infrastructure only — no files created or modified in this repo).

**Interfaces:**
- Consumes: an authenticated `az` CLI session (the human operator runs `az login` interactively before this task begins — this cannot be scripted or delegated, since it requires an interactive credential flow).
- Produces: a resource group, App Service Plan, and Web App, whose exact names are used verbatim by Task 3 (role assignment scope) and Task 4 (deploy target).

- [ ] **Step 1: Confirm authenticated session and capture subscription/tenant IDs**

Run: `az account show --query "{subscriptionId:id, tenantId:tenantId, name:name}" -o table`
Expected: shows the subscription and tenant you'll provision into. If this fails with a login error, stop and run `az login` first — do not proceed without a confirmed authenticated session.

- [ ] **Step 2: Create the resource group**

```bash
az group create \
  --name quantalyze-prod-rg \
  --location centralindia
```

Expected: JSON output with `"provisioningState": "Succeeded"`.

- [ ] **Step 3: Create the App Service Plan**

```bash
az appservice plan create \
  --name quantalyze-prod-plan \
  --resource-group quantalyze-prod-rg \
  --location centralindia \
  --is-linux \
  --sku B1
```

`B1` (Basic tier, smallest paid Linux tier with always-on support) is the starting size for a pre-launch app — cheap, easy to scale up later via `az appservice plan update --sku <bigger-tier>` with no redeployment needed. Expected: JSON output with `"provisioningState": "Succeeded"`.

- [ ] **Step 4: Create the Web App**

```bash
az webapp create \
  --name quantalyze-app \
  --resource-group quantalyze-prod-rg \
  --plan quantalyze-prod-plan \
  --runtime "NODE:20-lts"
```

If this fails with a name-conflict error (the `*.azurewebsites.net` namespace is global across all Azure customers), retry with a suffix, e.g. `quantalyze-app-prod`, and use that name consistently in every later task and command in this plan instead of `quantalyze-app`.

Expected: JSON output including `"defaultHostName": "quantalyze-app.azurewebsites.net"` (or your chosen suffixed name).

- [ ] **Step 5: Enable "Always On" (prevents the app from unloading during idle periods, which would otherwise cause a cold start on health-check pings)**

```bash
az webapp config set \
  --name quantalyze-app \
  --resource-group quantalyze-prod-rg \
  --always-on true
```

- [ ] **Step 6: Configure the App Service's health check path**

```bash
az webapp config set \
  --name quantalyze-app \
  --resource-group quantalyze-prod-rg \
  --generic-configurations '{"healthCheckPath": "/api/health"}'
```

- [ ] **Step 7: Verify the app responds (still the default placeholder page — no code deployed yet)**

```bash
curl -i https://quantalyze-app.azurewebsites.net
```

Expected: `HTTP/1.1 200` (Azure's default "app is starting/placeholder" page — this confirms the Web App itself is reachable before any deployment).

No commit for this task — record the exact resource group, plan, and web app names chosen (in case a suffix was needed) somewhere visible for the next task's operator, e.g. as a comment in the PR description or a note to the team.

---

### Task 3: GitHub Actions OIDC trust + repository secrets

**Files:** none (Azure AD + GitHub repository configuration only).

**Interfaces:**
- Consumes: the resource group name from Task 2 (`quantalyze-prod-rg`, or your suffixed equivalent) for scoping the role assignment.
- Produces: three GitHub repository secrets — `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` — consumed by Task 4's workflow YAML (`azure/login@v2` step).

- [ ] **Step 1: Create the Azure AD app registration**

```bash
AZURE_CLIENT_ID=$(az ad app create --display-name "quantalyze-github-oidc" --query appId -o tsv)
echo "AZURE_CLIENT_ID=$AZURE_CLIENT_ID"
```

Expected: a GUID printed. Keep this shell session open — the following steps reuse `$AZURE_CLIENT_ID`.

- [ ] **Step 2: Create the service principal for the app**

```bash
az ad sp create --id "$AZURE_CLIENT_ID"
```

Expected: JSON output describing the new service principal.

- [ ] **Step 3: Capture subscription and tenant IDs**

```bash
AZURE_SUBSCRIPTION_ID=$(az account show --query id -o tsv)
AZURE_TENANT_ID=$(az account show --query tenantId -o tsv)
echo "AZURE_SUBSCRIPTION_ID=$AZURE_SUBSCRIPTION_ID"
echo "AZURE_TENANT_ID=$AZURE_TENANT_ID"
```

- [ ] **Step 4: Create the federated credential scoped to this repo's main branch**

```bash
az ad app federated-credential create \
  --id "$AZURE_CLIENT_ID" \
  --parameters '{
    "name": "github-main-branch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:Notion-Demand/notionwealth-engine-research:ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

This scopes the trust narrowly: only a GitHub Actions run triggered from a push to `main` in this exact repository can exchange a token for Azure access — not any workflow, not any branch, not any fork.

- [ ] **Step 5: Assign Contributor role, scoped to the resource group only (not the whole subscription)**

```bash
az role assignment create \
  --assignee "$AZURE_CLIENT_ID" \
  --role "Contributor" \
  --scope "/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/quantalyze-prod-rg"
```

Scoping to the resource group (rather than the subscription) means this credential can only affect resources inside `quantalyze-prod-rg` — it has no reach into any other project or resource on the same Azure subscription.

- [ ] **Step 6: Push the three values as GitHub repository secrets**

```bash
gh secret set AZURE_CLIENT_ID --body "$AZURE_CLIENT_ID" --repo Notion-Demand/notionwealth-engine-research
gh secret set AZURE_TENANT_ID --body "$AZURE_TENANT_ID" --repo Notion-Demand/notionwealth-engine-research
gh secret set AZURE_SUBSCRIPTION_ID --body "$AZURE_SUBSCRIPTION_ID" --repo Notion-Demand/notionwealth-engine-research
```

- [ ] **Step 7: Verify the secrets were set**

```bash
gh secret list --repo Notion-Demand/notionwealth-engine-research
```

Expected: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` all listed (values are never shown by `gh secret list`, only names and update timestamps — this is expected, not a gap).

No commit for this task — nothing in this repo's tracked files changes.

---

### Task 4: GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/deploy-azure.yml`

**Interfaces:**
- Consumes: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` GitHub secrets (Task 3); the Web App name from Task 2 (`quantalyze-app`); the standalone build output structure from Task 1.
- Produces: nothing consumed by later tasks in this repo — this workflow is what Task 6/7 trigger to actually deploy.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/deploy-azure.yml`:

```yaml
name: Deploy to Azure App Service

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Assemble standalone deployment package
        run: |
          mkdir -p deploy
          cp -r .next/standalone/. deploy/
          mkdir -p deploy/.next
          cp -r .next/static deploy/.next/static
          cp -r public deploy/public

      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy to Azure App Service
        uses: azure/webapps-deploy@v3
        with:
          app-name: quantalyze-app
          package: deploy
```

(If Task 2 needed a suffixed Web App name, use that same name in place of `quantalyze-app` in the `Deploy to Azure App Service` step above.)

- [ ] **Step 2: Verify the YAML is well-formed**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-azure.yml'))" && echo "valid YAML"`
Expected: `valid YAML` printed, no exception. (This only validates syntax, not that the workflow will actually succeed on GitHub's runners — that's verified live in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-azure.yml
git commit -m "feat: add GitHub Actions workflow to deploy to Azure App Service via OIDC"
```

---

### Task 5: Environment variables + Application Insights

**Files:** none (Azure resource configuration only).

**Interfaces:**
- Consumes: the App Service name/resource group from Task 2; the current secret values from `.env.local` (read locally, never committed or printed to logs).
- Produces: App Service Application Settings populated, consumed by the deployed app at runtime starting in Task 6; an Application Insights connection string, also set as an Application Setting.

- [ ] **Step 1: Read the current environment variable names (not values) to confirm the full list**

Run: `grep -oE "^[A-Z_0-9]+=" .env.local`
Expected output (already confirmed during spec brainstorming, re-verify it hasn't changed): `NEXT_PUBLIC_SUPABASE_URL=`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=`, `SUPABASE_SERVICE_ROLE_KEY=`, `NEXT_PUBLIC_API_URL=`, `GOOGLE_CLIENT_ID=`, `GOOGLE_CLIENT_SECRET=`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID=`, `SLACK_CLIENT_ID=`, `SLACK_CLIENT_SECRET=`, `NEXT_PUBLIC_SLACK_CLIENT_ID=`, `YOUTUBE_API_KEY=`.

- [ ] **Step 2: Set each one as an App Service Application Setting**

Run this once per variable, substituting the real value from your local `.env.local` for `<value>` (do this interactively in your own terminal — never paste real secret values into a shared chat, log, or commit):

```bash
az webapp config appsettings set \
  --name quantalyze-app \
  --resource-group quantalyze-prod-rg \
  --settings NEXT_PUBLIC_SUPABASE_URL="<value>"
```

Repeat for each of the eleven variables listed in Step 1. Multiple `--settings key=value` pairs can be passed in one call if preferred:

```bash
az webapp config appsettings set \
  --name quantalyze-app \
  --resource-group quantalyze-prod-rg \
  --settings \
    NEXT_PUBLIC_SUPABASE_URL="<value>" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="<value>" \
    SUPABASE_SERVICE_ROLE_KEY="<value>" \
    NEXT_PUBLIC_API_URL="<value>" \
    GOOGLE_CLIENT_ID="<value>" \
    GOOGLE_CLIENT_SECRET="<value>" \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID="<value>" \
    SLACK_CLIENT_ID="<value>" \
    SLACK_CLIENT_SECRET="<value>" \
    NEXT_PUBLIC_SLACK_CLIENT_ID="<value>" \
    YOUTUBE_API_KEY="<value>"
```

- [ ] **Step 3: Verify the settings were applied (names only, values are not printed by default with this query)**

```bash
az webapp config appsettings list \
  --name quantalyze-app \
  --resource-group quantalyze-prod-rg \
  --query "[].name" -o tsv
```

Expected: all eleven names from Step 1 listed.

- [ ] **Step 4: Create the Application Insights resource**

```bash
az monitor app-insights component create \
  --app quantalyze-appinsights \
  --location centralindia \
  --resource-group quantalyze-prod-rg \
  --application-type web
```

Expected: JSON output including a `connectionString` field — copy it for the next step.

- [ ] **Step 5: Wire the connection string into the App Service so Node auto-instrumentation activates**

```bash
APPINSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show \
  --app quantalyze-appinsights \
  --resource-group quantalyze-prod-rg \
  --query connectionString -o tsv)

az webapp config appsettings set \
  --name quantalyze-app \
  --resource-group quantalyze-prod-rg \
  --settings \
    APPLICATIONINSIGHTS_CONNECTION_STRING="$APPINSIGHTS_CONNECTION_STRING" \
    ApplicationInsightsAgent_EXTENSION_VERSION="~3"
```

`ApplicationInsightsAgent_EXTENSION_VERSION="~3"` is what enables App Service's built-in Node.js auto-instrumentation extension — with this and the connection string set, no code changes are needed for request-level telemetry (exceptions, response times, failed requests) to start flowing.

No commit for this task — nothing in this repo's tracked files changes.

---

### Task 6: Deploy and verify on the Azure-provided URL (pre-DNS-cutover)

**Files:** none.

**Interfaces:**
- Consumes: everything from Tasks 1–5 (code, infra, secrets, workflow).
- Produces: a confirmed-healthy deployment on `https://quantalyze-app.azurewebsites.net`, gating Task 7's DNS cutover.

- [ ] **Step 1: Trigger the deploy**

```bash
git push origin main
```

(If Tasks 1–4's commits haven't already been pushed as part of normal development flow, push now — this is what triggers `.github/workflows/deploy-azure.yml`.)

- [ ] **Step 2: Watch the workflow run**

```bash
gh run watch --repo Notion-Demand/notionwealth-engine-research
```

Expected: the workflow completes with a green checkmark. If it fails, read the failed step's log (`gh run view --repo Notion-Demand/notionwealth-engine-research --log-failed`) before proceeding — do not retry blindly.

- [ ] **Step 3: Verify App Service's startup logs show a successful boot**

```bash
az webapp log tail --name quantalyze-app --resource-group quantalyze-prod-rg &
sleep 30
kill %1
```

Expected: log output showing the Node process starting and listening (no "missing module," no unhandled exception, no repeated restart loop). This is checked *before* any customer-facing traffic is at risk — catches missing env vars or a broken build before Task 7's DNS cutover.

- [ ] **Step 4: Smoke-test the health endpoint**

```bash
curl -i https://quantalyze-app.azurewebsites.net/api/health
```

Expected: `HTTP/1.1 200` with body `{"status":"ok"}`.

- [ ] **Step 5: Smoke-test the app itself**

```bash
curl -i https://quantalyze-app.azurewebsites.net
```

Expected: `HTTP/1.1 200`, HTML body (the app's actual home page, not Azure's placeholder page from Task 2 Step 7 — confirms the real deployment is serving, not the pre-deploy default).

Manually, in a browser, visit `https://quantalyze-app.azurewebsites.net` and confirm: the login page loads, logging in with an existing account works (still against Supabase Auth — unchanged by this migration), and at least one data-bearing page (e.g. the dashboard or screener) loads with real data.

- [ ] **Step 6: Confirm Application Insights is receiving telemetry**

```bash
az monitor app-insights query \
  --app quantalyze-appinsights \
  --resource-group quantalyze-prod-rg \
  --analytics-query "requests | take 5"
```

Expected: at least one row, reflecting the requests made in Steps 4–5 (may take a minute or two to appear after the requests were made — retry if empty on the first attempt).

No commit for this task.

---

### Task 7: DNS cutover and final verification

**Files:** none (DNS provider configuration only — exact steps depend on which DNS provider hosts the custom domain, which isn't part of this repo).

**Interfaces:**
- Consumes: the confirmed-healthy deployment from Task 6.
- Produces: the live custom domain serving from Azure App Service instead of Vercel.

- [ ] **Step 1: Add the custom domain to the App Service (before changing DNS)**

```bash
az webapp config hostname add \
  --webapp-name quantalyze-app \
  --resource-group quantalyze-prod-rg \
  --hostname <your-custom-domain>
```

This will likely fail on the first attempt with a domain-verification error — Azure requires a TXT or CNAME record proving ownership before it accepts the hostname binding. Follow the specific verification record Azure's error message requests (add it at your DNS provider), wait for propagation, then retry this command.

- [ ] **Step 2: Enable HTTPS for the custom domain**

```bash
az webapp config ssl create \
  --resource-group quantalyze-prod-rg \
  --name quantalyze-app \
  --hostname <your-custom-domain>
```

Follow with binding the resulting certificate thumbprint via `az webapp config ssl bind` per the command's own output — Azure App Service supports free managed certificates for custom domains, which is the simplest path unless you have a specific reason to bring your own certificate.

- [ ] **Step 3: Repoint DNS**

At your DNS provider (not part of this repo — whichever registrar/DNS host manages the custom domain today), change the record currently pointing at Vercel to instead point at `quantalyze-app.azurewebsites.net` (typically a CNAME record; Azure App Service's own documentation for your exact record type is authoritative here since it depends on whether this is an apex/root domain or a subdomain).

- [ ] **Step 4: Wait for DNS propagation, then verify**

```bash
dig +short <your-custom-domain>
```

Expected: resolves to an Azure IP / CNAME chain ending in `azurewebsites.net`, not Vercel's IPs. Propagation can take anywhere from minutes to a few hours depending on the previous record's TTL.

- [ ] **Step 5: Full verification against the custom domain**

```bash
curl -i https://<your-custom-domain>/api/health
```

Expected: `HTTP/1.1 200`, `{"status":"ok"}`.

Manually, in a browser: visit the custom domain, confirm the app loads, and **specifically test both Google and Slack OAuth login end-to-end** — this is the one place a domain-based assumption (that redirect URIs don't need updating) gets verified live rather than just assumed. If either OAuth flow fails with a redirect-URI-mismatch error, that specific OAuth app's configuration needs a matching update in the Google Cloud Console / Slack App settings before this step can pass.

- [ ] **Step 6: Record the start of the safety window**

Note the date and time of this successful cutover somewhere the team can reference (a comment in this plan file, a note in the team's usual tracking location, etc.) — the exit criteria for decommissioning Vercel is one successful production deployment (satisfied by this task), verification passed (satisfied by Step 5), and 7 days with no migration-related incidents starting from this point.

- [ ] **Step 7: Commit the safety-window note (optional, if tracked in this repo)**

If you choose to track the safety-window start date in this repository (e.g., appending a line to this plan file), commit it:

```bash
git add docs/superpowers/plans/2026-07-10-azure-hosting-migration.md
git commit -m "docs: record Azure hosting cutover completion date for safety-window tracking"
```

---

## Rollback Procedure (contingency — not part of the normal task sequence)

If Task 6 or Task 7 reveals a problem after the custom domain has already been repointed:

1. Repoint the custom domain's DNS record back to Vercel's original target.
2. Verify the app is healthy on Vercel again (Vercel was never touched by Tasks 1–7, so this should be immediate once DNS re-propagates).
3. Investigate the App Service environment offline, without time pressure, now that the live app is back on the known-good Vercel path — re-run Task 6's verification steps against `https://quantalyze-app.azurewebsites.net` directly (bypassing DNS) to debug.

Because Vercel is never decommissioned by this plan (that only happens after the 7-day safety window from Task 7 Step 6, as a separate, later action outside this plan's scope), rollback at any point is a DNS change, not a redeploy or data recovery operation.

## Self-Review Notes

**Spec coverage:** App Service provisioning (Task 2) ✓. GitHub Actions + OIDC (Tasks 3–4) ✓. Standalone output + health endpoint (Task 1) ✓. Environment variables (Task 5) ✓. Application Insights, request-level only (Task 5) ✓. DNS-based cutover (Task 7) ✓. Startup-log verification before DNS (Task 6, Step 3) ✓. Hosting invariants (no route/service/repository/auth/schema/storage/public-API changes) — none of Tasks 1–7 touch any of those ✓. Rollback plan (DNS repoint back to Vercel, Vercel untouched throughout) — implicitly satisfied by Task 7's design (Vercel is never decommissioned in this plan; that's explicitly a follow-up action after the 7-day safety window, outside this plan's scope) ✓. Non-goals (no Docker, no Key Vault, no deployment slots, no multi-region) — none appear anywhere in this plan ✓.

**Placeholder scan:** `<value>`, `<your-custom-domain>` are legitimate runtime-supplied values (a real secret, a real domain name this plan can't know in advance) with clear instructions for what to substitute — not vague "TBD" placeholders. No other placeholder patterns found.

**Type consistency:** The health endpoint's response shape (`{ "status": "ok" }`) is defined once in Task 1 and referenced identically in Task 2 (health check path config), Task 6 (smoke test), and the spec's own Health endpoint section. The App Service name (`quantalyze-app`) and resource group (`quantalyze-prod-rg`) are introduced in Task 2 and used identically in every subsequent task's commands — with an explicit note wherever a name might need to change (webapp name conflict) to keep later tasks consistent if that happens.

## Execution Record

All 7 tasks completed 2026-07-10. Resource names used exactly as planned, no webapp-name conflict encountered. Deviations from the written plan, discovered during execution:

- **Node version**: Azure App Service's Linux Node stack no longer offers `20-lts` (Node 20 LTS reached end-of-life) — only `22-lts` and `24-lts` were available. Used `22-lts` throughout (App Service runtime, GitHub Actions `setup-node`), which happens to match this machine's local Node version. This was the plan's own anticipated open question ("Exact Node.js LTS version to pin... matched against Azure's currently-supported Linux Node stack list at provisioning time"), resolved at execution time as expected.
- **GitHub Actions push required the `workflow` OAuth scope**: the initial `git push origin main` (containing a new `.github/workflows/*.yml` file) was rejected because the local `gh`-backed git credential only had `gist`, `read:org`, `repo` scopes. Fixed via `gh auth refresh -h github.com -s workflow` (an interactive device-code approval, done by the human operator) before retrying the push successfully.
- **App Service 503 "Application Error" on first deploy, not anticipated by the plan**: the standalone bundle's `package.json` (copied verbatim from the source repo by Next.js's own standalone-output process) retains `"start": "next start"`. Azure App Service's default Node startup runs `npm start`, which tries to run the full Next.js CLI — something the trimmed-down standalone bundle deliberately doesn't include the dependencies for. Fixed with an explicit App Service startup command: `az webapp config set ... --startup-file "node server.js"`, bypassing `package.json`'s scripts entirely and running the standalone bundle's actual entry point directly. Confirmed via a clean restart + stable `200` responses on both `/api/health` and `/`. This is worth carrying forward as an explicit plan step if this app is ever redeployed to a fresh App Service instance.
- **Managed SSL certificate ordering**: the plan's Task 7 Steps 1–3 (add hostname → enable SSL → repoint DNS) don't work in that order in practice — Azure's managed-certificate issuance requires the DNS to already resolve to Azure first (it validates domain control over live HTTP traffic), so the actual working order was: add hostname + TXT record for ownership verification → repoint the A record → *then* request the managed certificate. This created a brief (under two minutes, in practice) window where `https://quantalyze.me` could show a certificate mismatch (serving Azure's default `*.azurewebsites.net` wildcard cert) before the `quantalyze.me`-specific managed certificate finished propagating — acceptable given no live users yet, confirmed with the user before flipping DNS.
- **Apex domain on GoDaddy needs two A records**, not a single IP: Azure App Service's managed-certificate validation specifically required both `20.192.171.16` and `20.192.171.17` present as separate A records for the same `@` host — a single-IP A record was rejected as "missing one DNS record."

**Safety window**: cutover completed and fully verified (health endpoint, Application Insights telemetry, live OAuth login via Google/Slack against `https://quantalyze.me`) on 2026-07-10. Per the plan's exit criteria, Vercel should be decommissioned no earlier than 2026-07-17 (7 days with no migration-related incidents), and only after re-confirming the other two criteria (successful production deployment, verification passed) still hold at that time.

## Post-completion addendum: VNet integration (2026-07-10)

Added after this plan's 7 tasks were done, as a prerequisite discovered while starting to plan the Data + Storage migration: that spec assumed App Service would already have VNet integration in place for private Postgres access, but nothing in this Hosting plan's original scope required a VNet. Closed the gap rather than revise the Data + Storage spec:

- Created `quantalyze-prod-vnet` (address space `10.0.0.0/16`) in `quantalyze-prod-rg`, Central India, with a subnet `appservice-integration-subnet` (`10.0.1.0/24`) delegated to `Microsoft.Web/serverFarms`.
- Ran `az webapp vnet-integration add` to connect `quantalyze-app` to that subnet (regional VNet integration — outbound traffic from the app can now reach resources in this VNet privately; this doesn't affect inbound traffic/availability).
- This triggers an app restart — confirmed via a brief window of `503`s (~60–90 seconds) followed by stable `200`s on `/api/health`, consistent with expected VNet-integration restart behavior, not a regression.

This VNet and subnet are what the Data + Storage spec's Postgres Flexible Server should be provisioned into (or peered with) for private-only access, once that plan is written.
