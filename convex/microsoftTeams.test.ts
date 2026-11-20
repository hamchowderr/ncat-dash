import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { teamsCard } from "./lib/chatAlerts/teams";
import { notify } from "./lib/alerts";
import { teamsAppPackage, teamsManifest, zip } from "./lib/teamsApp";
import { settingsUrl, tenantOfIdToken } from "./microsoftTeams";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

// The agent in Microsoft Teams: an owner links the team's Microsoft organization by
// signing in with Microsoft, members are known by their Microsoft account, the agent
// server finds who wrote and acts as them, and alerts post to a channel the team picks.

const SECRET = "the-agent-shared-secret-of-at-least-32-chars";
const TENANT = "11111111-2222-3333-4444-555555555555";
const OTHER_TENANT = "99999999-2222-3333-4444-555555555555";
const SERVICE = "https://smba.trafficmanager.net/amer";
const TEAM_ID = "19:team-general@thread.tacv2";

type MsUser = { id: string; displayName: string; tid: string };
let codes: Record<string, MsUser> = {};
let posted: { url: string; method: string; body: Record<string, unknown> }[] = [];

function base64url(value: string | Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

function idToken(claims: object) {
  return `${base64url("{}")}.${base64url(JSON.stringify(claims))}.sig`;
}

beforeEach(() => {
  process.env.MASTRA_JWT_SECRET = SECRET;
  process.env.MICROSOFT_CLIENT_ID = "c4d4ec4e-0000-0000-0000-000000000001";
  process.env.MICROSOFT_CLIENT_SECRET = "a-microsoft-secret";
  process.env.MICROSOFT_LOGIN_URL = "https://login.test/common";
  process.env.MICROSOFT_GRAPH_URL = "https://graph.test/v1.0";
  process.env.TEAMS_APP_ID = "c4d4ec4e-0000-0000-0000-000000000001";
  process.env.TEAMS_APP_PASSWORD = "a-bot-password";
  process.env.TEAMS_LOGIN_URL = "https://login.test";
  process.env.CONVEX_SITE_URL = "https://site.test";
  codes = {};
  posted = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    if (url === "https://login.test/common/oauth2/v2.0/token") {
      const form = new URLSearchParams(String(init?.body ?? ""));
      const found = codes[form.get("code") ?? ""];
      if (!found || form.get("client_secret") !== "a-microsoft-secret") {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({
        access_token: `access-${form.get("code")}`,
        id_token: idToken({ tid: found.tid, oid: found.id }),
      });
    }
    if (url === "https://graph.test/v1.0/me") {
      const found = codes[auth.replace("Bearer access-", "")];
      return found
        ? Response.json({ id: found.id, displayName: found.displayName })
        : new Response("no", { status: 401 });
    }
    if (url.startsWith("https://graph.test/v1.0/organization")) {
      const found = codes[auth.replace("Bearer access-", "")];
      return Response.json({ value: [{ id: found?.tid, displayName: "Salt House Media" }] });
    }
    if (url === "https://login.test/botframework.com/oauth2/v2.0/token") {
      const form = new URLSearchParams(String(init?.body ?? ""));
      return form.get("client_secret") === "a-bot-password"
        ? Response.json({ access_token: "bot-token" })
        : Response.json({ error: "invalid_client" }, { status: 401 });
    }
    if (url === `${SERVICE}/v3/teams/${encodeURIComponent(TEAM_ID)}/conversations`) {
      if (auth !== "Bearer bot-token") return new Response("no", { status: 401 });
      return Response.json({
        conversations: [
          { id: TEAM_ID, name: null },
          { id: "19:edits@thread.tacv2", name: "Edits" },
        ],
      });
    }
    if (url.startsWith(`${SERVICE}/v3/conversations/`)) {
      posted.push({
        url,
        method: init?.method ?? "GET",
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return Response.json({ id: `activity-${posted.length}` });
    }
    return new Response("unknown", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const key of [
    "MASTRA_JWT_SECRET",
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
    "MICROSOFT_LOGIN_URL",
    "MICROSOFT_GRAPH_URL",
    "TEAMS_APP_ID",
    "TEAMS_APP_PASSWORD",
    "TEAMS_LOGIN_URL",
    "CONVEX_SITE_URL",
  ]) {
    delete process.env[key];
  }
});

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Jordan Lee", [team], "owner");
  const member = await addPerson(t, "Maya Ortiz", [team], "member");
  return { t, team, owner, member };
}

/** Plays Microsoft: the person signs in, and Microsoft sends them back with a code. */
async function comeBack(
  t: ReturnType<typeof backend>,
  startUrl: string,
  code: string,
  user: MsUser,
) {
  codes[code] = user;
  const state = new URL(startUrl).searchParams.get("state");
  const back = await t.fetch(`/microsoft/callback?code=${code}&state=${state}`, { method: "GET" });
  expect(back.status).toBe(302);
  const location = new URL(back.headers.get("location") ?? "");
  expect(location.pathname).toBe("/settings/teams");
  return location.searchParams.get("teams");
}

async function agentToken(secret = SECRET) {
  const iat = Math.floor(Date.now() / 1000);
  const body = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({ sub: "agent-server", iat, exp: iat + 300 }),
  )}`;
  const { createHmac } = await import("node:crypto");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

async function askPerson(t: ReturnType<typeof backend>, body: object, secret = SECRET) {
  return await t.fetch("/teams/person", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await agentToken(secret)}`,
    },
    body: JSON.stringify(body),
  });
}

