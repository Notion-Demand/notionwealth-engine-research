/**
 * FastAPI client helpers.
 *
 * All requests attach the Supabase session JWT as a Bearer token so that
 * FastAPI's `get_current_user` dependency can verify the caller.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

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

// ── Connection helpers ────────────────────────────────────────────────────────

export type Connection = {
  provider: string;
  connected_at: string;
  gmail_email?: string;
  slack_team_id?: string;
  slack_team_name?: string;
};

export async function listConnections(): Promise<Connection[]> {
  return apiFetch<Connection[]>("/connections");
}

export async function deleteConnection(provider: "gmail" | "slack") {
  return apiFetch(`/connections/${provider}`, { method: "DELETE" });
}

// ── Analyze helpers ───────────────────────────────────────────────────────────

export type AnalyzeResult = {
  id: string;
  payload: Record<string, unknown>;
};

export async function runAnalysis(query: string): Promise<AnalyzeResult> {
  return apiFetch<AnalyzeResult>("/analyze", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}

export async function getAnalysisHistory(): Promise<unknown[]> {
  return apiFetch<unknown[]>("/analyze/history");
}

// ── Email helpers ─────────────────────────────────────────────────────────────

export async function sendEmail(params: {
  to: string;
  subject: string;
  body: string;
}) {
  return apiFetch("/email/send", {
    method: "POST",
    body: JSON.stringify(params),
  });
}
