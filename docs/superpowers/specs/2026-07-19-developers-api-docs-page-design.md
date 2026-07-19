# Developers API Docs Page Design

## Context

Quantalyze already has a working Public API layer (built in an earlier "Services + Public API" project): three endpoints under `/api/public/v1/*`, gated by `middleware.ts` via a `Bearer <api-key>` header (SHA-256 hash lookup against `apiAccessRepo`), with responses shaped by a dedicated contract layer (`lib/api-contracts/v1/*`) that translates internal domain entities into clean, versioned, camelCase response shapes — no internal table/repository/entity names are ever exposed. This layer already satisfies "don't expose the internal system" by construction; it has simply never been documented publicly.

Zero API partners/keys are currently provisioned in production (confirmed empty during the Auth migration's testing) — this is a pre-launch product surface, not yet in active use by any real integration.

## Goal

A public-facing developer documentation page so prospective API partners can see what the API does and how to use it, without needing to be handed anything privately first.

## Non-Goals

- No self-serve API key signup or account creation flow — key provisioning stays manual (unchanged from today).
- No interactive "try it now" API console — a static reference page only.
- No new API endpoints, no changes to `middleware.ts`, `lib/api-contracts/v1/*`, or any existing route handler. This is a documentation-only project; the API itself is out of scope.
- No changes to the main landing page's structure beyond adding one footer link.

## Architecture

**New page**: `app/developers/page.tsx` — a public, unauthenticated Next.js page (no session check, matching `app/page.tsx`'s public accessibility). Written as a single, self-contained file, following this codebase's existing convention for marketing pages (`app/page.tsx` itself is ~355 lines with no extracted sub-components) rather than introducing a new componentization pattern.

**Navigation**: one new link, "API Docs", added to `app/page.tsx`'s existing footer, alongside the current Privacy/Terms links. The top header nav (Book a Demo / Sign in) is left unchanged — API docs are a narrower audience than the primary investor-facing nav.

**Content grounding**: every endpoint, parameter, and example response documented on the page is pulled directly from the real, already-shipped contract types (`CompanyResponseV1` in `lib/api-contracts/v1/company.ts`, `SectorResponseV1` in `lib/api-contracts/v1/sector.ts`, `SectorThesisResponseV1` in `lib/api-contracts/v1/sectorThesis.ts`) and the real auth/error behavior in `middleware.ts`. This is a documentation task, not a design task — the API surface being documented already exists and is not being changed.

## Page Sections

1. **Intro** — Short, direct framing in the same brand voice as the existing marketing copy (confident, no-fluff — matching the tone of `canva/Demandion_Quantalyze_Video_Scripts.pdf`): what the API is, who it's for, that it's the same underlying intelligence the product itself runs on.

2. **Authentication** — `Authorization: Bearer <api-key>` header requirement. Documents the real behavior from `middleware.ts`: missing/malformed header → 401, invalid/inactive key → 401, key valid but not entitled to the requested product → 403 (with the real error message format: `"key is not entitled to '<product>' — contact us to add this product"`).

3. **Endpoints** — one block per endpoint, each with: HTTP method + path, path/query parameters, a `curl` example using the placeholder `YOUR_API_KEY` for the key and `RELIANCE` as the example ticker / `IT` as the example sector (consistent across all three endpoint examples), and an example JSON response built field-by-field from the real response contract, populated with illustrative placeholder values in the correct shape and types (not real proprietary analysis content):
   - `GET /api/public/v1/data/companies/RELIANCE` — `CompanyResponseV1` shape (ticker, quarter, quarterPrevious, overallSignal, overallScore, summary, keyMetrics, earningsDelta, generatedAt).
   - `GET /api/public/v1/data/sectors/IT` — `SectorResponseV1` shape (sector, sectorLabel, quarter, companyCount, dimensions[], narrative, generatedAt).
   - `GET /api/public/v1/products/sector-thesis?sector=IT` — `SectorThesisResponseV1` shape (sector, sectorLabel, quarter, quarterPrevious, companyCount, narrative, dimensions[], topCompanies[], generatedAt).

4. **Rate limits** — described generically: each API key has a daily request quota set per partner; exceeding it returns 429 with `{ "error": "daily rate limit exceeded" }` (the real message from `middleware.ts`). No specific numeric quota is hardcoded on the page, since quota is configured per-partner, not a fixed platform-wide number.

5. **Errors** — the uniform `{ "error": string }` response shape used across all three endpoints, plus a table of the real status codes each endpoint can return: 400 (bad request — e.g. missing required query param), 401 (missing/invalid/inactive key), 403 (not entitled to this product), 404 (no data available for the given ticker/sector), 429 (rate limit exceeded), 500 (internal error).

6. **Get API access** — a CTA section linking to the existing Calendly link (`https://calendly.com/quantalyze/say-hi`), the same one already used for "Book a Demo" elsewhere on the site, since there is no self-serve signup.

## Testing

Since this is a static content page with no new backend logic: verify the page builds and renders (`npm run build` / dev server), verify the footer link navigates correctly, and manually cross-check every documented field name, parameter, and status code against the real source files listed above (contract types + `middleware.ts`) to ensure the docs cannot drift from the real, live API behavior.
