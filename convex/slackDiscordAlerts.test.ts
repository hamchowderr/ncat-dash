import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

// Alerts in Slack and Discord: an approval waiting arrives as a direct message with
// Approve and Send back, a press decides it as the member who pressed it, and every
// message then says who decided and loses its buttons. Both apps are stand-ins here.

const TOKEN = "xoxb-1111-2222-good";
const SIGNING = "0123456789abcdef0123456789abcdef";
const SECRET = "an-agent-secret-of-at-least-32-characters";

type Call = { app: "slack" | "discord"; method: string; body: Record<string, unknown> };
let calls: Call[] = [];
let slackUsers: Record<string, string> = {};
let nextId = 1000;

beforeEach(() => {
  vi.useFakeTimers();
  process.env.CONNECTIONS_SECRET = "a-connections-secret-of-at-least-32-chars";
  process.env.SLACK_API_URL = "https://slack.test/api/";
  process.env.DISCORD_API_URL = "https://discord.test/api";
  process.env.DISCORD_BOT_TOKEN = "discord-bot";
  process.env.MASTRA_JWT_SECRET = SECRET;
  process.env.SITE_URL = "https://dash.test";
  calls = [];
  slackUsers = { U0OLU: "olu.bello@example.test", U0ANA: "ana.reyes@example.test" };
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://slack.test/api/")) {
      const method = url.replace("https://slack.test/api/", "");
      const params = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
      calls.push({ app: "slack", method, body: params });
      switch (method) {
        case "auth.test":
          return Response.json({
            ok: true,
            team_id: "T0SALT",
            team: "Salt House",
            user_id: "U0BOT",
          });
        case "users.lookupByEmail": {
          const id = Object.entries(slackUsers).find(([, email]) => email === params.email)?.[0];
          return Response.json(
            id ? { ok: true, user: { id } } : { ok: false, error: "users_not_found" },
          );
        }
        case "users.info":
          return Response.json({
            ok: true,
            user: { id: params.user, profile: { email: slackUsers[params.user as string] } },
          });
        case "chat.postMessage":
          return Response.json({ ok: true, channel: `D${params.channel}`, ts: `${++nextId}.0001` });
        default:
          return Response.json({ ok: true });
      }
    }
    if (url.startsWith("https://discord.test/api")) {
      const method = `${init?.method} ${url.replace("https://discord.test/api", "")}`;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ app: "discord", method, body });
      if (method === "POST /users/@me/channels")
        return Response.json({ id: `dm-${body.recipient_id}` });
      return Response.json({ id: `msg-${++nextId}` });
    }
    return new Response("unknown", { status: 404 });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.DISCORD_BOT_TOKEN;
});

/** A team with Slack connected, Ben's Discord linked, and a run waiting on an approval. */
async function waiting() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const olu = await addPerson(t, "Olu Bello", [team], "owner");
  const ana = await addPerson(t, "Ana Reyes", [team]);
  const ben = await addPerson(t, "Ben Cho", [team]);
  await olu.as.action(api.slack.connect, {
    organizationId: team,
    botToken: TOKEN,
    signingSecret: SIGNING,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("discordPeople", {
      organizationId: team,
      userId: ben.id,
      discordUserId: "200000000000000001",
      discordName: "ben",
      linkedAt: Date.now(),
    });
  });
  calls = [];
  const runId = await t.run(async (ctx) => {
    const automationId = await ctx.db.insert("automations", {
      organizationId: team,
      name: "Weekly clips",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [{ id: "approval", kind: "approval", input: {}, position: { x: 0, y: 0 } }],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: olu.id,
      updatedAt: Date.now(),
    });
    const automation = await ctx.db.get(automationId);
    const started = await startRun(
      ctx,
      automation!,
      "webhook",
      { file_url: "https://f/x.mp4" },
      null,
    );
    if (!started.ok) throw new Error(started.message);
    return started.runId;
  });
  const step = () =>
    t.run(
      async (ctx) =>
        (await ctx.db
          .query("runSteps")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .unique())!,
    );
  return { t, team, olu, ana, ben, step };
}

const settleDown = (t: ReturnType<typeof backend>) =>
  t.finishAllScheduledFunctions(vi.runAllTimers);

