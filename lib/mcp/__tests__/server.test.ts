import { describe, it, expect } from "vitest";
import { callerContextFromAuthInfo, buildQuantalyzeMcpServer } from "@/lib/mcp/server";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

function authInfo(extra: Record<string, unknown> | undefined): AuthInfo {
  return { token: "t", clientId: "c", scopes: [], extra } as AuthInfo;
}

describe("callerContextFromAuthInfo", () => {
  it("returns null when authInfo is undefined", () => {
    expect(callerContextFromAuthInfo(undefined)).toBeNull();
  });

  it("returns null when extra is missing keyId or partnerId", () => {
    expect(callerContextFromAuthInfo(authInfo({ keyId: "k" }))).toBeNull();
    expect(callerContextFromAuthInfo(authInfo({ partnerId: "p" }))).toBeNull();
    expect(callerContextFromAuthInfo(authInfo(undefined))).toBeNull();
  });

  it("extracts keyId and partnerId when both are present", () => {
    expect(callerContextFromAuthInfo(authInfo({ keyId: "k1", partnerId: "p1" }))).toEqual({
      keyId: "k1",
      partnerId: "p1",
    });
  });
});

describe("buildQuantalyzeMcpServer", () => {
  it("registers all tools without name collisions or construction errors", () => {
    // A duplicate registerTool() name throws at call time — this is the
    // regression test for that: it would fail the moment a second tool
    // (verify_company_analysis) was wired in with a colliding name.
    const server = buildQuantalyzeMcpServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolNames = Object.keys((server as any)._registeredTools ?? {});
    expect(toolNames).toEqual(expect.arrayContaining(["get_company_analysis", "verify_company_analysis"]));
  });
});
