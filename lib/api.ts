/**
 * FastAPI client helpers.
 *
 * All requests attach the Supabase session JWT as a Bearer token so that
 * FastAPI's `get_current_user` dependency can verify the caller.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

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

export interface AnalyzeParams {
  ticker: string;
  q_prev: string;
  q_curr: string;
  force?: boolean;
}

export type PipelineProgressEvent =
  | { type: "start"; sections: string[] }
  | { type: "thematic_done"; section: string; which: "prev" | "curr" }
  | { type: "evasiveness_done"; score: number }
  | { type: "delta_done"; section: string }
  | { type: "stock_done"; stockPriceChange: number }
  | { type: "done"; payload: Record<string, unknown>; id: string }
  | { type: "error"; detail: string };

/**
 * Calls the streaming analyze endpoint and fires onEvent for each
 * NDJSON line. Resolves with the final AnalyzeResult on completion.
 */
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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API ${response.status}: ${error}`);
  }
  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AnalyzeResult | null = null;

  const processLine = (line: string) => {
    if (!line.trim()) return;
    let event: PipelineProgressEvent;
    try {
      event = JSON.parse(line) as PipelineProgressEvent;
    } catch {
      return;
    }
    onEvent(event);
    if (event.type === "done") {
      result = { id: event.id, payload: event.payload };
    }
    if (event.type === "error") {
      throw new Error(event.detail);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  }

  // Flush any remaining data in the buffer (stream closed without trailing newline)
  if (buffer.trim()) processLine(buffer);

  if (!result) throw new Error("Pipeline completed without result");
  return result;
}

export async function runAnalysis(params: AnalyzeParams): Promise<AnalyzeResult> {
  return apiFetch<AnalyzeResult>("/analyze", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getAnalysisHistory(): Promise<unknown[]> {
  return apiFetch<unknown[]>("/analyze/history");
}

// ── Transcript download ───────────────────────────────────────────────────────

export async function getTranscriptDownloadUrl(
  ticker: string,
  quarter: string
): Promise<{ url: string; filename: string }> {
  const token = await getToken();
  const res = await fetch(
    `${API_URL}/transcript/download?ticker=${encodeURIComponent(ticker)}&quarter=${encodeURIComponent(quarter)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }
  return res.json();
}

// ── Insights stream ───────────────────────────────────────────────────────────

export type InsightsProgressEvent =
  | { type: "start"; ticker: string; quarters: string[] }
  | { type: "quarter_done"; quarter: string }
  | { type: "synthesis_start" }
  | { type: "done"; payload: Record<string, unknown> }
  | { type: "error"; detail: string };

export async function runInsightsStream(
  ticker: string,
  onEvent: (event: InsightsProgressEvent) => void
): Promise<Record<string, unknown>> {
  const token = await getToken();
  const response = await fetch(`${API_URL}/insights`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ticker }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API ${response.status}: ${error}`);
  }
  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Record<string, unknown> | null = null;

  const processLine = (line: string) => {
    if (!line.trim()) return;
    let event: InsightsProgressEvent;
    try {
      event = JSON.parse(line) as InsightsProgressEvent;
    } catch {
      return;
    }
    onEvent(event);
    if (event.type === "done") result = event.payload;
    if (event.type === "error") throw new Error(event.detail);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  }
  if (buffer.trim()) processLine(buffer);
  if (!result) throw new Error("Insights pipeline completed without result");
  return result;
}

// ── Email helpers ─────────────────────────────────────────────────────────────

export async function sendEmail(params: {
  to: string;
  subject: string;
  body: string;
  html?: string;
}) {
  return apiFetch("/email/send", {
    method: "POST",
    body: JSON.stringify(params),
  });
}
