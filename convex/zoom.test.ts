import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isFromZoom, pickRecordingFile, recordingFileName } from "./lib/zoom";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit } from "./test.toolkit";

// Zoom meetings brought in by themselves: a member connects their Zoom from Settings,
// Zoom says when a cloud recording is finished, and the team's toolkit streams the file
// from Zoom into the team's folder, where it becomes an upload like any other.

const SECRET = "zoom-webhook-secret-token";

type ZoomUser = { id: string; account_id: string; email: string; display_name: string };
let codes: Record<string, ZoomUser> = {};
let refreshes = 0;
let toolkitCalls: { url: string; body: Record<string, unknown> }[] = [];
let recordings: unknown[] = [];

beforeEach(() => {
  process.env.ZOOM_CLIENT_ID = "zoom-client-id";
  process.env.ZOOM_CLIENT_SECRET = "zoom-client-secret";
  process.env.ZOOM_WEBHOOK_SECRET = SECRET;
  process.env.ZOOM_OAUTH_URL = "https://zoom.test";
  process.env.ZOOM_API_URL = "https://api.zoom.test/v2";
  process.env.CONVEX_SITE_URL = "https://site.test";
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  codes = {};
  refreshes = 0;
  toolkitCalls = [];
  recordings = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url === "https://zoom.test/oauth/token") {
      const expected = `Basic ${btoa("zoom-client-id:zoom-client-secret")}`;
      if (headers.get("authorization") !== expected) return new Response("no", { status: 401 });
      const form = new URLSearchParams(String(init?.body ?? ""));
      if (form.get("grant_type") === "refresh_token") {
        if (form.get("refresh_token") !== "refresh-1") return new Response("no", { status: 400 });
        refreshes++;
        return Response.json({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 3600,
        });
      }
      if (
        !codes[form.get("code") ?? ""] ||
        form.get("redirect_uri") !== "https://site.test/zoom/callback"
      ) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({
        access_token: `access-${form.get("code")}`,
        refresh_token: "refresh-1",
        expires_in: 3600,
      });
    }
    if (url === "https://api.zoom.test/v2/users/me") {
      const code = String(headers.get("authorization")).replace("Bearer access-", "");
      return codes[code] ? Response.json(codes[code]) : new Response("no", { status: 401 });
    }
    if (url.startsWith("https://api.zoom.test/v2/users/me/recordings")) {
      return Response.json({ meetings: recordings });
    }
    if (url === "https://zoom.test/oauth/revoke?token=refresh-1") return Response.json({});
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
    "ZOOM_CLIENT_ID",
    "ZOOM_CLIENT_SECRET",
    "ZOOM_WEBHOOK_SECRET",
    "ZOOM_OAUTH_URL",
    "ZOOM_API_URL",
    "CONVEX_SITE_URL",
  ]) {
    delete process.env[key];
  }
});

const JORDAN: ZoomUser = {
  id: "zoom-user-jordan",
  account_id: "zoom-account-1",
  email: "jordan@salthouse.test",
  display_name: "Jordan Lee",
};

async function setUp({ toolkit = true } = {}) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Jordan Lee", [team], "owner");
  const member = await addPerson(t, "Maya Ortiz", [team], "member");
  if (toolkit) await connectToolkit(t, team, owner.id);
  return { t, team, owner, member };
}

/** Plays Zoom: the person signs in, and Zoom sends them back with a code. */
async function comeBack(
  t: ReturnType<typeof backend>,
  startUrl: string,
  code: string,
  user: ZoomUser,
) {
  codes[code] = user;
  const state = new URL(startUrl).searchParams.get("state");
  const back = await t.fetch(`/zoom/callback?code=${code}&state=${state}`, { method: "GET" });
  expect(back.status).toBe(302);
  return new URL(back.headers.get("location") ?? "").searchParams.get("zoom");
}

async function connect(setup: Awaited<ReturnType<typeof setUp>>, user = JORDAN) {
  const url = await setup.owner.as.mutation(api.zoom.startLink, { organizationId: setup.team });
  return await comeBack(setup.t, url, "c1", user);
}

