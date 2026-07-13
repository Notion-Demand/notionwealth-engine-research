# Azure Auth Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Auth entirely with Microsoft Entra External ID across the Next.js app, preserving Google + email/password login and invite-only onboarding, with zero user-data migration.

**Architecture:** Auth.js (`next-auth` v5) wired to a Microsoft Entra External ID (CIAM) tenant via its `MicrosoftEntraID` provider, using JWT-session-strategy cookies. A single `lib/auth.ts` helper (`getCurrentUser()`) wraps Auth.js's `auth()` everywhere instead of routes calling `auth()` directly, so any future move back to portable bearer tokens (a revived separate backend, mobile app, etc.) only requires changing that one function. All Supabase-specific auth code (custom OAuth-bypass routes, SSR cookie clients, the auth proxy route) is deleted outright — confirmed unused by anything except auth itself.

**Tech Stack:** `next-auth@5` (Auth.js), Microsoft Entra External ID (CIAM tenant), Next.js 14.2.29 App Router.

## Global Constraints

- No migration of existing Supabase Auth user accounts/passwords — fresh start (spec: Non-Goals).
- No in-app admin UI for user creation — onboarding is via the Entra admin center (spec: Non-Goals).
- No changes to the Gemini Flash API integration (`GEMINI_API_KEY`) — completely separate from Google OAuth (spec: Non-Goals).
- No changes to `middleware.ts`'s existing partner API-key gating (`/api/public/:path*`) — unrelated to user auth (spec: Non-Goals).
- `finance-agent/`'s FastAPI backend (`api/auth.py` etc.) is **out of scope** — confirmed dead code with no deployment, no runtime bridge from Next.js, and no live traffic path (verified via repo-wide search for `localhost:8000`, `NEXT_PUBLIC_API_URL` usage, and `finance-agent` references — see this plan's research notes below). Do not modify anything under `finance-agent/`.
- Session/token architecture: cookie-based, not portable bearer tokens. Since finance-agent is out of scope, there is no separate backend that needs a portable JWT — all six routes previously gated by `lib/auth.ts`'s Bearer-header parsing are same-origin and can rely on Auth.js's session cookie directly (confirmed with user during planning).
- Login methods: Google (federated via Entra) + email/password (Entra local accounts), both invite-only — no self-registration path for either (spec: Architecture).
- `lib/supabase/admin.ts` and `SUPABASE_SERVICE_ROLE_KEY` **stay** — still used by the currently-idle `SupabaseXRepository` classes from the Data+Storage migration until their own separate safety window ends (2026-07-20). Do not touch this file or remove this env var.

## Research Notes (grounding facts found during planning, not in the original spec)

- **Entra External ID has only one user flow per tenant** (unlike Azure AD B2C's separate "sign-up and sign-in" vs. "sign-in only" flow types). Invite-only is implemented by setting `isSignUpAllowed: false` on that single user flow via the Microsoft Graph API — there is no portal toggle for this. Setting this to `false` also blocks automatic account creation via federated IdPs (i.e., an uninvited Google account cannot self-register either), which is exactly the invite-only behavior both login methods need.
- **Entra External ID's issuer URL format differs from standard Entra ID**: `https://<tenant-subdomain>.ciamlogin.com/<tenant-id>/v2.0` (not `login.microsoftonline.com`). Auth.js's `MicrosoftEntraID` provider works with this transparently — it's a generic OIDC provider that discovers `.well-known/openid-configuration` from whatever `issuer` URL is configured.
- **`lib/auth.ts`'s `getUserId(req)` is the real, centralized gatekeeper for six routes** (`app/api/v1/analyze/route.ts`, `analyze/solo/route.ts`, `analyze/history/route.ts`, `insights/route.ts`, `credits/route.ts`, `transcript/download/route.ts`) — none of these call `supabase.auth.*` directly, they all delegate to this one helper. This wasn't caught by the spec-time survey of direct `supabase.auth.*` call sites.
- **`NEXT_PUBLIC_API_URL` was a dead/stale App Service setting** (`http://localhost:8000/api/v1`) with zero effect on the live app — Next.js bakes `NEXT_PUBLIC_*` vars into the client bundle at build time, and the GitHub Actions build step never sets this var, so the shipped bundle already has the correct `"/api/v1"` same-origin fallback baked in. Removed from App Service settings during planning (no code change needed, already correct).
- **Complete inventory of every file touching Supabase auth** (found via `grep -rln "supabase\.auth\."` across `app/`, `lib/`, `components/`): `app/page.tsx`, `app/sectors/page.tsx`, `app/screener/page.tsx`, `app/kpis/page.tsx`, `app/dashboard/page.tsx`, `app/request/page.tsx`, `app/auth/callback/route.ts`, `app/auth/reset-callback/route.ts`, `app/api/v1/auth/route.ts`, `app/api/v1/auth/google-callback/route.ts`, `app/api/v1/user-tickers/route.ts`, `app/api/v1/request/route.ts`, `lib/api.ts`, `lib/auth.ts`, `components/Nav.tsx`. Plus `app/api/v1/auth/google-start/route.ts` and `app/auth/reset-password/page.tsx` (no direct Supabase call, but part of the same flow, deleted alongside).

---

### Task 1: Provision the Entra External ID tenant, app registration, and invite-only user flow

**Files:** None (Azure/Entra admin console + Graph API steps; no repo files touched).

**Interfaces:**
- Produces: an Entra app registration's **client ID**, **client secret**, and **issuer URL** — consumed by Task 2's `AUTH_MICROSOFT_ENTRA_ID_ID`/`_SECRET`/`_ISSUER` env vars. Also produces the tenant's Graph API access needed for Step 5.

- [ ] **Step 1: Create the Entra External ID tenant**

In the Azure Portal, create a new **Microsoft Entra External ID** tenant (Azure Portal → "Create a resource" → search "Microsoft Entra External ID" → "External tenant"). Note the tenant's default domain (`<tenant-subdomain>.onmicrosoft.com`) and its **Tenant ID** (a GUID, visible on the tenant's Overview page).

