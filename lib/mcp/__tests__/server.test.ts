import { describe, it, expect } from "vitest";
import { callerContextFromAuthInfo } from "@/lib/mcp/server";
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
