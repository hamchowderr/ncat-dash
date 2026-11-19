import { createHmac } from "node:crypto";
import { env } from "../../lib/env";

/** Where the dashboard's HTTP actions answer. */
export function convexSiteUrl(): string | null {
  if (env.CONVEX_SITE_URL) return env.CONVEX_SITE_URL.replace(/\/$/, "");
  if (!env.CONVEX_URL) return null;
  const url = new URL(env.CONVEX_URL);
  if (url.hostname.endsWith(".convex.cloud")) {
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
  } else if (url.port) {
    url.port = String(Number(url.port) + 1);
  }
  return url.origin;
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

/** A five-minute HS256 token, as the dashboard signs its own calls to us. */
export function signForDashboard(secret: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const body = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({ sub: "agent-server", iat, exp: iat + 300 }),
  )}`;
  return `${body}.${base64url(createHmac("sha256", secret).update(body).digest())}`;
}
