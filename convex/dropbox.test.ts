import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  apiArg,
  type DropboxEntry,
  mediaOf,
  PIECE_BYTES,
  pickFile,
  sendFolderOf,
  signatureOf,
} from "./lib/dropbox";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

// Dropbox both ways: a member connects their Dropbox from Settings and picks folders to
// watch; new videos, sounds and pictures in them come into Uploads through the toolkit.
// An automation switched to send to Dropbox sends each finished run's files there.

const AUTH = "https://auth.dropbox.test";
const API = "https://api.dropbox.test";
const CONTENT = "https://content.dropbox.test";
const SECRET = "dropbox-app-secret";

type Account = {
  account_id: string;
  email: string;
  name: { display_name: string };
  root_info: { root_namespace_id: string; home_namespace_id: string };
};

let codes: Record<string, Account> = {};
let refuseRefresh = false;
let tokenForms: URLSearchParams[] = [];
// Every file and folder in the Dropbox, by path.
let tree: DropboxEntry[] = [];
// Changes Dropbox has not told about yet, handed out once by list_folder/continue.
let pending: DropboxEntry[] = [];
let gone = new Set<string>();
let toolkitCalls: { url: string; body: Record<string, unknown> }[] = [];
let rpcCalls: { path: string; body: unknown; root: string | null }[] = [];
let contentCalls: {
  path: string;
  arg: Record<string, unknown>;
  bytes: number;
  root: string | null;
}[] = [];
// Bytes of files in the bucket, by key, for reading them back in pieces.
let bucketSizes: Record<string, number> = {};
let toolkit: ReturnType<typeof fakeToolkitStorage>;

const JORDAN: Account = {
  account_id: "dbid:jordan",
  email: "jordan@salthouse.test",
  name: { display_name: "Jordan Lee" },
  root_info: { root_namespace_id: "100", home_namespace_id: "100" },
};
const MAYA_TEAM: Account = {
  account_id: "dbid:maya",
  email: "maya@salthouse.test",
  name: { display_name: "Maya Ortiz" },
  // A Dropbox team account: the team space's top is not the member's own folder.
  root_info: { root_namespace_id: "900", home_namespace_id: "901" },
};

function file(path: string, size = 2_000_000, hash = `hash-${path}`): DropboxEntry {
  const name = path.split("/").pop()!;
  return {
    ".tag": "file",
    id: `id:${path}`,
    name,
    path_lower: path.toLowerCase(),
    path_display: path,
    server_modified: new Date().toISOString(),
    size,
    content_hash: hash,
    is_downloadable: true,
  };
}

function folder(path: string, shared = false): DropboxEntry & { sharing_info?: unknown } {
  return {
    ".tag": "folder",
    id: `id:${path}`,
    name: path.split("/").pop()!,
    path_lower: path.toLowerCase(),
    path_display: path,
    ...(shared ? { sharing_info: { read_only: false } } : {}),
  };
}

function under(path: string, entry: DropboxEntry) {
  const p = path.toLowerCase();
  return p === "" || (entry.path_lower ?? "").startsWith(`${p}/`);
}

