import { describe, expect, it } from "vitest";
import { getStep } from "@ncat-dash/step-catalog";
import {
  fileFamily,
  STARTER_CATEGORIES,
  STARTERS,
  type AutomationEdge,
  type AutomationNode,
  downstreamOf,
  fillTemplates,
  graphProblem,
  nextRunAt,
  planJobs,
  readyNodes,
  scheduleProblem,
  TemplateError,
} from "../src";

const node = (id: string, stepId = "video-trim"): AutomationNode => ({
  id,
  kind: "step",
  stepId,
  input: {},
  position: { x: 0, y: 0 },
});
const edge = (source: string, target: string): AutomationEdge => ({
  id: `${source}-${target}`,
  source,
  target,
});

describe("graphProblem", () => {
  it("accepts a chain and a diamond", () => {
    expect(graphProblem([node("a"), node("b")], [edge("a", "b")])).toBeNull();
    expect(
      graphProblem(
        [node("a"), node("b"), node("c"), node("d")],
        [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")],
      ),
    ).toBeNull();
  });
  it("refuses an empty graph, a loop, a dangling or doubled connection", () => {
    expect(graphProblem([], [])).toMatch(/at least one/);
    expect(graphProblem([node("a"), node("b")], [edge("a", "b"), edge("b", "a")])).toMatch(/loop/);
    expect(graphProblem([node("a")], [edge("a", "a")])).toMatch(/itself/);
    expect(graphProblem([node("a")], [edge("a", "zz")])).toMatch(/no longer exists/);
    expect(graphProblem([node("a"), node("b")], [edge("a", "b"), edge("a", "b")])).toMatch(/twice/);
    expect(graphProblem([node("a"), node("a")], [])).toMatch(/same id/);
  });
});

describe("readyNodes and downstreamOf", () => {
  const nodes = [node("a"), node("b"), node("c"), node("d")];
  const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")];
  it("waits for every upstream node", () => {
    const ids = (status: Record<string, "pending" | "done" | "running">) =>
      readyNodes(nodes, edges, status).map((n) => n.id);
    expect(ids({ a: "pending", b: "pending", c: "pending", d: "pending" })).toEqual(["a"]);
    expect(ids({ a: "done", b: "pending", c: "pending", d: "pending" })).toEqual(["b", "c"]);
    expect(ids({ a: "done", b: "done", c: "running", d: "pending" })).toEqual([]);
    expect(ids({ a: "done", b: "done", c: "done", d: "pending" })).toEqual(["d"]);
  });
  it("finds everything a node feeds", () => {
    expect(downstreamOf("a", edges).sort()).toEqual(["b", "c", "d"]);
    expect(downstreamOf("d", edges)).toEqual([]);
  });
});

describe("templates", () => {
  const context = {
    input: "https://x/clip1.mp4",
    inputs: ["https://x/clip1.mp4", "https://x/clip2.mp4"],
    trigger: { file_url: "https://x/in.mp4", body: { title: "Episode 4" } },
    steps: { t1: { url: "https://x/t.srt", urls: ["https://x/t.srt"], result: { text: "hi" } } },
  };
  it("keeps the type of a whole placeholder and writes others in as text", () => {
    expect(fillTemplates("{{inputs}}", context)).toEqual(context.inputs);
    expect(fillTemplates("Title: {{ trigger.body.title }}", context)).toBe("Title: Episode 4");
    expect(
      fillTemplates(
        { a: ["{{steps.t1.url}}"], b: { c: "{{steps.t1.result.text}}" }, n: 3 },
        context,
      ),
    ).toEqual({ a: ["https://x/t.srt"], b: { c: "hi" }, n: 3 });
  });
  it("refuses a placeholder that points at nothing", () => {
    expect(() => fillTemplates("{{steps.nope.url}}", context)).toThrow(TemplateError);
    expect(() => fillTemplates("x {{constructor}}", context)).toThrow(TemplateError);
  });
  it("runs a one-file step once per incoming file", () => {
    const jobs = planJobs(
      { primaryInput: "video_url" },
      { language: "en", note: "{{input}}" },
      context,
    );
    expect(jobs).toEqual([
      { language: "en", note: "https://x/clip1.mp4", video_url: "https://x/clip1.mp4" },
      { language: "en", note: "https://x/clip2.mp4", video_url: "https://x/clip2.mp4" },
    ]);
  });
  it("leaves a filled-in file field alone and fills a list field", () => {
    expect(
      planJobs({ primaryInput: "video_url" }, { video_url: "{{trigger.file_url}}" }, context),
    ).toEqual([{ video_url: "https://x/in.mp4" }]);
    expect(
      planJobs(
        { primaryInput: null, listInput: { field: "video_urls", itemKey: "video_url" } },
        {},
        context,
      ),
    ).toEqual([
      { video_urls: [{ video_url: "https://x/clip1.mp4" }, { video_url: "https://x/clip2.mp4" }] },
    ]);
  });
  it("fails clearly when no file arrives", () => {
    expect(() => planJobs({ primaryInput: "video_url" }, {}, { ...context, inputs: [] })).toThrow(
      /No file reached/,
    );
  });
});

describe("schedule", () => {
  it("steps an interval forward", () => {
    expect(nextRunAt({ mode: "interval", minutes: 15 }, 1_000_000)).toBe(1_000_000 + 900_000);
  });
  it("finds the next daily time in a zone, across a clock change", () => {
    const daily = { mode: "daily", time: "09:00", timeZone: "America/New_York" } as const;
    // 2026-11-16 12:00 UTC is 07:00 in New York (UTC-5): fires the same day at 14:00 UTC.
    expect(new Date(nextRunAt(daily, Date.UTC(2026, 10, 16, 12))).toISOString()).toBe(
      "2026-11-16T14:00:00.000Z",
    );
    // After 09:00 local: the next day.
    expect(new Date(nextRunAt(daily, Date.UTC(2026, 10, 16, 15))).toISOString()).toBe(
      "2026-11-17T14:00:00.000Z",
    );
    // Clocks go forward on 2027-03-14: 09:00 local becomes 13:00 UTC.
    expect(new Date(nextRunAt(daily, Date.UTC(2027, 2, 13, 15))).toISOString()).toBe(
      "2027-03-14T13:00:00.000Z",
    );
  });
  it("checks schedules", () => {
    expect(scheduleProblem({ mode: "interval", minutes: 1 })).toMatch(/every 5 minutes/);
    expect(scheduleProblem({ mode: "daily", time: "9am", timeZone: "UTC" })).toMatch(/09:30/);
    expect(scheduleProblem({ mode: "daily", time: "09:30", timeZone: "Mars/Olympus" })).toMatch(
      /time zone/,
    );
    expect(scheduleProblem({ mode: "daily", time: "09:30", timeZone: "Europe/London" })).toBeNull();
  });
});

describe("files", () => {
  it("sorts names into families by their ending", () => {
    expect(fileFamily("incoming/Episode 4.MP4")).toBe("video");
    expect(fileFamily("a.b.wav")).toBe("audio");
    expect(fileFamily("cover.jpeg")).toBe("image");
    expect(fileFamily("notes.txt")).toBe("other");
    expect(fileFamily("no-ending")).toBe("other");
  });
});

describe("starters", () => {
  it("are complete automations built from steps the catalog has", () => {
    expect(new Set(STARTERS.map((starter) => starter.id)).size).toBe(STARTERS.length);
    for (const starter of STARTERS) {
      expect(graphProblem(starter.nodes, starter.edges), starter.id).toBeNull();
      for (const node of starter.nodes) {
        if (node.kind === "step") expect(getStep(node.stepId!), node.stepId).toBeDefined();
      }
    }
  });
});

describe("the ready-made list", () => {
  it("puts every automation in a known category, and every category has some", () => {
    const known = new Set(STARTER_CATEGORIES.map((category) => category.id));
    for (const starter of STARTERS) expect(known.has(starter.category), starter.id).toBe(true);
    for (const category of STARTER_CATEGORIES) {
      expect(
        STARTERS.filter((starter) => starter.category === category.id).length,
        category.id,
      ).toBeGreaterThan(1);
    }
  });

  it("has every ready-made step and the researched workflows", () => {
    expect(STARTERS.filter((starter) => starter.group === "workflow")).toHaveLength(17);
    expect(STARTERS.filter((starter) => starter.group === "recipe")).toHaveLength(28);
  });

  it("starts audio-only automations from audio uploads", () => {
    for (const id of ["audio-to-video", "lyric-video", "music-release-pack"]) {
      expect(STARTERS.find((starter) => starter.id === id)?.trigger).toEqual({
        kind: "upload",
        fileType: "audio",
      });
    }
  });
});

describe("ready-made step settings", () => {
  it("are settings each step really has", () => {
    for (const starter of STARTERS) {
      for (const node of starter.nodes) {
        if (node.kind !== "step") continue;
        const step = getStep(node.stepId!)!;
        const result = step.input.partial().safeParse(node.input);
        expect(result.success, `${starter.id} ${node.id}`).toBe(true);
      }
    }
  });
});
