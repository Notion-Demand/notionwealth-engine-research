/**
 * POST /api/mcp — Quantalyze's MCP server endpoint.
 *
 * Authentication, entitlement, and quota enforcement all happen upstream in
 * middleware.ts (matcher covers /api/mcp/:path*, same as /api/public/:path*)
 * — this route handler NEVER re-implements or bypasses that check. By the
 * time a request reaches here, middleware.ts has already: validated the
 * Bearer API key, confirmed the key is entitled to the "mcp:tools" product,
 * checked and incremented the daily quota, and forwarded the caller's
 * identity as headers. This route's only job is to hand that identity to
 * the MCP transport as AuthInfo and let the SDK speak MCP.
 *
 * Stateless mode (sessionIdGenerator: undefined): a fresh transport and
 * server are constructed per request rather than kept alive across calls.
 * See lib/mcp/server.ts's doc comment for why that's the right choice here,
 * not a shortcut.
 *
 * GET and DELETE are part of the Streamable HTTP spec (SSE resumption /
 * session termination) but only matter in stateful mode; this server
 * doesn't run in stateful mode, so both return 405 — the same choice the
 * MCP SDK's own stateless example makes.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { buildQuantalyzeMcpServer } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

export function authInfoFromRequest(req: Request): AuthInfo | undefined {
  const keyId = req.headers.get("x-api-key-id");
  const partnerId = req.headers.get("x-api-partner-id");
  const product = req.headers.get("x-api-product");
  if (!keyId || !partnerId) {
    // middleware.ts didn't authenticate this request. In production that
    // should be unreachable (the matcher covers this path), but fail closed
    // rather than silently running the tool as an anonymous caller.
    return undefined;
  }
  return {
    token: req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "",
    clientId: partnerId,
    scopes: product ? [product] : [],
    extra: { keyId, partnerId },
  };
}

export async function POST(req: Request): Promise<Response> {
  const authInfo = authInfoFromRequest(req);
  if (!authInfo) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "unauthenticated" }, id: null },
      { status: 401 }
    );
  }

  const server = buildQuantalyzeMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(req, { authInfo });
  } finally {
    // Per-request instances (see module doc comment) — close what we opened.
    await transport.close();
    await server.close();
  }
}

function methodNotAllowed(): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. This MCP server runs in stateless mode." }, id: null },
    { status: 405 }
  );
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}
