import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const TOOLKIT = "https://toolkit.example";
const PHOTO = "https://files.example/uploads/Spring_Launch-recap.png";
const VIDEO = "https://files.example/uploads/episode_12.mp4";
const CARD = "https://files.example/brand/card.png";
const INTRO = "https://files.example/brand/intro.mp4";
const OUTRO = "https://files.example/brand/outro.mp4";

afterEach(() => vi.unstubAllGlobals());

type Node = { id: string; stepId: string; input?: Record<string, unknown> };

/** A team with a toolkit, a manager, and an automation of `nodes` in a row. */
async function setUp(nodes: Node[]) {
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.CONVEX_SITE_URL = "https://dash.example";
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const automationId = await t.run(async (ctx) => {
    await ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: TOOLKIT,
      apiKeyCipher,
      apiKeyHint: "abcd",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: 0,
      lastError: null,
      createdBy: maya.id,
    });
    return ctx.db.insert("automations", {
      organizationId: team,
      name: "Editing",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: nodes.map((node, index) => ({
        id: node.id,
        kind: "step" as const,
        stepId: node.stepId,
        input: node.input ?? {},
        position: { x: index * 300, y: 0 },
      })),
      edges: nodes
        .slice(1)
        .map((node, index) => ({ id: `e${index}`, source: nodes[index].id, target: node.id })),
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    });
  });
  const start = (trigger: Record<string, unknown>) =>
    t.run(async (ctx) => {
      const automation = (await ctx.db.get(automationId))!;
      const started = await startRun(ctx, automation, "webhook", trigger, maya.id);
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
  const jobsOf = (runId: Id<"runs">, nodeId: string) =>
    t.run(async (ctx) => {
      const step = (await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .filter((q) => q.eq(q.field("nodeId"), nodeId))
        .first())!;
      const jobs = await Promise.all(step.jobIds.map((id) => ctx.db.get(id)));
      return jobs.filter((job) => job !== null);
    });
  return { t, team, maya, start, jobsOf };
}

/** A stand-in toolkit: metadata answers with `facts`, anything else is taken (202). */
function toolkit(facts: Record<string, unknown>) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
    if (path === "/v1/media/metadata") {
      return new Response(JSON.stringify({ code: 200, response: facts }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 202, job_id: "tk-1" }), { status: 202 });
  });
  return calls;
}

describe("brand files for the editing steps", () => {
  test("Settings keeps a card template, an intro and an outro", async () => {
    const { team, maya } = await setUp([]);
    await maya.as.mutation(api.teamSettings.setBrand, {
      organizationId: team,
      brand: { card: CARD, intro: INTRO, outro: OUTRO, color: "#FFCC00" },
    });
    const settings = await maya.as.query(api.teamSettings.get, { organizationId: team });
    expect(settings.brand).toMatchObject({ card: CARD, intro: INTRO, outro: OUTRO });
  });

  test("an intro that is not a file or a link is turned away", async () => {
    const { team, maya } = await setUp([]);
    await expect(
      maya.as.mutation(api.teamSettings.setBrand, {
        organizationId: team,
        brand: { intro: "my intro" },
      }),
    ).rejects.toThrow(/https:\/\//);
  });

  test("a quote card takes the team's card template and font without being asked", async () => {
    const { team, maya, start, jobsOf } = await setUp([
      { id: "quote_1", stepId: "recipe-quote-card", input: { text: "Ship it before it's ready." } },
    ]);
    await maya.as.mutation(api.teamSettings.setBrand, {
      organizationId: team,
      brand: { card: CARD, font: "Inter" },
    });
    const [job] = await jobsOf(await start({}), "quote_1");
    expect(job.input).toMatchObject({ template_url: CARD, font: "Inter" });
  });

  test("a title on a picture comes from the name of the file that started the run", async () => {
    const { team, maya, start, jobsOf } = await setUp([
      { id: "title_1", stepId: "recipe-title-on-picture" },
    ]);
    await maya.as.mutation(api.teamSettings.setBrand, {
      organizationId: team,
      brand: { color: "#1E2A78" },
    });
    const runId = await start({ file_url: PHOTO, file_name: "Spring_Launch-recap.png" });
    const [job] = await jobsOf(runId, "title_1");
    expect(job.input).toMatchObject({
      image_url: PHOTO,
      file_name: "Spring_Launch-recap.png",
      band_color: "#1E2A78",
    });
  });

  test("a title typed on the step wins over the file's name", async () => {
    const { start, jobsOf } = await setUp([
      { id: "title_1", stepId: "recipe-title-on-picture", input: { title: "Launch day" } },
    ]);
    const [job] = await jobsOf(
      await start({ file_url: PHOTO, file_name: "Spring_Launch-recap.png" }),
      "title_1",
    );
    expect(job.input).toMatchObject({ title: "Launch day" });
  });
});

describe("steps that read their files first", () => {
  test("a video card with no card template stops before the toolkit is asked", async () => {
    const { t, start } = await setUp([
      { id: "card_1", stepId: "recipe-video-card", input: { text: "Follow for part 2" } },
    ]);
    const calls = toolkit({ duration: 12.5, width: 1080, height: 1920 });
    const runId = await start({ file_url: VIDEO });
    const step = await t.run((ctx) =>
      ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .first(),
    );
    expect(step?.status).toBe("failed");
    expect(step?.error).toMatch(/template_url/);
    expect(calls.filter((call) => JSON.stringify(call.body).includes(VIDEO))).toHaveLength(0);
  });

  test("reads the video, then sends a request sized to it", async () => {
    const { t, team, maya, start, jobsOf } = await setUp([
      { id: "card_1", stepId: "recipe-video-card", input: { text: "Follow for part 2" } },
    ]);
    await maya.as.mutation(api.teamSettings.setBrand, {
      organizationId: team,
      brand: { card: CARD },
    });
    const calls = toolkit({
      duration: 12.5,
      width: 1080,
      height: 1920,
      video_fps: 30,
      has_video: true,
      has_audio: true,
    });
    const runId = await start({ file_url: VIDEO });
    const [job] = await jobsOf(runId, "card_1");
    await t.action(internal.jobs.dispatch, { jobId: job._id });
    // Jobs left over from earlier tests may still be dispatching; keep this video's calls.
    const mine = calls.filter((call) => JSON.stringify(call.body).includes(VIDEO));
    expect(mine.map((call) => call.path)).toEqual(["/v1/media/metadata", "/v1/ffmpeg/compose"]);
    expect(mine[0].body).toMatchObject({ media_url: VIDEO });
    // The card is fitted to the video's own 1080x1920 frame.
    expect(JSON.stringify(mine[1].body)).toContain("1080:1920");
    expect((await jobsOf(runId, "card_1"))[0].status).toBe("running");
  });

  test("an intro and outro step with neither in Settings fails plainly, once", async () => {
    const { t, start, jobsOf } = await setUp([{ id: "wrap_1", stepId: "recipe-intro-outro" }]);
    toolkit({ duration: 30, width: 1920, height: 1080, has_video: true, has_audio: true });
    const runId = await start({ file_url: VIDEO });
    const [job] = await jobsOf(runId, "wrap_1");
    await t.action(internal.jobs.dispatch, { jobId: job._id });
    const [after] = await jobsOf(runId, "wrap_1");
    expect(after.status).toBe("failed");
    expect(after.permanent).toBe(true);
    expect(after.error).toBe("Add an intro or an outro in Settings, under Brand.");
  });
});