/** Sends an event signed the way Zoom signs them. */
async function sendEvent(
  t: ReturnType<typeof backend>,
  event: unknown,
  { secret = SECRET, timestamp = String(Math.floor(Date.now() / 1000)) } = {},
) {
  const body = JSON.stringify(event);
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  return await t.fetch("/zoom/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zm-request-timestamp": timestamp,
      "x-zm-signature": signature,
    },
    body,
  });
}

const FILES = [
  {
    id: "file-gallery",
    file_type: "MP4",
    file_extension: "MP4",
    file_size: 900,
    recording_type: "gallery_view",
    download_url: "https://zoom.test/rec/download/gallery",
    status: "completed",
  },
  {
    id: "file-screen",
    file_type: "MP4",
    file_extension: "MP4",
    file_size: 2_000_000,
    recording_type: "shared_screen_with_speaker_view",
    download_url: "https://zoom.test/rec/download/screen",
    status: "completed",
  },
  {
    id: "file-audio",
    file_type: "M4A",
    file_size: 100,
    recording_type: "audio_only",
    download_url: "https://zoom.test/rec/download/audio",
    status: "completed",
  },
];

function completed(hostId = JORDAN.id, files: unknown[] = FILES) {
  return {
    event: "recording.completed",
    event_ts: Date.now(),
    download_token: "zoom-download-token",
    payload: {
      account_id: "zoom-account-1",
      object: {
        uuid: "meeting-uuid-1==",
        id: 123456789,
        host_id: hostId,
        topic: "Weekly Sync: Launch / Plan",
        start_time: "2026-11-18T17:00:00Z",
        duration: 42,
        recording_files: files,
      },
    },
  };
}

describe("picking the file to bring in", () => {
  test("the shared screen with the speaker comes first, then the sound alone", () => {
    expect(pickRecordingFile(FILES)?.id).toBe("file-screen");
    expect(pickRecordingFile([FILES[2]])).toMatchObject({ id: "file-audio", extension: "m4a" });
    expect(pickRecordingFile([{ ...FILES[1], status: "processing" }])).toBeNull();
    expect(pickRecordingFile([])).toBeNull();
  });

  test("names the file after the meeting and its day", () => {
    expect(recordingFileName("Weekly Sync: Launch / Plan", Date.UTC(2026, 10, 18, 17), "mp4")).toBe(
      "Weekly Sync Launch Plan 2026-11-18.mp4",
    );
    expect(recordingFileName("  ", Date.UTC(2026, 10, 18), "m4a")).toBe(
      "Zoom meeting 2026-11-18.m4a",
    );
  });

  test("an event is from Zoom only with the right signature, and only while it is fresh", async () => {
    const now = Date.UTC(2026, 10, 18, 17);
    const stamp = String(now / 1000);
    const sign = (key: string) =>
      `v0=${createHmac("sha256", key).update(`v0:${stamp}:{}`).digest("hex")}`;
    expect(await isFromZoom(SECRET, stamp, "{}", sign(SECRET), now)).toBe(true);
    expect(await isFromZoom(SECRET, stamp, "{}", sign("other"), now)).toBe(false);
    expect(await isFromZoom(SECRET, stamp, "{ }", sign(SECRET), now)).toBe(false);
    expect(await isFromZoom(SECRET, stamp, "{}", sign(SECRET), now + 10 * 60 * 1000)).toBe(false);
  });
});

