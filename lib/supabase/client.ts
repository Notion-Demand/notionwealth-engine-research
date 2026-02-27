import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  // Fallbacks prevent throws during build-time SSR when env vars aren't set.
  // All actual requests will fail if these are placeholder values — which is correct.
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key"
  );
}
