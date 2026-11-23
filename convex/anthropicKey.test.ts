import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { DASHBOARD_AUDIENCE } from "./lib/agentToken";

/** A token as the agent server signs its calls to this backend. */
async function signAgentToken(secret: string, sub: string) {
  const b64 = (bytes: Uint8Array | string) => {
    const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    let text = "";
    for (const byte of raw) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const iat = Math.floor(Date.now() / 1000);
  const body = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(
    JSON.stringify({ sub, aud: DASHBOARD_AUDIENCE, iat, exp: iat + 300 }),
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
import { addPerson, addTeam, backend } from "./test.setup";

/** A team's own Anthropic key (anthropicKey.ts): added, shown by its end, read by the agent. */

const SECRET = "the-agent-shared-secret-of-at-least-32-chars";
const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789-WXYZ";

let anthropicAnswers: number;
let checked: { url: string; key: string | null }[];

beforeEach(() => {
  process.env.MASTRA_JWT_SECRET = SECRET;
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  anthropicAnswers = 200;
  checked = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      checked.push({ url: String(input), key: headers.get("x-api-key") });
      return new Response("{}", { status: anthropicAnswers });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MASTRA_JWT_SECRET;
});

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Jordan Lee", [team], "owner");
  const member = await addPerson(t, "Maya Ortiz", [team], "member");
  return { t, team, owner, member };
}

async function askForKey(t: ReturnType<typeof backend>, organizationId: string, secret = SECRET) {
  return await t.fetch("/agent/team-key", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await signAgentToken(secret, "agent-server")}`,
    },
    body: JSON.stringify({ organizationId }),
  });
}

describe("the team's own Anthropic key", () => {
  test("an owner adds it once Anthropic takes it; members see only its last characters", async () => {
    const { t, team, owner, member } = await setUp();
    await owner.as.action(api.anthropicKey.set, { organizationId: team, key: `  ${KEY}\n` });

    expect(checked).toEqual([{ url: "https://api.anthropic.com/v1/models?limit=1", key: KEY }]);
    const seen = await member.as.query(api.teamSettings.get, { organizationId: team });
    expect(seen.anthropicKey).toEqual({ hint: "WXYZ", setAt: expect.any(Number) });
    expect(JSON.stringify(seen)).not.toContain(KEY);
    // Kept encrypted.
    const stored = await t.run(async (ctx) => (await ctx.db.query("teamSettings").first())!);
    expect(stored.anthropicKey?.cipher).not.toContain("sk-ant");
  });

  test("refuses something that is not a key, or a key Anthropic turns down", async () => {
    const { team, owner } = await setUp();
    await expect(
      owner.as.action(api.anthropicKey.set, { organizationId: team, key: "hello" }),
    ).rejects.toThrow(/starts with sk-ant-/);
    expect(checked).toEqual([]);

    anthropicAnswers = 401;
    await expect(
      owner.as.action(api.anthropicKey.set, { organizationId: team, key: KEY }),
    ).rejects.toThrow(/did not accept that key/);
    anthropicAnswers = 503;
    await expect(
      owner.as.action(api.anthropicKey.set, { organizationId: team, key: KEY }),
    ).rejects.toThrow(/could not be reached/);
    expect(
      (await owner.as.query(api.teamSettings.get, { organizationId: team })).anthropicKey,
    ).toBeNull();
  });

  test("only owners and admins add or remove it", async () => {
    const { team, owner, member } = await setUp();
    await expect(
      member.as.action(api.anthropicKey.set, { organizationId: team, key: KEY }),
    ).rejects.toThrow();
    await owner.as.action(api.anthropicKey.set, { organizationId: team, key: KEY });
    await expect(
      member.as.mutation(api.anthropicKey.remove, { organizationId: team }),
    ).rejects.toThrow();
    await owner.as.mutation(api.anthropicKey.remove, { organizationId: team });
    expect(
      (await owner.as.query(api.teamSettings.get, { organizationId: team })).anthropicKey,
    ).toBeNull();
  });

  test("the agent server reads it back with the shared secret, and nobody else can", async () => {
    const { t, team, owner } = await setUp();
    expect((await askForKey(t, team)).status).toBe(404);
    await owner.as.action(api.anthropicKey.set, { organizationId: team, key: KEY });

    const answer = await askForKey(t, team);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ key: KEY });

    expect((await askForKey(t, team, "some-other-secret-of-at-least-32-chars!")).status).toBe(401);
    const unsigned = await t.fetch("/agent/team-key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: team }),
    });
    expect(unsigned.status).toBe(401);
  });
});