describe("connecting Zoom", () => {
  test("a member signs in with Zoom and Settings shows their account; tokens are kept secret", async () => {
    const setup = await setUp();
    const url = await setup.owner.as.mutation(api.zoom.startLink, { organizationId: setup.team });
    const start = new URL(url);
    expect(start.origin + start.pathname).toBe("https://zoom.test/oauth/authorize");
    expect(start.searchParams.get("client_id")).toBe("zoom-client-id");
    expect(start.searchParams.get("redirect_uri")).toBe("https://site.test/zoom/callback");

    expect(await comeBack(setup.t, url, "c1", JORDAN)).toBe("connected");
    const view = await setup.owner.as.query(api.zoom.forTeam, { organizationId: setup.team });
    expect(view?.me).toMatchObject({
      zoomName: "Jordan Lee",
      zoomEmail: JORDAN.email,
      autoImport: true,
    });
    const memberView = await setup.member.as.query(api.zoom.forTeam, {
      organizationId: setup.team,
    });
    expect(memberView?.me).toBeNull();
    expect(memberView?.others).toEqual([{ zoomName: "Jordan Lee", memberName: "Jordan Lee" }]);

    const [row] = await setup.t.run((ctx) => ctx.db.query("zoomConnections").collect());
    expect(row.accessTokenCipher).not.toContain("access-c1");
    expect(row.refreshTokenCipher).not.toContain("refresh-1");
  });

  test("a sign-in that is unknown, or a Zoom account already on another team, is refused", async () => {
    const setup = await setUp();
    const madeUp = await setup.t.fetch("/zoom/callback?code=c9&state=nope", { method: "GET" });
    expect(new URL(madeUp.headers.get("location")!).searchParams.get("zoom")).toBe("expired");
    const closed = await setup.t.fetch("/zoom/callback?error=access_denied", { method: "GET" });
    expect(new URL(closed.headers.get("location")!).searchParams.get("zoom")).toBe("cancelled");

    await connect(setup);
    const otherTeam = await addTeam(setup.t, "Other Studio");
    const stranger = await addPerson(setup.t, "Sam Park", [otherTeam]);
    const url = await stranger.as.mutation(api.zoom.startLink, { organizationId: otherTeam });
    expect(await comeBack(setup.t, url, "c2", JORDAN)).toBe("taken");
  });

  test("nothing to press when the dashboard has no Zoom app", async () => {
    delete process.env.ZOOM_WEBHOOK_SECRET;
    const setup = await setUp();
    expect(
      (await setup.owner.as.query(api.zoom.forTeam, { organizationId: setup.team }))?.ready,
    ).toBe(false);
    await expect(
      setup.owner.as.mutation(api.zoom.startLink, { organizationId: setup.team }),
    ).rejects.toThrow(/not set up/);
  });

  test("disconnecting forgets the account and tells Zoom", async () => {
    vi.useFakeTimers();
    const setup = await setUp();
    await connect(setup);
    await setup.owner.as.mutation(api.zoom.disconnect, { organizationId: setup.team });
    await setup.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await setup.t.run((ctx) => ctx.db.query("zoomConnections").collect())).toEqual([]);
  });
});

