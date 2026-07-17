import { Suspense } from "react";
import LoginClient from "./LoginClient";

// Force dynamic rendering — this page was previously served from Next.js's
// full-route cache with a 1-year s-maxage (from a pre-migration test
// request), and that cache key isn't partitioned by Host header. A stale
// cached response bypasses next.config.mjs's www->bare-domain redirect
// entirely, meaning a user landing on www.quantalyze.me/login would still
// see (and could submit) the login form on the wrong host, reconstructing
// the exact AADSTS50011 redirect URI mismatch this migration fixed.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginClient />
    </Suspense>
  );
}
