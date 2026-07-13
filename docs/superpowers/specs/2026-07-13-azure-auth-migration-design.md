# Azure Auth Migration Design

**Status:** Approved, ready for implementation planning.

## Context

Quantalyze's database and file storage were already migrated from Supabase to Azure (Postgres Flexible Server + Blob Storage; see `2026-07-10-azure-data-storage-migration-design.md`). Authentication is the last Supabase-dependent subsystem. This spec covers replacing Supabase Auth entirely with Microsoft Entra External ID, across both the Next.js frontend and the FastAPI backend (`finance-agent/`).

This is a standalone sub-project, independent of the Hosting and Data+Storage migrations already completed.

## Goals

- Replace Supabase Auth (session issuance, JWT validation, OAuth handling) with Microsoft Entra External ID.
- Preserve both existing login methods: email/password and Google sign-in.
- Preserve the current invite-only, admin-driven onboarding model (today implemented as a post-login `ALLOWED_EMAILS` check; moves to being enforced at the identity-provider level instead).
- Update the FastAPI backend's independent JWT verification to trust Entra-issued tokens instead of Supabase-issued ones (mandatory — the integration breaks otherwise, not a nice-to-have).

## Non-Goals

- No migration of existing Supabase Auth user accounts, passwords, or sessions. Fresh start — the current user base is small enough (early-stage enterprise pilot) that everyone is re-invited under the new system.
- No in-app admin UI for creating users. Onboarding a new customer means creating them directly in the Entra admin center (Azure Portal); Entra sends the invitation/credentials email.
- No changes to the Gemini Flash API integration. Quantalyze uses Google in two unrelated ways: Google OAuth (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, used only for sign-in) and the Gemini Flash API (`GEMINI_API_KEY`, used only for transcript-analysis inference). This migration touches only the former. The Gemini integration, its API key, and its call sites remain completely unchanged.
- No changes to `middleware.ts`'s existing partner API-key gating (`/api/public/:path*`). That guards the Public API with a `Bearer <api-key>` + SHA-256 hash lookup and is unrelated to user authentication.
- No changes to the Data + Storage migration's remaining cleanup (deleting the now-unused `SupabaseXRepository` classes and `lib/supabase/admin.ts`) — that has its own separate 7-day safety window ending 2026-07-20, tracked in that migration's own plan document.

## Architecture

