import { describe, expect, it } from "vitest";
import { createNcatRoutes } from "../../src/mastra/ncat/routes";
import { translatePrompt, translateRequest } from "../../src/mastra/ncat/translate";
import { ctx, find } from "../helpers/route-harness";

/**
 * POST /ncat/translate: the dashboard sends a batch of a video's subtitle lines, once per
 * video and language, and gets back the model's answer as text with what it used. The
 * model is the stand-in (AIMock); its answer is at the top of fixtures/chat.json.
 */

const route = find(createNcatRoutes(), "/ncat/translate", "POST");

const ASKED = {
  language: "Spanish",
  title: "Cafe opening",
  lines: ["We opened the cafe last spring.", "Nobody came the first week."],
  organizationId: "team_1",
};

describe("the agent translating subtitles", () => {
  it("answers with the lines in the other language and what it used", async () => {
    const { c, captured } = ctx({ resourceId: "u1", body: ASKED });
    await route.handler(c);
    expect(captured.status).toBe(200);
    const body = captured.body as { answer: string; model: string; usage: unknown };
    expect(JSON.parse(body.answer)).toEqual([
      "Abrimos la cafetería la primavera pasada.",
      "Nadie vino la primera semana.",
    ]);
    expect(typeof body.model).toBe("string");
    expect(body.usage).toBeTruthy();
  });

  it("refuses an unsigned call and a body it cannot read", async () => {
    const unsigned = ctx({ body: ASKED });
    await route.handler(unsigned.c);
    expect(unsigned.captured.status).toBe(401);
    const bad = ctx({ resourceId: "u1", body: { ...ASKED, lines: [] } });
    await route.handler(bad.c);
    expect(bad.captured.status).toBe(400);
  });
});

describe("the translate prompt", () => {
  it("numbers the lines and gives what came before only for sense", () => {
    const prompt = translatePrompt(
      translateRequest.parse({ ...ASKED, before: ["Welcome back to the show."] }),
    );
    expect(prompt.startsWith("Translate these subtitle lines into Spanish.")).toBe(true);
    expect(prompt).toContain("The video is called: Cafe opening");
    expect(prompt).toContain("for sense only");
    expect(prompt).toContain("Lines (2):\n1. We opened the cafe last spring.\n2. Nobody came");
  });

  it("leaves out the title and the lines before when there are none", () => {
    const prompt = translatePrompt(translateRequest.parse({ language: "French", lines: ["Hi"] }));
    expect(prompt).toBe("Translate these subtitle lines into French.\nLines (1):\n1. Hi");
  });
});