beforeEach(() => {
  process.env.DROPBOX_APP_KEY = "dropbox-app-key";
  process.env.DROPBOX_APP_SECRET = SECRET;
  process.env.DROPBOX_AUTH_URL = AUTH;
  process.env.DROPBOX_API_URL = API;
  process.env.DROPBOX_CONTENT_URL = CONTENT;
  process.env.CONVEX_SITE_URL = "https://site.test";
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  codes = {};
  refuseRefresh = false;
  tokenForms = [];
  tree = [folder("/Raw footage"), folder("/Raw footage/Day 1"), folder("/Marketing", true)];
  pending = [];
  gone = new Set();
  toolkitCalls = [];
  rpcCalls = [];
  contentCalls = [];
  bucketSizes = {};
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const bearer = String(headers.get("authorization")).replace("Bearer ", "");
    const root = headers.get("dropbox-api-path-root");
    if (url === `${API}/oauth2/token`) {
      const form = new URLSearchParams(String(init?.body ?? ""));
      tokenForms.push(form);
      if (form.get("client_id") !== "dropbox-app-key" || form.get("client_secret") !== SECRET) {
        return new Response("no", { status: 401 });
      }
      if (form.get("grant_type") === "refresh_token") {
        if (refuseRefresh) return Response.json({ error: "invalid_grant" }, { status: 400 });
        // Dropbox keeps the same refresh token and sends only a new access token.
        return Response.json({ access_token: "access-renewed", expires_in: 14_400 });
      }
      const code = form.get("code") ?? "";
      if (!codes[code] || form.get("redirect_uri") !== "https://site.test/dropbox/callback") {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({
        access_token: `access-${code}`,
        refresh_token: `refresh-${code}`,
        expires_in: 14_400,
        account_id: codes[code].account_id,
      });
    }
    if (url.startsWith(`${API}/2/`) && !bearer.startsWith("access-")) {
      return new Response("no", { status: 401 });
    }
    if (url.startsWith(`${API}/2/`)) {
      const path = url.slice(`${API}/2/`.length);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      rpcCalls.push({ path, body, root });
      if (path === "users/get_current_account") {
        const account = codes[bearer.replace("access-", "")] ?? Object.values(codes)[0];
        return account ? Response.json(account) : new Response("no", { status: 401 });
      }
      if (path === "auth/token/revoke") return Response.json(null);
      if (path === "files/get_metadata") {
        const found = tree.find((one) => one.path_lower === String(body.path).toLowerCase());
        return found
          ? Response.json(found)
          : Response.json({ error_summary: "path/not_found/.." }, { status: 409 });
      }
      if (path === "files/list_folder") {
        const entries = body.recursive
          ? tree.filter((one) => under(body.path, one))
          : tree.filter(
              (one) =>
                under(body.path, one) &&
                !(one.path_lower ?? "").slice(String(body.path).length + 1).includes("/"),
            );
        return Response.json({ entries, cursor: `list:${body.path}`, has_more: false });
      }
      if (path === "files/list_folder/get_latest_cursor") {
        // A cursor from now on: changes made before it are not handed out.
        pending = pending.filter((one) => !under(body.path, one));
        // A folder watched on its own (not the folders inside it) gets a "flat" cursor.
        return Response.json({ cursor: `watch${body.recursive ? "" : "flat"}:${body.path}` });
      }
      if (path === "files/list_folder/continue") {
        const cursor = String(body.cursor);
        if (cursor === "watch:/stale") {
          return Response.json({ error_summary: "reset/..." }, { status: 409 });
        }
        const flat = cursor.startsWith("watchflat:");
        const at = cursor.replace(/^watch(flat)?:/, "").replace(/#\d+$/, "");
        const mine = pending.filter(
          (one) =>
            under(at, one) && (!flat || !(one.path_lower ?? "").slice(at.length + 1).includes("/")),
        );
        pending = pending.filter((one) => !mine.includes(one));
        return Response.json({
          entries: mine,
          cursor: `watch${flat ? "flat" : ""}:${at}#1`,
          has_more: false,
        });
      }
      if (path === "files/get_temporary_link") {
        if (gone.has(body.path)) {
          return Response.json({ error_summary: "path/not_found/" }, { status: 409 });
        }
        return Response.json({ link: `https://dl.dropbox.test/${encodeURIComponent(body.path)}` });
      }
      return new Response("unknown", { status: 404 });
    }
    if (url.startsWith(`${CONTENT}/2/`)) {
      const path = url.slice(`${CONTENT}/2/`.length);
      const arg = JSON.parse(headers.get("dropbox-api-arg") ?? "{}");
      const bytes = (init?.body as ArrayBuffer | undefined)?.byteLength ?? 0;
      contentCalls.push({ path, arg, bytes, root });
      if (path === "files/upload_session/start") return Response.json({ session_id: "session-1" });
      if (path === "files/upload_session/append_v2") return Response.json(null);
      const commit = (path === "files/upload" ? arg : arg.commit) as { path: string };
      return Response.json({ ".tag": "file", path_display: commit.path });
    }
    if (url.startsWith("https://r2.example/")) {
      // The team's bucket, read with a signed link, in pieces.
      const key = decodeURIComponent(new URL(url).pathname.split("/").slice(2).join("/"));
      const size = bucketSizes[key];
      if (size === undefined) return new Response("no", { status: 404 });
      const range = /bytes=(\d+)-(\d+)/.exec(headers.get("range") ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range ? Math.min(Number(range[2]), size - 1) : size - 1;
      return new Response(new Uint8Array(end - start + 1), {
        status: range ? 206 : 200,
        headers: { "content-range": `bytes ${start}-${end}/${size}` },
      });
    }
    if (url.startsWith("https://toolkit.example/")) {
      toolkitCalls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return Response.json({ code: 202, job_id: "toolkit-job-1" }, { status: 202 });
    }
    return new Response("unknown", { status: 404 });
  });
  // Storage requests go to an in-memory bucket; everything else to the stand-in above.
  toolkit = fakeToolkitStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const key of [
    "DROPBOX_APP_KEY",
    "DROPBOX_APP_SECRET",
    "DROPBOX_AUTH_URL",
    "DROPBOX_API_URL",
    "DROPBOX_CONTENT_URL",
    "CONVEX_SITE_URL",
  ]) {
    delete process.env[key];
  }
});

