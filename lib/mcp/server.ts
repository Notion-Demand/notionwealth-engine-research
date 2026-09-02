/**
 * Builds one McpServer instance, registering every Quantalyze MCP tool.
 *
 * Called once per HTTP request (see app/api/mcp/route.ts) — stateless mode,
 * matching Next.js Route Handlers' request lifecycle and the pattern the
 * SDK itself recommends for serverless/edge-style runtimes (see
 * WebStandardStreamableHTTPServerTransport's own doc comment: "Stateless
 * mode - explicitly set session ID to undefined"). A single long-lived
 * server instance would leak tool-call state across unrelated callers on a
 * platform where each request may land on a different Container Apps
 * replica; per-request construction avoids that class of bug entirely
 * rather than trying to make shared state safe.
 *
 * Adding a new tool: write it in lib/mcp/tools/, following
 * getCompanyAnalysis.ts's shape (a pure, independently-testable `run*`
 * function plus exported zod input/output shapes), then register it below.
 * Nothing else in this file should need to change per tool.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  getCompanyAnalysisInputSchema,
  getCompanyAnalysisOutputSchema,
  runGetCompanyAnalysis,
} from "@/lib/mcp/tools/getCompanyAnalysis";
import {
  verifyCompanyAnalysisInputSchema,
  verifyCompanyAnalysisOutputSchema,
  runVerifyCompanyAnalysis,
} from "@/lib/mcp/tools/verifyCompanyAnalysis";
import { logMcpToolInvocation } from "@/lib/mcp/log";
import type { CallerContext } from "@/lib/mcp/types";

export function callerContextFromAuthInfo(authInfo: AuthInfo | undefined): CallerContext | null {
  const extra = authInfo?.extra as { keyId?: string; partnerId?: string } | undefined;
  if (!extra?.keyId || !extra?.partnerId) return null;
  return { keyId: extra.keyId, partnerId: extra.partnerId };
}

export function buildQuantalyzeMcpServer(): McpServer {
  const server = new McpServer({
    name: "quantalyze",
    version: "1.0.0",
  });

  server.registerTool(
    "get_company_analysis",
    {
      title: "Get Company Analysis",
      description:
        "Returns Quantalyze's most recent cached earnings analysis for a company — overall signal, " +
        "score, summary, key metrics, and quarter-over-quarter narrative deltas. Read-only; does not " +
        "trigger a new analysis run. Returns NOT_FOUND if the ticker has never been analyzed.",
      inputSchema: getCompanyAnalysisInputSchema,
      outputSchema: getCompanyAnalysisOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ ticker }, extra) => {
      const start = Date.now();
      const caller = callerContextFromAuthInfo(extra.authInfo);
      const requestId = String(extra.requestId);

      const outcome = await runGetCompanyAnalysis(ticker);

      if (!outcome.ok) {
        logMcpToolInvocation({
          requestId,
          toolName: "get_company_analysis",
          keyId: caller?.keyId ?? null,
          partnerId: caller?.partnerId ?? null,
          argumentKeys: ["ticker"],
          status: "error",
          errorCode: outcome.code,
          latencyMs: Date.now() - start,
        });
        return {
          isError: true,
          content: [{ type: "text", text: outcome.message }],
          structuredContent: { code: outcome.code, message: outcome.message },
        };
      }

      logMcpToolInvocation({
        requestId,
        toolName: "get_company_analysis",
        keyId: caller?.keyId ?? null,
        partnerId: caller?.partnerId ?? null,
        argumentKeys: ["ticker"],
        status: "success",
        latencyMs: Date.now() - start,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(outcome.result, null, 2) }],
        // Spread into a plain object literal rather than passing the typed
        // envelope directly — CallToolResult.structuredContent is typed as
        // Record<string, unknown> (an index signature McpToolEnvelope<T>
        // deliberately doesn't carry, to keep it a precise, closed shape
        // everywhere else it's used).
        structuredContent: { data: outcome.result.data, metadata: outcome.result.metadata },
      };
    }
  );

  server.registerTool(
    "verify_company_analysis",
    {
      title: "Verify Company Analysis",
      description:
        "Runs the Evidence Verification Agent: checks Quantalyze's own earnings-delta claims for a " +
        "ticker against the actual source transcript, via RAG retrieval over the transcript's chunked " +
        "and embedded text, plus one grounded LLM verdict per claim. NOT read-only — ingests the " +
        "transcript on first call and writes a new evidence_verifications row every time it runs. " +
        "Returns NOT_FOUND if the ticker has no analysis, NO_CLAIMS if that analysis has no " +
        "earnings-delta claims to check, or INGESTION_FAILED if the source transcript couldn't be read.",
      inputSchema: verifyCompanyAnalysisInputSchema,
      outputSchema: verifyCompanyAnalysisOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ ticker }, extra) => {
      const start = Date.now();
      const caller = callerContextFromAuthInfo(extra.authInfo);
      const requestId = String(extra.requestId);

      const outcome = await runVerifyCompanyAnalysis(ticker);

      if (!outcome.ok) {
        logMcpToolInvocation({
          requestId,
          toolName: "verify_company_analysis",
          keyId: caller?.keyId ?? null,
          partnerId: caller?.partnerId ?? null,
          argumentKeys: ["ticker"],
          status: "error",
          errorCode: outcome.code,
          latencyMs: Date.now() - start,
        });
        return {
          isError: true,
          content: [{ type: "text", text: outcome.message }],
          structuredContent: { code: outcome.code, message: outcome.message },
        };
      }

      logMcpToolInvocation({
        requestId,
        toolName: "verify_company_analysis",
        keyId: caller?.keyId ?? null,
        partnerId: caller?.partnerId ?? null,
        argumentKeys: ["ticker"],
        status: "success",
        latencyMs: Date.now() - start,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(outcome.result, null, 2) }],
        // Same rationale as get_company_analysis above: spread into a plain
        // object literal rather than passing the typed envelope directly.
        structuredContent: { data: outcome.result.data, metadata: outcome.result.metadata },
      };
    }
  );

  return server;
}
