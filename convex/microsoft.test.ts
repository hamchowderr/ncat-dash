import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { pickRecording, topicOf } from "./lib/microsoft";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit } from "./test.toolkit";

// Teams meetings brought in by themselves: a member connects their Microsoft 365 account
// from Settings, the dashboard watches their OneDrive, and when Teams saves a recording
// to the Recordings folder the team's toolkit streams it into the team's folder, where
// it becomes an upload like any other.

const LOGIN = "https://login.test/common";
const GRAPH = "https://graph.test/v1.0";

type MsUser = { id: string; displayName: string; mail: string | null; userPrincipalName: string };
let codes: Record<string, MsUser> = {};
let refreshes = 0;
let refuseRefresh = false;
let toolkitCalls: { url: string; body: Record<string, unknown> }[] = [];
let subscriptions: { method: string; url: string; body: Record<string, unknown> }[] = [];
let files: Record<string, unknown>[] = [];
let hasFolder = true;

beforeEach(() => {
  process.env.MICROSOFT_CLIENT_ID = "ms-client-id";
  process.env.MICROSOFT_CLIENT_SECRET = "ms-client-secret";
  process.env.MICROSOFT_LOGIN_URL = LOGIN;
  process.env.MICROSOFT_GRAPH_URL = GRAPH;
  process.env.CONVEX_SITE_URL = "https://site.test";
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  codes = {};
  refreshes = 0;
  refuseRefresh = false;
  toolkitCalls = [];
  subscriptions = [];
  files = [];
  hasFolder = true;
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const bearer = String(headers.get("authorization")).replace("Bearer ", "");
    if (url === `${LOGIN}/oauth2/v2.0/token`) {
      const form = new URLSearchParams(String(init?.body ?? ""));
      if (
        form.get("client_id") !== "ms-client-id" ||
        form.get("client_secret") !== "ms-client-secret"
      ) {
        return new Response("no", { status: 401 });
      }
      if (form.get("grant_type") === "refresh_token") {
        if (refuseRefresh || form.get("refresh_token") !== "refresh-1") {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        refreshes++;
        return Response.json({
          access_token: "access-2",
          refresh_token: "refresh-1",
          expires_in: 3600,
        });
      }
      if (
        !codes[form.get("code") ?? ""] ||
        form.get("redirect_uri") !== "https://site.test/microsoft/callback"
      ) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({
        access_token: `access-${form.get("code")}`,
        refresh_token: "refresh-1",
        expires_in: 3600,
      });
    }
    if (!bearer.startsWith("access-") && url.startsWith(GRAPH)) {
      return new Response("no", { status: 401 });
    }
    if (url === `${GRAPH}/me`) {
      const user = codes[bearer.replace("access-", "")] ?? Object.values(codes)[0];
      return user ? Response.json(user) : new Response("no", { status: 401 });
    }
    if (url === `${GRAPH}/me/drive/special/recordings`) {
      return hasFolder
        ? Response.json({ id: "folder-rec", name: "Recordings", folder: { childCount: 1 } })
        : Response.json({ error: { code: "itemNotFound" } }, { status: 404 });
    }
    if (url === `${GRAPH}/me/drive/root:/Recordings`) {
      return Response.json({ error: { code: "itemNotFound" } }, { status: 404 });
    }
    if (url.startsWith(`${GRAPH}/me/drive/items/folder-rec/children`)) {
      return Response.json({ value: files });
    }
    if (url.startsWith(`${GRAPH}/me/drive/items/`)) {
      const id = decodeURIComponent(url.slice(`${GRAPH}/me/drive/items/`.length));
      const found = files.find((file) => file.id === id);
      return found
        ? Response.json({
            ...found,
            "@microsoft.graph.downloadUrl": `https://onedrive.test/dl/${id}?t=fresh`,
          })
        : Response.json({ error: { code: "itemNotFound" } }, { status: 404 });
    }
    if (url.startsWith(`${GRAPH}/subscriptions`)) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      subscriptions.push({ method, url, body });
      if (method === "POST") {
        return Response.json(
          { id: "sub-1", expirationDateTime: body.expirationDateTime },
          { status: 201 },
        );
      }
      return method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json({ id: "sub-1" });
    }
    if (url.startsWith("https://toolkit.example/")) {
      toolkitCalls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return Response.json({ code: 202, job_id: "toolkit-job-1" }, { status: 202 });
    }
    return new Response("unknown", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const key of [
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
    "MICROSOFT_LOGIN_URL",
    "MICROSOFT_GRAPH_URL",
    "CONVEX_SITE_URL",
  ]) {
    delete process.env[key];
  }
});

