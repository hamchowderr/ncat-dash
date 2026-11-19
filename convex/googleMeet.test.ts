import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { grantedAll, GOOGLE_MEET_SCOPES, meetingTitle, minutesOf } from "./lib/googleMeet";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit } from "./test.toolkit";

// Google Meet recordings brought in by themselves: a member connects their Google account
// from Settings, the dashboard asks Meet every few minutes for recordings that finished
// saving to Drive, and the team's toolkit streams each file from Drive into the team's
// folder, where it becomes an upload like any other.

const G = "https://google.test";

type GoogleUser = { sub: string; email: string; name: string };
let codes: Record<string, GoogleUser> = {};
let granted = GOOGLE_MEET_SCOPES.join(" ");
let refreshes = 0;
let refreshWorks = true;
let revoked: string[] = [];
let toolkitCalls: { url: string; body: Record<string, unknown> }[] = [];
let conferenceFilters: string[] = [];
let conferences: { name: string; startTime: string; endTime?: string }[] = [];
let recordings: Record<string, unknown[]> = {};
let driveFiles: Record<string, Record<string, unknown>> = {};

beforeEach(() => {
  process.env.GOOGLE_MEET_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_MEET_CLIENT_SECRET = "google-client-secret";
  process.env.GOOGLE_MEET_STAND_IN_URL = G;
  process.env.CONVEX_SITE_URL = "https://site.test";
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  codes = {};
  granted = GOOGLE_MEET_SCOPES.join(" ");
  refreshes = 0;
  refreshWorks = true;
  revoked = [];
  toolkitCalls = [];
  conferenceFilters = [];
  conferences = [];
  recordings = {};
  driveFiles = {};
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const bearer = String(headers.get("authorization")).replace("Bearer ", "");
    const signedIn = bearer.startsWith("access-");
    if (url.href === `${G}/token`) {
      const form = new URLSearchParams(String(init?.body ?? ""));
      if (
        form.get("client_id") !== "google-client-id" ||
        form.get("client_secret") !== "google-client-secret"
      ) {
        return Response.json({ error: "invalid_client" }, { status: 401 });
      }
      if (form.get("grant_type") === "refresh_token") {
        if (!refreshWorks || form.get("refresh_token") !== "refresh-1") {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        refreshes++;
        // Google keeps the same refresh token and sends none back.
        return Response.json({ access_token: `access-renewed-${refreshes}`, expires_in: 3599 });
      }
      if (
        !codes[form.get("code") ?? ""] ||
        form.get("redirect_uri") !== "https://site.test/google-meet/callback"
      ) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({
        access_token: `access-${form.get("code")}`,
        refresh_token: "refresh-1",
        expires_in: 3599,
        scope: granted,
      });
    }
    if (url.href === `${G}/revoke`) {
      revoked.push(new URLSearchParams(String(init?.body ?? "")).get("token") ?? "");
      return Response.json({});
    }
    if (url.href === `${G}/v1/userinfo`) {
      const code = bearer.replace("access-", "");
      return codes[code] ? Response.json(codes[code]) : new Response("no", { status: 401 });
    }
    if (!signedIn && url.origin === G) return new Response("no", { status: 401 });
    if (url.pathname === "/v2/conferenceRecords") {
      conferenceFilters.push(url.searchParams.get("filter") ?? "");
      return Response.json({ conferenceRecords: conferences });
    }
    const recordingsOf = /^\/v2\/(conferenceRecords\/[^/]+)\/recordings$/.exec(url.pathname);
    if (recordingsOf) return Response.json({ recordings: recordings[recordingsOf[1]] ?? [] });
    const oneRecording = /^\/v2\/(conferenceRecords\/[^/]+\/recordings\/[^/]+)$/.exec(url.pathname);
    if (oneRecording) {
      const found = Object.values(recordings)
        .flat()
        .find((one) => (one as { name: string }).name === oneRecording[1]);
      return found ? Response.json(found) : new Response("no", { status: 404 });
    }
    const file = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (file) {
      return driveFiles[file[1]]
        ? Response.json(driveFiles[file[1]])
        : new Response("no", { status: 404 });
    }
    if (url.href.startsWith("https://toolkit.example/")) {
      toolkitCalls.push({ url: url.href, body: JSON.parse(String(init?.body ?? "{}")) });
      return Response.json({ code: 202, job_id: "toolkit-job-1" }, { status: 202 });
    }
    return new Response("unknown", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const key of [
    "GOOGLE_MEET_CLIENT_ID",
    "GOOGLE_MEET_CLIENT_SECRET",
    "GOOGLE_MEET_STAND_IN_URL",
    "CONVEX_SITE_URL",
  ]) {
    delete process.env[key];
  }
});

const JORDAN: GoogleUser = {
  sub: "google-user-jordan",
  email: "jordan@salthouse.test",
  name: "Jordan Lee",
};

async function setUp({ toolkit = true } = {}) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Jordan Lee", [team], "owner");
  const member = await addPerson(t, "Maya Ortiz", [team], "member");
  if (toolkit) await connectToolkit(t, team, owner.id);
  return { t, team, owner, member };
}

