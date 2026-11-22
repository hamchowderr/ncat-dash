// When two lines meet at a step, the step can pair their files (by the upload they started
// from, or in order) or take whichever line finishes first.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Doc } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit } from "./test.toolkit";

type Node = Doc<"automations">["nodes"][number];

const A = "https://files.example/in/episode-a.mp4";
const B = "https://files.example/in/episode-b.mp4";

function fakeToolkit() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const done = (response: unknown) =>
        new Response(JSON.stringify({ code: 200, response }), { status: 200 });
      const name = String(body.video_url ?? "")
        .split("/")
        .pop()
        ?.replace(".mp4", "");
      if (url.endsWith("/v1/video/trim")) {
        return done(`https://files.example/out/${name}-from-${body.start}.mp4`);
      }
      if (url.endsWith("/v1/video/cut")) {
        return done(`https://files.example/out/${name}-cut.mp4`);
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.CONVEX_SITE_URL = "https://dash.example";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const at = (x: number, y = 0) => ({ x, y });
const trim = (id: string, start: string, y: number): Node => ({
  id,
  kind: "step",
  stepId: "video-trim",
  input: { start, end: "00:00:30" },
  position: at(0, y),
});
const pip = (join: Node["join"]): Node => ({
  id: "pip",
  kind: "step",
  stepId: "recipe-picture-in-picture",
  input: {},
  position: at(220),
  ...(join ? { join } : {}),
});

async function run(nodes: Node[], edges: { source: string; target: string }[], files: string[]) {
  fakeToolkit();
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  await connectToolkit(t, team, maya.id);
  const runId = await t.run(async (ctx) => {
    const automationId = await ctx.db.insert("automations", {
      organizationId: team,
      name: "Face cam",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes,
      edges: edges.map((edge, index) => ({ id: `e${index}`, ...edge })),
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    });
    const started = await startRun(
      ctx,
      (await ctx.db.get(automationId))!,
      "webhook",
      { file_url: files[0], files },
      maya.id,
    );
    if (!started.ok) throw new Error(started.message);
    return started.runId;
  });
  for (let second = 0; second < 20; second++) {
    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();
  }
  return t.run(async (ctx) => {
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
    const pipStep = steps.find((step) => step.nodeId === "pip");
    const jobs = await Promise.all((pipStep?.jobIds ?? []).map((id) => ctx.db.get(id)));
    return {
      step: pipStep,
      inputs: jobs.map((job) => job!.input as Record<string, unknown>),
    };
  });
}

const TWO_LINES = [
  { source: "main", target: "pip" },
  { source: "cam", target: "pip" },
];

describe("files meeting at a step", () => {
  test("paired by upload: each video gets the other line's video of the same upload", async () => {
    const { inputs } = await run(
      [trim("main", "00:00:05", 0), trim("cam", "00:00:10", 120), pip("source")],
      TWO_LINES,
      [A, B],
    );
    expect(inputs).toHaveLength(2);
    const pairs = Object.fromEntries(inputs.map((one) => [one.video_url, one.other_video_url]));
    expect(pairs).toEqual({
      "https://files.example/out/episode-a-from-00:00:05.mp4":
        "https://files.example/out/episode-a-from-00:00:10.mp4",
      "https://files.example/out/episode-b-from-00:00:05.mp4":
        "https://files.example/out/episode-b-from-00:00:10.mp4",
    });
  });

  test("paired in order: first with first, second with second", async () => {
    const { inputs } = await run(
      [trim("main", "00:00:05", 0), trim("cam", "00:00:10", 120), pip("position")],
      TWO_LINES,
      [A, B],
    );
    expect(inputs.map((one) => [one.video_url, one.other_video_url])).toEqual([
      [
        "https://files.example/out/episode-a-from-00:00:05.mp4",
        "https://files.example/out/episode-a-from-00:00:10.mp4",
      ],
      [
        "https://files.example/out/episode-b-from-00:00:05.mp4",
        "https://files.example/out/episode-b-from-00:00:10.mp4",
      ],
    ]);
  });

  test("by default every file from both lines is worked on", async () => {
    const { inputs } = await run(
      [
        trim("main", "00:00:05", 0),
        trim("cam", "00:00:10", 120),
        { ...pip(undefined), stepId: "video-cut", input: { cuts: [{ start: "0", end: "1" }] } },
      ],
      TWO_LINES,
      [A, B],
    );
    expect(inputs).toHaveLength(4);
  });

  test("a pair that cannot be made stops the step in plain words", async () => {
    // The second line only works on episode A, so episode B has nothing to pair with.
    const onlyA = { ...trim("cam", "00:00:10", 120), input: { video_url: A, start: "00:00:10" } };
    const { step } = await run([trim("main", "00:00:05", 0), onlyA, pip("source")], TWO_LINES, [
      A,
      B,
    ]);
    expect(step?.status).toBe("failed");
    expect(step?.error).toBe(
      "Nothing from the other line started from the same upload as episode-b-from-00:00:05.mp4, so it has nothing to be paired with.",
    );
  });

  test("whichever line finishes first: only its files, without waiting for the other", async () => {
    // The camera line has two steps, so the main line finishes first.
    const { inputs } = await run(
      [
        trim("main", "00:00:05", 0),
        trim("cam", "00:00:10", 120),
        trim("cam2", "00:00:12", 120),
        {
          ...pip("first"),
          stepId: "video-cut",
          input: { cuts: [{ start: "0", end: "1" }] },
        },
      ],
      [
        { source: "main", target: "pip" },
        { source: "cam", target: "cam2" },
        { source: "cam2", target: "pip" },
      ],
      [A, B],
    );
    expect(inputs.map((one) => one.video_url)).toEqual([
      "https://files.example/out/episode-a-from-00:00:05.mp4",
      "https://files.example/out/episode-b-from-00:00:05.mp4",
    ]);
  });
});
