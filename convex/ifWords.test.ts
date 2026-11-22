// An If can send each file by what is said in it, from a Transcribe step before it.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Doc } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit } from "./test.toolkit";

type Node = Doc<"automations">["nodes"][number];

const MENU = "https://files.example/in/menu-launch.mp4";
const CHAT = "https://files.example/in/team-chat.mp4";

beforeEach(() => {
  vi.useFakeTimers();
  process.env.CONVEX_SITE_URL = "https://dash.example";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const done = (response: unknown) =>
        new Response(JSON.stringify({ code: 200, response }), { status: 200 });
      if (url.endsWith("/v1/media/transcribe")) {
        return done({
          text: body.media_url === MENU ? "Try our New Menu this week" : "Good morning everyone",
        });
      }
      if (url.endsWith("/v1/video/trim")) return done("https://files.example/out/trimmed.mp4");
      return new Response("not found", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const at = (x: number) => ({ x, y: 0 });
const NODES: Node[] = [
  { id: "listen", kind: "step", stepId: "media-transcribe", input: {}, position: at(0) },
  {
    id: "if",
    kind: "if",
    input: { check: "words", is: "mentions", text: "new menu" },
    position: at(220),
  },
  {
    id: "trim",
    kind: "step",
    stepId: "video-trim",
    input: { start: "00:00:00", end: "00:00:15" },
    position: at(440),
  },
];

describe("an If on what is said", () => {
  test("sends a file that mentions the words by Yes and the rest by No", async () => {
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
    await connectToolkit(t, team, maya.id);
    const runId = await t.run(async (ctx) => {
      const automationId = await ctx.db.insert("automations", {
        organizationId: team,
        name: "Menu clips",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: NODES,
        edges: [
          { id: "e1", source: "listen", target: "if" },
          { id: "e2", source: "if", target: "trim", branch: "yes" },
        ],
        hookToken: "token",
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      });
      const started = await startRun(
        ctx,
        (await ctx.db.get(automationId))!,
        "webhook",
        { file_url: MENU, files: [MENU, CHAT] },
        maya.id,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
    for (let second = 0; second < 20; second++) {
      vi.advanceTimersByTime(1000);
      await t.finishInProgressScheduledFunctions();
    }
    const { ifStep, trimmed } = await t.run(async (ctx) => {
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
      const trim = steps.find((step) => step.nodeId === "trim")!;
      const jobs = await Promise.all(trim.jobIds.map((id) => ctx.db.get(id)));
      return {
        ifStep: steps.find((step) => step.nodeId === "if")!,
        trimmed: jobs.map((job) => (job!.input as { video_url: string }).video_url),
      };
    });
    expect(ifStep.branches).toEqual({ yes: [MENU], no: [CHAT] });
    expect(trimmed).toEqual([MENU]);
  });
});