Expected: a new external tenant exists, separate from your existing Entra ID workforce tenant used for the Azure subscription itself.

- [ ] **Step 2: Register the Quantalyze application**

Inside the new external tenant (switch directories in the Portal to the new tenant first), go to **App registrations → New registration**:
- Name: `Quantalyze`
- Supported account types: "Accounts in this organizational directory only" (single external tenant)
- Redirect URI: type "Web", value `https://quantalyze.me/api/auth/callback/microsoft-entra-id` (Auth.js's default callback path convention for a provider ID of `microsoft-entra-id`)

After creation, note the **Application (client) ID** from the Overview page. Go to **Certificates & secrets → New client secret**, create one with a long expiry, and copy its **Value** immediately (it's not shown again) — this is the client secret.

Expected: an app registration exists with a client ID, a client secret value, and one redirect URI configured.

- [ ] **Step 3: Configure Google as a federated identity provider**

In the external tenant, go to **External Identities → All identity providers → Google**. Enter the existing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` values (the same ones currently used by the app's custom OAuth flow — these get reused here, not replaced).

Expected: Google appears as an available identity provider option for this tenant.

- [ ] **Step 4: Add Google to the tenant's user flow**

Go to **External Identities → User flows**, open the tenant's single default user flow, and under **Identity providers**, enable Google alongside the local (email/password) account option.

Expected: the user flow's sign-in page will present both "Continue with Google" and email/password fields once tested.

- [ ] **Step 5: Disable self-service sign-up (invite-only) via Microsoft Graph API**

Entra External ID has only one user flow per tenant, and there is no portal toggle for "sign-in only" — this must be set via Graph API. Using the Azure CLI (already authenticated to your subscription; Graph API calls work across tenants you have access to via `az rest`), find the user flow's ID first:

```bash
az login --tenant <external-tenant-id>
az rest --method GET \
  --url "https://graph.microsoft.com/beta/identity/authenticationEventsFlows" \
  --query "value[].{id:id, displayName:displayName}"
```

Note the `id` of the tenant's user flow, then disable sign-up:

```bash
az rest --method PATCH \
  --url "https://graph.microsoft.com/beta/identity/authenticationEventsFlows/<flow-id>" \
  --body '{"onAuthenticationMethodLoadStartListener": {"@odata.type": "#microsoft.graph.onAuthenticationMethodLoadStartListener", "isSignUpAllowed": false}}'
```

Expected: subsequent step verifies this — an uninvited Google account attempting to sign in is rejected rather than auto-registered, and there's no sign-up link on the local-account form.

- [ ] **Step 6: Create one test user manually**

Go to **Users → New user → Create new user** in the external tenant admin center. Set an email and a temporary password (or use "Invite user" for an invitation-link flow instead). Note the email for Step 10's verification.

Expected: one real user exists that Task 10 can sign in as.

- [ ] **Step 7: Note the issuer URL and save all three values**

The issuer URL for this tenant is `https://<tenant-subdomain>.ciamlogin.com/<tenant-id>/v2.0` (not the standard `login.microsoftonline.com` format used by workforce Entra ID tenants). Save all three values for Task 2:

```bash
echo "AUTH_MICROSOFT_ENTRA_ID_ID=<client-id-from-step-2>"
echo "AUTH_MICROSOFT_ENTRA_ID_SECRET=<client-secret-from-step-2>"
echo "AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://<tenant-subdomain>.ciamlogin.com/<tenant-id>/v2.0"
```

- [ ] **Step 8: Generate an Auth.js session secret**

```bash
openssl rand -base64 32
```

Save this as `AUTH_SECRET` for Task 2 — Auth.js uses it to encrypt/sign the session cookie (JWT strategy).

---

### Task 2: Install and configure Auth.js with the Microsoft Entra ID provider

**Files:**
- Modify: `package.json` (add `next-auth`)
- Create: `auth.ts` (repo root, alongside `middleware.ts` — Auth.js's conventional config location)
- Create: `app/api/auth/[...nextauth]/route.ts`

**Interfaces:**
- Consumes: `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_ISSUER`, `AUTH_SECRET` (Task 1).
- Produces: `auth`, `handlers`, `signIn`, `signOut` exported from `auth.ts` — consumed by every later task. `session.user.id` (a string) — consumed by every route/page needing the current user's ID.

- [ ] **Step 1: Install `next-auth`**

```bash
npm install next-auth@5
```

- [ ] **Step 2: Create `auth.ts`**

```ts
import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  // Auth.js only auto-trusts the incoming Host header on platforms it can
  // detect (e.g. Vercel, via its own env var). Azure App Service isn't
  // recognized, so without this every request is rejected with
  // "UntrustedHost" — found by testing the real deployment, not caught by
  // type-checking. Safe here since App Service's own routing already
  // guarantees the Host header matches this app's actual bound domain.
  trustHost: true,
  // Without this, Auth.js redirects unauthenticated access and sign-in
  // errors to its own built-in pages instead of this app's /login page —
  // LoginClient.tsx (Task 7) reads `?error=...` off the URL, which only
  // arrives here because pages.signIn is set.
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // Entra's OIDC `sub` claim (the user's unique ID in this tenant) is on
    // the `token`, not the default `session.user` shape — Auth.js does not
    // expose an ID on session.user unless a callback copies it there. Every
    // consumer in this app needs a stable user ID (matching what the old
    // Supabase `user.id` provided), so this callback is required, not optional.
    async jwt({ token, account }) {
      if (account) {
        token.sub = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
```

- [ ] **Step 3: Create the Auth.js route handler**

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

Save as `app/api/auth/[...nextauth]/route.ts`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (note: `session.user.id` will cause a type error until Task 3 adds the module augmentation — if it errors here, that's expected and gets fixed by Task 3's Step 1; otherwise proceed).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json auth.ts "app/api/auth/[...nextauth]/route.ts"
git commit -m "feat: install and configure Auth.js with Microsoft Entra ID provider"
```

---

### Task 3: Rewrite `lib/auth.ts` as the central `getCurrentUser()` helper

**Files:**
- Modify: `lib/auth.ts` (full rewrite)

**Interfaces:**
- Consumes: `auth` from `auth.ts` (Task 2).
- Produces: `getCurrentUser(): Promise<{ id: string; email: string | null } | null>` — the single function every later task uses to check who's logged in. Returns `null` if not authenticated (never throws) — a deliberate change from the old `getUserId()`'s throw-on-missing behavior, since callers differ in whether they want a 401 (routes) or a redirect (pages), and a single return-null contract lets each caller decide.

- [ ] **Step 1: Add the module augmentation for `session.user.id`**

Auth.js's default `Session["user"]` type has no `id` field. Create `types/next-auth.d.ts`:

```ts
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
```

- [ ] **Step 2: Rewrite `lib/auth.ts`**

Replace the full contents of `lib/auth.ts`:

```ts
import { auth } from "@/auth";

export interface CurrentUser {
  id: string;
  email: string | null;
}

/**
 * Returns the currently authenticated user (via Auth.js's session cookie),
 * or null if not authenticated. Never throws — callers decide whether a
 * missing user means a 401 (API routes) or a redirect (Server Component
 * pages). Centralizing this here (rather than calling auth() directly in
 * every route/page) means a future change — e.g. reintroducing a portable
 * bearer token for a separate backend — only requires changing this one
 * function, not every call site.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, email: session.user.email ?? null };
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (This will show errors in the 8 files that still call the old `getUserId(req)` — those are fixed in Tasks 4–6.)

- [ ] **Step 4: Commit**

```bash
git add lib/auth.ts types/next-auth.d.ts
git commit -m "feat: replace Supabase-JWT getUserId() with Auth.js-backed getCurrentUser()"
```

---

### Task 4: Update the six routes that call `lib/auth.ts`'s helper

**Files:**
- Modify: `app/api/v1/analyze/route.ts`
- Modify: `app/api/v1/analyze/solo/route.ts`
- Modify: `app/api/v1/analyze/history/route.ts`
- Modify: `app/api/v1/insights/route.ts`
- Modify: `app/api/v1/credits/route.ts`
- Modify: `app/api/v1/transcript/download/route.ts`

**Interfaces:**
- Consumes: `getCurrentUser()` from `lib/auth.ts` (Task 3).

All six files use `{ detail: "..." }` as their error response shape (not `{ error: "..." }`) — preserved exactly, since that's this route family's own existing convention. Five of the six wrap `getUserId(req)` in a `try`/`catch` that returns 401 on any throw; `analyze/history/route.ts` instead wraps its *entire* handler in one `try`/`catch` and string-compares the caught error's `.message` to `"Unauthorized"` — this one needs restructuring, not just a line swap, since `getCurrentUser()` never throws.

- [ ] **Step 1: Update `app/api/v1/analyze/route.ts`**

Replace:

```ts
import { getUserId } from "@/lib/auth";
```

with:

```ts
import { getCurrentUser } from "@/lib/auth";
```

Replace:

```ts
export async function POST(req: NextRequest) {
  // Validate auth + params before opening the stream
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
```

with:

```ts
export async function POST(req: NextRequest) {
  // Validate auth + params before opening the stream
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  const userId = user.id;
```

(The rest of the file — `checkAndDeduct(userId, "delta")` at line 79, `analysisRepo.saveAnalysis(userId, ...)` at line 110 — is unchanged; `userId` still exists as a `string`.)

- [ ] **Step 2: Update `app/api/v1/analyze/solo/route.ts`**

Replace:

```ts
import { getUserId } from "@/lib/auth";
```

with:

```ts
import { getCurrentUser } from "@/lib/auth";
```

Replace:

```ts
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
```

with:

```ts
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  const userId = user.id;
```

- [ ] **Step 3: Update `app/api/v1/analyze/history/route.ts` (restructured — the throw-based pattern doesn't apply)**

Replace the full contents:

```ts
import { NextRequest, NextResponse } from "next/server";
import { analysisRepo } from "@/lib/repositories";
import { getUserId } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);

    const history = await analysisRepo.listUserHistory(userId, 20);

    return NextResponse.json(history);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Unauthorized") {
      return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
```

with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { analysisRepo } from "@/lib/repositories";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });

  try {
    const history = await analysisRepo.listUserHistory(user.id, 20);
    return NextResponse.json(history);
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Update `app/api/v1/insights/route.ts`**

Replace:

```ts
import { getUserId } from "@/lib/auth";
```

with:

```ts
import { getCurrentUser } from "@/lib/auth";
```

Replace:

```ts
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
```

with:

```ts
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  const userId = user.id;
```

- [ ] **Step 5: Update `app/api/v1/credits/route.ts`**

Replace:

```ts
import { getUserId } from "@/lib/auth";
```

with:

```ts
import { getCurrentUser } from "@/lib/auth";
```

Replace:

```ts
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const status = await getCreditStatus(userId);
  return NextResponse.json(status);
}
```

with:

```ts
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });

  const status = await getCreditStatus(user.id);
  return NextResponse.json(status);
}
```

(`req: NextRequest` becomes an unused parameter here — harmless, TypeScript's default `noUnusedParameters` is off; left in place to keep the route handler's expected signature consistent with Next.js conventions.)

- [ ] **Step 6: Update `app/api/v1/transcript/download/route.ts`**

Replace:

```ts
import { getUserId } from "@/lib/auth";
```

with:

```ts
import { getCurrentUser } from "@/lib/auth";
```

Replace:

```ts
export async function GET(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
```

with:

```ts
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
```

(The original discarded `getUserId`'s return value too — it only used the call to trigger the throw-on-missing-auth check — so `user` being unused here matches the original's own behavior.)

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors, and no remaining references to `getUserId` anywhere (`grep -rn "getUserId" app/ lib/` returns nothing).

- [ ] **Step 8: Commit**

```bash
git add app/api/v1/analyze/route.ts app/api/v1/analyze/solo/route.ts app/api/v1/analyze/history/route.ts app/api/v1/insights/route.ts app/api/v1/credits/route.ts app/api/v1/transcript/download/route.ts
git commit -m "feat: switch six analyze/insights/credits routes to getCurrentUser()"
```

---

### Task 5: Update the six Server Component pages doing session-gated redirects

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/sectors/page.tsx`
- Modify: `app/screener/page.tsx`
- Modify: `app/kpis/page.tsx`
- Modify: `app/dashboard/page.tsx`
- Modify: `app/request/page.tsx`

**Interfaces:**
- Consumes: `getCurrentUser()` from `lib/auth.ts` (Task 3).

Five of these six (`sectors`, `screener`, `kpis`, `dashboard`, `request`) share the identical pattern:

```ts
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import XClient from "./XClient";

export default async function XPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  return (
    <Suspense>
      <XClient />
    </Suspense>
  );
}
```

- [ ] **Step 1: Update `app/sectors/page.tsx`, `app/screener/page.tsx`, `app/kpis/page.tsx` (4-space indent)**

For each of these three, replace:

```ts
import { createClient } from "@/lib/supabase/server";
```

with:

```ts
import { getCurrentUser } from "@/lib/auth";
```

and replace:

```ts
    const supabase = await createClient();
    const {
        data: { session },
    } = await supabase.auth.getSession();

    if (!session) redirect("/login");
```

with:

```ts
    const user = await getCurrentUser();

    if (!user) redirect("/login");
```

- [ ] **Step 2: Update `app/dashboard/page.tsx` (2-space indent — different from Step 1's files)**

Replace:

```ts
import { createClient } from "@/lib/supabase/server";
```

with:

```ts
import { getCurrentUser } from "@/lib/auth";
```

and replace:

```ts
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");
```

with:

```ts
  const user = await getCurrentUser();

  if (!user) redirect("/login");
```

- [ ] **Step 3: Update `app/request/page.tsx`**

Same pattern, same replacement (it has no `Suspense` wrapper, just returns `<RequestClient />` directly — don't add one, preserve as-is):

```ts
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import RequestClient from "./RequestClient";

export default async function RequestPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return <RequestClient />;
}
```

- [ ] **Step 4: Update `app/page.tsx` (inverted condition — redirects TO dashboard if already logged in)**

Replace:

```ts
import { createClient } from "@/lib/supabase/server";
```

with:

```ts
import { getCurrentUser } from "@/lib/auth";
```

and replace:

```ts
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) redirect("/dashboard");
```

with:

```ts
  const user = await getCurrentUser();

  if (user) redirect("/dashboard");
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx app/sectors/page.tsx app/screener/page.tsx app/kpis/page.tsx app/dashboard/page.tsx app/request/page.tsx
git commit -m "feat: switch six session-gated pages to getCurrentUser()"
```

---

### Task 6: Update `user-tickers` and `request` API routes' direct Supabase calls

**Files:**
- Modify: `app/api/v1/user-tickers/route.ts`
- Modify: `app/api/v1/request/route.ts`

**Interfaces:**
- Consumes: `getCurrentUser()` from `lib/auth.ts` (Task 3).

These two call `supabase.auth.getUser()` directly (not via `lib/auth.ts`) — a pre-existing inconsistency in the codebase, preserved as two separate call sites rather than unified, since that's out of scope for this migration.

- [ ] **Step 1: Update `app/api/v1/user-tickers/route.ts`**

Replace the import:

```ts
import { createClient } from "@/lib/supabase/server";
```

with:

```ts
import { getCurrentUser } from "@/lib/auth";
```

Replace all three occurrences of:

```ts
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

with:

```ts
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

(This appears once in `GET`, once in `POST`, once in `DELETE` — all three become identical to this replacement; the rest of each handler, e.g. `watchlistRepo.list(user.id)`, is unchanged since `user.id` still exists on the new `CurrentUser` type.)

- [ ] **Step 2: Update `app/api/v1/request/route.ts`**

Replace the import:

```ts
import { createClient } from "@/lib/supabase/server";
```

with:

```ts
import { getCurrentUser } from "@/lib/auth";
```

Replace:

```ts
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
```

with:

```ts
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
```

(Note this file's error shape is `{ detail: ... }`, not `{ error: ... }` — preserved exactly as the file already has it, since that's its own existing convention, unrelated to this migration.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/v1/user-tickers/route.ts app/api/v1/request/route.ts
git commit -m "feat: switch user-tickers and request routes to getCurrentUser()"
```

---

### Task 7: Rewrite the login page and delete obsolete Supabase auth routes

**Files:**
- Modify: `app/login/LoginClient.tsx`
- Delete: `app/api/v1/auth/route.ts`
- Delete: `app/api/v1/auth/google-start/route.ts`
- Delete: `app/api/v1/auth/google-callback/route.ts`
- Delete: `app/auth/callback/route.ts`
- Delete: `app/auth/reset-callback/route.ts`
- Delete: `app/auth/reset-password/page.tsx`

**Interfaces:**
- Consumes: `signIn` from `auth.ts` (Task 2), via Auth.js's client-side `signIn()` re-export (`next-auth/react`'s `signIn`, which internally calls the server config).

Auth.js's server-exported `signIn` (from `auth.ts`) is for Server Components/Actions. Client Components (like `LoginClient.tsx`, marked `"use client"`) use `next-auth/react`'s `signIn` instead — a separate client-side function that POSTs to the `app/api/auth/[...nextauth]/route.ts` handler from Task 2.

- [ ] **Step 1: Rewrite `app/login/LoginClient.tsx`**

Replace the full contents:

```tsx
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginClient() {
  const searchParams = useSearchParams();

  const urlError = searchParams.get("error");
  const initialError =
    urlError === "AccessDenied"
      ? "Access is by invitation only. Contact us to request access."
      : urlError
      ? "Authentication failed. Please try again."
      : null;

  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    try {
      await signIn("microsoft-entra-id", { callbackUrl: "/dashboard" });
    } catch {
      setError("Authentication failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-bold tracking-tight">
          Quantalyze
        </h1>
        <p className="mb-8 text-center text-sm text-gray-500">
          Earnings Concall Analysis
        </p>

        {error && <p className="mb-4 text-center text-sm text-red-600">{error}</p>}

        <button
          onClick={handleSignIn}
          disabled={loading}
          className="w-full rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "Please wait…" : "Sign in"}
        </button>

        <p className="mt-6 text-center text-sm text-gray-400">
          Access is by invitation only.
        </p>
      </div>
    </div>
  );
}
```

Note: Entra's own hosted sign-in page presents both the Google button and the email/password form (configured in Task 1, Step 4) — this app-side page now just triggers the redirect into that hosted flow via a single `signIn("microsoft-entra-id")` call, rather than building separate UI for each method itself. Self-service password reset (SSPR) is handled entirely on Entra's hosted page (Task 1's tenant-level SSPR configuration), so there is no app-side "forgot password" link or `/auth/reset-password` page anymore.

- [ ] **Step 2: Delete the obsolete Supabase auth routes**

```bash
rm app/api/v1/auth/route.ts
rm app/api/v1/auth/google-start/route.ts
rm app/api/v1/auth/google-callback/route.ts
rm app/auth/callback/route.ts
rm app/auth/reset-callback/route.ts
rm app/auth/reset-password/page.tsx
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A app/login/LoginClient.tsx app/api/v1/auth app/auth
git commit -m "feat: rewrite login page for Auth.js; delete obsolete Supabase OAuth/reset routes"
```

---

### Task 8: Simplify `lib/api.ts` and update `components/Nav.tsx`

**Files:**
- Modify: `lib/api.ts`
- Modify: `components/Nav.tsx`

**Interfaces:**
- Consumes: `next-auth/react`'s `useSession`/`signOut` (client-side).
- Produces: unchanged public function signatures in `lib/api.ts` (`runAnalysisStream`, `runAnalysis`, `getAnalysisHistory`, `getTranscriptDownloadUrl`, `runInsightsStream`, `runSoloAnalysisStream`) — callers (`DashboardClient.tsx` etc.) need no changes.

Per the confirmed architecture decision: since finance-agent is out of scope, there's no separate-origin backend needing a portable bearer token. These same-origin `fetch()` calls send the Auth.js session cookie automatically — no manual token extraction/attachment needed.

- [ ] **Step 1: Simplify `lib/api.ts`**

Remove the `getToken()` function entirely and its usage in every caller. Replace:

```ts
async function getToken(): Promise<string> {
  // Must be called in a browser context after Supabase session is established
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API ${res.status}: ${error}`);
  }
  return res.json() as Promise<T>;
}
```

with:

```ts
async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API ${res.status}: ${error}`);
  }
  return res.json() as Promise<T>;
}
```

Then, in `runAnalysisStream`, `runInsightsStream`, `runSoloAnalysisStream`, and `getTranscriptDownloadUrl` — each currently starts with `const token = await getToken();` and manually attaches `Authorization: Bearer ${token}` in its own `fetch()` call. Remove the `const token = await getToken();` line from each, and remove the `Authorization: Bearer ${token},` header line from each of their `fetch()` calls. For example, `runAnalysisStream` changes from:

```ts
export async function runAnalysisStream(
  params: AnalyzeParams,
  onEvent: (event: PipelineProgressEvent) => void
): Promise<AnalyzeResult> {
  const token = await getToken();
  const response = await fetch(`${API_URL}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });
```

to:

```ts
export async function runAnalysisStream(
  params: AnalyzeParams,
  onEvent: (event: PipelineProgressEvent) => void
): Promise<AnalyzeResult> {
  const response = await fetch(`${API_URL}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
```

Apply the same removal to the other three functions. `runInsightsStream` changes from:

```ts
export async function runInsightsStream(
  ticker: string,
  onEvent: (event: InsightsProgressEvent) => void,
  options?: { force?: boolean }
): Promise<Record<string, unknown>> {
  const token = await getToken();
  const response = await fetch(`${API_URL}/insights`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ticker, force: options?.force }),
  });
```

to:

```ts
export async function runInsightsStream(
  ticker: string,
  onEvent: (event: InsightsProgressEvent) => void,
  options?: { force?: boolean }
): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_URL}/insights`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ticker, force: options?.force }),
  });
```

`runSoloAnalysisStream` changes from:

```ts
export async function runSoloAnalysisStream(
  ticker: string,
  quarter: string,
  onEvent: (event: SoloProgressEvent) => void,
  options?: { force?: boolean }
): Promise<{ id: string; payload: Record<string, unknown> }> {
  const token = await getToken();
  const response = await fetch(`${API_URL}/analyze/solo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ticker, quarter, force: options?.force }),
  });
```

to:

```ts
export async function runSoloAnalysisStream(
  ticker: string,
  quarter: string,
  onEvent: (event: SoloProgressEvent) => void,
  options?: { force?: boolean }
): Promise<{ id: string; payload: Record<string, unknown> }> {
  const response = await fetch(`${API_URL}/analyze/solo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ticker, quarter, force: options?.force }),
  });
```

`getTranscriptDownloadUrl` changes from:

```ts
export async function getTranscriptDownloadUrl(
  ticker: string,
  quarter: string
): Promise<{ url: string; filename: string }> {
  const token = await getToken();
  const res = await fetch(
    `${API_URL}/transcript/download?ticker=${encodeURIComponent(ticker)}&quarter=${encodeURIComponent(quarter)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
```

to:

```ts
export async function getTranscriptDownloadUrl(
  ticker: string,
  quarter: string
): Promise<{ url: string; filename: string }> {
  const res = await fetch(
    `${API_URL}/transcript/download?ticker=${encodeURIComponent(ticker)}&quarter=${encodeURIComponent(quarter)}`
  );
```

Also update the file's header comment:

```ts
/**
 * FastAPI client helpers.
 *
 * All requests attach the Supabase session JWT as a Bearer token so that
 * FastAPI's `get_current_user` dependency can verify the caller.
 */
```

to:

```ts
/**
 * Next.js API route client helpers (app/api/v1/*).
 *
 * All requests are same-origin, so the Auth.js session cookie is sent
 * automatically — no manual token extraction or Authorization header needed.
 */
```

- [ ] **Step 2: Update `components/Nav.tsx`**

Replace the import:

```tsx
import { createClient } from "@/lib/supabase/client";
```

with:

```tsx
import { signOut } from "next-auth/react";
```

Remove the `const supabase = createClient();` line from the `Nav` component (no longer needed).

Replace the `signOut` function:

```tsx
    async function signOut() {
        await supabase.auth.signOut();
        router.push("/login");
    }
```

with (renamed to avoid shadowing the imported `signOut`):

```tsx
    async function handleSignOut() {
        await signOut({ callbackUrl: "/login" });
    }
```

Update the button's `onClick` from `onClick={signOut}` to `onClick={handleSignOut}`.

Note: `Nav()`'s top-level `const router = useRouter();` becomes unused after this change (it was only used inside the old `signOut()` for `router.push("/login")`; `handleSignOut` no longer needs it since `next-auth/react`'s `signOut({ callbackUrl: "/login" })` handles the redirect itself). This is harmless — `tsconfig.json` has neither `noUnusedLocals` nor `noUnusedParameters` set, so it won't fail the build — but it can be deleted along with its `useRouter` import for cleanliness. Do not remove `pathname`/`usePathname()` — that's still used by the nav items' active-link highlighting.

In `CreditsIndicator`, replace:

```tsx
function CreditsIndicator() {
    const [credits, setCredits] = useState<{ used: number; quota: number; remaining: number } | null>(null);

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (!session) return;
            fetch("/api/v1/credits", {
                headers: { Authorization: `Bearer ${session.access_token}` },
            })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => { if (d) setCredits(d); })
                .catch(() => {});
        });
    }, []);