/** Plays Google: the person signs in, and Google sends them back with a code. */
async function comeBack(
  t: ReturnType<typeof backend>,
  startUrl: string,
  code: string,
  user: GoogleUser,
) {
  codes[code] = user;
  const state = new URL(startUrl).searchParams.get("state");
  const back = await t.fetch(`/google-meet/callback?code=${code}&state=${state}`, {
    method: "GET",
  });
  expect(back.status).toBe(302);
  return new URL(back.headers.get("location") ?? "").searchParams.get("meet");
}

async function connect(setup: Awaited<ReturnType<typeof setUp>>, user = JORDAN) {
  const url = await setup.owner.as.mutation(api.googleMeet.startLink, {
    organizationId: setup.team,
  });
  return await comeBack(setup.t, url, "c1", user);
}

const HOUR = 60 * 60 * 1000;

/** A meeting that ended a while ago, with one recording Meet has finished saving. */
function meetingEnded({
  id = "conf-1",
  file = "1kuceFZohVoCh6FulBHxwy6I15Ogpc4hP",
  title = "Weekly Sync: Launch / Plan",
  endedAgo = HOUR,
  state = "FILE_GENERATED",
} = {}) {
  const end = Date.now() - endedAgo;
  const start = end - 42 * 60 * 1000;
  conferences.push({
    name: `conferenceRecords/${id}`,
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
  });
  recordings[`conferenceRecords/${id}`] = [
    {
      name: `conferenceRecords/${id}/recordings/rec-${id}`,
      state,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      driveDestination: { file, exportUri: `https://drive.google.com/file/d/${file}/view` },
    },
  ];
  driveFiles[file] = {
    id: file,
    name: `${title} (2026-11-18 10:02 GMT-8) - Recording`,
    size: "2000000",
    mimeType: "video/mp4",
  };
  return { start, recordingName: `conferenceRecords/${id}/recordings/rec-${id}`, file };
}

describe("reading Google's answers", () => {
  test("the meeting's title comes from the name Meet gives the file in Drive", () => {
    expect(meetingTitle("Weekly Sync (2026-11-18 10:02 GMT-8) - Recording")).toBe("Weekly Sync");
    expect(meetingTitle("Weekly Sync - 2026/11/18 10:02 PST - Recording")).toBe("Weekly Sync");
    expect(meetingTitle("abc-defg-hij (2026-11-18 10:02 GMT-8) – Recording.mp4")).toBe(
      "abc-defg-hij",
    );
    expect(meetingTitle(undefined)).toBe("");
  });

  test("how long a recording ran, and whether every needed access was allowed", () => {
    expect(minutesOf({ startTime: "2026-11-18T17:00:00Z", endTime: "2026-11-18T17:42:10Z" })).toBe(
      42,
    );
    expect(minutesOf({ startTime: "2026-11-18T17:00:00Z" })).toBeNull();
    expect(grantedAll(GOOGLE_MEET_SCOPES.join(" "))).toBe(true);
    expect(grantedAll("openid email https://www.googleapis.com/auth/meetings.space.readonly")).toBe(
      false,
    );
  });
});

