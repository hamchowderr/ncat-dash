import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { cleanPageUrl, describeStep, profileName, recordingFileName } from "./lib/pageRecording";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * Page recordings: a take marked "Page recording" is recorded by the agent from a web page.
 * It waits its turn in one line, the agent server records it and sends the raw video into
 * the bucket, the toolkit turns it into MP4, and the MP4 is kept in the team's "Page
 * Recordings" folder and put into the take. The clicks are kept for recording again.
 */

const TOOLKIT = "https://toolkit.example";
const AGENT_URL = "https://agent.example";
const CONVERTED = "https://files.example/out/take.mp4";
const STEPS = [
  { do: "goto", url: "https://example.com/" },
  { do: "click", target: { role: "link", name: "Pricing", nth: 0 } },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.AGENT_URL;
  delete process.env.MASTRA_JWT_SECRET;
});

type Sent = { url: string; body: Record<string, unknown>; method: string };

/** A stand-in toolkit, bucket, agent server and Firecrawl sign-in. */
function stubs(agent?: (body: Record<string, unknown>) => Response) {
  const sent: Sent[] = [];
  const put: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(String(init?.body ?? "")) as Record<string, unknown>;
    } catch {
      body = {};
    }
    sent.push({ url, body, method });
    if (url === `${TOOLKIT}/v1/storage/sign`) {
      return Response.json({
        response: {
          url: `https://bucket.example/${String(body.key)}?method=${String(body.method)}`,
        },
      });
    }
    if (url === `${TOOLKIT}/v1/storage/list`) {
      return Response.json({ response: { files: [], folders: [], next_token: null } });
    }
    if (url === `${TOOLKIT}/v1/storage/delete`) return Response.json({ response: { failed: [] } });
    if (url === `${TOOLKIT}/v1/media/convert`)
      return Response.json({ code: 200, response: CONVERTED });
    if (url === CONVERTED) return new Response(new Uint8Array(4321));
    if (url.startsWith("https://bucket.example/") && method === "PUT") {
      put.push(decodeURIComponent(new URL(url).pathname.slice(1)));
      return new Response(null, { status: 200 });
    }
    if (url === `${AGENT_URL}/ncat/record`) {
      return agent
        ? agent(body)
        : Response.json({ steps: STEPS, rehearsed: true, durationMs: 8200, frames: 120 });
    }
    if (url === `${AGENT_URL}/ncat/sign-in/start`) {
      return Response.json({ sessionId: "session_1", liveViewUrl: "https://live.example/s1" });
    }
    if (url === `${AGENT_URL}/ncat/sign-in/finish`) return Response.json({ ok: true });
    return new Response(JSON.stringify({ code: 202, job_id: "tk-1" }), { status: 202 });
  });
  return { sent, put };
}

async function setUp() {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.AGENT_URL = AGENT_URL;
  process.env.MASTRA_JWT_SECRET = "a-shared-secret-for-the-agent-server";
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Example Studio");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  await t.run((ctx) =>
    ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: TOOLKIT,
      apiKeyCipher,
      apiKeyHint: "abcd",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: 0,
      lastError: null,
      createdBy: maya.id,
      storage: { bucket: "media", endpoint: null, publicUrl: null },
    }),
  );
  const projectId = await maya.as.mutation(api.projects.create, {
    organizationId: team,
    name: "Pricing walkthrough",
    package: "blank",
  });
  const storyboardId = await maya.as.mutation(api.storyboards.create, {
    projectId,
    script:
      "## Plans\n[Full Screen · You] Hi there.\n[Full Screen · Page recording] Here are the plans.",
  });
  const board = async () => (await maya.as.query(api.storyboards.get, { projectId }))!;
  const [said, shown] = (await board()).chapters[0].takes;
  const rows = () => maya.as.query(api.pageRecordings.forStoryboard, { storyboardId });
  // The pool runs on its own timers; give it time and let what it started finish.
  const run = async (seconds = 20) => {
    for (let second = 0; second < seconds; second++) {
      vi.advanceTimersByTime(1000);
      await t.finishInProgressScheduledFunctions();
    }
  };
  return { t, team, maya, outsider, storyboardId, board, said, shown, rows, run };
}

