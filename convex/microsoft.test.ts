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
// Files in other people's OneDrives shared with the signed-in account, and the scopes
// each token request asked for.
let sharedFiles: { driveId: string; item: Record<string, unknown> }[] = [];
let tokenScopes: string[] = [];
// Recordings Teams saved in a channel's files (SharePoint), and whether that channel has
// a Recordings folder yet.
let channelFiles: Record<string, unknown>[] = [];
let channelHasRecordings = true;

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
  sharedFiles = [];
  tokenScopes = [];
  channelFiles = [];
  channelHasRecordings = true;
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const bearer = String(headers.get("authorization")).replace("Bearer ", "");
    if (url === `${LOGIN}/oauth2/v2.0/token`) {
      const form = new URLSearchParams(String(init?.body ?? ""));
      tokenScopes.push(form.get("scope") ?? "");
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
    if (url.startsWith(`${GRAPH}/me/drive/search(q='Recording')`)) {
      // Microsoft's search finds the member's own files and files shared with them.
      return Response.json({
        value: [
          { id: "own-hit", name: "Mine-20261118_170302-Meeting Recording.mp4" },
          ...sharedFiles.map(({ driveId, item }) => ({
            id: `hit-${item.id}`,
            name: item.name,
            remoteItem: { id: item.id, parentReference: { driveId } },
          })),
        ],
      });
    }
    if (url.startsWith(`${GRAPH}/me/joinedTeams`)) {
      return Response.json({ value: [{ id: "team-video", displayName: "Video team" }] });
    }
    if (url.startsWith(`${GRAPH}/teams/team-video/channels?`)) {
      return Response.json({
        value: [
          { id: "19:general", displayName: "General" },
          { id: "19:edits", displayName: "Edits" },
        ],
      });
    }
    if (
      url === `${GRAPH}/teams/team-video/channels/${encodeURIComponent("19:edits")}/filesFolder`
    ) {
      return Response.json({
        id: "folder-edits",
        name: "Edits",
        folder: {},
        parentReference: { driveId: "drive-video" },
      });
    }
    if (url.startsWith(`${GRAPH}/drives/drive-video/items/folder-edits:/Recordings:/children`)) {
      return channelHasRecordings
        ? Response.json({ value: channelFiles })
        : Response.json({ error: { code: "itemNotFound" } }, { status: 404 });
    }
    if (url.startsWith(`${GRAPH}/drives/drive-video/items/`)) {
      const id = decodeURIComponent(
        url.slice(`${GRAPH}/drives/drive-video/items/`.length).split("?")[0],
      );
      const found = channelFiles.find((file) => file.id === id);
      return found
        ? Response.json({
            ...found,
            "@microsoft.graph.downloadUrl": `https://sharepoint.test/dl/${id}?t=channel`,
          })
        : Response.json({ error: { code: "itemNotFound" } }, { status: 404 });
    }
    if (url.startsWith(`${GRAPH}/drives/`)) {
      const [driveId, , itemId] = url
        .slice(`${GRAPH}/drives/`.length)
        .split("?")[0]
        .split("/")
        .map(decodeURIComponent);
      const found = sharedFiles.find((one) => one.driveId === driveId && one.item.id === itemId);
      return found
        ? Response.json({
            ...found.item,
            "@microsoft.graph.downloadUrl": `https://onedrive.test/dl/${itemId}?t=shared`,
          })
        : Response.json({ error: { code: "itemNotFound" } }, { status: 404 });
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
    // Kept in its own folder, beside the other places recordings come from.
    expect(upload.key).toMatch(/^uploads\/Microsoft Teams\/[0-9a-f-]+\//);
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
        shared: false,
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

describe("meetings shared with you", () => {
  /** Someone else's meeting recording, shared with the member, in its owner's OneDrive. */
  function sharedRecording(
    id = "shared-1",
    name = "Board Review-20261118_160000-Meeting Recording.mp4",
    minutesAgo = 1,
    size = 3_000_000,
  ) {
    return { driveId: "drive-ana", item: { ...recording(id, name, minutesAgo), size } };
  }

  /** Connects, then switches on shared meetings the way Settings does. */
  async function connectWithShared(setup: Awaited<ReturnType<typeof setUp>>) {
    await connect(setup);
    await runScheduled(setup.t);
    const url = await setup.owner.as.mutation(api.microsoft.startLink, {
      organizationId: setup.team,
      shared: true,
    });
    const result = await comeBack(setup.t, url, "c2", JORDAN);
    await runScheduled(setup.t);
    const [row] = await setup.t.run((ctx) => ctx.db.query("microsoftConnections").collect());
    return { url, result, row };
  }

  test("switching it on asks Microsoft for reading shared files, once", async () => {
    const setup = await setUp();
    await connect(setup);
    await runScheduled(setup.t);
    await expect(
      setup.owner.as.mutation(api.microsoft.setIncludeShared, {
        organizationId: setup.team,
        includeShared: true,
      }),
    ).rejects.toThrow(/allow reading files shared with you/);

    const { url, result } = await connectWithShared(setup);
    expect(new URL(url).searchParams.get("scope")).toBe(
      "offline_access User.Read Files.Read Files.Read.All",
    );
    expect(result).toBe("shared");
    expect(tokenScopes.at(-1)).toContain("Files.Read.All");
    const view = await setup.owner.as.query(api.microsoft.forTeam, { organizationId: setup.team });
    expect(view?.me).toMatchObject({ includeShared: true, sharedGranted: true });

    // Off and on again needs no new sign-in; a later sign-in keeps asking for it.
    const args = { organizationId: setup.team };
    await setup.owner.as.mutation(api.microsoft.setIncludeShared, {
      ...args,
      includeShared: false,
    });
    await setup.owner.as.mutation(api.microsoft.setIncludeShared, { ...args, includeShared: true });
    const again = await setup.owner.as.mutation(api.microsoft.startLink, args);
    expect(new URL(again).searchParams.get("scope")).toContain("Files.Read.All");
  });

  test("off by default: nothing shared comes in", async () => {
    const setup = await setUp();
    sharedFiles = [sharedRecording()];
    await connect(setup);
    await runScheduled(setup.t);
    const [row] = await setup.t.run((ctx) => ctx.db.query("microsoftConnections").collect());
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    expect(await uploads(setup.t)).toEqual([]);
    expect(row.includeShared).toBeUndefined();
  });

  test("a recording shared with you comes in from its owner's OneDrive", async () => {
    const setup = await setUp();
    const { row } = await connectWithShared(setup);
    sharedFiles = [
      sharedRecording(),
      // Other videos shared with the member, and a recording from before, stay out.
      { driveId: "drive-ana", item: { ...recording("holiday", "Holiday.mp4"), size: 9 } },
      sharedRecording("old", "Old-20260101_100000-Meeting Recording.mp4", 60 * 24, 4_000_000),
    ];
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    const [upload, ...more] = await uploads(setup.t);
    expect(more).toEqual([]);
    expect(upload).toMatchObject({
      fileName: expect.stringMatching(/^Board Review \d{4}-\d{2}-\d{2}\.mp4$/),
      size: 3_000_000,
      source: "microsoft",
    });
    const [job] = await jobs(setup.t);
    expect(job.input).toMatchObject({
      file_url: `${GRAPH}/drives/drive-ana/items/shared-1/content`,
    });
    await setup.t.action(internal.jobs.dispatch, { jobId: job._id });
    expect(toolkitCalls[0].body.file_url).toBe("https://onedrive.test/dl/shared-1?t=shared");

    // Switched off, a new shared recording waits.
    await setup.owner.as.mutation(api.microsoft.setIncludeShared, {
      organizationId: setup.team,
      includeShared: false,
    });
    sharedFiles.push(sharedRecording("shared-2", "Next-20261118_170000-Meeting Recording.mp4"));
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    expect(await uploads(setup.t)).toHaveLength(1);
  });

  test("a recording the organizer on the team already brought in is not brought in twice", async () => {
    const setup = await setUp();
    const { row } = await connectWithShared(setup);
    files = [recording("item-1", "Board Review-20261118_160000-Meeting Recording.mp4")];
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    expect(await uploads(setup.t)).toHaveLength(1);

    sharedFiles = [sharedRecording("shared-1", undefined, 1, 2_000_000)];
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    expect(await uploads(setup.t)).toHaveLength(1);
    const imports = await setup.t.run((ctx) => ctx.db.query("microsoftImports").collect());
    expect(imports.find((one) => one.driveId === "drive-ana")).toMatchObject({ status: "done" });
  });

  test("shared recordings are listed with your own, and can be brought in by hand", async () => {
    const setup = await setUp();
    files = [recording("mine-1", "Mine-20261116_170000-Meeting Recording.mp4", 60 * 24 * 3)];
    sharedFiles = [sharedRecording("shared-1", undefined, 60 * 24)];
    await connectWithShared(setup);
    const past = await setup.owner.as.action(api.microsoft.pastRecordings, {
      organizationId: setup.team,
    });
    expect(past.map((one) => [one.itemId, one.shared, one.driveId])).toEqual([
      ["shared-1", true, "drive-ana"],
      ["mine-1", false, undefined],
    ]);
    const args = { organizationId: setup.team, itemId: "shared-1", driveId: "drive-ana" };
    expect(await setup.owner.as.action(api.microsoft.bringIn, args)).toBe("started");
    expect(await setup.owner.as.action(api.microsoft.bringIn, args)).toBe("already");
    // The same file id in the member's own OneDrive is a different file.
    await expect(
      setup.owner.as.action(api.microsoft.bringIn, { ...args, driveId: undefined }),
    ).rejects.toThrow(/no longer has/);
  });

  test("a recording no longer shared with you fails for good, saying so", async () => {
    const setup = await setUp();
    const { row } = await connectWithShared(setup);
    sharedFiles = [sharedRecording()];
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    const [job] = await jobs(setup.t);
    sharedFiles = [];
    await setup.t.action(internal.jobs.dispatch, { jobId: job._id });
    const [one] = await setup.t.run((ctx) => ctx.db.query("microsoftImports").collect());
    expect(one).toMatchObject({
      status: "failed",
      error: "The recording is no longer shared with you.",
    });
  });
});

describe("channel meetings", () => {
  /** Connects, allows Teams channels the way Settings does, and picks the Edits channel. */
  async function connectWithChannel(setup: Awaited<ReturnType<typeof setUp>>) {
    await connect(setup);
    await runScheduled(setup.t);
    const url = await setup.owner.as.mutation(api.microsoft.startLink, {
      organizationId: setup.team,
      channels: true,
    });
    const result = await comeBack(setup.t, url, "c2", JORDAN);
    await runScheduled(setup.t);
    const args = { organizationId: setup.team };
    const listed = await setup.owner.as.action(api.microsoft.teamChannels, args);
    const picked = await setup.owner.as.action(api.microsoft.watchChannel, {
      ...args,
      teamId: "team-video",
      teamName: "Video team",
      channelId: "19:edits",
      channelName: "Edits",
    });
    const [row] = await setup.t.run((ctx) => ctx.db.query("microsoftConnections").collect());
    return { url, result, listed, picked, row };
  }

  test("picking channels first asks Microsoft to read the member's teams", async () => {
    const setup = await setUp();
    await connect(setup);
    await runScheduled(setup.t);
    const args = { organizationId: setup.team };
    await expect(setup.owner.as.action(api.microsoft.teamChannels, args)).rejects.toThrow(
      /allow reading your Teams channels/,
    );

    const { url, result, listed, picked } = await connectWithChannel(setup);
    const scope = new URL(url).searchParams.get("scope") ?? "";
    expect(scope).toContain("Team.ReadBasic.All");
    expect(scope).toContain("Channel.ReadBasic.All");
    expect(result).toBe("channels");
    expect(tokenScopes.at(-1)).toContain("Channel.ReadBasic.All");
    expect(listed).toEqual([
      {
        teamId: "team-video",
        teamName: "Video team",
        channels: [
          { id: "19:general", name: "General" },
          { id: "19:edits", name: "Edits" },
        ],
      },
    ]);
    expect(picked).toEqual({ ok: true });
    const view = await setup.owner.as.query(api.microsoft.forTeam, args);
    expect(view?.me?.channelsGranted).toBe(true);
    expect(view?.channels).toMatchObject([{ teamName: "Video team", channelName: "Edits" }]);

    // Picking it again keeps one; a later sign-in keeps asking for channels.
    await setup.owner.as.action(api.microsoft.watchChannel, {
      ...args,
      teamId: "team-video",
      teamName: "Video team",
      channelId: "19:edits",
      channelName: "Edits",
    });
    expect(await setup.t.run((ctx) => ctx.db.query("microsoftChannels").collect())).toHaveLength(1);
    const again = await setup.owner.as.mutation(api.microsoft.startLink, args);
    expect(new URL(again).searchParams.get("scope")).toContain("Channel.ReadBasic.All");
  });

  test("a channel meeting's recording comes in from the channel's files", async () => {
    const setup = await setUp();
    const { row } = await connectWithChannel(setup);
    channelFiles = [
      recording("chan-1", "Edit Review-20261118_150000-Meeting Recording.mp4"),
      // A recording from before the channel was picked stays out.
      recording("chan-old", "Old-20260101_100000-Meeting Recording.mp4", 60 * 24),
    ];
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    const [upload, ...more] = await uploads(setup.t);
    expect(more).toEqual([]);
    expect(upload).toMatchObject({
      fileName: expect.stringMatching(/^Edit Review \d{4}-\d{2}-\d{2}\.mp4$/),
      source: "microsoft",
    });
    const [job] = await jobs(setup.t);
    expect(job.input).toMatchObject({
      file_url: `${GRAPH}/drives/drive-video/items/chan-1/content`,
    });
    await setup.t.action(internal.jobs.dispatch, { jobId: job._id });
    expect(toolkitCalls[0].body.file_url).toBe("https://sharepoint.test/dl/chan-1?t=channel");

    // Looking again brings nothing in twice.
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    expect(await uploads(setup.t)).toHaveLength(1);
  });

  test("channel recordings come in even with your own meetings switched off", async () => {
    const setup = await setUp();
    const { row } = await connectWithChannel(setup);
    await setup.owner.as.mutation(api.microsoft.setAutoImport, {
      organizationId: setup.team,
      autoImport: false,
    });
    files = [recording("own-1")];
    channelFiles = [recording("chan-1", "Edit Review-20261118_150000-Meeting Recording.mp4")];
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    const all = await setup.t.run((ctx) => ctx.db.query("microsoftImports").collect());
    expect(all.map((one) => one.itemId)).toEqual(["chan-1"]);
  });

  test("no Recordings folder in the channel yet: nothing happens", async () => {
    const setup = await setUp();
    const { row } = await connectWithChannel(setup);
    channelHasRecordings = false;
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    expect(await uploads(setup.t)).toEqual([]);
  });

  test("stopping a channel, or disconnecting, means its recordings no longer come in", async () => {
    const setup = await setUp();
    const { row } = await connectWithChannel(setup);
    const args = { organizationId: setup.team };
    const [channel] = await setup.t.run((ctx) => ctx.db.query("microsoftChannels").collect());
    // Someone else on the team cannot stop it.
    await setup.member.as.mutation(api.microsoft.unwatchChannel, {
      ...args,
      channelRowId: channel._id,
    });
    expect(await setup.t.run((ctx) => ctx.db.query("microsoftChannels").collect())).toHaveLength(1);
    await setup.owner.as.mutation(api.microsoft.unwatchChannel, {
      ...args,
      channelRowId: channel._id,
    });
    channelFiles = [recording("chan-1", "Edit Review-20261118_150000-Meeting Recording.mp4")];
    await setup.owner.as.mutation(api.microsoft.setAutoImport, { ...args, autoImport: false });
    await setup.t.action(internal.microsoft.check, { connectionId: row._id });
    expect(await uploads(setup.t)).toEqual([]);

    await setup.owner.as.action(api.microsoft.watchChannel, {
      ...args,
      teamId: "team-video",
      teamName: "Video team",
      channelId: "19:edits",
      channelName: "Edits",
    });
    await setup.owner.as.mutation(api.microsoft.disconnect, args);
    expect(await setup.t.run((ctx) => ctx.db.query("microsoftChannels").collect())).toEqual([]);
  });
});