const JORDAN: MsUser = { id: "aad-jordan", displayName: "Jordan Lee", tid: TENANT };
const MAYA: MsUser = { id: "aad-maya", displayName: "Maya Ortiz", tid: TENANT };

async function linkOrganization(setup: Awaited<ReturnType<typeof setUp>>, code = "c1") {
  const url = await setup.owner.as.mutation(api.microsoftTeams.startLink, {
    organizationId: setup.team,
    kind: "organization",
  });
  expect(await comeBack(setup.t, url, code, JORDAN)).toBe("added");
}

describe("linking a team's Microsoft organization", () => {
  test("an owner signs in with Microsoft; Settings shows the organization and their link", async () => {
    const setup = await setUp();
    const url = await setup.owner.as.mutation(api.microsoftTeams.startLink, {
      organizationId: setup.team,
      kind: "organization",
    });
    const asked = new URL(url);
    expect(asked.origin + asked.pathname).toBe("https://login.test/common/oauth2/v2.0/authorize");
    expect(asked.searchParams.get("scope")).toBe("openid profile User.Read");
    expect(asked.searchParams.get("redirect_uri")).toBe("https://site.test/microsoft/callback");
    expect(asked.searchParams.get("state")).toMatch(/^teams\./);

    expect(await comeBack(setup.t, url, "c1", JORDAN)).toBe("added");
    expect(
      await setup.member.as.query(api.microsoftTeams.forTeam, { organizationId: setup.team }),
    ).toMatchObject({
      ready: true,
      canEdit: false,
      appPackageUrl: "https://site.test/teams/app.zip",
      organization: { name: "Salt House Media", addedBy: "Jordan Lee", alertChannel: null },
      me: null,
      linkedCount: 1,
    });
    expect(
      await setup.owner.as.query(api.microsoftTeams.forTeam, { organizationId: setup.team }),
    ).toMatchObject({ canEdit: true, me: { name: "Jordan Lee", via: "teams" } });
  });

  test("a member cannot link the organization, but can link their own account", async () => {
    const setup = await setUp();
    await expect(
      setup.member.as.mutation(api.microsoftTeams.startLink, {
        organizationId: setup.team,
        kind: "organization",
      }),
    ).rejects.toThrow(/owner or admin/);
    const url = await setup.member.as.mutation(api.microsoftTeams.startLink, {
      organizationId: setup.team,
      kind: "person",
    });
    expect(await comeBack(setup.t, url, "c2", MAYA)).toBe("linked");
  });

  test("an organization one team has cannot be taken by another, and personal accounts are refused", async () => {
    const setup = await setUp();
    await linkOrganization(setup);
    const other = await addTeam(setup.t, "Harbor Lane");
    const rival = await addPerson(setup.t, "Riley Park", [other], "owner");
    const url = await rival.as.mutation(api.microsoftTeams.startLink, {
      organizationId: other,
      kind: "organization",
    });
    expect(
      await comeBack(setup.t, url, "c3", { id: "aad-riley", displayName: "Riley", tid: TENANT }),
    ).toBe("taken");
    const personal = await rival.as.mutation(api.microsoftTeams.startLink, {
      organizationId: other,
      kind: "organization",
    });
    expect(
      await comeBack(setup.t, personal, "c4", {
        id: "aad-riley",
        displayName: "Riley",
        tid: "9188040d-6c67-4c5b-b112-36a304b66dad",
      }),
    ).toBe("personal_account");
  });

  test("a sign-in works once, and Microsoft 365 sign-ins still go to their own page", async () => {
    const setup = await setUp();
    const url = await setup.member.as.mutation(api.microsoftTeams.startLink, {
      organizationId: setup.team,
      kind: "person",
    });
    expect(await comeBack(setup.t, url, "c5", MAYA)).toBe("linked");
    expect(await comeBack(setup.t, url, "c6", MAYA)).toBe("expired");
    const closed = await setup.t.fetch("/microsoft/callback?error=access_denied&state=teams.x", {
      method: "GET",
    });
    expect(closed.headers.get("location")).toBe(
      "http://localhost:3000/settings/teams?teams=cancelled",
    );
    const microsoft = await setup.t.fetch("/microsoft/callback?error=access_denied", {
      method: "GET",
    });
    expect(microsoft.headers.get("location")).toContain("/settings/microsoft?");
  });

  test("without a bot set up, Settings says so and nothing starts", async () => {
    const setup = await setUp();
    delete process.env.TEAMS_APP_PASSWORD;
    expect(
      await setup.owner.as.query(api.microsoftTeams.forTeam, { organizationId: setup.team }),
    ).toMatchObject({ ready: false });
    await expect(
      setup.owner.as.mutation(api.microsoftTeams.startLink, {
        organizationId: setup.team,
        kind: "person",
      }),
    ).rejects.toThrow(/not set up/);
  });

  test("removing the organization and unlinking forget them", async () => {
    const setup = await setUp();
    await linkOrganization(setup);
    await setup.owner.as.mutation(api.microsoftTeams.removeOrganization, {
      organizationId: setup.team,
    });
    await setup.owner.as.mutation(api.microsoftTeams.unlinkMe, { organizationId: setup.team });
    expect(
      await setup.owner.as.query(api.microsoftTeams.forTeam, { organizationId: setup.team }),
    ).toMatchObject({ organization: null, me: null });
  });
});