async function setUp({ withToolkit = true } = {}) {
  // Scheduled work waits until a test runs it, so each test says when.
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Jordan Lee", [team], "owner");
  const member = await addPerson(t, "Maya Ortiz", [team], "member");
  if (withToolkit) await connectToolkit(t, team, owner.id);
  return { t, team, owner, member };
}
type SetUp = Awaited<ReturnType<typeof setUp>>;
type Person = SetUp["owner"];

async function comeBack(t: SetUp["t"], startUrl: string, code: string, account: Account) {
  codes[code] = account;
  const state = new URL(startUrl).searchParams.get("state");
  const back = await t.fetch(`/dropbox/callback?code=${code}&state=${state}`, { method: "GET" });
  expect(back.status).toBe(302);
  return new URL(back.headers.get("location") ?? "").searchParams.get("dropbox");
}

async function connect(setup: SetUp, person: Person = setup.owner, account = JORDAN, code = "c1") {
  const url = await person.as.mutation(api.dropbox.startLink, { organizationId: setup.team });
  return await comeBack(setup.t, url, code, account);
}

/** Runs what is due now, but not the check, hours later, for jobs that never report. */
async function runScheduled(t: SetUp["t"]) {
  await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000));
}

async function notify(t: SetUp["t"], accounts: string[], secret = SECRET) {
  const body = JSON.stringify({ list_folder: { accounts }, delta: { users: [1] } });
  return await t.fetch("/dropbox/events", {
    method: "POST",
    headers: { "x-dropbox-signature": await signatureOf(secret, body) },
    body,
  });
}

const uploads = (t: SetUp["t"]) => t.run((ctx) => ctx.db.query("uploads").collect());
const imports = (t: SetUp["t"]) => t.run((ctx) => ctx.db.query("dropboxImports").collect());

describe("reading Dropbox", () => {
  test("videos, sounds and pictures come in; documents and folders do not", () => {
    expect(mediaOf("Day 1.MOV")).toEqual({ kind: "video", contentType: "video/quicktime" });
    expect(mediaOf("voice.m4a")?.kind).toBe("audio");
    expect(mediaOf("logo.png")?.kind).toBe("image");
    expect(mediaOf("brief.pdf")).toBeNull();
    expect(mediaOf("project.zip")).toBeNull();
    expect(pickFile(file("/Raw footage/a.mp4"))).toMatchObject({
      fileId: "id:/Raw footage/a.mp4",
      kind: "video",
      contentType: "video/mp4",
    });
    expect(pickFile(file("/Raw footage/notes.docx"))).toBeNull();
    expect(pickFile(folder("/Raw footage"))).toBeNull();
    expect(pickFile({ ...file("/a.mp4"), size: 0 })).toBeNull();
    expect(pickFile({ ...file("/a.mp4"), is_downloadable: false })).toBeNull();
    expect(pickFile({ ...file("/a.mp4"), ".tag": "deleted" })).toBeNull();
  });

  test("settings for Dropbox are sent as plain ASCII, and folders get sensible names", () => {
    expect(apiArg({ path: "/Café/clip.mp4" })).toBe('{"path":"/Caf\\u00e9/clip.mp4"}');
    expect(sendFolderOf(undefined, "Weekly / shorts")).toBe("/Kontifi/Weekly - shorts");
    expect(sendFolderOf("/Clients/Acme/", "Weekly shorts")).toBe("/Clients/Acme");
  });
});

