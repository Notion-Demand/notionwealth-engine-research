/**
 * Structured audit logging for MCP tool invocations.
 *
 * Deliberately reuses the exact JSON-line-to-console.log convention
 * middleware.ts already established for the public REST API (see its
 * `log()` helper) rather than introducing a second logging shape or a new
 * observability dependency — this repo's rule 6 in the discussions/
 * technical-debt writeup is "no metrics/traces exist, only console.log";
 * this module doesn't pretend otherwise, it extends the one pattern that
 * does exist, with the fields an MCP tool call specifically needs (rule 5:
 * every MCP invocation should be auditable — caller, tool, arguments,
 * timestamp, execution time, success/failure).
 *
 * Explicitly NOT logged: raw tool arguments. A ticker symbol is harmless,
 * but a future tool's arguments might not be — logging only argument KEYS
 * (not values) keeps this safe by default without needing a per-tool
 * redaction list. Widen this later (allowlist specific safe argument
 * values) if a concrete need for that shows up.
 */
export interface McpAuditEvent {
  requestId: string;
  toolName: string;
  keyId: string | null;
  partnerId: string | null;
  argumentKeys: string[];
  status: "success" | "error";
  errorCode?: string;
  latencyMs: number;
}

export function logMcpToolInvocation(event: McpAuditEvent): void {
  console.log(
    JSON.stringify({
      component: "mcp",
      requestId: event.requestId,
      tool: event.toolName,
      keyId: event.keyId,
      partnerId: event.partnerId,
      argumentKeys: event.argumentKeys,
      status: event.status,
      errorCode: event.errorCode ?? null,
      latencyMs: event.latencyMs,
    })
  );
}
