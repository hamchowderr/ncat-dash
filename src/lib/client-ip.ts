import { createHmac } from "node:crypto";

// Kept in step with convex/lib/clientIp.ts, which checks what this adds.
export const CLIENT_IP_HEADER = "x-ncat-client-ip";
export const CLIENT_IP_SIGNATURE_HEADER = "x-ncat-client-ip-signature";

/** The visitor's address, as Vercel (or another proxy in front) saw it. */
export function clientIpOf(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || null;
}

/**
 * The request, passed on to Convex with the visitor's address and a signature made with
 * MASTRA_JWT_SECRET, so the sign-up limits can count per network and nobody can claim an
 * address by calling Convex directly. Any address the request arrived claiming is dropped
 * first. Without the secret, or an address, nothing is added.
 */
export function withClientIp(request: Request, secret = process.env.MASTRA_JWT_SECRET): Request {
  const headers = new Headers(request.headers);
  headers.delete(CLIENT_IP_HEADER);
  headers.delete(CLIENT_IP_SIGNATURE_HEADER);
  const ip = clientIpOf(request.headers);
  if (secret && ip && ip.length <= 64) {
    headers.set(CLIENT_IP_HEADER, ip);
    headers.set(
      CLIENT_IP_SIGNATURE_HEADER,
      createHmac("sha256", secret).update(`client-ip:${ip}`).digest("hex"),
    );
  }
  const init: RequestInit & { duplex?: "half" } = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }
  return new Request(request.url, init);
}