describe("connecting Dropbox", () => {
  test("a member signs in for a refresh token, and Settings shows the account", async () => {
    const setup = await setUp();
    const url = await setup.owner.as.mutation(api.dropbox.startLink, {
      organizationId: setup.team,
    });
    const asked = new URL(url);
    expect(asked.origin + asked.pathname).toBe(`${AUTH}/oauth2/authorize`);
    expect(asked.searchParams.get("token_access_type")).toBe("offline");
    expect(asked.searchParams.get("scope")).toContain("files.content.write");
    expect(await comeBack(setup.t, url, "c1", JORDAN)).toBe("connected");
    const shown = await setup.owner.as.query(api.dropbox.forTeam, { organizationId: setup.team });
    expect(shown?.me).toMatchObject({
      name: "Jordan Lee",
      email: "jordan@salthouse.test",
      autoImport: true,
      teamSpace: false,
      folders: [],
    });
    // The teammate sees who is connected, but not the account's details as their own.
    const other = await setup.member.as.query(api.dropbox.forTeam, {
      organizationId: setup.team,
    });
    expect(other?.me).toBeNull();
    expect(other?.others).toEqual([{ name: "Jordan Lee", memberName: "Jordan Lee" }]);
  });

  test("a sign-in that is old, reused or refused changes nothing", async () => {
    const setup = await setUp();
    const url = await setup.owner.as.mutation(api.dropbox.startLink, {
      organizationId: setup.team,
    });
    expect(await comeBack(setup.t, url, "c1", JORDAN)).toBe("connected");
    expect(await comeBack(setup.t, url, "c2", JORDAN)).toBe("expired");
    const cancelled = await setup.t.fetch("/dropbox/callback?error=access_denied", {
      method: "GET",
    });
    expect(new URL(cancelled.headers.get("location")!).searchParams.get("dropbox")).toBe(
      "cancelled",
    );
  });

  test("one Dropbox belongs to one person on one team", async () => {
    const setup = await setUp();
    expect(await connect(setup)).toBe("connected");
    expect(await connect(setup, setup.member, JORDAN, "c2")).toBe("taken_here");
    const otherTeam = await addTeam(setup.t, "North Studio");
    const stranger = await addPerson(setup.t, "Sam Wu", [otherTeam], "owner");
    const url = await stranger.as.mutation(api.dropbox.startLink, { organizationId: otherTeam });
    expect(await comeBack(setup.t, url, "c3", JORDAN)).toBe("taken");
  });

  test("a Dropbox team account reads from the team space, so team folders show", async () => {
    const setup = await setUp();
    await connect(setup, setup.member, MAYA_TEAM, "m1");
    const shown = await setup.member.as.query(api.dropbox.forTeam, {
      organizationId: setup.team,
    });
    expect(shown?.me?.teamSpace).toBe(true);
    const folders = await setup.member.as.action(api.dropbox.browse, {
      organizationId: setup.team,
      path: "",
    });
    expect(folders).toEqual([
      { name: "Marketing", path: "/Marketing", shared: true },
      { name: "Raw footage", path: "/Raw footage", shared: false },
    ]);
    const listing = rpcCalls.find((one) => one.path === "files/list_folder");
    expect(JSON.parse(listing?.root ?? "{}")).toEqual({ ".tag": "root", root: "900" });
  });

  test("an account Dropbox stopped accepting asks to be connected again", async () => {
    const setup = await setUp();
    await connect(setup);
    await setup.t.run(async (ctx) => {
      const row = await ctx.db.query("dropboxConnections").first();
      await ctx.db.patch(row!._id, { expiresAt: Date.now() });
    });
    refuseRefresh = true;
    await expect(
      setup.owner.as.action(api.dropbox.browse, { organizationId: setup.team, path: "" }),
    ).rejects.toThrow(/Connect it again/);
    const shown = await setup.owner.as.query(api.dropbox.forTeam, { organizationId: setup.team });
    expect(shown?.me?.needsReconnect).toBe(true);
  });

  test("an access token running low is renewed with the kept refresh token", async () => {
    const setup = await setUp();
    await connect(setup);
    await setup.t.run(async (ctx) => {
      const row = await ctx.db.query("dropboxConnections").first();
      await ctx.db.patch(row!._id, { expiresAt: Date.now() });
    });
    await setup.owner.as.action(api.dropbox.browse, { organizationId: setup.team, path: "" });
    const renewal = tokenForms.find((form) => form.get("grant_type") === "refresh_token");
    expect(renewal?.get("refresh_token")).toBe("refresh-c1");
  });
});