function slackPress(
  t: ReturnType<typeof backend>,
  slackUser: string,
  actionId: string,
  value: string,
) {
  const body = new URLSearchParams({
    payload: JSON.stringify({
      type: "block_actions",
      team: { id: "T0SALT" },
      user: { id: slackUser },
      container: { channel_id: `D${slackUser}` },
      actions: [{ action_id: actionId, value }],
    }),
  }).toString();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac("sha256", SIGNING).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  return t.fetch("/slack/actions", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
}

function agentToken() {
  const b = (value: string) => Buffer.from(value).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const body = `${b(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b(
    JSON.stringify({ sub: "agent-server", aud: "takewon-dashboard", iat, exp: iat + 300 }),
  )}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}

describe("alerts in Slack and Discord", () => {
  test("an approval arrives as a direct message with buttons, in each app", async () => {
    const { t, step } = await waiting();
    await settleDown(t);
    const slackPosts = calls.filter((c) => c.app === "slack" && c.method === "chat.postMessage");
    // Olu and Ana are in the Slack workspace; Ben's email is not.
    expect(slackPosts.map((c) => c.body.channel).sort()).toEqual(["U0ANA", "U0OLU"]);
    const blocks = JSON.parse(String(slackPosts[0].body.blocks));
    expect(blocks[0].text.text).toContain("*Weekly clips is waiting for your approval");
    expect(blocks[0].text.text).toContain("|Open the run>");
    const { _id } = await step();
    expect(
      blocks[1].elements.map((e: { action_id: string; value: string }) => [e.action_id, e.value]),
    ).toEqual([
      ["ncat_alert_approve", _id],
      ["ncat_alert_send_back", _id],
    ]);

    const discordPosts = calls.filter((c) => c.app === "discord" && c.method.includes("/messages"));
    expect(discordPosts.map((c) => c.method)).toEqual([
      "POST /channels/dm-200000000000000001/messages",
    ]);
    const row = (
      discordPosts[0].body.components as { components: { custom_id?: string; url?: string }[] }[]
    )[0];
    expect(row.components.map((b) => b.custom_id ?? b.url)).toEqual([
      `ncat_alert_approve\n${_id}`,
      `ncat_alert_send_back\n${_id}`,
      expect.stringMatching(/\/automations\/.+\/runs\//),
    ]);
  });

  test("Approve in Slack decides as that member, and every message then says so", async () => {
    const { t, ana, step } = await waiting();
    await settleDown(t);
    const { _id } = await step();
    calls = [];
    const answer = await slackPress(t, "U0ANA", "ncat_alert_approve", _id);
    expect(answer.status).toBe(200);
    await settleDown(t);
    expect(await step()).toMatchObject({ status: "done", decidedBy: ana.id });
    const updates = calls.filter((c) => c.method === "chat.update");
    expect(updates).toHaveLength(2);
    expect(String(updates[0].body.blocks)).toContain("Approved by Ana Reyes.");
    expect(String(updates[0].body.blocks)).not.toContain("ncat_alert_");
    const edits = calls.filter((c) => c.app === "discord" && c.method.startsWith("PATCH"));
    expect(edits).toHaveLength(1);
    expect(String(edits[0].body.content)).toContain("Approved by Ana Reyes.");
  });

  test("a press with a bad signature, or by someone not on the team, decides nothing", async () => {
    const { t, step } = await waiting();
    await settleDown(t);
    const { _id } = await step();
    const forged = await t.fetch("/slack/actions", {
      method: "POST",
      headers: {
        "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-slack-signature": "v0=nope",
      },
      body: new URLSearchParams({
        payload: JSON.stringify({
          type: "block_actions",
          team: { id: "T0SALT" },
          user: { id: "U0ANA" },
          actions: [{ action_id: "ncat_alert_approve", value: _id }],
        }),
      }).toString(),
    });
    expect(forged.status).toBe(401);
    slackUsers.U0SAM = "sam@elsewhere.test";
    calls = [];
    await slackPress(t, "U0SAM", "ncat_alert_approve", _id);
    await settleDown(t);
    expect((await step()).status).toBe("waiting_approval");
    const told = calls.find((c) => c.method === "chat.postEphemeral");
    expect(told?.body.text).toContain("sam@elsewhere.test is not on the team");
  });

  test("Send back in Discord, handed over by the agent server, decides as the linked member", async () => {
    const { t, ben, step } = await waiting();
    await settleDown(t);
    const { _id } = await step();
    const press = (discordUserId: string) =>
      t.fetch("/discord/alert-action", {
        method: "POST",
        headers: { authorization: `Bearer ${agentToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ runStepId: _id, discordUserId, decision: "send_back" }),
      });
    const stranger = await press("999999999999999999");
    expect(await stranger.json()).toMatchObject({
      ok: false,
      message: expect.stringContaining("Link my Discord"),
    });
    const answer = await press("200000000000000001");
    expect(await answer.json()).toEqual({ ok: true, message: "Sent back." });
    expect(await step()).toMatchObject({ decidedBy: ben.id });
    expect((await step()).status).not.toBe("waiting_approval");

    const unsigned = await t.fetch("/discord/alert-action", {
      method: "POST",
      body: JSON.stringify({ runStepId: _id, discordUserId: "1", decision: "approve" }),
    });
    expect(unsigned.status).toBe(401);
  });

  test("Settings shows Slack and Discord only to the members who can get them", async () => {
    const { team, ben, olu } = await waiting();
    const forBen = await ben.as.query(api.notifications.get, { organizationId: team });
    const forOlu = await olu.as.query(api.notifications.get, { organizationId: team });
    expect(forBen?.chatApps).toEqual(expect.arrayContaining(["slack", "discord"]));
    expect(forOlu?.chatApps).toEqual(["slack"]);
  });
});
