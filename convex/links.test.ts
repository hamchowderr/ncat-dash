import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { encryptSecret } from "./lib/crypto";
import { failureWords, keyFromLink, readLink } from "./links";
import { cookieSites } from "./videoCookies";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * A video from a pasted link (links.ts): the toolkit downloads it into the team's folder
 * and it becomes an upload, with the team's cookies for sites that want a sign-in
 * (videoCookies.ts). Pasted to copy its look, its look is studied by itself.
 */

const TOOLKIT = "https://toolkit.example";
const AGENT_URL = "https://agent.example";
const COOKIES =
  "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n#HttpOnly_.vimeo.com\tTRUE\t/\tTRUE\t0\tvuid\txyz\nwww.youtube.com\tFALSE\t/\tFALSE\t0\tPREF\tf1\n";

type Sent = { url: string; body: Record<string, unknown> };

/** The toolkit answering each request at once, the way the real routes do. */
function fakeToolkit({ download = "ok" as "ok" | "sign-in" | "photos" } = {}) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sent.push({ url, body });
      const done = (response: unknown) =>
        new Response(JSON.stringify({ code: 200, response }), { status: 200 });
      if (url.endsWith("/v1/BETA/media/download")) {
        if (download === "sign-in") {
          return new Response(
            "ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies",
            { status: 500 },
          );
        }
        if (download === "photos") {
          return new Response(
            "There is no video or sound at this link to download. It may be a post of photos.",
            { status: 400 },
          );
        }
        // The file came out as WebM, so the toolkit kept that ending.
        const key = String(body.filename).replace(/\.mp4$/, ".webm");
        return done({
          media: {
            media_url: `https://files.example/media/${encodeURI(key)}`,
            title: "Morning routine: 5 tips",
            ext: "webm",
            filesize: 4321,
            width: 1080,
            height: 1920,
            duration: 30,
          },
        });
      }
      if (url.endsWith("/v1/storage/sign")) return done({ url: "https://files.example/signed" });
      if (url.endsWith("/v1/media/metadata")) {
        return done({ duration: 30, width: 1080, height: 1920, filesize: 4321, has_video: true });
      }
      if (url.endsWith("/v1/ffmpeg/compose")) {
        return done([{ file_url: "https://files.example/out/sheet.png" }]);
      }
      if (url.endsWith("/v1/media/look")) return done({ media: { duration: 30, cuts: [5, 10] } });
      if (url === `${AGENT_URL}/ncat/look`) {
        return new Response(JSON.stringify({ answer: JSON.stringify({ fill: "crop" }) }));
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return sent;
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.AGENT_URL;
  delete process.env.MASTRA_JWT_SECRET;
});

async function settled(t: ReturnType<typeof backend>, seconds = 20) {
  for (let second = 0; second < seconds; second++) {
    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();
  }
}

async function setUp() {
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.CONVEX_SITE_URL = "https://dash.example";
  process.env.AGENT_URL = AGENT_URL;
  process.env.MASTRA_JWT_SECRET = "a-shared-secret-for-the-agent-server";
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const ines = await addPerson(t, "Ines Duarte", [team], "owner");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  await t.run(async (ctx) => {
    await ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: TOOLKIT,
      apiKeyCipher,
      apiKeyHint: "abcd",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: 0,
      lastError: null,
      createdBy: ines.id,
      storage: { bucket: "media", endpoint: null, publicUrl: null },
    });
  });
  return { t, team, ines, maya };
}

const downloads = (sent: Sent[]) => sent.filter((one) => one.url.endsWith("/media/download"));