describe("watching folders", () => {
  async function watching() {
    const setup = await setUp();
    await connect(setup);
    await setup.owner.as.action(api.dropbox.addFolder, {
      organizationId: setup.team,
      path: "/Raw footage",
    });
    await setup.owner.as.action(api.dropbox.addFolder, {
      organizationId: setup.team,
      path: "/Marketing",
    });
    return setup;
  }

  test("several folders can be watched, and one can be let go", async () => {
    const setup = await watching();
    // Watching the same folder again does not add it twice.
    await setup.owner.as.action(api.dropbox.addFolder, {
      organizationId: setup.team,
      path: "/raw footage",
    });
    const shown = await setup.owner.as.query(api.dropbox.forTeam, { organizationId: setup.team });
    expect(shown?.me?.folders.map((one) => one.path)).toEqual(["/Raw footage", "/Marketing"]);
    await setup.owner.as.mutation(api.dropbox.removeFolder, {
      folderId: shown!.me!.folders[1]._id,
    });
    const after = await setup.owner.as.query(api.dropbox.forTeam, { organizationId: setup.team });
    expect(after?.me?.folders.map((one) => one.path)).toEqual(["/Raw footage"]);
    // A teammate cannot let go of someone else's folder.
    await expect(
      setup.member.as.mutation(api.dropbox.removeFolder, { folderId: after!.me!.folders[0]._id }),
    ).rejects.toThrow(/someone else/);
  });

  test("a folder that is not in Dropbox is refused", async () => {
    const setup = await setUp();
    await connect(setup);
    await expect(
      setup.owner.as.action(api.dropbox.addFolder, { organizationId: setup.team, path: "/Nope" }),
    ).rejects.toThrow(/not in Dropbox/);
  });

  test("Dropbox's address check is answered, and an unsigned notice is refused", async () => {
    const setup = await setUp();
    const check = await setup.t.fetch("/dropbox/events?challenge=abc123", { method: "GET" });
    expect(await check.text()).toBe("abc123");
    expect(check.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await notify(setup.t, [JORDAN.account_id], "wrong-secret")).status).toBe(403);
  });

  test("new media in any watched folder or its subfolders comes into Uploads", async () => {
    const setup = await watching();
    pending = [
      file("/Raw footage/Day 1/Interview.mov"),
      file("/Marketing/Logo.png", 40_000),
      file("/Raw footage/Brief.pdf"),
      folder("/Raw footage/Day 2"),
    ];
    expect((await notify(setup.t, [JORDAN.account_id, "dbid:somebody-else"])).status).toBe(200);
    await runScheduled(setup.t);
    const came = await uploads(setup.t);
    expect(came.map((one) => [one.fileName, one.source, one.contentType]).sort()).toEqual([
      ["Interview.mov", "dropbox", "video/quicktime"],
      ["Logo.png", "dropbox", "image/png"],
    ]);
    // The toolkit was sent a fresh four-hour link, made only as the job went out.
    const links = toolkitCalls.map((one) => one.body.file_url);
    expect(links).toContain(
      `https://dl.dropbox.test/${encodeURIComponent("id:/Raw footage/Day 1/Interview.mov")}`,
    );
    expect(String(toolkitCalls[0].body.filename)).toMatch(new RegExp(`^teams/.+/uploads/`));
    // Nothing new: nothing more comes in.
    await notify(setup.t, [JORDAN.account_id]);
    await runScheduled(setup.t);
    expect(await uploads(setup.t)).toHaveLength(2);
  });

  test("the job finishing makes the upload ready; a failed one says why", async () => {
    const setup = await watching();
    pending = [file("/Raw footage/a.mp4"), file("/Raw footage/b.mp4")];
    gone.add("id:/Raw footage/b.mp4");
    await setup.t.action(internal.dropbox.sweep, {});
    await runScheduled(setup.t);
    const rows = await imports(setup.t);
    const a = rows.find((one) => one.name === "a.mp4")!;
    const b = rows.find((one) => one.name === "b.mp4")!;
    expect(b.status).toBe("failed");
    expect(b.error).toMatch(/no longer in Dropbox/);
    await setup.t.mutation(internal.jobs.finish, { jobId: a.jobId!, ok: true, result: {} });
    const ready = (await uploads(setup.t)).find((one) => one.fileName === "a.mp4");
    expect(ready?.status).toBe("ready");
    expect((await imports(setup.t)).find((one) => one.name === "a.mp4")?.status).toBe("done");
  });

  test("the same file watched twice, or by two people, comes in once", async () => {
    const setup = await watching();
    await connect(setup, setup.member, MAYA_TEAM, "m1");
    await setup.member.as.action(api.dropbox.addFolder, {
      organizationId: setup.team,
      path: "/Marketing",
    });
    pending = [file("/Marketing/Promo.mp4", 5_000_000, "same-hash")];
    await setup.t.action(internal.dropbox.check, {
      connectionId: (await setup.t.run((ctx) => ctx.db.query("dropboxConnections").first()))!._id,
    });
    pending = [
      file("/Marketing/Promo.mp4", 5_000_000, "same-hash"),
      { ...file("/Raw footage/Promo copy.mp4", 5_000_000, "same-hash") },
    ];
    await notify(setup.t, [MAYA_TEAM.account_id, JORDAN.account_id]);
    await runScheduled(setup.t);
    expect(await uploads(setup.t)).toHaveLength(1);
    expect((await imports(setup.t)).map((one) => one.status).sort()).toEqual([
      "duplicate",
      "importing",
    ]);
  });

  test("switched off, new files wait, and switching on does not bring in what was missed", async () => {
    const setup = await watching();
    await setup.owner.as.mutation(api.dropbox.setAutoImport, {
      organizationId: setup.team,
      autoImport: false,
    });
    pending = [file("/Raw footage/While off.mp4")];
    await notify(setup.t, [JORDAN.account_id]);
    await runScheduled(setup.t);
    expect(await uploads(setup.t)).toHaveLength(0);
    await setup.owner.as.mutation(api.dropbox.setAutoImport, {
      organizationId: setup.team,
      autoImport: true,
    });
    await runScheduled(setup.t);
    await notify(setup.t, [JORDAN.account_id]);
    await runScheduled(setup.t);
    // The skipped file is still listed in Settings, to bring over by hand.
    expect(await uploads(setup.t)).toHaveLength(0);
  });

  test("a folder whose place Dropbox forgot starts again from now", async () => {
    const setup = await watching();
    await setup.t.run(async (ctx) => {
      const one = await ctx.db.query("dropboxFolders").first();
      await ctx.db.patch(one!._id, { cursor: "watch:/stale" });
    });
    await setup.t.action(internal.dropbox.sweep, {});
    await runScheduled(setup.t);
    const one = await setup.t.run((ctx) => ctx.db.query("dropboxFolders").first());
    expect(one?.cursor).toBe("watch:/Raw footage");
  });

  test("without a toolkit, the file says where it needs to go", async () => {
    const setup = await setUp({ withToolkit: false });
    await connect(setup);
    await setup.owner.as.action(api.dropbox.addFolder, {
      organizationId: setup.team,
      path: "/Raw footage",
    });
    pending = [file("/Raw footage/a.mp4")];
    await notify(setup.t, [JORDAN.account_id]);
    await runScheduled(setup.t);
    expect((await imports(setup.t))[0]).toMatchObject({ status: "failed" });
    expect((await imports(setup.t))[0].error).toMatch(/Connect your toolkit/);
  });
});