describe("connecting Google Meet", () => {
  test("a member signs in with Google and Settings shows their account; tokens are kept secret", async () => {
    const setup = await setUp();
    const url = await setup.owner.as.mutation(api.googleMeet.startLink, {
      organizationId: setup.team,
    });
    const start = new URL(url);
    expect(start.origin + start.pathname).toBe(`${G}/o/oauth2/v2/auth`);
    expect(start.searchParams.get("client_id")).toBe("google-client-id");
    expect(start.searchParams.get("redirect_uri")).toBe("https://site.test/google-meet/callback");
    expect(start.searchParams.get("access_type")).toBe("offline");
    expect(start.searchParams.get("scope")).toContain("drive.meet.readonly");

    expect(await comeBack(setup.t, url, "c1", JORDAN)).toBe("connected");
    const view = await setup.owner.as.query(api.googleMeet.forTeam, {
      organizationId: setup.team,
    });
    expect(view?.me).toMatchObject({
      googleName: "Jordan Lee",
      googleEmail: JORDAN.email,
      autoImport: true,
      signInLost: false,
    });
    const memberView = await setup.member.as.query(api.googleMeet.forTeam, {
      organizationId: setup.team,
    });
    expect(memberView?.me).toBeNull();
    expect(memberView?.others).toEqual([{ googleName: "Jordan Lee", memberName: "Jordan Lee" }]);

    const [row] = await setup.t.run((ctx) => ctx.db.query("googleMeetConnections").collect());
    expect(row.accessTokenCipher).not.toContain("access-c1");
    expect(row.refreshTokenCipher).not.toContain("refresh-1");
  });

  test("a sign-in that is unknown, missing access, or already on another team, is refused", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const setup = await setUp();
    const madeUp = await setup.t.fetch("/google-meet/callback?code=c9&state=nope", {
      method: "GET",
    });
    expect(new URL(madeUp.headers.get("location")!).searchParams.get("meet")).toBe("expired");
    const closed = await setup.t.fetch("/google-meet/callback?error=access_denied", {
      method: "GET",
    });
    expect(new URL(closed.headers.get("location")!).searchParams.get("meet")).toBe("cancelled");

    // The person unticked Drive on Google's page: nothing is kept, and Google is told.
    granted = "openid email profile https://www.googleapis.com/auth/meetings.space.readonly";
    expect(await connect(setup)).toBe("missing_access");
    expect(await setup.t.run((ctx) => ctx.db.query("googleMeetConnections").collect())).toEqual([]);
    expect(revoked).toEqual(["refresh-1"]);

    granted = GOOGLE_MEET_SCOPES.join(" ");
    await connect(setup);
    const otherTeam = await addTeam(setup.t, "Other Studio");
    const stranger = await addPerson(setup.t, "Sam Park", [otherTeam]);
    const url = await stranger.as.mutation(api.googleMeet.startLink, { organizationId: otherTeam });
    expect(await comeBack(setup.t, url, "c2", JORDAN)).toBe("taken");
  });

  test("nothing to press when the dashboard has no Google app", async () => {
    delete process.env.GOOGLE_MEET_CLIENT_SECRET;
    const setup = await setUp();
    expect(
      (await setup.owner.as.query(api.googleMeet.forTeam, { organizationId: setup.team }))?.ready,
    ).toBe(false);
    await expect(
      setup.owner.as.mutation(api.googleMeet.startLink, { organizationId: setup.team }),
    ).rejects.toThrow(/not set up/);
  });

  test("disconnecting forgets the account and tells Google", async () => {
    vi.useFakeTimers();
    const setup = await setUp();
    await connect(setup);
    await setup.owner.as.mutation(api.googleMeet.disconnect, { organizationId: setup.team });
    await setup.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await setup.t.run((ctx) => ctx.db.query("googleMeetConnections").collect())).toEqual([]);
    expect(revoked).toEqual(["refresh-1"]);
  });
});