const JORDAN: MsUser = {
  id: "ms-user-jordan",
  displayName: "Jordan Lee",
  mail: "jordan@salthouse.test",
  userPrincipalName: "jordan@salthouse.onmicrosoft.test",
};

/** A recording Teams saved, the way OneDrive lists it. */
function recording(
  id = "item-1",
  name = "Weekly Sync-20261118_170302-Meeting Recording.mp4",
  minutesAgo = 1,
) {
  return {
    id,
    name,
    size: 2_000_000,
    createdDateTime: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    lastModifiedDateTime: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    file: { mimeType: "video/mp4" },
    video: { duration: 42 * 60_000 },
  };
}

async function setUp({ toolkit = true } = {}) {
  // Scheduled work waits until a test runs it, so each test says when.
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Jordan Lee", [team], "owner");
  const member = await addPerson(t, "Maya Ortiz", [team], "member");
  if (toolkit) await connectToolkit(t, team, owner.id);
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
  return new URL(back.headers.get("location") ?? "").searchParams.get("microsoft");
}

async function connect(setup: Awaited<ReturnType<typeof setUp>>, user = JORDAN) {
  const url = await setup.owner.as.mutation(api.microsoft.startLink, {
    organizationId: setup.team,
  });
  return await comeBack(setup.t, url, "c1", user);
}

async function runScheduled(t: ReturnType<typeof backend>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

const uploads = (t: ReturnType<typeof backend>) =>
  t.run((ctx) => ctx.db.query("uploads").collect());
const jobs = (t: ReturnType<typeof backend>) => t.run((ctx) => ctx.db.query("jobs").collect());

describe("reading OneDrive", () => {
  test("the meeting's name comes from Teams' file name", () => {
    expect(topicOf("Weekly Sync-20261118_170302-Meeting Recording.mp4")).toBe("Weekly Sync");
    expect(topicOf("Kundengespräch-20261118_170302-Besprechungsaufzeichnung.mp4")).toBe(
      "Kundengespräch",
    );
    expect(topicOf("My upload.mp4")).toBe("My upload");
  });

  test("only finished videos count, and the meeting started its length before the file", () => {
    const now = Date.UTC(2026, 10, 18, 18);
    const picked = pickRecording(
      { ...recording(), createdDateTime: new Date(now).toISOString() },
      now,
    );
    expect(picked).toMatchObject({ itemId: "item-1", topic: "Weekly Sync", minutes: 42 });
    expect(picked?.startTime).toBe(now - 42 * 60_000);
    expect(pickRecording({ ...recording(), file: { mimeType: "text/vtt" } }, now)).toBeNull();
    expect(pickRecording({ ...recording(), size: 0 }, now)).toBeNull();
    expect(pickRecording({ id: "f", name: "Folder", folder: {} }, now)).toBeNull();
  });
});

describe("connecting Microsoft 365", () => {
  test("a member signs in, Settings shows the account, and the OneDrive is watched", async () => {
    const setup = await setUp();
    const url = await setup.owner.as.mutation(api.microsoft.startLink, {
      organizationId: setup.team,
    });
    const start = new URL(url);
    expect(start.origin + start.pathname).toBe(`${LOGIN}/oauth2/v2.0/authorize`);
    expect(start.searchParams.get("client_id")).toBe("ms-client-id");
    expect(start.searchParams.get("redirect_uri")).toBe("https://site.test/microsoft/callback");
    expect(start.searchParams.get("scope")).toBe("offline_access User.Read Files.Read");

    expect(await comeBack(setup.t, url, "c1", JORDAN)).toBe("connected");
    await runScheduled(setup.t);
    const view = await setup.owner.as.query(api.microsoft.forTeam, { organizationId: setup.team });
    expect(view?.me).toMatchObject({
      msName: "Jordan Lee",
      msEmail: JORDAN.mail,
      autoImport: true,
      needsReconnect: false,
    });
    const memberView = await setup.member.as.query(api.microsoft.forTeam, {
      organizationId: setup.team,
    });
    expect(memberView?.me).toBeNull();
    expect(memberView?.others).toEqual([{ msName: "Jordan Lee", memberName: "Jordan Lee" }]);

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].body).toMatchObject({
      changeType: "updated",
      notificationUrl: "https://site.test/microsoft/events",
      resource: "/me/drive/root",
    });
    const [row] = await setup.t.run((ctx) => ctx.db.query("microsoftConnections").collect());
    expect(row.subscriptionId).toBe("sub-1");
    expect(row.clientState).toBe(subscriptions[0].body.clientState);
    expect(row.recordingsFolderId).toBe("folder-rec");
    expect(row.accessTokenCipher).not.toContain("access-c1");
    expect(row.refreshTokenCipher).not.toContain("refresh-1");
  });

  test("an unknown sign-in, or an account already on another team, is refused", async () => {
    const setup = await setUp();
    const madeUp = await setup.t.fetch("/microsoft/callback?code=c9&state=nope", { method: "GET" });
    expect(new URL(madeUp.headers.get("location")!).searchParams.get("microsoft")).toBe("expired");
    const closed = await setup.t.fetch("/microsoft/callback?error=access_denied", {
      method: "GET",
    });
    expect(new URL(closed.headers.get("location")!).searchParams.get("microsoft")).toBe(
      "cancelled",
    );

    await connect(setup);
    const otherTeam = await addTeam(setup.t, "Other Studio");
    const stranger = await addPerson(setup.t, "Sam Park", [otherTeam]);
    const url = await stranger.as.mutation(api.microsoft.startLink, { organizationId: otherTeam });
    expect(await comeBack(setup.t, url, "c2", JORDAN)).toBe("taken");
  });

  test("nothing to press when the dashboard has no Microsoft app", async () => {
    delete process.env.MICROSOFT_CLIENT_SECRET;
    const setup = await setUp();
    expect(
      (await setup.owner.as.query(api.microsoft.forTeam, { organizationId: setup.team }))?.ready,
    ).toBe(false);
    await expect(
      setup.owner.as.mutation(api.microsoft.startLink, { organizationId: setup.team }),
    ).rejects.toThrow(/not set up/);
  });

  test("disconnecting forgets the account and stops the watch", async () => {
    const setup = await setUp();
    await connect(setup);
    await runScheduled(setup.t);
    await setup.owner.as.mutation(api.microsoft.disconnect, { organizationId: setup.team });
    await runScheduled(setup.t);
    expect(await setup.t.run((ctx) => ctx.db.query("microsoftConnections").collect())).toEqual([]);
    expect(subscriptions.at(-1)).toMatchObject({
      method: "DELETE",
      url: `${GRAPH}/subscriptions/sub-1`,
    });
  });
});