describe("Zoom's events", () => {
  test("Zoom's check of the address is answered with the signed token", async () => {
    const setup = await setUp();
    const answer = await setup.t.fetch("/zoom/events", {
      method: "POST",
      body: JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: "abc123" } }),
    });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      plainToken: "abc123",
      encryptedToken: createHmac("sha256", SECRET).update("abc123").digest("hex"),
    });
  });

  test("an event signed with the wrong secret, or too old, does nothing", async () => {
    const setup = await setUp();
    await connect(setup);
    expect((await sendEvent(setup.t, completed(), { secret: "wrong" })).status).toBe(401);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect((await sendEvent(setup.t, completed(), { timestamp: old })).status).toBe(401);
    expect(await setup.t.run((ctx) => ctx.db.query("uploads").collect())).toEqual([]);
  });

  test("a finished recording becomes an upload on its way, streamed by the toolkit", async () => {
    const setup = await setUp();
    await connect(setup);
    expect((await sendEvent(setup.t, completed())).status).toBe(204);
    // Zoom sends an event again when an answer is slow: still one upload.
    await sendEvent(setup.t, completed());

    const uploads = await setup.t.run((ctx) => ctx.db.query("uploads").collect());
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      fileName: "Weekly Sync Launch Plan 2026-11-18.mp4",
      contentType: "video/mp4",
      size: 2_000_000,
      status: "uploading",
      source: "zoom",
      createdBy: setup.owner.id,
    });
    expect(uploads[0].key).toMatch(
      /^uploads\/[0-9a-f-]+\/Weekly-Sync-Launch-Plan-2026-11-18\.mp4$/,
    );

    const jobs = await setup.t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs).toHaveLength(1);
    expect(jobs[0].stepId).toBe("storage-upload-s3");
    expect(jobs[0].input).toEqual({
      file_url: "https://zoom.test/rec/download/screen",
      filename: `teams/${setup.team}/${uploads[0].key}`,
    });
    // The download token is never kept where the job is.
    expect(JSON.stringify(jobs[0])).not.toContain("zoom-download-token");
    // Step jobs on the Steps page leave it out.
    expect(await setup.owner.as.query(api.jobs.list, { organizationId: setup.team })).toEqual([]);

    const view = await setup.owner.as.query(api.zoom.forTeam, { organizationId: setup.team });
    expect(view?.imports).toMatchObject([
      { topic: "Weekly Sync: Launch / Plan", status: "importing" },
    ]);
  });

  test("with bringing in switched off, a finished recording waits", async () => {
    const setup = await setUp();
    await connect(setup);
    await setup.owner.as.mutation(api.zoom.setAutoImport, {
      organizationId: setup.team,
      autoImport: false,
    });
    await sendEvent(setup.t, completed());
    expect(await setup.t.run((ctx) => ctx.db.query("uploads").collect())).toEqual([]);
  });

  test("a recording of someone not connected, or with nothing finished, is left alone", async () => {
    const setup = await setUp();
    await connect(setup);
    await sendEvent(setup.t, completed("someone-else"));
    await sendEvent(setup.t, completed(JORDAN.id, [{ ...FILES[1], status: "processing" }]));
    expect(await setup.t.run((ctx) => ctx.db.query("uploads").collect())).toEqual([]);
  });

  test("with no toolkit, the import says what to do", async () => {
    const setup = await setUp({ toolkit: false });
    await connect(setup);
    await sendEvent(setup.t, completed());
    const view = await setup.owner.as.query(api.zoom.forTeam, { organizationId: setup.team });
    expect(view?.imports).toMatchObject([
      { status: "failed", error: expect.stringMatching(/toolkit/) },
    ]);
    expect(await setup.t.run((ctx) => ctx.db.query("uploads").collect())).toEqual([]);
  });

  test("removing the app in Zoom forgets the account", async () => {
    const setup = await setUp();
    await connect(setup);
    await sendEvent(setup.t, {
      event: "app_deauthorized",
      payload: { account_id: "zoom-account-1", user_id: JORDAN.id, client_id: "zoom-client-id" },
    });
    expect(await setup.t.run((ctx) => ctx.db.query("zoomConnections").collect())).toEqual([]);
  });
});

