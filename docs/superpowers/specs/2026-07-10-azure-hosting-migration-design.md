# Azure Hosting Migration — Design

## Context

This is the first of three independent Azure migration sub-projects (see `docs/superpowers/specs/2026-07-10-azure-data-storage-migration-design.md` for the full breakdown and rationale):

1. **Hosting** (this spec) — Vercel → Azure App Service. No application changes.
2. **Data + Storage** (next, depends on this one) — Supabase Postgres/Storage → Azure Postgres/Blob. Repository-implementation swap only, per the pattern Plan A's repository interfaces were built for.
3. **Auth** (future, depends on neither) — Supabase Auth → an Azure identity product (Entra External ID or similar). Session/cookie changes, its own spec.

Hosting is sequenced first because the Data + Storage spec requires the app to already be running on Azure compute, so the new Postgres server can use private/VNet networking from day one instead of a temporary public-access posture that would just be thrown away once hosting moved anyway.

This app currently deploys on Vercel: `next build`/`next start`, a live custom domain, no meaningful Vercel-specific code (`@vercel/functions` is a declared dependency but unused; `vercel.json` has no special config beyond `{"framework": "nextjs"}`). Almost every route runs on the Node.js runtime, not Edge — `pdf-parse` and `node-html-parser` are explicitly marked `serverComponentsExternalPackages` (real Node.js, not Edge-compatible), and `next.config.mjs` bundles local PDF assets into specific serverless functions via `outputFileTracingIncludes`. Only `/api/og/route.tsx` and the public-API `middleware.ts` are Edge-compatible; everything else needs a real Node runtime — which rules out Azure Static Web Apps (its Next.js SSR support is a restricted hybrid mode, historically awkward with Node-native packages like this app depends on).

## Scope

**In scope:**
- Provisioning an Azure App Service (Linux, Node.js runtime) in Central India (Pune) — same region planned for the Data + Storage spec's Postgres and Blob Storage, so they can share a VNet later without cross-region complexity.
- A GitHub Actions workflow that builds the app and deploys the built artifact to App Service, authenticating via OIDC federated credentials (no stored publish-profile secret).
- Enabling Next.js `output: "standalone"` mode for a smaller, more deterministic deployment artifact.
- Migrating environment variables to App Service Application Settings.
- Adding Application Insights for basic production observability (exceptions, response times, failed requests, availability).
- Adding a lightweight health-check endpoint for App Service's health check feature.
- A DNS-based cutover (the custom domain already in use today just repoints to App Service) and rollback plan.

**Out of scope (named, not built here):**
- **Any application code change beyond the two additions above** (`output: "standalone"` in `next.config.mjs`, the new health endpoint) — this migration doesn't touch routes, services, repositories, auth, or any business logic.
- **Data + Storage migration** — the app keeps talking to Supabase Postgres/Storage exactly as it does today. This spec only moves *where the app runs*, not what it talks to.
- **Auth migration** — Supabase Auth, unchanged.
- **Containerization/Docker** — App Service's Linux/Node runtime deploys from a built artifact directly; no Dockerfile is needed for this hosting choice.
- **Azure Key Vault** — App Service Application Settings (encrypted at rest, Azure-RBAC-controlled) is adequate for a single app's ~dozen secrets at this stage. Key Vault becomes more compelling with multiple apps/environments, secret rotation, or certificates — none of which apply yet. Named as a future enhancement, not built now.
- **Deployment slots** (staging slot + zero-downtime swap) — valuable once there's a real release cadence to protect, not needed for a single-environment pre-launch app. Named as the natural next evolution of this setup, not built now.
- **CDN/edge-caching changes** beyond whatever App Service provides by default.
- **Multi-region / high-availability App Service configuration** — single region, single instance tier is proportionate for a pre-launch app.

## Hosting invariants

The following must remain unchanged by this migration:
- Routes (`app/**/route.ts`, pages)
- Repository implementations (still Supabase-backed; untouched by this spec)
- Services (`lib/services/*`)
- Authentication (still Supabase Auth)
- Database schema and data (still Supabase; hosting migration never touches schema or data — that's the entire next spec's job)
- The storage the app talks to (still Supabase)
- The public API (`app/api/public/v1/*`, `middleware.ts`)

