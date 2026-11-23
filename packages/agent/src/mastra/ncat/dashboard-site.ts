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

/**
 * Audiences keep each direction's tokens apart: one signed for the dashboard's backend is
 * refused by the agent server, and the other way round. Kept in step with
 * convex/lib/agentToken.ts and src/lib/mastra-proxy.ts.
 */
export const DASHBOARD_AUDIENCE = "ncat-dashboard";
export const AGENT_AUDIENCE = "ncat-agent";

/**
 * The secret for calls from here to the dashboard's backend: AGENT_CONVEX_SECRET, which
 * only this server and Convex hold, or MASTRA_JWT_SECRET when it isn't set.
 */
export function dashboardSecret(): string | undefined {
  return env.AGENT_CONVEX_SECRET || env.MASTRA_JWT_SECRET;
}

/** A five-minute HS256 token for the dashboard's backend, and only for it. */
export function signForDashboard(secret: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const body = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({ sub: "agent-server", aud: DASHBOARD_AUDIENCE, iat, exp: iat + 300 }),
  )}`;
  return `${body}.${base64url(createHmac("sha256", secret).update(body).digest())}`;
}
