import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  MASTRA_JWT_SECRET: undefined as string | undefined,
  AGENT_CONVEX_SECRET: undefined as string | undefined,
}));
vi.mock("../../src/lib/env", () => ({ env }));
import { AGENT_AUDIENCE, createServerAuth } from "../../src/mastra/lib/auth";
import {
  DASHBOARD_AUDIENCE,
  dashboardSecret,
  signForDashboard,
} from "../../src/mastra/ncat/dashboard-site";

/**
 * Each direction's tokens carry their own audience: this server only takes tokens made
 * for it (aud "takewon-agent"), and its own calls to the dashboard's backend say
 * "takewon-dashboard" and use AGENT_CONVEX_SECRET when it is set.
 */
const SECRET = "s".repeat(40);

function sign(claims: Record<string, unknown>, secret = SECRET) {
  const b = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const body = `${b({ alg: "HS256", typ: "JWT" })}.${b({ sub: "person~team", iat, exp: iat + 300, ...claims })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

const saved = { ...env };
afterEach(() => Object.assign(env, saved));

describe("token audiences", () => {
  const auth = createServerAuth(SECRET)!;

  it("takes a token made for the agent", async () => {
    const user = await auth.authenticateToken(sign({ aud: AGENT_AUDIENCE }));
    expect(await auth.authorizeUser(user)).toBe(true);
  });

  it("refuses one with no audience or one made for the dashboard", async () => {
    for (const claims of [{}, { aud: DASHBOARD_AUDIENCE }]) {
      const user = await auth.authenticateToken(sign(claims));
      expect(await auth.authorizeUser(user)).toBe(false);
    }
    const replayed = await auth.authenticateToken(signForDashboard(SECRET));
    expect(await auth.authorizeUser(replayed)).toBe(false);
  });

  it("signs calls to the dashboard with its audience and the separate secret when set", () => {
    const [, body] = signForDashboard(SECRET).split(".");
    expect(JSON.parse(Buffer.from(body, "base64url").toString()).aud).toBe(DASHBOARD_AUDIENCE);
    Object.assign(env, { MASTRA_JWT_SECRET: SECRET, AGENT_CONVEX_SECRET: undefined });
    expect(dashboardSecret()).toBe(SECRET);
    Object.assign(env, { AGENT_CONVEX_SECRET: "c".repeat(40) });
    expect(dashboardSecret()).toBe("c".repeat(40));
  });
});