describe("files already in watched folders", () => {
  test("are listed newest first, and the ticked ones are brought over", async () => {
    const setup = await setUp();
    await connect(setup);
    await setup.owner.as.action(api.dropbox.addFolder, {
      organizationId: setup.team,
      path: "/Raw footage",
    });
    tree.push(
      { ...file("/Raw footage/Old.mp4"), server_modified: "2026-01-02T00:00:00Z" },
      { ...file("/Raw footage/Day 1/New.wav"), server_modified: "2026-11-01T00:00:00Z" },
      file("/Raw footage/Notes.txt"),
      file("/Elsewhere/Not watched.mp4"),
    );
    const listed = await setup.owner.as.action(api.dropbox.pastFiles, {
      organizationId: setup.team,
    });
    expect(listed.map((one) => [one.name, one.kind, one.brought])).toEqual([
      ["New.wav", "audio", false],
      ["Old.mp4", "video", false],
    ]);
    const outcome = await setup.owner.as.action(api.dropbox.bringOver, {
      organizationId: setup.team,
      // A file outside the watched folders is not brought over, whatever the browser says.
      fileIds: ["id:/Raw footage/Old.mp4", "id:/Elsewhere/Not watched.mp4"],
    });
    expect(outcome).toEqual({ started: 1, skipped: 1 });
    const again = await setup.owner.as.action(api.dropbox.pastFiles, {
      organizationId: setup.team,
    });
    expect(again.find((one) => one.name === "Old.mp4")?.brought).toBe(true);
  });
});

