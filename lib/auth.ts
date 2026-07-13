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