async function connectionOf(setup: Awaited<ReturnType<typeof setUp>>) {
  const [row] = await setup.t.run((ctx) => ctx.db.query("googleMeetConnections").collect());
  return row;
}

/** Connected a day ago, so meetings that ended in the last hours are new to the check. */
async function connectedEarlier(setup: Awaited<ReturnType<typeof setUp>>) {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  await connect(setup);
  const row = await connectionOf(setup);
  await setup.t.run((ctx) => ctx.db.patch(row._id, { watchFrom: Date.now() - 24 * HOUR }));
  return await connectionOf(setup);
}

describe("checking for finished recordings", () => {
  test("a recording Meet finished saving becomes an upload on its way, streamed by the toolkit", async () => {
    const setup = await setUp();
    const row = await connectedEarlier(setup);
    meetingEnded();
    expect(await setup.t.action(internal.googleMeet.checkOne, { connectionId: row._id })).toBe(1);
    // The next check finds the same recording: still one upload.
    expect(await setup.t.action(internal.googleMeet.checkOne, { connectionId: row._id })).toBe(0);
    // It asks only about meetings that ended since connecting.
    expect(conferenceFilters[0]).toBe(`end_time>="${new Date(row.watchFrom).toISOString()}"`);

    const uploads = await setup.t.run((ctx) => ctx.db.query("uploads").collect());
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      contentType: "video/mp4",
      size: 2_000_000,
      status: "uploading",
      source: "google_meet",
      createdBy: setup.owner.id,
    });
    expect(uploads[0].fileName).toMatch(/^Weekly Sync Launch Plan \d{4}-\d{2}-\d{2}\.mp4$/);
    expect(uploads[0].key).toMatch(/^uploads\/[0-9a-f-]+\/Weekly-Sync-Launch-Plan-[\d-]+\.mp4$/);

    const jobs = await setup.t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs).toHaveLength(1);
    expect(jobs[0].stepId).toBe("storage-upload-s3");
    expect(jobs[0].input).toEqual({
      file_url: `${G}/drive/v3/files/1kuceFZohVoCh6FulBHxwy6I15Ogpc4hP?alt=media`,
      filename: `teams/${setup.team}/${uploads[0].key}`,
    });
    // No Google sign-in is kept where the job is.
    expect(JSON.stringify(jobs[0])).not.toContain("access-");
    // Step jobs on the Steps page leave it out.
    expect(await setup.owner.as.query(api.jobs.list, { organizationId: setup.team })).toEqual([]);

    const view = await setup.owner.as.query(api.googleMeet.forTeam, {
      organizationId: setup.team,
    });
    expect(view?.imports).toMatchObject([
      { topic: "Weekly Sync: Launch / Plan", status: "importing" },
    ]);
  });

  test("a recording still being saved, a meeting still going, or a file deleted from Drive, waits", async () => {
    const setup = await setUp();
    const row = await connectedEarlier(setup);
    meetingEnded({ id: "conf-saving", file: "fileStillSaving01", state: "ENDED" });
    conferences.push({ name: "conferenceRecords/conf-live", startTime: new Date().toISOString() });
    const gone = meetingEnded({ id: "conf-gone", file: "fileDeletedFromDrive" });
    delete driveFiles[gone.file];
    expect(await setup.t.action(internal.googleMeet.checkOne, { connectionId: row._id })).toBe(0);
    expect(await setup.t.run((ctx) => ctx.db.query("uploads").collect())).toEqual([]);
  });

  test("every few minutes, each account bringing recordings in is checked", async () => {
    vi.useFakeTimers();
    const setup = await setUp();
    await connect(setup);
    const row = await connectionOf(setup);
    await setup.t.run((ctx) => ctx.db.patch(row._id, { watchFrom: Date.now() - 24 * HOUR }));
    meetingEnded();
    await setup.t.mutation(internal.googleMeet.checkAll, {});
    await setup.t.finishAllScheduledFunctions(vi.runAllTimers);
    // Running every timer also runs out the job's wait for the toolkit; the check itself
    // is what counts here: the recording was found and a job made to bring it in.
    const imports = await setup.t.run((ctx) => ctx.db.query("googleMeetImports").collect());
    expect(imports).toHaveLength(1);
    expect(imports[0].jobId).toBeDefined();
  });

  test("with bringing in switched off, nothing is asked; switched back on, it starts from then", async () => {
    const setup = await setUp();
    const row = await connectedEarlier(setup);
    meetingEnded();
    await setup.owner.as.mutation(api.googleMeet.setAutoImport, {
      organizationId: setup.team,
      autoImport: false,
    });
    expect(await setup.t.action(internal.googleMeet.checkOne, { connectionId: row._id })).toBe(0);
    expect(conferenceFilters).toEqual([]);
    await setup.owner.as.mutation(api.googleMeet.setAutoImport, {
      organizationId: setup.team,
      autoImport: true,
    });
    expect((await connectionOf(setup)).watchFrom).toBeGreaterThan(Date.now() - 60_000);
  });

  test("when Google stops accepting the sign-in, checks stop and Settings says so", async () => {
    const setup = await setUp();
    const row = await connectedEarlier(setup);
    await setup.t.run((ctx) => ctx.db.patch(row._id, { expiresAt: Date.now() - 1000 }));
    refreshWorks = false;
    meetingEnded();
    expect(await setup.t.action(internal.googleMeet.checkOne, { connectionId: row._id })).toBe(0);
    const view = await setup.owner.as.query(api.googleMeet.forTeam, {
      organizationId: setup.team,
    });
    expect(view?.me?.signInLost).toBe(true);
    // Connecting again picks up where it left off.
    await connect(setup);
    expect((await connectionOf(setup)).signInLostAt).toBeUndefined();
  });

  test("with no toolkit, the import says what to do, and the check does not keep retrying", async () => {
    const setup = await setUp({ toolkit: false });
    const row = await connectedEarlier(setup);
    meetingEnded();
    await setup.t.action(internal.googleMeet.checkOne, { connectionId: row._id });
    await setup.t.action(internal.googleMeet.checkOne, { connectionId: row._id });
    const view = await setup.owner.as.query(api.googleMeet.forTeam, {
      organizationId: setup.team,
    });
    expect(view?.imports).toMatchObject([
      { status: "failed", error: expect.stringMatching(/toolkit/) },
    ]);
    expect(await setup.t.run((ctx) => ctx.db.query("jobs").collect())).toEqual([]);
    expect(await setup.t.run((ctx) => ctx.db.query("uploads").collect())).toEqual([]);
  });
});

