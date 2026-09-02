/**
 * lib/mcp/ — Quantalyze's MCP tool layer.
 *
 * Architectural rule this whole module exists to enforce: an MCP tool is a
 * thin adapter, never a second implementation of a domain capability. Every
 * tool handler in lib/mcp/tools/ calls the SAME repository/service objects
 * (lib/repositories, lib/services) that the REST routes under app/api/
 * already call — see lib/mcp/tools/getCompanyAnalysis.ts, which calls
 * analysisRepo exactly as app/api/public/v1/data/companies/[ticker]/route.ts
 * does, and shares its DTO shaping (lib/api-contracts/v1/company.ts).
 *
 * Authentication/authorization is NOT implemented here. It's enforced by
 * middleware.ts (matcher extended to /api/mcp/:path*) using the same
 * apiAccessRepo-backed API-key/entitlement/quota pipeline the public REST
 * API already uses — see middleware.ts and lib/public-api/product-routes.ts
 * (the "mcp:tools" entry). By the time a tool handler in this folder runs,
 * the caller has already been authenticated, entitled, and quota-checked;
 * this module only threads the already-validated caller identity through
 * for audit logging (see log.ts and CallerContext below).
 */

/** Identity of the already-authenticated caller, forwarded by middleware.ts
 *  via the x-api-key-id / x-api-partner-id headers it sets on every request
 *  it lets through. Never re-derived here — re-deriving it would duplicate
 *  the auth logic middleware.ts already owns. */
export interface CallerContext {
  keyId: string;
  partnerId: string;
}

/** The envelope every tool result is wrapped in before being returned as
 *  MCP structured content. Fields map directly onto what a calling agent
 *  needs to decide how much to trust a result, not decoration: */
export interface McpToolEnvelope<T> {
  data: T;
  metadata: {
    /** Which repository/table this came from — never a raw SQL string or
     *  internal schema name, just enough for a caller to know what kind of
     *  system produced the data (rule: don't leak DB structure). */
    source: string;
    /** 0-1. Only ever populated from a real, already-computed signal —
     *  here, Quantalyze's own local self-consistency check
     *  (Analysis.validationScore). Omitted, not fabricated, when no real
     *  signal exists for a tool. */
    confidence?: number;
    /** When this response was produced. */
    timestamp: string;
    /** When the underlying data was actually generated/stored, if the
     *  repository can tell us — distinct from `timestamp` above. */
    provenance: string;
    /** Non-fatal caveats about this specific result (e.g. "N sections
     *  flagged by validation"). Empty array, not omitted, when there are
     *  none — keeps the shape predictable for callers. */
    warnings: string[];
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
