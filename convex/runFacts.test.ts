import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { factLabel, factsOf } from "./lib/facts";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

describe("the facts read from a toolkit result", () => {
  test("keeps plain values, with labels a person reads", () => {
    expect(
      factsOf({
        duration: 62.456,
        width: 1920,
        has_audio: true,
        text: "Welcome back to the station.",
        frame_rate: 30,
      }),
    ).toEqual([
      { label: "Duration", value: "62.46" },
      { label: "Width", value: "1,920" },
      { label: "Has audio", value: "Yes" },
      { label: "Text", value: "Welcome back to the station." },
      { label: "Frame rate", value: "30" },
    ]);
  });

  test("leaves out files, ids, bookkeeping and anything nested", () => {
    expect(
      factsOf({
        file_url: "https://files.example/a.mp4",
        thumbnail: "https://files.example/a.png",
        job_id: "abc",
        build_number: "204",
        segments: [{ start: 0 }],
        meta: { a: 1 },
        empty: "  ",
        lines: 3,
      }),
    ).toEqual([{ label: "Lines", value: "3" }]);
  });

  test("a file, a list of files or nothing gives no facts", () => {
    expect(factsOf("https://files.example/a.mp4")).toEqual([]);
    expect(factsOf(["https://files.example/a.mp4"])).toEqual([]);
    expect(factsOf(undefined)).toEqual([]);
    expect(factsOf(null)).toEqual([]);
  });

  test("long text is cut short and at most six facts are kept", () => {
    const [fact] = factsOf({ text: "word ".repeat(200) });
    expect(fact.value.length).toBeLessThanOrEqual(280);
    expect(fact.value.endsWith("…")).toBe(true);
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`n${i}`, i]));
    expect(factsOf(many)).toHaveLength(6);
  });

  test("labels keep short forms in capitals", () => {
    expect(factLabel("srt_file")).toBe("SRT file");
    expect(factLabel("frameRate")).toBe("Frame rate");
  });
});

describe("a run page's steps", () => {
  async function runWithJob(result: unknown, trigger: Record<string, unknown>) {
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team]);
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
        createdBy: maya.id,
        updatedAt: Date.now(),
      });
      const started = await startRun(
        ctx,
        (await ctx.db.get(automationId))!,
        "webhook",
        trigger,
        null,
      );
      if (!started.ok) throw new Error(started.message);
      // Stand in for a toolkit job the step finished, with what the toolkit sent back.
      const connectionId = await ctx.db.insert("toolkitConnections", {
        organizationId: team,
        baseUrl: "https://toolkit.example",
        apiKeyCipher: "x",
        apiKeyHint: "abcd",
        status: "ok",
        buildNumber: null,
        lastCheckedAt: 0,
        lastError: null,
        createdBy: maya.id,
      });
      const jobId = await ctx.db.insert("jobs", {
        organizationId: team,
        connectionId,
        stepId: "media-metadata",
        input: {},
        status: "done",
        webhookToken: "t",
        toolkitJobId: null,
        result,
        outputs: [],
        error: null,
        createdBy: maya.id,
        startedAt: 0,
        finishedAt: 1,
      });
      const step = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", started.runId))
        .unique();
      await ctx.db.patch(step!._id, { jobIds: [jobId] });
      return started.runId;
    });
    return { maya, runId };
  }

  test("carry the readable facts of their result and the file that started the run", async () => {
    const { maya, runId } = await runWithJob(
      { duration: 12, job_id: "x" },
      {
        file_url: "https://files.example/station_interview.mp4",
        file_name: "station_interview.mp4",
      },
    );
    const run = await maya.as.query(api.runs.get, { runId });
    expect(run?.startedWith).toBe("station_interview.mp4");
    expect(run?.steps[0].facts).toEqual([{ label: "Duration", value: "12" }]);
  });

  test("a run with no starting file says so, and a file result gives no facts", async () => {
    const { maya, runId } = await runWithJob("https://files.example/out.mp4", {});
    const run = await maya.as.query(api.runs.get, { runId });
    expect(run?.startedWith).toBeNull();
    expect(run?.steps[0].facts).toEqual([]);
  });
});

describe("the newest run, for the editor's canvas", () => {
  test("is null before the first run and for someone outside the team", async () => {
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team]);
    const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
    const automationId = await t.run((ctx) =>
      ctx.db.insert("automations", {
        organizationId: team,
        name: "Weekly clips",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [{ id: "approval", kind: "approval", input: {}, position: { x: 0, y: 0 } }],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      }),
    );
    expect(await maya.as.query(api.runs.latestForAutomation, { automationId })).toBeNull();

    await t.run(async (ctx) => {
      const automation = (await ctx.db.get(automationId))!;
      await startRun(ctx, automation, "webhook", { file_url: "https://files.example/a.mp4" }, null);
      // A second run starts later; the canvas follows the newest.
      await startRun(ctx, automation, "webhook", { file_url: "https://files.example/b.mp4" }, null);
    });
    const latest = await maya.as.query(api.runs.latestForAutomation, { automationId });
    const runs = await maya.as.query(api.runs.listForAutomation, { automationId });
    expect(latest?._id).toBe(runs[0]._id);
    expect(latest).toMatchObject({
      status: "waiting",
      steps: [{ nodeId: "approval", status: "waiting_approval", jobCount: 0, retryAt: null }],
    });
    expect(await outsider.as.query(api.runs.latestForAutomation, { automationId })).toBeNull();
  });
});
