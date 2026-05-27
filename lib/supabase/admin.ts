import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/** Lazily-initialized service-role Supabase client (safe at build time).
 *  Uses cache: 'no-store' on every fetch so Next.js 14's fetch cache never
 *  serves stale Supabase responses — without this, the filtered sectors query
 *  can return cached rows from before new sectors (FMCG, Telecom) were seeded.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        global: {
          fetch: (url: RequestInfo | URL, options?: RequestInit) =>
            fetch(url, { ...options, cache: "no-store" }),
        },
      }
    );
  }
  return _client;
}