Only these change:
- Deployment target (Vercel → Azure App Service)
- CI/CD (Vercel's git-push-to-deploy → GitHub Actions)
- DNS (custom domain repoints)
- Runtime configuration (`next.config.mjs`'s `output: "standalone"`, new env var source, new health endpoint)

If a task in the eventual implementation plan touches anything outside that second list, it's out of scope for this migration and should be flagged, not built.

## Architecture

### App Service

Linux, Node.js runtime (exact version pinned during planning against the project's supported LTS Node version at the time of migration — not tied to whatever happens to be on a developer's local machine, which can move faster than Azure App Service's supported stack list), Central India (Pune), single instance tier sized for current pre-launch traffic with a documented upgrade path (exact SKU is a planning-level/cost decision, not fixed here).

### Build artifact

`next.config.mjs` gains `output: "standalone"`. This isn't required by App Service's Node runtime the way it would be for a Docker image, but it's adopted anyway: it produces a minimal, self-contained server bundle (only the files and dependencies actually needed at runtime, resolved via Next.js's own dependency tracing — the same tracing mechanism already relied on for `outputFileTracingIncludes`'s local PDF bundling), which means a smaller deployment, faster cold starts, and — importantly — no accidental runtime dependency on a local file that happens to exist in the dev/build environment but wasn't actually traced into the deployable artifact.

**GitHub Actions builds the application into Next.js standalone output and deploys the resulting runtime artifact to App Service** — that artifact is `.next/standalone` plus `.next/static` and `public/` copied alongside it (standalone mode doesn't include static assets by default; those two directories still need to travel with it), not literally just the standalone folder on its own. The workflow runs `npm ci && npm run build`, assembles those three pieces, then deploys via `azure/webapps-deploy`, authenticated through an OIDC federated credential (GitHub Actions ↔ Azure AD trust, short-lived tokens, no publish-profile secret stored in GitHub). App Service does not run its own build step (Oryx) — this keeps what's deployed exactly what CI built and tested, not a second, potentially different build performed at deploy time.

### Environment variables

The existing set (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`/`SECRET`, `SLACK_CLIENT_ID`/`SECRET`, `YOUTUBE_API_KEY`, etc. — unchanged by this migration, since Data + Storage and Auth haven't moved yet) is migrated into App Service's Application Settings. No new secrets are introduced by this spec.

### Observability

Application Insights is added from day one — not full Azure Monitor, just Application Insights, App Service's native lightweight APM. It gives exceptions, response times, failed-request tracking, availability, and log aggregation without any custom instrumentation code required (App Service's Node.js runtime supports auto-instrumentation via a connection string in Application Settings). This is proportionate now — cheap to add, and genuinely useful the moment the app has any real traffic, rather than something to retrofit later under pressure. **Request-level telemetry (the auto-instrumentation above) is sufficient scope for this migration; custom business metrics (e.g. instrumenting the analysis pipeline's own stages) are future work, not built here** — this migration is about hosting, not about deepening observability into application-specific logic.

### Health endpoint

A new route, `app/api/health/route.ts`, returns `200 OK` with a body of `{"status": "ok"}` for App Service's health check feature to poll — deliberately minimal, answering exactly one question: can Node answer HTTP requests? It does **not** check Supabase, the database, Storage, or the Gemini API — this migration doesn't change what the app depends on, and a health check that fails when an *external* dependency has a transient blip would cause App Service to needlessly recycle a perfectly healthy instance.

## Cutover procedure

1. Provision the App Service (Central India / Pune), set up the GitHub Actions OIDC trust.
2. Add `output: "standalone"` to `next.config.mjs` and the health endpoint; verify locally (`npm run build && npm run start`, confirm `/api/health` returns 200) and via `npx tsc --noEmit`.
3. Migrate environment variables into Application Settings.
4. Deploy via the GitHub Actions workflow to App Service's own `*.azurewebsites.net` URL (custom domain not yet repointed).
5. Verify App Service's startup logs show a successful boot (no missing env vars, no missing package, no startup crash) before doing anything else — this catches configuration problems while nothing is customer-facing yet.
6. Smoke-test directly against the `*.azurewebsites.net` URL: confirm the app loads, login works (still against Supabase Auth), a sample of existing routes return expected data, Application Insights is receiving telemetry.
7. Repoint the custom domain's DNS to App Service.
8. Verify against the custom domain once DNS propagates; confirm Google/Slack OAuth login still works (redirect URIs are domain-based and the domain hasn't changed, so no OAuth app config changes are expected — but this is verified live, not just assumed).
9. Vercel deployment is left in place, unused, for a short safety window (same exit criteria as the Data + Storage spec's safety window: one successful production deployment, verification passed, 7 days with no migration-related incidents) before being decommissioned.

## Rollback plan

1. Repoint the custom domain's DNS back to Vercel.
2. Verify the app is healthy on Vercel again (Vercel deployment was never touched, so this is immediate).
3. Investigate the App Service environment offline, without time pressure, now that the live app is back on the known-good Vercel path.

Because Vercel is never decommissioned until the safety window passes, rollback at any point before that is a DNS change, not a redeploy or data recovery operation.

## Testing

No automated test runner exists in this repo. Verification is `npx tsc --noEmit` for the two code changes (`next.config.mjs`, the health endpoint), plus the manual cutover checklist above (steps 6 and 8) run against both the pre-DNS-cutover `*.azurewebsites.net` URL and the post-cutover custom domain.

## Future extensions (named, not built here)

- **Deployment slots** — a staging slot with swap-based zero-downtime deploys is the natural next evolution once there's a real release cadence worth protecting against a bad deploy. Not needed for a single-environment pre-launch app.
- **Azure Key Vault** — for secret rotation, certificates, or once multiple apps/environments share infrastructure.
- **Containerization** — if the app's runtime needs ever outgrow what App Service's Node runtime offers, or if a future need for portability across non-Azure hosts arises, Azure Container Apps (Docker-based) is the natural next step. Not needed now.

## Open questions carried into planning

- Exact Node.js LTS version to pin on App Service, matched against Azure's currently-supported Linux Node stack list at provisioning time.
- Exact App Service Plan SKU/tier — a planning-level/cost decision, defaulting to the smallest tier that fits current pre-launch traffic with a documented upgrade path.
- Exact GitHub Actions workflow file structure and the specific `azure/webapps-deploy`/OIDC-login action versions to pin.
- Whether Application Insights auto-instrumentation covers everything useful out of the box, or whether a small number of custom trace points are worth adding for this app's specific pipeline/analysis routes — a planning-level judgment call once basic auto-instrumentation is live and its coverage can be assessed.
- Exact GitHub Actions trigger (push to `main`, manual dispatch, or a tag-based release trigger) — a planning-level workflow-design choice with no architectural impact.

Note on region co-location: Central India (Pune) is the target region for App Service, and (per the Data + Storage spec) for Postgres and Blob Storage — keeping all Azure-hosted pieces in one region avoids unnecessary cross-region latency. This app's AI provider (Google's Gemini API, via `@google/generative-ai`) is an external managed service outside Azure entirely, not something this migration can co-locate — its latency is unaffected by which Azure region hosts the app.