describe("the toolkit bringing a recording in", () => {
  async function started() {
    // Scheduled work (the job being sent) waits, so each test sends it itself.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const setup = await setUp();
    await connect(setup);
    await sendEvent(setup.t, completed());
    const [job] = await setup.t.run((ctx) => ctx.db.query("jobs").collect());
    return { ...setup, job };
  }

  test("the toolkit is sent Zoom's download token as a sign-in header", async () => {
    const { t, job } = await started();
    await t.action(internal.jobs.dispatch, { jobId: job._id });
    expect(toolkitCalls).toHaveLength(1);
    expect(toolkitCalls[0].url).toBe("https://toolkit.example/v1/s3/upload");
    expect(toolkitCalls[0].body).toMatchObject({
      file_url: "https://zoom.test/rec/download/screen",
      download_headers: { Authorization: "Bearer zoom-download-token" },
    });
    expect((await t.run((ctx) => ctx.db.get(job._id)))?.status).toBe("running");
  });

  test("without a download token, the account's sign-in is renewed and used", async () => {
    const { t, job } = await started();
    await t.run(async (ctx) => {
      const [found] = await ctx.db.query("zoomImports").collect();
      await ctx.db.patch(found._id, { downloadTokenCipher: undefined });
      const [connection] = await ctx.db.query("zoomConnections").collect();
      await ctx.db.patch(connection._id, { expiresAt: Date.now() - 1000 });
    });
    await t.action(internal.jobs.dispatch, { jobId: job._id });
    expect(refreshes).toBe(1);
    expect(toolkitCalls[0].body.download_headers).toEqual({ Authorization: "Bearer access-2" });
  });

  test("once the file is in, it is a ready upload in the library", async () => {
    const { t, team, owner, job } = await started();
    await t.mutation(internal.jobs.finish, {
      jobId: job._id,
      ok: true,
      result: { file_url: "https://r2.example/x.mp4" },
    });
    const [upload] = await t.run((ctx) => ctx.db.query("uploads").collect());
    expect(upload.status).toBe("ready");
    const library = await t.run((ctx) => ctx.db.query("libraryItems").collect());
    expect(library.map((item) => item.uploadId)).toEqual([upload._id]);
    const view = await owner.as.query(api.zoom.forTeam, { organizationId: team });
    expect(view?.imports).toMatchObject([{ status: "done" }]);
    // The copy is not shown as a step's output.
    expect(await owner.as.query(api.jobs.outputs, { organizationId: team })).toEqual([]);
  });

  test("a failed copy says why, takes the upload away, and can be brought in again", async () => {
    const { t, team, owner, job } = await started();
    await t.mutation(internal.jobs.finish, { jobId: job._id, ok: false, error: "403 Forbidden" });
    expect(await t.run((ctx) => ctx.db.query("uploads").collect())).toEqual([]);
    const view = await owner.as.query(api.zoom.forTeam, { organizationId: team });
    expect(view?.imports).toMatchObject([{ status: "failed", error: "403 Forbidden" }]);

    recordings = [completed().payload.object];
    const past = await owner.as.action(api.zoom.pastRecordings, { organizationId: team });
    expect(past).toMatchObject([{ meetingUuid: "meeting-uuid-1==", brought: false, minutes: 42 }]);
    expect(
      await owner.as.action(api.zoom.bringIn, {
        organizationId: team,
        meetingUuid: "meeting-uuid-1==",
      }),
    ).toBe("started");
    const imports = await t.run((ctx) => ctx.db.query("zoomImports").collect());
    expect(imports).toHaveLength(1);
    expect(imports[0].status).toBe("importing");
    expect(imports[0].jobId).not.toBe(job._id as Id<"jobs">);
  });
});

describe("past recordings", () => {
  test("lists the last 30 days, and brings one in by hand once", async () => {
    const setup = await setUp();
    await connect(setup);
    recordings = [completed().payload.object];
    const past = await setup.owner.as.action(api.zoom.pastRecordings, {
      organizationId: setup.team,
    });
    expect(past).toEqual([
      {
        meetingUuid: "meeting-uuid-1==",
        topic: "Weekly Sync: Launch / Plan",
        startTime: Date.UTC(2026, 10, 18, 17),
        minutes: 42,
        size: 2_000_000,
        brought: false,
      },
    ]);
    const args = { organizationId: setup.team, meetingUuid: "meeting-uuid-1==" };
    expect(await setup.owner.as.action(api.zoom.bringIn, args)).toBe("started");
    expect(await setup.owner.as.action(api.zoom.bringIn, args)).toBe("already");
    const again = await setup.owner.as.action(api.zoom.pastRecordings, {
      organizationId: setup.team,
    });
    expect(again[0].brought).toBe(true);
    await expect(
      setup.owner.as.action(api.zoom.bringIn, { ...args, meetingUuid: "made-up" }),
    ).rejects.toThrow(/no longer has/);
  });

  test("someone who has not connected Zoom is asked to", async () => {
    const setup = await setUp();
    await expect(
      setup.member.as.action(api.zoom.pastRecordings, { organizationId: setup.team }),
    ).rejects.toThrow(/Connect your Zoom/);
  });
});
