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

describe("trying an automation", () => {
  test("asks first, and says it uses the toolkit", () => {
    const words = toolWords("try_automation", {});
    expect(words?.question).toBe("Try this automation on a file?");
    expect(words?.lines.join(" ")).toMatch(/toolkit/);
  });

  test("looking at uploads and runs never asks", () => {
    expect(toolWords("list_uploads", {})?.question).toBe("");
    expect(toolWords("check_run", { runId: "r" })?.question).toBe("");
  });

  test("says which file it started on", () => {
    expect(resultWords("try_automation", { fileName: "talk.mp4", runId: "r" })).toEqual([
      "Started on talk.mp4",
    ]);
  });

  test("tells how each step went, never ids or links", () => {
    const lines = resultWords("check_run", {
      runId: "run_1",
      status: "failed",
      address: "/automations/a/runs/run_1",
      steps: [
        { id: "clips", name: "Cut into short clips", status: "done", madeCount: 3, error: null },
        {
          id: "caption",
          name: "Add captions",
          status: "failed",
          madeCount: 0,
          error: "No speech.",
        },
        { id: "approve", name: "Approve clips", status: "pending", madeCount: 0, error: null },
        { id: "c2", type: "step:video-caption", name: null, status: "done", madeCount: 1 },
      ],
    });
    expect(lines).toEqual([
      "The run failed.",
      "Cut into short clips: made 3 files",
      "Add captions: failed: No speech.",
      "Approve clips: not started yet",
      "Caption video: made 1 file",
    ]);
    expect(lines.join(" ")).not.toMatch(/run_1|\/automations/);
  });

  test("a step waiting at an approval says so", () => {
    expect(
      resultWords("check_run", {
        status: "waiting",
        steps: [{ name: "Approve clips", status: "waiting_approval", madeCount: 0 }],
      }),
    ).toEqual(["The run is waiting.", "Approve clips: waiting for someone to approve"]);
  });
});
