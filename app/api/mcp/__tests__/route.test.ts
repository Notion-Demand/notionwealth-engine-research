import { describe, it, expect } from "vitest";
import { authInfoFromRequest } from "@/app/api/mcp/route";

function makeRequest(headers: Record<string, string>): Request {
  return new Request("https://quantalyze.demandion.ai/api/mcp", { headers });
}

describe("authInfoFromRequest", () => {
  it("returns undefined when middleware.ts's identity headers are missing (fail closed)", () => {
    expect(authInfoFromRequest(makeRequest({}))).toBeUndefined();
  });

  it("returns undefined when only one of the two required headers is present", () => {
    expect(authInfoFromRequest(makeRequest({ "x-api-key-id": "key_1" }))).toBeUndefined();
  });

  it("builds AuthInfo from the headers middleware.ts forwards on a successful auth", () => {
    const authInfo = authInfoFromRequest(
      makeRequest({
        "x-api-key-id": "key_1",
        "x-api-partner-id": "partner_1",
        "x-api-product": "mcp:tools",
        authorization: "Bearer qzk_live_abc123",
      })
    );

    expect(authInfo).toEqual({
      token: "qzk_live_abc123",
      clientId: "partner_1",
      scopes: ["mcp:tools"],
      extra: { keyId: "key_1", partnerId: "partner_1" },
    });
  });

  it("defaults scopes to an empty array when x-api-product wasn't forwarded", () => {
    const authInfo = authInfoFromRequest(
      makeRequest({ "x-api-key-id": "key_1", "x-api-partner-id": "partner_1" })
    );
    expect(authInfo?.scopes).toEqual([]);
  });
});
