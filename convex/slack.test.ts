import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

// A team's own Slack app: an owner connects it with the bot token and signing secret,
// which are checked with Slack and kept encrypted; the agent server, holding the shared
// secret, gets them back to take that workspace's events, and finds who a Slack user is
// on the team by their email address.

const SECRET = "the-agent-shared-secret-of-at-least-32-chars";
const TOKEN = "xoxb-1111-2222-good";
const SIGNING = "0123456789abcdef0123456789abcdef";

type Call = { method: string; params: URLSearchParams; token: string };
let calls: Call[] = [];
let slackUsers: Record<string, { email?: string; is_bot?: boolean }> = {};

beforeEach(() => {
  process.env.CONNECTIONS_SECRET = "a-connections-secret-of-at-least-32-chars";
  process.env.MASTRA_JWT_SECRET = SECRET;
  process.env.SLACK_API_URL = "https://slack.test/api/";
  calls = [];
  slackUsers = {};
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const method = String(input).replace("https://slack.test/api/", "");
    const token = String(new Headers(init?.headers).get("authorization")).replace("Bearer ", "");
    const params = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ method, params, token });
    const good = token === TOKEN;
    if (method === "auth.test") {
      return Response.json(
        good
          ? { ok: true, team_id: "T0SALT", team: "Salt House", user_id: "U0BOT" }
          : { ok: false, error: "invalid_auth" },
      );
    }
    if (method === "users.info") {
      const user = slackUsers[params.get("user") ?? ""];
      return Response.json(
        user
          ? { ok: true, user: { id: params.get("user"), is_bot: !!user.is_bot, profile: user } }
          : { ok: false, error: "user_not_found" },
      );
    }
    return Response.json({ ok: false, error: "unknown_method" });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CONNECTIONS_SECRET;
  delete process.env.MASTRA_JWT_SECRET;
  delete process.env.SLACK_API_URL;
});

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Jordan Lee", [team], "owner");
  const member = await addPerson(t, "Maya Ortiz", [team], "member");
  return { t, team, owner, member };
}