describe("who the agent server is told wrote", () => {
  test("only a caller with the shared secret is answered", async () => {
    const { t } = await setUp();
    const wrong = await askPerson(
      t,
      { tenantId: TENANT, aadObjectId: JORDAN.id },
      "a-different-secret-of-32-characters!",
    );
    expect(wrong.status).toBe(401);
  });

  test("a linked member gets a sign-in that acts as them, and their Teams team is noted", async () => {
    const setup = await setUp();
    await linkOrganization(setup);
    const found = await (
      await askPerson(setup.t, {
        tenantId: TENANT,
        aadObjectId: JORDAN.id,
        teamId: TEAM_ID,
        teamName: "Video team",
        serviceUrl: SERVICE,
      })
    ).json();
    expect(found).toMatchObject({ ok: true, name: "Jordan Lee", organizationId: setup.team });
    expect(typeof found.convexToken).toBe("string");
    expect(
      await setup.owner.as.query(api.microsoftTeams.forTeam, { organizationId: setup.team }),
    ).toMatchObject({ teamsSeen: ["Video team"] });
  });

  test("someone who connected Microsoft 365 is known without linking again", async () => {
    const setup = await setUp();
    await linkOrganization(setup);
    await setup.t.run(async (ctx) => {
      await ctx.db.insert("microsoftConnections", {
        organizationId: setup.team,
        userId: setup.member.id,
        msUserId: MAYA.id,
        msEmail: "maya@salthouse.test",
        msName: "Maya Ortiz",
        accessTokenCipher: "x",
        refreshTokenCipher: "x",
        expiresAt: 0,
        connectedAt: 0,
        autoImport: true,
      });
    });
    expect(
      await (await askPerson(setup.t, { tenantId: TENANT, aadObjectId: MAYA.id })).json(),
    ).toMatchObject({ ok: true, name: "Maya Ortiz" });
  });

  test("someone not linked, or an organization no team linked, is told why", async () => {
    const setup = await setUp();
    await linkOrganization(setup);
    expect(
      await (await askPerson(setup.t, { tenantId: TENANT, aadObjectId: "aad-stranger" })).json(),
    ).toEqual({ ok: false, reason: "not_linked" });
    expect(
      await (await askPerson(setup.t, { tenantId: OTHER_TENANT, aadObjectId: JORDAN.id })).json(),
    ).toEqual({ ok: false, reason: "not_connected" });
  });

  test("a team whose trial is over is told why instead of answered", async () => {
    const setup = await setUp();
    await linkOrganization(setup);
    await setup.t.run((ctx) =>
      ctx.db.insert("teamTrials", { organizationId: setup.team, startedAt: 0, endsAt: 1 }),
    );
    expect(
      await (await askPerson(setup.t, { tenantId: TENANT, aadObjectId: JORDAN.id })).json(),
    ).toMatchObject({
      ok: false,
      reason: "refused",
      message: expect.stringMatching(/trial has ended/),
    });
  });
});

