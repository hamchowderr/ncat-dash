import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { shownInput } from "./lib/stepLog";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit } from "./test.toolkit";

type Node = Doc<"automations">["nodes"][number];

const FILE = "https://files.example/in/episode.mp4";

beforeEach(() => {
  vi.useFakeTimers();
  process.env.CONVEX_SITE_URL = "https://dash.example";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a step's log", () => {
  test("lists every job it sent, the failed try too, with what was sent and when", async () => {
    let trims = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/video/trim")) {
          trims += 1;
          if (trims === 1) return new Response("busy", { status: 503 });
          return new Response(
            JSON.stringify({
              code: 200,
              job_id: "tk-42",
              response: "https://files.example/out/trimmed.mp4",
            }),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
    const stranger = await addPerson(t, "Sam Reed", [await addTeam(t, "Elsewhere")]);
    await connectToolkit(t, team, maya.id);
    const trim: Node = {
      id: "trim",
      kind: "step",
      stepId: "video-trim",
      input: { start: "00:00:05", end: "00:00:20" },
      position: { x: 0, y: 0 },
    };
    const runId = await t.run(async (ctx) => {
      const automationId = await ctx.db.insert("automations", {
        organizationId: team,
        name: "Trim",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [trim],
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
        { file_url: FILE },
        maya.id,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
    for (let second = 0; second < 120; second++) {
      vi.advanceTimersByTime(1000);
      await t.finishInProgressScheduledFunctions();
    }
    const run = (await maya.as.query(api.runs.get, { runId }))!;
    const step = run.steps.find((each) => each.nodeId === "trim")!;
    expect(step.status).toBe("done");

    const log = (await maya.as.query(api.runs.stepLog, { runStepId: step._id }))!;
    expect(log.tries).toHaveLength(1);
    expect(log.tries[0].error).toMatch(/503|busy/);
    expect(log.jobs.map((job) => job.status)).toEqual(["failed", "done"]);
    const [failed, worked] = log.jobs;
    expect(failed).toMatchObject({ title: "Trim video", file: FILE, permanent: false });
    expect(failed.error).toBeTruthy();
    expect(worked).toMatchObject({
      file: FILE,
      error: null,
      outputs: ["https://files.example/out/trimmed.mp4"],
      input: expect.objectContaining({ video_url: FILE, start: "00:00:05", end: "00:00:20" }),
    });
    expect(worked.sentAt).toBeGreaterThanOrEqual(worked.queuedAt);
    expect(worked.finishedAt).toBeGreaterThanOrEqual(worked.sentAt!);
    expect(log.more).toBe(false);
    // The file it made, traced back to the file the run started with.
    expect(log.files).toEqual([
      expect.objectContaining({ url: step.outputs[0], from: FILE, source: FILE, kind: "video" }),
    ]);
    // Nobody outside the team reads it.
    expect(await stranger.as.query(api.runs.stepLog, { runStepId: step._id })).toBeNull();
  });

  test("hides secrets and cuts long text", () => {
    const shown = shownInput({
      video_url: FILE,
      api_key: "sk-live-123",
      settings: { secret_token: "abc", style: "classic" },
      captions: "x".repeat(1000),
    }) as Record<string, unknown>;
    expect(shown.api_key).toBe("hidden");
    expect(shown.settings).toEqual({ secret_token: "hidden", style: "classic" });
    expect(shown.video_url).toBe(FILE);
    expect(String(shown.captions)).toMatch(/… \(1000 characters\)$/);
    expect(String(shown.captions).length).toBeLessThan(450);
  });
});