describe("the rules for page recordings", () => {
  test("a page address is http or https, and https is added when left out", () => {
    expect(cleanPageUrl("example.com/pricing")).toBe("https://example.com/pricing");
    expect(cleanPageUrl(" http://localhost:3000 ")).toBe("http://localhost:3000/");
    expect(cleanPageUrl("javascript:alert(1)")).toBeNull();
    expect(cleanPageUrl("file:///etc/passwd")).toBeNull();
    expect(cleanPageUrl("not a page")).toBeNull();
  });

  test("a recording is named for its take, and a sign-in's profile is the team's own", () => {
    expect(recordingFileName(4, "Open the pricing page: plans/prices?")).toBe(
      "Take 4 - Open the pricing page plans prices.mp4",
    );
    expect(profileName("org/1", "abc 2")).toBe("takewon-org1-abc2");
    expect(describeStep({ do: "scroll", direction: "down", amount: 400 })).toBe("Scroll down");
  });
});

describe("recording a take", () => {
  test("waits its turn, is recorded and converted, and goes into the take and the team's files", async () => {
    const { t, maya, shown, rows, run, board } = await setUp();
    const { sent, put } = stubs();
    await maya.as.mutation(api.pageRecordings.record, {
      takeId: shown._id,
      url: "example.com",
      notes: "Show the yearly prices",
    });
    expect((await rows())[0]).toMatchObject({
      status: "queued",
      place: 1,
      url: "https://example.com/",
    });
    await run();

    const asked = sent.find((call) => call.url === `${AGENT_URL}/ncat/record`)!;
    expect(asked.body).toMatchObject({
      line: "Here are the plans.",
      url: "https://example.com/",
      notes: "Show the yearly prices",
      aspect: "16:9",
      profile: null,
      steps: null,
    });
    expect(String(asked.body.uploadUrl)).toContain("page-recordings/");
    const convert = sent.find((call) => call.url === `${TOOLKIT}/v1/media/convert`)!;
    expect(convert.body).toMatchObject({ format: "mp4", video_codec: "libx264" });
    expect(
      put.some((key) => key.endsWith("Page Recordings/Take 2 - Here are the plans..mp4")),
    ).toBe(true);

    const [row] = await rows();
    expect(row).toMatchObject({ status: "done", durationMs: 8200, steps: STEPS });
    const upload = await t.run((ctx) => ctx.db.get(row.uploadId as Id<"uploads">));
    expect(upload).toMatchObject({
      purpose: "recording",
      contentType: "video/mp4",
      size: 4321,
      fileName: "Take 2 - Here are the plans..mp4",
    });
    const take = (await board()).chapters[0].takes[1];
    expect(take.files.recording).toBe(`upload:${row.uploadId}`);
  });

  test("records again with the same clicks, and no AI", async () => {
    const { maya, shown, rows, run } = await setUp();
    const { sent } = stubs();
    await expect(
      maya.as.mutation(api.pageRecordings.record, {
        takeId: shown._id,
        url: "https://example.com",
        again: true,
      }),
    ).rejects.toThrow(/no saved clicks/);
    await maya.as.mutation(api.pageRecordings.record, {
      takeId: shown._id,
      url: "https://example.com",
    });
    await run();
    await maya.as.mutation(api.pageRecordings.record, {
      takeId: shown._id,
      url: "https://other.example.com",
      again: true,
    });
    await run();
    const calls = sent.filter((call) => call.url === `${AGENT_URL}/ncat/record`);
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toMatchObject({ steps: STEPS, url: "https://example.com/" });
    expect((await rows())[0].status).toBe("done");
  });

  test("keeps the reason a take could not be recorded", async () => {
    const { maya, shown, rows, run } = await setUp();
    stubs(() =>
      Response.json(
        { error: "The page no longer has what this step clicks.", code: "step_missing" },
        { status: 422 },
      ),
    );
    await maya.as.mutation(api.pageRecordings.record, {
      takeId: shown._id,
      url: "https://example.com",
    });
    await run();
    expect((await rows())[0]).toMatchObject({
      status: "failed",
      problem: "The page no longer has what this step clicks.",
    });
  });

  test("refuses takes with no page recording, bad addresses, a second at once, and outsiders", async () => {
    const { t, maya, outsider, said, shown } = await setUp();
    stubs();
    await expect(
      maya.as.mutation(api.pageRecordings.record, { takeId: said._id, url: "https://example.com" }),
    ).rejects.toThrow(/no page recording/);
    await expect(
      maya.as.mutation(api.pageRecordings.record, { takeId: shown._id, url: "ftp://example.com" }),
    ).rejects.toThrow(/web address/);
    await expect(
      outsider.as.mutation(api.pageRecordings.record, {
        takeId: shown._id,
        url: "https://example.com",
      }),
    ).rejects.toThrow();
    await maya.as.mutation(api.pageRecordings.record, {
      takeId: shown._id,
      url: "https://example.com",
    });
    await expect(
      maya.as.mutation(api.pageRecordings.record, {
        takeId: shown._id,
        url: "https://example.com",
      }),
    ).rejects.toThrow(/already being recorded/);
    // A recording the pool lost part-way says so instead of waiting for ever.
    const [row] = await t.run((ctx) => ctx.db.query("takeRecordings").collect());
    await t.mutation(internal.pageRecordings.ended, {
      workId: "w1" as never,
      context: { recordingId: row._id },
      result: { kind: "failed", error: "boom" },
    });
    expect((await t.run((ctx) => ctx.db.get(row._id)))?.status).toBe("failed");
  });
});