describe("the toolkit bringing a recording in", () => {
  async function started() {
    const setup = await setUp();
    const row = await connectedEarlier(setup);
    meetingEnded();
    await setup.t.action(internal.googleMeet.checkOne, { connectionId: row._id });
    const [job] = await setup.t.run((ctx) => ctx.db.query("jobs").collect());
    return { ...setup, job };
  }

  test("the toolkit is sent a fresh Google sign-in as a header, made as the job is sent", async () => {
    const { t, job } = await started();
    // The toolkit may queue the job a while, so it gets a sign-in with most of its hour
    // left: one with half an hour to go is renewed first.
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("googleMeetConnections").collect();
      await ctx.db.patch(row._id, { expiresAt: Date.now() + 30 * 60 * 1000 });
    });
    const before = refreshes;
    await t.action(internal.jobs.dispatch, { jobId: job._id });
    expect(toolkitCalls).toHaveLength(1);
    expect(toolkitCalls[0].url).toBe("https://toolkit.example/v1/s3/upload");
    expect(refreshes).toBe(before + 1);
    expect(toolkitCalls[0].body).toMatchObject({
      file_url: `${G}/drive/v3/files/1kuceFZohVoCh6FulBHxwy6I15Ogpc4hP?alt=media`,
      download_headers: { Authorization: `Bearer access-renewed-${refreshes}` },
    });
    expect((await t.run((ctx) => ctx.db.get(job._id)))?.status).toBe("running");
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
    const view = await owner.as.query(api.googleMeet.forTeam, { organizationId: team });
    expect(view?.imports).toMatchObject([{ status: "done" }]);
    // The copy is not shown as a step's output.
    expect(await owner.as.query(api.jobs.outputs, { organizationId: team })).toEqual([]);
  });

  test("a failed copy says why, takes the upload away, and can be brought in again by hand", async () => {
    const { t, team, owner, job } = await started();
    await t.mutation(internal.jobs.finish, { jobId: job._id, ok: false, error: "403 Forbidden" });
    expect(await t.run((ctx) => ctx.db.query("uploads").collect())).toEqual([]);
    const view = await owner.as.query(api.googleMeet.forTeam, { organizationId: team });
    expect(view?.imports).toMatchObject([{ status: "failed", error: "403 Forbidden" }]);

    const past = await owner.as.action(api.googleMeet.pastRecordings, { organizationId: team });
    expect(past).toMatchObject([
      {
        recordingName: "conferenceRecords/conf-1/recordings/rec-conf-1",
        brought: false,
        minutes: 42,
      },
    ]);
    expect(
      await owner.as.action(api.googleMeet.bringIn, {
        organizationId: team,
        recordingName: "conferenceRecords/conf-1/recordings/rec-conf-1",
      }),
    ).toBe("started");
    const imports = await t.run((ctx) => ctx.db.query("googleMeetImports").collect());
    expect(imports).toHaveLength(1);
    expect(imports[0].status).toBe("importing");
    expect(imports[0].jobId).not.toBe(job._id as Id<"jobs">);
  });
});