```

with:

```tsx
function CreditsIndicator() {
    const [credits, setCredits] = useState<{ used: number; quota: number; remaining: number } | null>(null);

    useEffect(() => {
        fetch("/api/v1/credits")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d) setCredits(d); })
            .catch(() => {});
    }, []);
```

(Same-origin `fetch()` sends the session cookie automatically — no session check needed before firing the request; a logged-out user simply gets a 401, handled by the existing `r.ok ? r.json() : null` check.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/api.ts components/Nav.tsx
git commit -m "feat: simplify lib/api.ts and Nav.tsx to same-origin cookie auth (drop manual Bearer tokens)"
```

---

### Task 9: Delete obsolete Supabase SSR clients and clean up environment variables

**Files:**
- Delete: `lib/supabase/server.ts`
- Delete: `lib/supabase/client.ts`
- Modify: `package.json` (remove `@supabase/ssr` if nothing else uses it)

**Interfaces:** None — this is pure cleanup, no new interfaces produced.

- [ ] **Step 1: Confirm nothing else references these two files**

```bash
grep -rln "lib/supabase/server\|lib/supabase/client" --include="*.ts" --include="*.tsx" app lib components
```

Expected: no output (all consumers were already updated in Tasks 5, 6, 8; `lib/supabase/admin.ts` is a separate file, untouched by this grep pattern and not part of this deletion).