describe("Microsoft's change notices", () => {
  test("Microsoft's check of the address is answered with its token, as plain text", async () => {
    const setup = await setUp();
    const answer = await setup.t.fetch("/microsoft/events?validationToken=abc%20123", {
      method: "POST",
    });
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toContain("text/plain");
    expect(await answer.text()).toBe("abc 123");
  });

  test("a notice for the watch brings the new recording in, once", async () => {
    const setup = await setUp();
    await connect(setup);
    await runScheduled(setup.t);
    files = [
      recording(),
      { ...recording("notes-1", "Weekly Sync notes.vtt"), file: { mimeType: "text/vtt" } },
    ];
    const [row] = await setup.t.run((ctx) => ctx.db.query("microsoftConnections").collect());
    const notice = {
      value: [{ subscriptionId: "sub-1", clientState: row.clientState, changeType: "updated" }],
    };
    const answer = await setup.t.fetch("/microsoft/events", {
      method: "POST",
      body: JSON.stringify(notice),
    });
    expect(answer.status).toBe(202);
    // Microsoft sends several notices for one change: still one upload.
    await setup.t.fetch("/microsoft/events", { method: "POST", body: JSON.stringify(notice) });
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });

    const [upload, ...more] = await uploads(setup.t);
    expect(more).toEqual([]);
    expect(upload).toMatchObject({
      fileName: expect.stringMatching(/^Weekly Sync \d{4}-\d{2}-\d{2}\.mp4$/),
      contentType: "video/mp4",
      size: 2_000_000,
      status: "uploading",
      source: "microsoft",
      createdBy: setup.owner.id,
    });
    const [job] = await jobs(setup.t);
    expect(job.stepId).toBe("storage-upload-s3");
    expect(job.input).toEqual({
      file_url: `${GRAPH}/me/drive/items/item-1/content`,
      filename: `teams/${setup.team}/${upload.key}`,
    });
    expect(await setup.owner.as.query(api.jobs.list, { organizationId: setup.team })).toEqual([]);
  });

  test("a notice with the wrong secret, or for a watch nobody has, does nothing", async () => {
    const setup = await setUp();
    await connect(setup);
    await runScheduled(setup.t);
    files = [recording()];
    for (const value of [
      [{ subscriptionId: "sub-1", clientState: "made-up" }],
      [{ subscriptionId: "sub-9", clientState: "made-up" }],
    ]) {
      const answer = await setup.t.fetch("/microsoft/events", {
        method: "POST",
        body: JSON.stringify({ value }),
      });
      expect(answer.status).toBe(202);
    }
    await runScheduled(setup.t);
    expect(await uploads(setup.t)).toEqual([]);
  });

  test("recordings from before connecting wait to be brought in by hand", async () => {
    const setup = await setUp();
    files = [recording("old-1", "Old Call-20261001_100000-Meeting Recording.mp4", 60 * 24 * 3)];
    await connect(setup);
    await runScheduled(setup.t);
    expect(await uploads(setup.t)).toEqual([]);
  });

  test("with bringing in switched off, a new recording waits", async () => {
    const setup = await setUp();
    await connect(setup);
    await runScheduled(setup.t);
    await setup.owner.as.mutation(api.microsoft.setAutoImport, {
      organizationId: setup.team,
      autoImport: false,
    });
    files = [recording()];
    const [row] = await setup.t.run((ctx) => ctx.db.query("microsoftConnections").collect());
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    expect(await uploads(setup.t)).toEqual([]);
  });

  test("with no toolkit, the import says what to do", async () => {
    const setup = await setUp({ toolkit: false });
    files = [recording()];
    await connect(setup);
    await runScheduled(setup.t);
    const view = await setup.owner.as.query(api.microsoft.forTeam, { organizationId: setup.team });
    expect(view?.imports).toMatchObject([
      { status: "failed", error: expect.stringMatching(/toolkit/) },
    ]);
    expect(await uploads(setup.t)).toEqual([]);
  });

  test("no Recordings folder yet: nothing happens until Teams makes one", async () => {
    const setup = await setUp();
    hasFolder = false;
    await connect(setup);
    await runScheduled(setup.t);
    const [row] = await setup.t.run((ctx) => ctx.db.query("microsoftConnections").collect());
    expect(row.recordingsFolderId).toBeUndefined();
    hasFolder = true;
    files = [recording()];
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    expect(await uploads(setup.t)).toHaveLength(1);
  });

  test("the check every 15 minutes renews a watch that is running out", async () => {
    const setup = await setUp();
    await connect(setup);
    await runScheduled(setup.t);
    await setup.t.run(async (ctx) => {
      const [row] = await ctx.db.query("microsoftConnections").collect();
      await ctx.db.patch(row._id, { subscriptionExpiresAt: Date.now() + 60_000 });
    });
    await setup.t.action(internal.microsoft.sweep, {});
    await runScheduled(setup.t);
    expect(subscriptions.at(-1)).toMatchObject({
      method: "PATCH",
      url: `${GRAPH}/subscriptions/sub-1`,
    });
    const [row] = await setup.t.run((ctx) => ctx.db.query("microsoftConnections").collect());
    expect(row.subscriptionExpiresAt).toBeGreaterThan(Date.now() + 20 * 24 * 60 * 60 * 1000);
  });

  test("a sign-in Microsoft no longer accepts asks the member to connect again", async () => {
    const setup = await setUp();
    await connect(setup);
    await runScheduled(setup.t);
    refuseRefresh = true;
    const [row] = await setup.t.run((ctx) => ctx.db.query("microsoftConnections").collect());
    await setup.t.run((ctx) => ctx.db.patch(row._id, { expiresAt: Date.now() - 1000 }));
    files = [recording()];
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    const view = await setup.owner.as.query(api.microsoft.forTeam, { organizationId: setup.team });
    expect(view?.me?.needsReconnect).toBe(true);
    expect(await uploads(setup.t)).toEqual([]);
  });
});

