import { afterEach, describe, expect, it } from "vitest";
import { agentCallSecret, DASHBOARD_AUDIENCE, fromAgent } from "./lib/agentToken";
import { AGENT_AUDIENCE, signAgentToken } from "./reviewAgent";

/**
 * Calls from the agent server (convex/lib/agentToken.ts) need a token made for this
 * backend: a token the web app or Convex signs for the agent is refused here, and once
 * AGENT_CONVEX_SECRET is set, MASTRA_JWT_SECRET (which the web app also holds) no longer
 * opens these routes.
 */
const OLD = "w".repeat(40);
const NEW = "a".repeat(40);

function b64(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function token(secret: string, claims: Record<string, unknown>) {
  const iat = Math.floor(Date.now() / 1000);
  const body = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(
    JSON.stringify({ sub: "agent-server", iat, exp: iat + 300, ...claims }),
  )}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${b64(new Uint8Array(signature))}`;
}

const asked = (bearer: string) =>
  new Request("https://site.example/agent/team-key", {
    headers: { authorization: `Bearer ${bearer}` },
  });

afterEach(() => {
  delete process.env.MASTRA_JWT_SECRET;
  delete process.env.AGENT_CONVEX_SECRET;
});

describe("tokens from the agent server", () => {
  it("takes a token made for this backend", async () => {
    process.env.MASTRA_JWT_SECRET = OLD;
    expect(await fromAgent(asked(await token(OLD, { aud: DASHBOARD_AUDIENCE })))).toBe(true);
  });

  it("refuses a token with no audience, or one made for the agent", async () => {
    process.env.MASTRA_JWT_SECRET = OLD;
    expect(await fromAgent(asked(await token(OLD, {})))).toBe(false);
    expect(await fromAgent(asked(await token(OLD, { aud: AGENT_AUDIENCE })))).toBe(false);
    expect(await fromAgent(asked(await signAgentToken(OLD, "someone")))).toBe(false);
  });

  it("uses AGENT_CONVEX_SECRET once it is set, so the web app's secret stops working here", async () => {
    process.env.MASTRA_JWT_SECRET = OLD;
    process.env.AGENT_CONVEX_SECRET = NEW;
    expect(agentCallSecret()).toBe(NEW);
    expect(await fromAgent(asked(await token(NEW, { aud: DASHBOARD_AUDIENCE })))).toBe(true);
    expect(await fromAgent(asked(await token(OLD, { aud: DASHBOARD_AUDIENCE })))).toBe(false);
  });

  it("signs tokens for the agent with the agent's audience", async () => {
    const [, body] = (await signAgentToken(OLD, "someone")).split(".");
    const claims = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
    expect(claims.aud).toBe(AGENT_AUDIENCE);
  });
});