describe("a video from a pasted link", () => {
  test("is downloaded into the team's folder and becomes an upload named as on the site", async () => {
    const sent = fakeToolkit();
    const { t, team, maya } = await setUp();
    await maya.as.mutation(api.links.bringIn, {
      organizationId: team,
      url: "  www.tiktok.com/@salthouse/video/123 ",
    });
    // On its way: it shows in Uploads at once.
    const waiting = await maya.as.query(api.storage.listUploads, { organizationId: team });
    expect(waiting.map((one) => [one.fileName, one.status])).toEqual([
      ["Video from tiktok.com", "uploading"],
    ]);
    await settled(t);

    const [download] = downloads(sent);
    expect(download.body).toMatchObject({
      media_url: "https://www.tiktok.com/@salthouse/video/123",
      cloud_upload: true,
      filename: expect.stringMatching(new RegExp(`^teams/${team}/uploads/[\\w-]+/video\\.mp4$`)),
    });
    expect(download.body.cookie).toBeUndefined();

    const [upload] = await maya.as.query(api.storage.listUploads, { organizationId: team });
    expect(upload).toMatchObject({
      fileName: "Morning routine 5 tips.webm",
      contentType: "video/webm",
      size: 4321,
      status: "ready",
      source: "link",
      sourceUrl: "https://www.tiktok.com/@salthouse/video/123",
      details: expect.objectContaining({ duration: 30, width: 1080 }),
    });
    const stored = await t.run(async (ctx) => (await ctx.db.get(upload._id))!);
    expect(stored.key).toMatch(/^uploads\/[\w-]+\/video\.webm$/);
    // Nothing left to show: the link is in.
    expect(await maya.as.query(api.links.recent, { organizationId: team })).toEqual([]);
    // Not shown with step jobs.
    expect(await maya.as.query(api.jobs.list, { organizationId: team })).toEqual([]);
  });

  test("a site asking for a sign-in says to add cookies, and then gets them", async () => {
    const sent = fakeToolkit({ download: "sign-in" });
    const { t, team, ines } = await setUp();
    await ines.as.mutation(api.links.bringIn, {
      organizationId: team,
      url: "https://www.youtube.com/watch?v=abc",
    });
    await settled(t);
    const [failed] = await ines.as.query(api.links.recent, { organizationId: team });
    expect(failed).toMatchObject({ status: "failed", site: "youtube.com" });
    expect(failed.error).toMatch(/Add your browser's cookies in Settings, Video Links/);
    // The upload that was on its way is gone.
    expect(await ines.as.query(api.storage.listUploads, { organizationId: team })).toEqual([]);

    await ines.as.action(api.videoCookies.set, { organizationId: team, text: COOKIES });
    await ines.as.mutation(api.links.bringIn, {
      organizationId: team,
      url: "https://www.youtube.com/watch?v=abc",
    });
    await settled(t);
    expect(downloads(sent)[1].body.cookie).toBe(COOKIES.trim() + "\n");
    const [again] = await ines.as.query(api.links.recent, { organizationId: team });
    expect(again.error).toMatch(/even with your cookies/);

    await ines.as.mutation(api.links.dismiss, { organizationId: team, importId: again._id });
    await ines.as.mutation(api.links.dismiss, { organizationId: team, importId: failed._id });
    expect(await ines.as.query(api.links.recent, { organizationId: team })).toEqual([]);
  });

  test("a post of photos says so plainly", async () => {
    fakeToolkit({ download: "photos" });
    const { t, team, maya } = await setUp();
    await maya.as.mutation(api.links.bringIn, {
      organizationId: team,
      url: "https://www.instagram.com/p/xyz/",
    });
    await settled(t);
    const [failed] = await maya.as.query(api.links.recent, { organizationId: team });
    expect(failed.error).toBe(
      "There is no video or sound at this link. It may be a post of photos.",
    );
  });

  test("refuses something that is not a link", async () => {
    fakeToolkit();
    const { team, maya } = await setUp();
    await expect(
      maya.as.mutation(api.links.bringIn, { organizationId: team, url: "my best video" }),
    ).rejects.toThrow(/Paste a link to a video/);
  });

  test("pasted to copy its look, its look is studied once it is in", async () => {
    const sent = fakeToolkit();
    const { t, team, ines, maya } = await setUp();
    // Copying a look is for owners and admins.
    await expect(
      maya.as.mutation(api.links.bringIn, {
        organizationId: team,
        url: "https://vimeo.com/1",
        forLook: true,
      }),
    ).rejects.toThrow();
    await ines.as.mutation(api.links.bringIn, {
      organizationId: team,
      url: "https://www.instagram.com/reel/abc/",
      forLook: true,
    });
    const [waiting] = await ines.as.query(api.links.recent, { organizationId: team });
    expect(waiting).toMatchObject({ status: "importing", forLook: "waiting" });
    await expect(
      ines.as.mutation(api.links.bringIn, {
        organizationId: team,
        url: "https://www.instagram.com/reel/def/",
        forLook: true,
      }),
    ).rejects.toThrow(/already on its way/);

    await settled(t, 40);
    expect(sent.some((one) => one.url.endsWith("/v1/ffmpeg/compose"))).toBe(true);
    const shown = await ines.as.query(api.looks.list, { organizationId: team });
    expect(shown.study).toMatchObject({ sourceName: "Morning routine 5 tips.webm" });
    expect(await ines.as.query(api.links.recent, { organizationId: team })).toEqual([]);
  });
});

describe("the team's cookies for video sites", () => {
  test("owners add them; members see only the sites they are for, never the cookies", async () => {
    fakeToolkit();
    const { t, team, ines, maya } = await setUp();
    await expect(
      maya.as.action(api.videoCookies.set, { organizationId: team, text: COOKIES }),
    ).rejects.toThrow();
    await expect(
      ines.as.action(api.videoCookies.set, { organizationId: team, text: "hello there" }),
    ).rejects.toThrow(/not a cookies.txt file/);

    const saved = await ines.as.action(api.videoCookies.set, {
      organizationId: team,
      text: COOKIES,
    });
    expect(saved.sites).toEqual(["vimeo.com", "youtube.com"]);
    const seen = await maya.as.query(api.teamSettings.get, { organizationId: team });
    expect(seen.videoCookies).toEqual({
      sites: ["vimeo.com", "youtube.com"],
      setAt: expect.any(Number),
    });
    expect(JSON.stringify(seen)).not.toContain("SID");
    const stored = await t.run(async (ctx) => (await ctx.db.query("teamSettings").first())!);
    expect(stored.videoCookies?.cipher).not.toContain("youtube");

    await ines.as.mutation(api.videoCookies.remove, { organizationId: team });
    const after = await maya.as.query(api.teamSettings.get, { organizationId: team });
    expect(after.videoCookies).toBeNull();
  });

  test("a download step run by hand gets them too, unless it was given its own", async () => {
    const sent = fakeToolkit();
    const { t, team, ines } = await setUp();
    await ines.as.action(api.videoCookies.set, { organizationId: team, text: COOKIES });
    await ines.as.mutation(api.jobs.run, {
      organizationId: team,
      stepId: "media-download",
      input: { media_url: "https://vimeo.com/1" },
    });
    await ines.as.mutation(api.jobs.run, {
      organizationId: team,
      stepId: "media-download",
      input: { media_url: "https://vimeo.com/2", cookie: "https://cookies.example/mine.txt" },
    });
    await settled(t);
    const cookies = downloads(sent).map((one) => one.body.cookie);
    expect(cookies.sort()).toEqual([COOKIES.trim() + "\n", "https://cookies.example/mine.txt"]);
  });
});

describe("reading links and cookies", () => {
  test("links", () => {
    expect(readLink("tiktok.com/@a/video/1")).toBe("https://tiktok.com/@a/video/1");
    expect(readLink("ftp://example.com/a.mp4")).toBeNull();
    expect(readLink("localhost")).toBeNull();
    expect(readLink("")).toBeNull();
  });

  test("the key the toolkit kept, read from its link", () => {
    const planned = "uploads/u1/video.mp4";
    expect(
      keyFromLink("https://cdn.example/media/teams/t1/uploads/u1/video.mkv", "teams/t1/", planned),
    ).toBe("uploads/u1/video.mkv");
    expect(keyFromLink("not a link", "teams/t1/", planned)).toBe(planned);
  });

  test("failures", () => {
    expect(failureWords("This video is private", false)).toMatch(/Add your browser's cookies/);
    expect(failureWords("Unsupported URL: https://x.example", true)).toMatch(/no video at this/);
    expect(
      failureWords("Unable to download webpage: HTTP Error 429: Too Many Requests", false),
    ).toMatch(/turning away downloads/);
  });

  test("cookie files", () => {
    expect(cookieSites(COOKIES)).toEqual(["vimeo.com", "youtube.com"]);
    expect(cookieSites("# only a comment\n")).toBeNull();
    expect(cookieSites("name=value; other=1")).toBeNull();
  });
});