describe("saved sign-ins", () => {
  test("open a browser to sign in, are kept once signed in, and recordings use them", async () => {
    const { maya, team, shown, run } = await setUp();
    const { sent } = stubs();
    const started = await maya.as.action(api.pageRecordings.startSignIn, {
      organizationId: team,
      name: "Example Studio admin",
      url: "app.example.com/login",
    });
    expect(started.liveViewUrl).toBe("https://live.example/s1");
    const start = sent.find((call) => call.url === `${AGENT_URL}/ncat/sign-in/start`)!;
    expect(String(start.body.profile)).toMatch(/^takewon-[A-Za-z0-9_-]+$/);
    expect(start.body.url).toBe("https://app.example.com/login");

    // Not usable until the person says they are signed in.
    await expect(
      maya.as.mutation(api.pageRecordings.record, {
        takeId: shown._id,
        url: "https://app.example.com",
        signInId: started.signInId,
      }),
    ).rejects.toThrow(/Finish signing in/);
    await maya.as.action(api.pageRecordings.finishSignIn, { signInId: started.signInId });
    expect(await maya.as.query(api.pageRecordings.signIns, { organizationId: team })).toEqual([
      expect.objectContaining({ name: "Example Studio admin", status: "saved" }),
    ]);

    await maya.as.mutation(api.pageRecordings.record, {
      takeId: shown._id,
      url: "https://app.example.com",
      signInId: started.signInId,
    });
    await run();
    const asked = sent.find((call) => call.url === `${AGENT_URL}/ncat/record`)!;
    expect(asked.body.profile).toBe(start.body.profile);

    await maya.as.mutation(api.pageRecordings.removeSignIn, { signInId: started.signInId });
    expect(await maya.as.query(api.pageRecordings.signIns, { organizationId: team })).toEqual([]);
  });

  test("one whose browser never opened is not kept, so it can be tried again", async () => {
    const { maya, team } = await setUp();
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "Saved sign-ins need a Firecrawl key." }, { status: 502 }),
    );
    const ask = () =>
      maya.as.action(api.pageRecordings.startSignIn, {
        organizationId: team,
        name: "Admin",
        url: "https://app.example.com",
      });
    await expect(ask()).rejects.toThrow(/Firecrawl key/);
    await expect(ask()).rejects.toThrow(/Firecrawl key/);
    expect(await maya.as.query(api.pageRecordings.signIns, { organizationId: team })).toEqual([]);
  });

  test("are the team's own", async () => {
    const { maya, outsider, team } = await setUp();
    stubs();
    const started = await maya.as.action(api.pageRecordings.startSignIn, {
      organizationId: team,
      name: "Admin",
      url: "https://app.example.com",
    });
    await expect(
      outsider.as.query(api.pageRecordings.signIns, { organizationId: team }),
    ).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.pageRecordings.removeSignIn, { signInId: started.signInId }),
    ).rejects.toThrow();
  });
});
