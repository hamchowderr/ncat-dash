import { describe, expect, it } from "vitest";
import { scenesPrompt, scenesRequest } from "../../src/mastra/ncat/scenes";
import { createNcatRoutes } from "../../src/mastra/ncat/routes";
import { ctx, find } from "../helpers/route-harness";

/**
 * POST /ncat/scenes: when someone presses "Suggest scenes" on a storyboard, the dashboard
 * sends its chapters and numbered lines and gets back, as text, the lines better shown
 * another way and a name for each chapter. The model is the stand-in (AIMock); its answer
 * is at the top of fixtures/chat.json.
 */

const route = find(createNcatRoutes(), "/ncat/scenes", "POST");

const ASKED = {
  name: "Drafted from scenes-lesson.mp4",
  aspect: "9:16",
  organizationId: "team_1",
  chapters: [
    {
      title: "Welcome to the course",
      lines: [
        { n: 1, line: "Welcome to the course." },
        { n: 2, line: "There are three things you need." },
      ],
    },
    {
      title: "Step two is the upload",
      lines: [{ n: 3, line: "Here on the screen you can see the upload page." }],
    },
  ],
};

describe("the agent suggesting scenes", () => {
  it("answers with the scenes and chapter names the model gave", async () => {
    const { c, captured } = ctx({ resourceId: "u1", body: ASKED });
    await route.handler(c);
    expect(captured.status).toBe(200);
    const answer = JSON.parse((captured.body as { answer: string }).answer) as {
      chapters: { title: string }[];
      scenes: { n: number; scene: string }[];
    };
    expect(answer.chapters.map((chapter) => chapter.title)).toEqual([
      "Why this course",
      "Uploading your video",
    ]);
    expect(answer.scenes).toEqual([
      { n: 2, scene: "panel" },
      { n: 3, scene: "circle" },
    ]);
  });

  it("refuses an unsigned call and a body it cannot read", async () => {
    const unsigned = ctx({ body: ASKED });
    await route.handler(unsigned.c);
    expect(unsigned.captured.status).toBe(401);
    const bad = ctx({ resourceId: "u1", body: { ...ASKED, chapters: [] } });
    await route.handler(bad.c);
    expect(bad.captured.status).toBe(400);
  });
});

describe("the scenes prompt", () => {
  it("lists every chapter with its numbered lines, after the shape", () => {
    const prompt = scenesPrompt(scenesRequest.parse(ASKED));
    expect(prompt).toBe(
      [
        "Storyboard: Drafted from scenes-lesson.mp4",
        "Shape: 9:16 (upright, for phones).",
        "",
        "Chapter 1: Welcome to the course",
        "1. Welcome to the course.",
        "2. There are three things you need.",
        "",
        "Chapter 2: Step two is the upload",
        "3. Here on the screen you can see the upload page.",
      ].join("\n"),
    );
  });
});
