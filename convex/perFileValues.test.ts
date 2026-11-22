// A value one step makes (a transcript's captions) belongs to the file that step worked
// on. A later step gets it only for that same file, never for a file cut or changed from it.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Doc } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit } from "./test.toolkit";

type Node = Doc<"automations">["nodes"][number];
type Sent = { url: string; body: Record<string, unknown> };

const A = "https://files.example/in/episode-a.mp4";
const B = "https://files.example/in/episode-b.mp4";

const srtOf = (url: string) => `1\n00:00:01,000 --> 00:00:02,000\nWords of ${url}\n`;

function fakeToolkit() {
  const sent: Sent[] = [];
  let made = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sent.push({ url, body });
      const done = (response: unknown) =>
        new Response(JSON.stringify({ code: 200, response }), { status: 200 });
      if (url.endsWith("/v1/media/transcribe")) {
        return done({ text: `Words of ${body.media_url}`, srt: srtOf(String(body.media_url)) });
      }
      if (url.endsWith("/v1/video/trim")) {
        made += 1;
        return done(`https://files.example/out/trimmed-${made}.mp4`);
      }
      if (url.endsWith("/v1/video/caption")) {
        made += 1;
        return done(`https://files.example/out/captioned-${made}.mp4`);
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
  return sent;
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
const TRANSCRIBE: Node = {
  id: "transcribe",
  kind: "step",
  stepId: "media-transcribe",
  input: {},
  position: at(0),
};
const TRIM: Node = {
  id: "trim",
  kind: "step",
  stepId: "video-trim",
  input: { start: "00:00:05", end: "00:00:20" },
  position: at(220),
};
const CAPTION: Node = {
  id: "caption",
  kind: "step",
  stepId: "video-caption",
  input: {},
  position: at(440),
};

async function run(nodes: Node[], trigger: Record<string, unknown>) {
  const sent = fakeToolkit();
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  await connectToolkit(t, team, maya.id);
  const edges = nodes.slice(1).map((node, index) => ({
    id: `e${index}`,
    source: nodes[index].id,
    target: node.id,
  }));
  await t.run(async (ctx) => {
    const automationId = await ctx.db.insert("automations", {
      organizationId: team,
      name: "Captions",
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
  });
  for (let second = 0; second < 30; second++) {
    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();
  }
  return sent.filter((each) => each.url.endsWith("/v1/video/caption"));
}

describe("a value made for one file", () => {
  test("is not handed to a file cut from it", async () => {
    const captions = await run([TRANSCRIBE, TRIM, CAPTION], { file_url: A });
    // The trimmed video starts 5 seconds in, so the whole video's caption timings are
    // wrong for it: it is captioned from its own words instead.
    for (const each of captions) expect(each.body.captions).not.toBe(srtOf(A));
  });

  test("goes to the same file, one each, when several files ran", async () => {
    const captions = await run([TRANSCRIBE, CAPTION], { file_url: A, files: [A, B] });
    const byVideo = Object.fromEntries(
      captions.map((each) => [each.body.video_url, each.body.captions]),
    );
    expect(byVideo).toEqual({ [A]: srtOf(A), [B]: srtOf(B) });
  });

  test("still goes to the one file when one file ran", async () => {
    const captions = await run([TRANSCRIBE, CAPTION], { file_url: A });
    expect(captions.map((each) => each.body)).toMatchObject([{ video_url: A, captions: srtOf(A) }]);
  });
});