describe("reading the whole Dropbox and bringing folders in", () => {
  test("lists every folder with media right in it, fullest first, with what is new", async () => {
    const setup = await setUp();
    await connect(setup);
    tree.push(
      file("/Raw footage/a.mp4"),
      file("/Raw footage/b.mp4"),
      file("/Raw footage/Day 1/c.wav"),
      file("/Raw footage/Notes.txt"),
      file("/Top.png", 40_000),
      file("/Docs/Plan.pdf"),
    );
    const read = await setup.owner.as.action(api.dropbox.scan, { organizationId: setup.team });
    expect(read.partial).toBe(false);
    expect(read.folders.map((one) => [one.path, one.name, one.files, one.fresh])).toEqual([
      ["/Raw footage", "Raw footage", 2, 2],
      ["/", "Dropbox", 1, 1],
      ["/Raw footage/Day 1", "Day 1", 1, 1],
    ]);
    // The whole Dropbox was read in one listing from the top.
    const listing = rpcCalls.find((one) => one.path === "files/list_folder");
    expect(listing?.body).toMatchObject({ path: "", recursive: true });
  });

  test("ticked folders are watched and what is in them now comes in, nothing else", async () => {
    const setup = await setUp();
    await connect(setup);
    tree.push(
      folder("/Raw footage"),
      file("/Raw footage/a.mp4"),
      file("/Raw footage/b.mp4"),
      file("/Raw footage/Day 1/c.wav"),
      file("/Elsewhere/d.mp4"),
    );
    const outcome = await setup.owner.as.action(api.dropbox.pullIn, {
      organizationId: setup.team,
      paths: ["/Raw footage"],
    });
    expect(outcome).toEqual({ watching: 1, started: 2, more: false });
    await runScheduled(setup.t);
    expect((await uploads(setup.t)).map((one) => one.fileName).sort()).toEqual(["a.mp4", "b.mp4"]);
    const shown = await setup.owner.as.query(api.dropbox.forTeam, { organizationId: setup.team });
    expect(shown?.me?.folders.map((one) => [one.path, one.recursive])).toEqual([
      ["/Raw footage", false],
    ]);
    const read = await setup.owner.as.action(api.dropbox.scan, { organizationId: setup.team });
    expect(read.folders.find((one) => one.path === "/Raw footage")).toMatchObject({
      watched: true,
      fresh: 0,
    });
    // Later, a new file right in the folder comes in; one in a folder inside it does not.
    pending = [file("/Raw footage/e.mp4"), file("/Raw footage/Day 2/f.mp4")];
    await notify(setup.t, [JORDAN.account_id]);
    await runScheduled(setup.t);
    expect((await uploads(setup.t)).map((one) => one.fileName).sort()).toEqual([
      "a.mp4",
      "b.mp4",
      "e.mp4",
    ]);
    // Pressing again brings nothing twice.
    expect(
      await setup.owner.as.action(api.dropbox.pullIn, {
        organizationId: setup.team,
        paths: ["/Raw footage"],
      }),
    ).toEqual({ watching: 1, started: 0, more: false });
  });

  test("a folder that is gone, or someone without Dropbox, is refused", async () => {
    const setup = await setUp();
    await connect(setup);
    await expect(
      setup.owner.as.action(api.dropbox.pullIn, { organizationId: setup.team, paths: ["/Nope"] }),
    ).rejects.toThrow(/not in your Dropbox/);
    await expect(
      setup.member.as.action(api.dropbox.scan, { organizationId: setup.team }),
    ).rejects.toThrow(/Connect your Dropbox first/);
  });
});

