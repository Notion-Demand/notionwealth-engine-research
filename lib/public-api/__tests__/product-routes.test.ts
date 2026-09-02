import { describe, it, expect } from "vitest";
import { resolveProductName } from "@/lib/public-api/product-routes";

describe("resolveProductName", () => {
  it("resolves the MCP endpoint to the mcp:tools product", () => {
    expect(resolveProductName("/api/mcp")).toBe("mcp:tools");
  });

  it("still resolves the pre-existing public REST routes unchanged", () => {
    expect(resolveProductName("/api/public/v1/data/companies/RELIANCE")).toBe("data:companies");
    expect(resolveProductName("/api/public/v1/data/sectors/it")).toBe("data:sectors");
    expect(resolveProductName("/api/public/v1/products/sector-thesis")).toBe("products:sector-thesis");
  });

  it("returns null for a path with no matching product", () => {
    expect(resolveProductName("/api/v1/analyze")).toBeNull();
  });
});