function base64url(value: string | Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

async function agentToken(secret = SECRET, expiresIn = 300) {
  const iat = Math.floor(Date.now() / 1000);
  const body = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({ sub: "agent-server", iat, exp: iat + expiresIn }),
  )}`;
  const { createHmac } = await import("node:crypto");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

describe("connecting a team's Slack app", () => {
  test("an owner connects it; Settings shows the workspace and never the secrets", async () => {
    const { t, team, owner, member } = await setUp();
    const result = await owner.as.action(api.slack.connect, {
      organizationId: team,
      botToken: ` ${TOKEN} `,
      signingSecret: SIGNING,
    });
    expect(result).toEqual({ ok: true });
    expect(calls.map((call) => call.method)).toEqual(["auth.test"]);

    const shown = await member.as.query(api.slack.forTeam, { organizationId: team });
    expect(shown).toMatchObject({ connected: true, canEdit: false, slackTeamName: "Salt House" });
    expect(shown).toMatchObject({ connectedBy: "Jordan Lee" });
    expect(JSON.stringify(shown)).not.toContain(TOKEN);
    expect(JSON.stringify(shown)).not.toContain(SIGNING);

    // Stored encrypted.
    const row = await t.run((ctx) => ctx.db.query("slackConnections").unique());
    expect(row?.botTokenCipher.startsWith("v1.")).toBe(true);
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(JSON.stringify(row)).not.toContain(SIGNING);
  });

  test("a member cannot connect it", async () => {
    const { team, member } = await setUp();
    await expect(
      member.as.action(api.slack.connect, {
        organizationId: team,
        botToken: TOKEN,
        signingSecret: SIGNING,
      }),
    ).rejects.toThrow(/owner or admin/);
  });

  test("a wrong kind of token, a malformed secret and a refused token each say what to fix", async () => {
    const { team, owner } = await setUp();
    const connect = (botToken: string, signingSecret = SIGNING) =>
      owner.as.action(api.slack.connect, { organizationId: team, botToken, signingSecret });
    expect(await connect("xoxp-a-user-token")).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/not a bot token/),
    });
    expect(await connect(TOKEN, "not-a-secret")).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/not a signing secret/),
    });
    expect(await connect("xoxb-revoked")).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/did not accept this token/),
    });
  });

  test("a workspace connected to one team cannot be taken by another", async () => {
    const { t, team, owner } = await setUp();
    await owner.as.action(api.slack.connect, {
      organizationId: team,
      botToken: TOKEN,
      signingSecret: SIGNING,
    });
    const other = await addTeam(t, "Harbor Lane");
    const rival = await addPerson(t, "Riley Park", [other], "owner");
    const result = await rival.as.action(api.slack.connect, {
      organizationId: other,
      botToken: TOKEN,
      signingSecret: SIGNING,
    });
    expect(result).toMatchObject({ ok: false, detail: expect.stringMatching(/another team/) });
    expect(await rival.as.query(api.slack.forTeam, { organizationId: other })).toMatchObject({
      connected: false,
    });
  });

  test("disconnecting forgets the app and who was found in it", async () => {
    const { t, team, owner } = await setUp();
    await owner.as.action(api.slack.connect, {
      organizationId: team,
      botToken: TOKEN,
      signingSecret: SIGNING,
    });
    await t.mutation(internal.slack.rememberPerson, {
      slackTeamId: "T0SALT",
      slackUserId: "U0JORDAN",
      organizationId: team,
      userId: owner.id,
      sessionToken: "a-session",
      sessionExpiresAt: Date.now() + 1000,
    });
    await owner.as.mutation(api.slack.disconnect, { organizationId: team });
    expect(await t.run((ctx) => ctx.db.query("slackConnections").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("slackPeople").collect())).toEqual([]);
  });
});

describe("what the agent server is told", () => {
  test("only a caller with the shared secret gets a workspace's token and secret", async () => {
    const { t, team, owner } = await setUp();
    await owner.as.action(api.slack.connect, {
      organizationId: team,
      botToken: TOKEN,
      signingSecret: SIGNING,
    });
    const ask = async (authorization: string | null, body: object) =>
      await t.fetch("/slack/installation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(body),
      });

    expect((await ask(null, { slackTeamId: "T0SALT" })).status).toBe(401);
    expect(
      (
        await ask(`Bearer ${await agentToken("a-different-secret-of-32-characters!")}`, {
          slackTeamId: "T0SALT",
        })
      ).status,
    ).toBe(401);
    expect(
      (await ask(`Bearer ${await agentToken(SECRET, -10)}`, { slackTeamId: "T0SALT" })).status,
    ).toBe(401);

    const good = `Bearer ${await agentToken()}`;
    const answer = await ask(good, { slackTeamId: "T0SALT" });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      organizationId: team,
      botUserId: "U0BOT",
      botToken: TOKEN,
      signingSecret: SIGNING,
    });
    expect((await ask(good, { slackTeamId: "T0OTHER" })).status).toBe(404);
  });

  test("a Slack user is found on the team by email, and anyone else is turned away", async () => {
    const { t, team, owner } = await setUp();
    await owner.as.action(api.slack.connect, {
      organizationId: team,
      botToken: TOKEN,
      signingSecret: SIGNING,
    });
    slackUsers = {
      U0STRANGER: { email: "sam@elsewhere.test" },
      U0HIDDEN: {},
      U0BOTUSER: { email: "bot@example.test", is_bot: true },
    };
    const person = (slackUserId: string, slackTeamId = "T0SALT") =>
      t.action(internal.slack.person, { slackTeamId, slackUserId });

    expect(await person("U0STRANGER")).toEqual({
      ok: false,
      reason: "not_member",
      email: "sam@elsewhere.test",
    });
    expect(await person("U0HIDDEN")).toEqual({ ok: false, reason: "no_email", email: null });
    expect(await person("U0BOTUSER")).toEqual({ ok: false, reason: "no_email", email: null });
    expect(await person("U0JORDAN", "T0NOTCONNECTED")).toEqual({
      ok: false,
      reason: "not_connected",
      email: null,
    });
    expect(
      calls.filter((call) => call.method === "users.info").every((c) => c.token === TOKEN),
    ).toBe(true);
  });
});

describe("the agent in Slack once nothing new can start", () => {
  test("a blocked team, or one whose trial is over, is told why, even someone found before", async () => {
    const { t, team, owner } = await setUp();
    await owner.as.action(api.slack.connect, {
      organizationId: team,
      botToken: TOKEN,
      signingSecret: SIGNING,
    });
    slackUsers = { U0JORDAN: { email: "jordan.lee@example.test" } };
    const person = () =>
      t.action(internal.slack.person, { slackTeamId: "T0SALT", slackUserId: "U0JORDAN" });

    expect(await person()).toMatchObject({ ok: true, organizationId: team });
    await t.mutation(internal.blocks.blockTeam, { organizationId: team });
    expect(await person()).toMatchObject({
      ok: false,
      reason: "refused",
      email: null,
      message: expect.stringMatching(/paused/),
    });
    await t.mutation(internal.blocks.unblockTeam, { organizationId: team });
    await t.run((ctx) =>
      ctx.db.insert("teamTrials", { organizationId: team, startedAt: 0, endsAt: 1 }),
    );
    expect(await person()).toMatchObject({
      ok: false,
      reason: "refused",
      message: expect.stringMatching(/trial has ended/),
    });
  });
});