describe("the toolkit bringing a recording in", () => {
  async function started() {
    const setup = await setUp();
    await connect(setup);
    await runScheduled(setup.t);
    files = [recording()];
    const [row] = await setup.t.run((ctx) => ctx.db.query("microsoftConnections").collect());
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    const [job] = await jobs(setup.t);
    return { ...setup, job };
  }

  test("the toolkit is sent a fresh OneDrive link as the job goes, never a sign-in", async () => {
    const { t, job } = await started();
    await t.action(internal.jobs.dispatch, { jobId: job._id });
    expect(toolkitCalls).toHaveLength(1);
    expect(toolkitCalls[0].url).toBe("https://toolkit.example/v1/s3/upload");
    expect(toolkitCalls[0].body.file_url).toBe("https://onedrive.test/dl/item-1?t=fresh");
    expect(JSON.stringify(toolkitCalls[0].body)).not.toContain("access-");
    expect((await t.run((ctx) => ctx.db.get(job._id)))?.status).toBe("running");
  });

  test("an expired access token is renewed first", async () => {
    const { t, job } = await started();
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("microsoftConnections").collect();
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1000 });
    });
    await t.action(internal.jobs.dispatch, { jobId: job._id });
    expect(refreshes).toBe(1);
    expect(toolkitCalls[0].body.file_url).toBe("https://onedrive.test/dl/item-1?t=fresh");
  });

  test("a recording deleted from OneDrive fails for good, saying so", async () => {
    const { t, team, owner, job } = await started();
    files = [];
    await t.action(internal.jobs.dispatch, { jobId: job._id });
    expect(toolkitCalls).toEqual([]);
    const view = await owner.as.query(api.microsoft.forTeam, { organizationId: team });
    expect(view?.imports).toMatchObject([
      { status: "failed", error: "The recording is no longer in OneDrive." },
    ]);
  });

  test("once the file is in, it is a ready upload in the library", async () => {
    const { t, team, owner, job } = await started();
    await t.mutation(internal.jobs.finish, {
      jobId: job._id,
      ok: true,
      result: { file_url: "https://r2.example/x.mp4" },
    });
    const [upload] = await uploads(t);
    expect(upload.status).toBe("ready");
    const library = await t.run((ctx) => ctx.db.query("libraryItems").collect());
    expect(library.map((item) => item.uploadId)).toEqual([upload._id]);
    const view = await owner.as.query(api.microsoft.forTeam, { organizationId: team });
    expect(view?.imports).toMatchObject([{ topic: "Weekly Sync", status: "done" }]);
    expect(await owner.as.query(api.jobs.outputs, { organizationId: team })).toEqual([]);
  });

  test("a failed copy says why, takes the upload away, and can be brought in again", async () => {
    const { t, team, owner, job } = await started();
    await t.mutation(internal.jobs.finish, { jobId: job._id, ok: false, error: "403 Forbidden" });
    expect(await uploads(t)).toEqual([]);
    const past = await owner.as.action(api.microsoft.pastRecordings, { organizationId: team });
    expect(past).toMatchObject([{ itemId: "item-1", brought: false, minutes: 42 }]);
    expect(
      await owner.as.action(api.microsoft.bringIn, { organizationId: team, itemId: "item-1" }),
    ).toBe("started");
    const imports = await t.run((ctx) => ctx.db.query("microsoftImports").collect());
    expect(imports).toHaveLength(1);
    expect(imports[0].status).toBe("importing");
    expect(imports[0].jobId).not.toBe(job._id as Id<"jobs">);
  });
});