- [ ] **Step 2: Delete the files**

```bash
rm lib/supabase/server.ts lib/supabase/client.ts
```

- [ ] **Step 3: Check whether `@supabase/ssr` is still needed**

```bash
grep -rln "@supabase/ssr" --include="*.ts" --include="*.tsx" app lib components
```

If no output, remove it from `package.json`:

```bash
npm uninstall @supabase/ssr
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Remove obsolete environment variables from `quantalyze-app`**

```bash
az webapp config appsettings delete \
  --name quantalyze-app \
  --resource-group quantalyze-prod-rg \
  --setting-names NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET NEXT_PUBLIC_GOOGLE_CLIENT_ID ALLOWED_EMAILS \
  --query "[].name" -o tsv
```

Expected: the printed list of remaining setting *names* no longer includes any of the six removed above. (`SUPABASE_SERVICE_ROLE_KEY` is deliberately not in this list — it stays, per Global Constraints.)

- [ ] **Step 6: Set the new Auth.js/Entra environment variables**

Using the values saved from Task 1, Steps 7–8:

```bash
az webapp config appsettings set \
  --name quantalyze-app \
  --resource-group quantalyze-prod-rg \
  --settings \
    AUTH_SECRET="$AUTH_SECRET" \
    AUTH_MICROSOFT_ENTRA_ID_ID="$AUTH_MICROSOFT_ENTRA_ID_ID" \
    AUTH_MICROSOFT_ENTRA_ID_SECRET="$AUTH_MICROSOFT_ENTRA_ID_SECRET" \
    AUTH_MICROSOFT_ENTRA_ID_ISSUER="$AUTH_MICROSOFT_ENTRA_ID_ISSUER" \
  --query "[].name" -o tsv