describe("past recordings", () => {
  test("lists the last 30 days, and brings one in by hand once", async () => {
    const setup = await setUp();
    await connect(setup);
    const { start, recordingName } = meetingEnded({ endedAgo: 3 * 24 * HOUR });
    const past = await setup.owner.as.action(api.googleMeet.pastRecordings, {
      organizationId: setup.team,
    });
    expect(past).toEqual([
      {
        recordingName,
        topic: "Weekly Sync: Launch / Plan",
        startTime: start,
        minutes: 42,
        size: 2_000_000,
        brought: false,
      },
    ]);
    expect(conferenceFilters[0]).toMatch(/^end_time>="/);
    const args = { organizationId: setup.team, recordingName };
    expect(await setup.owner.as.action(api.googleMeet.bringIn, args)).toBe("started");
    expect(await setup.owner.as.action(api.googleMeet.bringIn, args)).toBe("already");
    const again = await setup.owner.as.action(api.googleMeet.pastRecordings, {
      organizationId: setup.team,
    });
    expect(again[0].brought).toBe(true);
    await expect(
      setup.owner.as.action(api.googleMeet.bringIn, {
        ...args,
        recordingName: "conferenceRecords/conf-1/recordings/made-up",
      }),
    ).rejects.toThrow(/no longer has/);
    // Only Meet's own names are asked about.
    await expect(
      setup.owner.as.action(api.googleMeet.bringIn, { ...args, recordingName: "../../drive" }),
    ).rejects.toThrow(/no such recording/);
  });

  test("someone who has not connected Google Meet is asked to", async () => {
    const setup = await setUp();
    await expect(
      setup.member.as.action(api.googleMeet.pastRecordings, { organizationId: setup.team }),
    ).rejects.toThrow(/Connect your Google account/);
  });
});