describe("past recordings", () => {
  test("lists the last 30 days, and brings one in by hand once", async () => {
    const setup = await setUp();
    files = [
      recording("old-1", "Client Kickoff-20261116_170000-Meeting Recording.mp4", 60 * 24 * 2),
      recording("ancient", "Long Ago-20260801_170000-Meeting Recording.mp4", 60 * 24 * 60),
    ];
    await connect(setup);
    await runScheduled(setup.t);
    const past = await setup.owner.as.action(api.microsoft.pastRecordings, {
      organizationId: setup.team,
    });
    expect(past).toEqual([
      {
        itemId: "old-1",
        topic: "Client Kickoff",
        startTime: expect.any(Number),
        minutes: 42,
        size: 2_000_000,
        brought: false,
      },
    ]);
    const args = { organizationId: setup.team, itemId: "old-1" };
    expect(await setup.owner.as.action(api.microsoft.bringIn, args)).toBe("started");
    expect(await setup.owner.as.action(api.microsoft.bringIn, args)).toBe("already");
    const again = await setup.owner.as.action(api.microsoft.pastRecordings, {
      organizationId: setup.team,
    });
    expect(again[0].brought).toBe(true);
    await expect(
      setup.owner.as.action(api.microsoft.bringIn, { ...args, itemId: "ancient" }),
    ).rejects.toThrow(/no longer has/);
  });

  test("someone who has not connected is asked to", async () => {
    const setup = await setUp();
    await expect(
      setup.member.as.action(api.microsoft.pastRecordings, { organizationId: setup.team }),
    ).rejects.toThrow(/Connect your Microsoft account/);
  });
});