describe("sending finished files to Dropbox", () => {
  async function finishedRun(setup: SetUp, size: number) {
    const automationId = await setup.t.run((ctx) =>
      ctx.db.insert("automations", {
        organizationId: setup.team,
        name: "Weekly shorts",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: setup.owner.id,
        updatedAt: Date.now(),
      }),
    );
    const LINK = "https://r2.example/test-bucket";
    const JOB = "ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10";
    const runId = await setup.t.run(async (ctx) => {
      const at = { x: 0, y: 0 };
      const runId = await ctx.db.insert("runs", {
        organizationId: setup.team,
        automationId,
        automationName: "Weekly shorts",
        status: "done",
        triggerKind: "manual",
        trigger: { file_url: `${LINK}/teams/${setup.team}/uploads/x/space.mp4` },
        nodes: [{ id: "caps", kind: "step", stepId: "video-caption", input: {}, position: at }],
        edges: [],
        error: null,
        startedBy: null,
        finishedAt: Date.now(),
      });
      await ctx.db.insert("runSteps", {
        runId,
        organizationId: setup.team,
        nodeId: "caps",
        status: "done",
        jobIds: [],
        outputs: [`${LINK}/${JOB}_captioned.mp4`],
        error: null,
        startedAt: 0,
        finishedAt: 0,
      });
      return runId;
    });
    toolkit.put(`${JOB}_captioned.mp4`, size);
    return { automationId, runId };
  }

  async function keep(setup: SetUp, runId: Id<"runs">, size: number) {
    const kept = await setup.t.action(internal.files.keepFinished, { runId });
    for (const key of kept) bucketSizes[`teams/${setup.team}/${key}`] = size;
    await runScheduled(setup.t);
    return kept;
  }

  test("the switch only shows to someone with Dropbox connected, and is off at first", async () => {
    const setup = await setUp();
    const { automationId } = await finishedRun(setup, 1000);
    expect(await setup.owner.as.query(api.dropbox.forAutomation, { automationId })).toBeNull();
    await connect(setup);
    expect(await setup.owner.as.query(api.dropbox.forAutomation, { automationId })).toEqual({
      on: false,
      canSwitch: true,
      account: "Jordan Lee",
      mine: true,
      folder: "/Kontifi/Weekly shorts",
    });
    await expect(
      setup.member.as.mutation(api.dropbox.setSend, { automationId, on: true }),
    ).rejects.toThrow(/Connect your Dropbox/);
  });

  test("switched off, nothing is sent", async () => {
    const setup = await setUp();
    await connect(setup);
    const { runId } = await finishedRun(setup, 1000);
    await keep(setup, runId, 1000);
    expect(contentCalls).toHaveLength(0);
  });

  test("a small file goes in one request, into the member's own folder", async () => {
    const setup = await setUp();
    await connect(setup, setup.member, MAYA_TEAM, "m1");
    const { automationId, runId } = await finishedRun(setup, 1000);
    await setup.member.as.mutation(api.dropbox.setSend, { automationId, on: true });
    const kept = await keep(setup, runId, 1000);
    expect(kept).toHaveLength(1);
    expect(contentCalls).toHaveLength(1);
    expect(contentCalls[0]).toMatchObject({ path: "files/upload", bytes: 1000, root: null });
    expect(contentCalls[0].arg).toMatchObject({ mode: "add", autorename: true });
    expect(String(contentCalls[0].arg.path)).toMatch(/^\/Kontifi\/Weekly shorts\/.+\.mp4$/);
    const sent = await setup.t.run((ctx) => ctx.db.query("dropboxSends").collect());
    expect(sent[0]).toMatchObject({ status: "done", size: 1000 });
    // Keeping the run's files again does not send them twice.
    await keep(setup, runId, 1000);
    expect(contentCalls).toHaveLength(1);
  });

  test("a big file goes in pieces, and a picked team folder is used as is", async () => {
    const setup = await setUp();
    await connect(setup, setup.member, MAYA_TEAM, "m1");
    const size = PIECE_BYTES * 2 + 1234;
    const { automationId, runId } = await finishedRun(setup, size);
    await setup.member.as.mutation(api.dropbox.setSend, {
      automationId,
      on: true,
      folder: "/Marketing/Shorts/",
    });
    await keep(setup, runId, size);
    expect(contentCalls.map((one) => one.path)).toEqual([
      "files/upload_session/start",
      "files/upload_session/append_v2",
      "files/upload_session/append_v2",
      "files/upload_session/finish",
    ]);
    expect(contentCalls.map((one) => one.bytes)).toEqual([PIECE_BYTES, PIECE_BYTES, 1234, 0]);
    expect(contentCalls[2].arg).toMatchObject({
      cursor: { session_id: "session-1", offset: PIECE_BYTES * 2 },
    });
    const finish = contentCalls[3].arg as { cursor: { offset: number }; commit: { path: string } };
    expect(finish.cursor.offset).toBe(size);
    expect(finish.commit.path).toMatch(/^\/Marketing\/Shorts\//);
    // A picked folder is read from the top of the team space.
    expect(JSON.parse(contentCalls[0].root ?? "{}")).toEqual({ ".tag": "root", root: "900" });
  });

  test("disconnecting Dropbox switches sending off", async () => {
    const setup = await setUp();
    await connect(setup);
    const { automationId } = await finishedRun(setup, 1000);
    await setup.owner.as.mutation(api.dropbox.setSend, { automationId, on: true });
    expect((await setup.owner.as.query(api.dropbox.forAutomation, { automationId }))?.on).toBe(
      true,
    );
    await setup.owner.as.mutation(api.dropbox.disconnect, { organizationId: setup.team });
    const automation = await setup.t.run((ctx) => ctx.db.get(automationId));
    expect(automation?.dropboxSend).toBeUndefined();
    expect(await setup.t.run((ctx) => ctx.db.query("dropboxConnections").collect())).toHaveLength(
      0,
    );
  });
});