describe("alerts in a Teams channel", () => {
  async function withChannel() {
    const setup = await setUp();
    await linkOrganization(setup);
    await askPerson(setup.t, {
      tenantId: TENANT,
      aadObjectId: JORDAN.id,
      teamId: TEAM_ID,
      teamName: "Video team",
      serviceUrl: SERVICE,
    });
    return setup;
  }

  test("an owner sees the channels of the teams the bot is in and picks one", async () => {
    const setup = await withChannel();
    expect(
      await setup.owner.as.action(api.microsoftTeams.channels, { organizationId: setup.team }),
    ).toEqual([
      { id: TEAM_ID, name: "General", teamName: "Video team" },
      { id: "19:edits@thread.tacv2", name: "Edits", teamName: "Video team" },
    ]);
    await expect(
      setup.member.as.action(api.microsoftTeams.channels, { organizationId: setup.team }),
    ).rejects.toThrow(/owner or admin/);
    expect(
      await setup.owner.as.action(api.microsoftTeams.setAlertChannel, {
        organizationId: setup.team,
        channelId: "19:nope@thread.tacv2",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await setup.owner.as.action(api.microsoftTeams.setAlertChannel, {
        organizationId: setup.team,
        channelId: "19:edits@thread.tacv2",
      }),
    ).toEqual({ ok: true });
    expect(
      await setup.owner.as.query(api.microsoftTeams.forTeam, { organizationId: setup.team }),
    ).toMatchObject({
      organization: { alertChannel: { id: "19:edits@thread.tacv2", name: "Video team › Edits" } },
    });
  });

  test("a failed run posts to the picked channel; with no channel nothing is posted", async () => {
    vi.useFakeTimers();
    const setup = await withChannel();
    const failure = {
      organizationId: setup.team,
      kind: "run_failed" as const,
      automationName: "Weekly podcast clips",
      stepName: "Add captions",
      message: "The toolkit could not be reached",
      retries: 2,
    };
    await setup.t.run((ctx) => notify(ctx, failure));
    await setup.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(posted).toEqual([]);

    await setup.owner.as.action(api.microsoftTeams.setAlertChannel, {
      organizationId: setup.team,
      channelId: "19:edits@thread.tacv2",
    });
    await setup.t.run((ctx) => notify(ctx, failure));
    await setup.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe(
      `${SERVICE}/v3/conversations/${encodeURIComponent("19:edits@thread.tacv2")}/activities`,
    );
    const card = (posted[0].body.attachments as { content: Record<string, unknown> }[])[0].content;
    expect(card).toMatchObject({ type: "AdaptiveCard" });
    expect(card.body).toEqual([
      expect.objectContaining({ text: "Weekly podcast clips failed (Add captions)" }),
      expect.objectContaining({ text: expect.stringMatching(/toolkit/i) }),
    ]);
    // A failure has no buttons, only the link to the run.
    expect(card.actions).toEqual([
      { type: "Action.OpenUrl", title: "Open the run", url: "http://localhost:3000/" },
    ]);
  });
});

describe("an approval in Teams", () => {
  /** The team linked, its channel picked, and a run waiting on an Approval step. */
  async function waiting(reviewers?: "maya") {
    const setup = await setUp();
    await linkOrganization(setup);
    await askPerson(setup.t, {
      tenantId: TENANT,
      aadObjectId: JORDAN.id,
      teamId: TEAM_ID,
      teamName: "Video team",
      serviceUrl: SERVICE,
    });
    await setup.owner.as.action(api.microsoftTeams.setAlertChannel, {
      organizationId: setup.team,
      channelId: "19:edits@thread.tacv2",
    });
    vi.useFakeTimers();
    const runId = await setup.t.run(async (ctx) => {
      const automationId = await ctx.db.insert("automations", {
        organizationId: setup.team,
        name: "Weekly clips",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [
          {
            id: "approval",
            kind: "approval",
            input: reviewers === "maya" ? { reviewers: [setup.member.id] } : {},
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: setup.owner.id,
        updatedAt: Date.now(),
      });
      const started = await startRun(
        ctx,
        (await ctx.db.get(automationId))!,
        "webhook",
        { file_url: "https://files.example/interview.mp4" },
        null,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
    await setup.t.finishAllScheduledFunctions(vi.runAllTimers);
    const step = await setup.t.run(
      async (ctx) =>
        (await ctx.db
          .query("runSteps")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .unique())!,
    );
    return { ...setup, step };
  }

  async function press(
    t: ReturnType<typeof backend>,
    body: Record<string, string>,
    secret = SECRET,
  ) {
    return await t.fetch("/teams/alert-action", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await agentToken(secret)}`,
      },
      body: JSON.stringify(body),
    });
  }

  test("posts a card with Approve and Send back, and tags who it waits for", async () => {
    const { step, member, team } = await waiting("maya");
    // With a channel picked, everyone gets a Teams switch in Settings, Notifications.
    expect(
      (await member.as.query(api.notifications.get, { organizationId: team })).chatApps,
    ).toEqual(["teams"]);
    // The approval card (an automation waiting also opens a review, posted as review news).
    const cards = posted.filter((one) => one.body.attachments);
    expect(cards).toHaveLength(1);
    const card = (cards[0].body.attachments as { content: Record<string, unknown> }[])[0].content;
    expect(card.body).toContainEqual(
      expect.objectContaining({ text: "Weekly clips is waiting for your approval (Approval)" }),
    );
    // Maya never linked her Microsoft account, so she is named but not tagged.
    expect(card.body).toContainEqual(expect.objectContaining({ text: "For Maya Ortiz" }));
    expect(card.actions).toEqual([
      {
        type: "Action.Submit",
        title: "Approve",
        style: "positive",
        data: { actionId: "ncat_alert_approve", value: step._id },
      },
      {
        type: "Action.Submit",
        title: "Send back",
        data: { actionId: "ncat_alert_send_back", value: step._id },
      },
      expect.objectContaining({ type: "Action.OpenUrl", title: "Open the run" }),
    ]);
  });

  test("Approve pressed in Teams approves as the linked member, and the card says so", async () => {
    const { t, step } = await waiting();
    const answer = await press(t, {
      tenantId: TENANT,
      aadObjectId: JORDAN.id,
      runStepId: step._id,
      decision: "approve",
    });
    expect(await answer.json()).toEqual({ ok: true, message: "Approved." });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await t.run(async (ctx) => await ctx.db.get(step._id));
    expect(after).toMatchObject({ status: "done" });
    const edit = posted.find((one) => one.method === "PUT")!;
    const sent = posted.findIndex((one) => one.method === "POST" && one.body.attachments);
    expect(edit.url).toBe(
      `${SERVICE}/v3/conversations/${encodeURIComponent("19:edits@thread.tacv2")}/activities/activity-${sent + 1}`,
    );
    const card = (edit.body.attachments as { content: Record<string, unknown> }[])[0].content;
    expect(card.body).toContainEqual(expect.objectContaining({ text: "Approved by Jordan Lee." }));
    expect(card.actions).toEqual([expect.objectContaining({ type: "Action.OpenUrl" })]);
  });

  test("someone without a linked account, another organization or a forged press is refused", async () => {
    const { t, step } = await waiting();
    const stranger = await press(t, {
      tenantId: TENANT,
      aadObjectId: "aad-nobody",
      runStepId: step._id,
      decision: "approve",
    });
    expect(await stranger.json()).toMatchObject({
      ok: false,
      message: expect.stringContaining("Link my Microsoft account"),
    });
    const elsewhere = await press(t, {
      tenantId: OTHER_TENANT,
      aadObjectId: JORDAN.id,
      runStepId: step._id,
      decision: "approve",
    });
    expect(await elsewhere.json()).toEqual({
      ok: false,
      message: "This approval no longer exists.",
    });
    const forged = await press(
      t,
      { tenantId: TENANT, aadObjectId: JORDAN.id, runStepId: step._id, decision: "approve" },
      "a-different-secret-that-is-also-long-enough",
    );
    expect(forged.status).toBe(401);
    const odd = await press(t, {
      tenantId: TENANT,
      aadObjectId: JORDAN.id,
      runStepId: step._id,
      decision: "delete",
    });
    expect(odd.status).toBe(400);
    const after = await t.run(async (ctx) => await ctx.db.get(step._id));
    expect(after?.status).toBe("waiting_approval");
  });
});

describe("the look of a Teams alert", () => {
  const alert = {
    title: "Client reel is waiting for your approval",
    lines: ["Check the hook", " "],
    link: "https://dash.test/runs/1",
    linkLabel: "Open the run",
    who: [
      { name: "Jordan Lee", aadObjectId: "aad-jordan" },
      { name: "Maya Ortiz", aadObjectId: null },
    ],
    runStepId: "step-1" as never,
    actions: [
      { id: "approve" as const, label: "Approve" },
      { id: "send_back" as const, label: "Send back" },
    ],
  };

  test("tags known accounts so Teams tells them, and names the rest", () => {
    const { content } = teamsCard(alert);
    expect(content.body).toContainEqual(
      expect.objectContaining({ text: "For <at>Jordan Lee</at>, Maya Ortiz" }),
    );
    expect(content.msteams).toEqual({
      entities: [
        {
          type: "mention",
          text: "<at>Jordan Lee</at>",
          mentioned: { id: "aad-jordan", name: "Jordan Lee" },
        },
      ],
    });
    // Blank lines are left out.
    expect(content.body).toHaveLength(3);
  });

  test("once decided, says how it ended and drops the buttons", () => {
    const { content } = teamsCard(alert, "Sent back by Maya Ortiz.");
    expect(content.body.at(-1)).toMatchObject({ text: "Sent back by Maya Ortiz." });
    expect(content.actions).toEqual([
      { type: "Action.OpenUrl", title: "Open the run", url: "https://dash.test/runs/1" },
    ]);
  });
});

describe("the Teams app a team uploads", () => {
  test("names the dashboard's bot and stays within Teams' limits", () => {
    const manifest = teamsManifest({
      botId: "c4d4ec4e-0000-0000-0000-000000000001",
      name: "A name far longer than Teams lets an app have",
      siteUrl: "https://dash.test/",
    });
    expect(manifest.id).toBe("c4d4ec4e-0000-0000-0000-000000000001");
    expect(manifest.bots[0]).toMatchObject({
      botId: "c4d4ec4e-0000-0000-0000-000000000001",
      scopes: ["personal", "team", "groupChat"],
    });
    expect(manifest.name.short.length).toBeLessThanOrEqual(30);
    expect(manifest.validDomains).toEqual(["dash.test"]);
  });

  test("is a zip with the manifest and both icons, served to anyone", async () => {
    const bytes = teamsAppPackage({ botId: "b", name: "Kontifi", siteUrl: "https://dash.test" });
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("PK\u0003\u0004")).toBe(true);
    for (const name of ["manifest.json", "color.png", "outline.png"]) expect(text).toContain(name);
    expect(zip([]).length).toBe(22);

    const { t } = await setUp();
    const served = await t.fetch("/teams/app.zip", { method: "GET" });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("application/zip");
    expect(served.headers.get("content-disposition")).toContain("Kontifi for Teams.zip");
  });
});

describe("after the Microsoft sign-in", () => {
  test("it returns to the Teams settings page, and reads the organization from the id token", () => {
    expect(settingsUrl("linked")).toBe("http://localhost:3000/settings/teams?teams=linked");
    expect(tenantOfIdToken(idToken({ tid: TENANT }))).toBe(TENANT);
    expect(tenantOfIdToken("not-a-token")).toBeNull();
  });
});