- **Identity platform**: a Microsoft Entra External ID tenant (Azure's hosted consumer/customer identity platform, CIAM), with one app registration for Quantalyze.
- **Sign-in model**: a "sign-in only" Entra user flow (not "sign-up and sign-in") — Entra rejects any login attempt for which no account already exists, for both login methods. This is what implements invite-only access; there is no self-registration path anywhere.
- **Login methods**: local email/password accounts native to Entra, plus Google configured as a federated identity provider *inside* Entra (the existing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are entered once into the Azure Portal's Entra identity-provider settings). Entra performs the Google OAuth exchange internally; application code never talks to Google's OAuth endpoints directly anymore.
- **OAuth redirect flow**: standard Entra-hosted redirect (browser → Entra's hosted login domain → federates to Google if that option is chosen → redirects back to the app with a token). The existing custom "talk to Google directly, bypass third-party auth domains" flow (built to route around Indian ISPs blocking `*.supabase.co`) is retired — Microsoft's domain is not known to be subject to the same targeted blocking, and the standard flow is far simpler to build and maintain.
- **Onboarding a new customer**: create the user in the Entra admin center (email + temporary password, or an invitation-link flow — Entra supports both natively), Entra emails them, they sign in. No in-app admin UI.
- **Password reset**: Entra's built-in self-service password reset (SSPR), configured once at the tenant level — replaces the app's custom `app/auth/reset-callback/route.ts` / `app/auth/reset-password/page.tsx` pages entirely.
- **Session issuance/validation in Next.js**: Auth.js (`next-auth`) with its built-in Microsoft Entra provider, using JWT-based sessions (Auth.js's default — no new database session table). Auth.js handles the OIDC redirect flow, PKCE, token refresh, and session cookies.
- **Session validation in FastAPI**: RS256 + JWKS verification against Entra's public signing keys, replacing the current HS256 + shared-secret (`SUPABASE_JWT_SECRET`) verification.

## Next.js Changes

**Remove** (Supabase-specific auth code, made obsolete):
- `app/api/v1/auth/route.ts` (email/password signin/signup/reset proxy)
- `app/api/v1/auth/google-start/route.ts`, `app/api/v1/auth/google-callback/route.ts` (custom direct-to-Google OAuth bypass)
- `app/auth/callback/route.ts` (classic Supabase OAuth PKCE callback)
- `app/auth/reset-callback/route.ts`, `app/auth/reset-password/page.tsx` (custom password reset flow)
- `lib/supabase/server.ts`, `lib/supabase/client.ts` (SSR cookie-based Supabase clients) — confirmed used only for auth today; the Data+Storage migration already moved `WatchlistRepository` off the RLS/request-scoped-client pattern, so nothing else depends on these.

**Keep for now**: `lib/supabase/admin.ts` — still used by the currently-idle `SupabaseXRepository` classes until their own separate safety window ends (2026-07-20). Not part of this migration's cleanup.

**Add**: Auth.js wired to the Entra app registration via its Microsoft Entra provider and standard App Router route handler.

**Update**: all 13 call sites currently using `supabase.auth.getUser()`/`getSession()`:
- Server Components doing redirect gates (`app/page.tsx`, `app/sectors/page.tsx`, `app/screener/page.tsx`, `app/kpis/page.tsx`, `app/dashboard/page.tsx`, `app/request/page.tsx`) → Auth.js's `auth()` helper.
- API routes returning 401 (`app/api/v1/user-tickers/route.ts` ×3, `app/api/v1/request/route.ts`) → Auth.js session check + 401.
- Client-side session reads (`lib/api.ts`, `components/Nav.tsx`) → Auth.js client-side session hooks.
- `app/login/LoginClient.tsx` simplifies to Auth.js's `signIn("microsoft-entra-id")` for both the email/password and Google options.

**Remove**: the `ALLOWED_EMAILS` env var and its app-level allowlist check — gating now happens entirely at the Entra sign-in-only user flow.

## FastAPI Backend Changes

`finance-agent/api/auth.py` already exposes a reusable `get_current_user()` dependency, used via `Depends(get_current_user)` across `connections.py`, `gmail.py`, and `analyze.py`. This migration changes only that function's internals, not its signature or call sites:

- **Before**: `jose.jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], audience="authenticated")`, extracting `sub` as the user identifier.
- **After**: fetch and cache Entra's JWKS (public signing keys) from its discovery endpoint, verify the token's signature against them (RS256), validate `iss` (Entra's issuer URL) and `aud` (the Entra app registration's client ID), and extract the user identifier from Entra's `sub`/`oid` claim.

Every authenticated call from `lib/api.ts` to the FastAPI backend carries this token as `Authorization: Bearer <token>`; once Next.js issues Entra tokens instead of Supabase tokens, this backend-side change is mandatory for those calls to keep working at all.

## Environment Variables

**Next.js (`quantalyze-app`)**:
- Remove: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `ALLOWED_EMAILS`.
- Keep for now: `SUPABASE_SERVICE_ROLE_KEY` (still consumed by `lib/supabase/admin.ts` until its own safety window ends).
- Add: `AUTH_SECRET` (Auth.js's session-signing secret), `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_ISSUER` (Auth.js's expected env var names for its Entra provider).

**FastAPI backend (`finance-agent/`)**:
- Remove: `SUPABASE_JWT_SECRET`.
- Add: `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_ISSUER`.

**Unchanged**: `GEMINI_API_KEY` and every other AI-inference-related env var — not touched by this migration.

## Verification Plan

1. Provision the Entra tenant, app registration, and sign-in-only user flow (Google + local accounts) in Azure — confirm the hosted login page renders both options.
2. Create one test user manually in Entra; confirm they can sign in via email/password and land in the app with a valid session.
3. Confirm an uninvited Google account is rejected at Entra (proves invite-only gating works for both login methods, not just email/password).
4. Confirm Entra's self-service password reset (SSPR) works end-to-end for the test user.
5. Confirm all 13 updated call sites behave correctly: redirect-gated Server Component pages, 401-returning API routes, and client-side session reads.
6. Confirm the FastAPI backend accepts a real Entra-issued token on a protected route (e.g. `analyze.py`) and rejects a tampered or expired one.
7. Confirm the Gemini Flash API integration is unaffected — a smoke check that this migration touched nothing in the inference path.
