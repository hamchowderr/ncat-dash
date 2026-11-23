// An automation set to run a few at a time keeps further runs waiting their turn, and
// starts them, oldest first, as runs end.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit } from "./test.toolkit";

type Node = Doc<"automations">["nodes"][number];

const TRIM: Node = {
  id: "trim",
  kind: "step",
  stepId: "video-trim",
  input: { start: "00:00:05", end: "00:00:20" },
  position: { x: 0, y: 0 },
};

beforeEach(() => {
  vi.useFakeTimers();
  process.env.CONVEX_SITE_URL = "https://dash.example";
  let made = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/v1/video/trim")) {
        made += 1;
        return new Response(
          JSON.stringify({ code: 200, response: `https://files.example/out/trimmed-${made}.mp4` }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function setUp(runsAtOnce?: number) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  await connectToolkit(t, team, maya.id);
  const automationId = await t.run((ctx) =>
    ctx.db.insert("automations", {
      organizationId: team,
      name: "Trim",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [TRIM],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
      ...(runsAtOnce ? { runsAtOnce } : {}),
    }),
  );
  const start = (file: string) =>
    t.run(async (ctx) => {
      const started = await startRun(
        ctx,
        (await ctx.db.get(automationId))!,
        "webhook",
        { file_url: `https://files.example/in/${file}.mp4` },
        maya.id,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
  const status = (runId: Id<"runs">) =>
    t.run(async (ctx) => {
      const run = (await ctx.db.get(runId))!;
      return { status: run.status, held: run.heldForSlot ?? false };
    });
  const settle = async () => {
    for (let second = 0; second < 20; second++) {
      vi.advanceTimersByTime(1000);
      await t.finishInProgressScheduledFunctions();
    }
  };
  return { t, maya, automationId, start, status, settle };
}

describe("runs at once", () => {
  test("a run started while the limit is reached waits, then starts when one ends", async () => {
    const { start, status, settle } = await setUp(1);
    const first = await start("one");
    const second = await start("two");
    const third = await start("three");
    expect(await status(first)).toEqual({ status: "running", held: false });
    expect(await status(second)).toEqual({ status: "waiting", held: true });
    expect(await status(third)).toEqual({ status: "waiting", held: true });
    await settle();
    expect(await status(first)).toMatchObject({ status: "done" });
    expect(await status(second)).toMatchObject({ status: "done" });
    expect(await status(third)).toMatchObject({ status: "done" });
  });

  test("without a limit every run starts at once", async () => {
    const { start, status } = await setUp();
    const first = await start("one");
    const second = await start("two");
    expect(await status(first)).toEqual({ status: "running", held: false });
    expect(await status(second)).toEqual({ status: "running", held: false });
  });

  test("taking the limit away starts the runs waiting their turn", async () => {
    const { maya, automationId, start, status } = await setUp(1);
    await start("one");
    const second = await start("two");
    expect(await status(second)).toMatchObject({ held: true });
    await maya.as.mutation(api.automations.setRunsAtOnce, { automationId, runsAtOnce: null });
    expect(await status(second)).toEqual({ status: "running", held: false });
  });

  test("only the offered limits can be set, and the run page says a run waits its turn", async () => {
    const { maya, automationId, start } = await setUp(1);
    await expect(
      maya.as.mutation(api.automations.setRunsAtOnce, { automationId, runsAtOnce: 4 }),
    ).rejects.toThrow(/Choose 1, 2, 3, 5, 10 runs at once, or no limit/);
    await start("one");
    const second = await start("two");
    const shown = await maya.as.query(api.runs.get, { runId: second });
    expect(shown?.waitingForTurn).toBe(1);
  });
});
