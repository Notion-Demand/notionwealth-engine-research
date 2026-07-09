import { NextRequest, NextResponse } from "next/server";
import { apiAccessRepo } from "@/lib/repositories";
import { resolveProductName } from "@/lib/public-api/product-routes";

export const config = {
  matcher: "/api/public/:path*",
};

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const start = Date.now();
  const requestId = crypto.randomUUID();
  const { pathname } = req.nextUrl;

  const product = resolveProductName(pathname);
  if (!product) {
    return log(jsonError(404, "unknown public API resource"), { requestId, pathname, product: null, start });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) {
    return log(jsonError(401, "missing or malformed Authorization header"), { requestId, pathname, product, start });
  }
  const rawKey = match[1];
  const keyHash = await sha256Hex(rawKey);

  const keyInfo = await apiAccessRepo.getKeyByHash(keyHash);
  if (!keyInfo || !keyInfo.active) {
    return log(jsonError(401, "invalid or inactive API key"), { requestId, pathname, product, start });
  }

  if (!keyInfo.entitledProducts.includes(product)) {
    return log(jsonError(403, `key is not entitled to '${product}' — contact us to add this product`), {
      requestId, pathname, product, start, keyId: keyInfo.keyId, partnerId: keyInfo.partnerId,
    });
  }

  // Best-effort rate limit: getUsageToday + incrementUsage is a read-then-write,
  // not an atomic increment, so concurrent requests from the same key within
  // the same second can both read the same count and both pass. Acceptable at
  // v1's scale (manually-provisioned, low-volume partners); revisit with an
  // atomic SQL increment (or the transaction-aware repository extension named
  // in the spec) if a partner's volume makes the race actually matter.
  const windowStart = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const usedToday = await apiAccessRepo.getUsageToday(keyInfo.keyId, windowStart);
  if (usedToday >= keyInfo.dailyQuota) {
    return log(jsonError(429, "daily rate limit exceeded"), {
      requestId, pathname, product, start, keyId: keyInfo.keyId, partnerId: keyInfo.partnerId,
    });
  }

  await apiAccessRepo.incrementUsage(keyInfo.keyId, windowStart);

  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set("x-api-key-id", keyInfo.keyId);
  forwardedHeaders.set("x-api-partner-id", keyInfo.partnerId);

  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  return log(response, { requestId, pathname, product, start, keyId: keyInfo.keyId, partnerId: keyInfo.partnerId });
}

function log(
  response: NextResponse,
  ctx: { requestId: string; pathname: string; product: string | null; start: number; keyId?: string; partnerId?: string }
): NextResponse {
  const latencyMs = Date.now() - ctx.start;
  console.log(
    JSON.stringify({
      requestId: ctx.requestId,
      partnerId: ctx.partnerId ?? null,
      keyId: ctx.keyId ?? null,
      endpoint: ctx.pathname,
      product: ctx.product,
      status: response.status,
      latencyMs,
    })
  );
  return response;
}
