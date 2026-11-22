// Each finished step writes down where its files came from, so later steps can pair
// files that started in the same place.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Doc } from "./_generated/dataModel";
import { itemKind } from "./lib/items";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit } from "./test.toolkit";

type Node = Doc<"automations">["nodes"][number];

const A = "https://files.example/in/episode-a.mp4";
const B = "https://files.example/in/episode-b.mp4";

function fakeToolkit() {
  let made = 0;
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
        made += 1;
        return done(`https://files.example/out/${name}-trimmed-${made}.mp4`);
      }
      if (url.endsWith("/v1/video/caption")) {
        made += 1;
        return done(`https://files.example/out/captioned-${made}.mp4`);
      }
      if (url.endsWith("/v1/media/transcribe")) {
        return done({ text: "Words", srt: "1\n00:00:01,000 --> 00:00:02,000\nWords\n" });
      }
      if (url.endsWith("/v1/media/generate/ass")) {
        made += 1;
        return done(`https://files.example/out/words-${made}.ass`);
      }
      if (url.endsWith("/v1/ffmpeg/compose")) {
        made += 1;
        return done([{ file_url: `https://files.example/out/burned-${made}.mp4` }]);
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

const at = (x: number) => ({ x, y: 0 });
const TRIM: Node = {
  id: "trim",
  kind: "step",
  stepId: "video-trim",
  input: { start: "00:00:05", end: "00:00:20" },
  position: at(0),
};
const CAPTION: Node = {
  id: "caption",
  kind: "step",
  stepId: "video-caption",
  input: {},
  position: at(220),
};

async function run(nodes: Node[], trigger: Record<string, unknown>) {
  fakeToolkit();
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  await connectToolkit(t, team, maya.id);
  const edges = nodes.slice(1).map((node, index) => ({
    id: `e${index}`,
    source: nodes[index].id,
    target: node.id,
  }));
  const runId = await t.run(async (ctx) => {
    const automationId = await ctx.db.insert("automations", {
      organizationId: team,
      name: "Trim and caption",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes,
      edges,
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
      maya.id,
    );
    if (!started.ok) throw new Error(started.message);
    return started.runId;
  });
  for (let second = 0; second < 30; second++) {
    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();
  }
  return t.run(async (ctx) => {
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
    const run = await ctx.db.get(runId);
    return { run, steps: Object.fromEntries(steps.map((step) => [step.nodeId, step])) };
  });
}

describe("where a step's files came from", () => {
  test("each file made from an upload points back to it, two steps on", async () => {
    const { run: done, steps } = await run([TRIM, CAPTION], { file_url: A, files: [A, B] });
    expect(done?.status).toBe("done");

    const trimmed = steps.trim.items ?? [];
    expect(trimmed).toHaveLength(2);
    for (const item of trimmed) {
      const upload = item.url.includes("episode-a") ? A : B;
      expect(item).toMatchObject({ from: upload, source: upload, kind: "video" });
    }

    const captioned = steps.caption.items ?? [];
    expect(captioned).toHaveLength(2);
    expect(captioned.map((item) => item.source).sort()).toEqual([A, B]);
    for (const item of captioned) {
      const cut = trimmed.find((one) => one.source === item.source)!.url;
      expect(item).toMatchObject({ from: cut, kind: "video" });
    }
  });

  test("a single upload is the source of everything made from it", async () => {
    const { steps } = await run([TRIM, CAPTION], { file_url: A });
    expect(steps.caption.items).toEqual([
      expect.objectContaining({ source: A, from: steps.trim.outputs[0] }),
    ]);
    expect(steps.caption.items?.map((item) => item.url)).toEqual(steps.caption.outputs);
  });
});

describe("what kind of file", () => {
  test("is told from the address", () => {
    expect(itemKind("https://x.example/a.mp4")).toBe("video");
    expect(itemKind("https://x.example/a.MP3?sig=1")).toBe("audio");
    expect(itemKind("https://x.example/a.webp")).toBe("image");
    expect(itemKind("https://x.example/a.srt")).toBe("captions");
    expect(itemKind("https://x.example/a.json")).toBe("text");
    expect(itemKind("https://x.example/a")).toBe("other");
  });
});