```

(Using shell variables set from Task 1's saved values — never paste the raw client secret or `AUTH_SECRET` into a shared chat/log.)

- [ ] **Step 7: Search for any remaining `ALLOWED_EMAILS` references**

```bash
grep -rn "ALLOWED_EMAILS" --include="*.ts" --include="*.tsx" app lib components
```

Expected: no output (both call sites — `app/api/v1/auth/route.ts` and `app/api/v1/auth/google-callback/route.ts` — were deleted in Task 7).

- [ ] **Step 8: Commit**

```bash
git add -A lib/supabase package.json package-lock.json
git commit -m "chore: delete obsolete Supabase SSR auth clients"
```

---

### Task 10: Real end-to-end verification and deploy

**Files:** None — this task runs the already-implemented system against the real provisioned Entra tenant, no code changes.

**Interfaces:** None.

- [ ] **Step 1: Merge and deploy**

From the worktree, merge into `main` (following the same pattern as the Hosting and Data+Storage migrations — direct merge, push triggers the existing GitHub Actions deploy):

```bash
git push origin <branch-name>
```

Then, from the main repo checkout: `git pull`, `git merge <branch-name> --no-edit`, `npm install` (picks up `next-auth`, drops `@supabase/ssr` if removed), `npx tsc --noEmit`, `git push origin main`.

Expected: `gh run watch <run-id> --repo Notion-Demand/notionwealth-engine-research --exit-status` reports success.

- [ ] **Step 2: Confirm the app boots cleanly**

```bash
curl -s https://quantalyze.me/api/health
```

Expected: `{"status":"ok"}`. Also tail App Service logs briefly (`az webapp log tail --name quantalyze-app --resource-group quantalyze-prod-rg`, killed after ~15s) checking for missing-env-var errors or crash loops.

- [ ] **Step 3: Sign in as the test user (email/password)**

In a browser, go to `https://quantalyze.me/login`, click "Sign in", and complete the flow using the test user created in Task 1, Step 6.

