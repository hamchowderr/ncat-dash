import { describe, expect, test } from "vitest";

import { errorWords, resultWords, toolWords } from "./tool-words";

describe("what the agent's tools are called", () => {
  test("reading tools have a title and nothing to ask", () => {
    for (const name of ["dash_overview", "describe_automation", "list_step_types"]) {
      const words = toolWords(name, {});
      expect(words?.title).toBeTruthy();
      expect(words?.question).toBe("");
    }
  });

  test("a tool that is not the dashboard's is left to the chat's own view", () => {
    expect(toolWords("getWeather", { city: "Tokyo" })).toBeNull();
    expect(toolWords(undefined, undefined)).toBeNull();
  });

  test("a change is listed step by step, by the names people see", () => {
    const words = toolWords("change_automation", {
      operations: [
        { op: "trigger", trigger: { kind: "upload", fileType: "video" } },
        { op: "add", type: "clips", settings: { platform: "TikTok" } },
        { op: "add", type: "step:video-caption", label: "Subtitles" },
        { op: "set", id: "clips", settings: { platform: "X", other: 1 } },
        { op: "remove", ids: ["a", "b"] },
        { op: "name", name: "Weekly clips" },
        { op: "tidy" },
      ],
    });
    expect(words?.question).toBe("Make these changes?");
    expect(words?.lines).toEqual([
      "Start it with: New upload",
      'Add the step "Clips for a platform"',
      'Add the step "Subtitles"',
      "Change 2 settings of a step",
      "Remove 2 steps",
      'Rename the automation to "Weekly clips"',
    ]);
  });

  test("never shows ids, type names or raw settings", () => {
    const words = toolWords("change_automation", {
      operations: [
        { op: "add", type: "step:recipe-logo", id: "logo_1", after: "caption_1" },
        { op: "use", id: "logo_1", field: "video_url", from: "trigger" },
        { op: "connect", source: "a_1", target: "b_2" },
      ],
    });
    const shown = JSON.stringify(words);
    for (const raw of ["step:", "logo_1", "caption_1", "video_url", "a_1", "{{"]) {
      expect(shown).not.toContain(raw);
    }
  });

  test("a change that only tidies says so", () => {
    expect(toolWords("change_automation", { operations: [{ op: "tidy" }] })?.lines).toEqual([
      "Tidy the canvas",
    ]);
  });

  test("making and switching say what will happen", () => {
    expect(toolWords("create_automation", { name: "Clips" })?.lines).toEqual([
      'Called "Clips", switched off',
    ]);
    expect(toolWords("switch_automation", { on: true })?.question).toBe(
      "Switch this automation on?",
    );
    expect(toolWords("switch_automation", { on: false })?.question).toBe(
      "Switch this automation off?",
    );
  });
});

describe("what came back", () => {
  test("the automations, one line each", () => {
    expect(
      resultWords("dash_overview", {
        automations: [
          { name: "Clips for social", on: true, steps: 2 },
          { name: "Drafts", on: false, steps: 1 },
        ],
      }),
    ).toEqual(["Clips for social: on, 2 steps", "Drafts: off, 1 step"]);
    expect(resultWords("dash_overview", { automations: [] })).toEqual(["No automations yet."]);
  });

  test("what still stops an automation running, or that nothing does", () => {
    expect(
      resultWords("change_automation", {
        outline: "raw text for the agent",
        problems: [{ nodeId: "logo_1", message: "Add a logo in Settings." }],
      }),
    ).toEqual(["Still needed before it can run:", "Add a logo in Settings."]);
    expect(resultWords("describe_automation", { outline: "x", problems: [] })).toEqual([
      "Nothing is stopping it from running.",
    ]);
  });

  test("nothing for tools with nothing to report", () => {
    expect(resultWords("create_automation", { automationId: "abc" })).toEqual([]);
  });
});

describe("what a failed turn says", () => {
  // The first real model run showed Anthropic's whole error response, request included.
  const providerError =
    'controller stream failed: {"url":"https://api.anthropic.com/v1/messages","requestBodyValues":{"model":"x"},"statusCode":400,"responseBody":"{\\"type\\":\\"error\\"}"}';

  test("never shows the raw error", () => {
    const words = errorWords(providerError);
    expect(words).not.toMatch(/requestBodyValues|anthropic|statusCode|\{/);
    expect(words).toMatch(/send your message again/i);
  });

  test("says when the model key is the problem", () => {
    expect(errorWords('{"statusCode":401,"message":"invalid x-api-key"}')).toMatch(/model key/);
  });

  test("says when the model is busy", () => {
    expect(errorWords("statusCode 529 overloaded_error")).toMatch(/busy/);
  });
});
