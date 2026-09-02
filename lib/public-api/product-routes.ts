export interface ProductRoute {
  pattern: RegExp;
  product: string;
}

// Add one entry per public API endpoint. Order doesn't matter — patterns
// are mutually exclusive by construction (each anchors to a distinct path
// prefix or exact path).
export const PRODUCT_ROUTES: ProductRoute[] = [
  { pattern: /^\/api\/public\/v1\/data\/companies\//, product: "data:companies" },
  { pattern: /^\/api\/public\/v1\/data\/sectors\//, product: "data:sectors" },
  { pattern: /^\/api\/public\/v1\/products\/sector-thesis$/, product: "products:sector-thesis" },
  // MCP server — one product entry covers the whole tool surface for now;
  // split into per-tool-group products (e.g. "mcp:read", "mcp:agents") if
  // and when a partner should get some tools but not others.
  { pattern: /^\/api\/mcp$/, product: "mcp:tools" }, // exact — app/api/mcp/route.ts has no sub-paths
];

export function resolveProductName(pathname: string): string | null {
  return PRODUCT_ROUTES.find((r) => r.pattern.test(pathname))?.product ?? null;
}