Expected: lands on `/dashboard` with a valid session; `components/Nav.tsx`'s credits indicator and sign-out button both work.

- [ ] **Step 4: Confirm an uninvited Google account is rejected**

Attempt to sign in via Google using a Google account that was never created as a user in the Entra tenant.

Expected: Entra rejects the attempt (no auto-registration) — proves the `isSignUpAllowed: false` setting from Task 1, Step 5 blocks both login methods consistently, not just email/password.

- [ ] **Step 5: Confirm self-service password reset works**

From the Entra-hosted sign-in page, trigger "Forgot password" for the test user.

Expected: reset email arrives, new password can be set, subsequent sign-in with the new password succeeds.

- [ ] **Step 6: Confirm the six `getCurrentUser()`-gated routes work for a signed-in user**

While signed in, exercise the dashboard's analyze flow (pick a ticker/quarter pair, run analysis) and confirm `/api/v1/credits` (via `Nav.tsx`'s credits indicator) returns real data with no 401.

Expected: analysis runs to completion (NDJSON stream completes), credits indicator shows a real number.

- [ ] **Step 7: Confirm Gemini Flash API calls are unaffected**

The analysis run in Step 6 itself confirms this (the pipeline calls Gemini for inference) — if it completed successfully, `GEMINI_API_KEY`/the inference path is confirmed untouched by this migration.

- [ ] **Step 8: Confirm signed-out access is correctly blocked**

Open an incognito/private browser window, navigate directly to `https://quantalyze.me/dashboard`.

Expected: redirected to `/login` (proves `app/dashboard/page.tsx`'s `getCurrentUser()` gate works for an anonymous request).
