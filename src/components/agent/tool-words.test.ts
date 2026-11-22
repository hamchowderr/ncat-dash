import { describe, expect, test } from "vitest";

import { errorWords, resultWords, toolWords } from "./tool-words";

/** Something shaped like a tool id: snake_case, camelCase or a dotted/dashed name. */
const TOOL_ID = /\b[a-z]+(?:[_.-][a-z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z]*\b/;

/** Every tool the agent server gives the chat agent today (packages/agent). */
const KNOWN_TOOL_IDS = [
  "dash_overview",
  "describe_automation",
  "list_step_types",
  "platform_guide",
  "change_automation",
  "create_automation",
  "list_uploads",
  "check_run",
  "try_automation",
  "try_team_step",
  "check_job",
  "save_team_step",
  "list_folder",
  "make_folder",
  "move_files",
  "rename_file",
  "switch_automation",
  "describe_workflow",
  "set_up_workflow",
  "switch_workflow",
  "find_in_library",
  "library_file",
  "knowledge_search",
  "knowledge_read",
  "knowledge_list",
  "knowledge_page",
  "knowledge_note",
  "knowledge_pin",
  "moments",
  "run_on_library_file",
  "list_schedules",
  "start_schedule",
  "stop_schedule",
  "doltHistory",
  "doltQuery",
  "doltWrite",
  "task_write",
  "task_update",
  "task_complete",
  "task_check",
  "updateWorkingMemory",
  "firecrawl_search",
  "firecrawl_scrape",
  "getWeather",
  "searchKnowledge",
];

describe("what the agent's tools are called", () => {
  test("reading tools have a title and nothing to ask", () => {
    for (const name of ["dash_overview", "describe_automation", "list_step_types"]) {
      const words = toolWords(name, {});
      expect(words?.title).toBeTruthy();
      expect(words?.question).toBe("");
    }
  });

  test("the agent's other tools get plain words too, never their tool id", () => {
    expect(toolWords("task_update", {}).title).toBe("Updated the plan");
    expect(toolWords("updateWorkingMemory", {}).title).toBe("Saved a note");
    expect(toolWords("browser_click", {}).title).toBe("Using the browser");
    expect(toolWords("mastra_workspace_write_file", {}).title).toBe("Working on files");
    expect(toolWords("something_new_later", {}).title).toBe("Working on it");
    expect(toolWords(undefined, undefined).title).toBe("Working on it");
  });

  test("no title ever looks like a tool id", () => {
    const names = [
      ...KNOWN_TOOL_IDS,
      "browser_goto",
      "firecrawl_anything",
      "mastra_workspace_execute_command",
      "subagent",
      "a_tool_nobody_has_named",
      "someCamelCaseTool",
    ];
    for (const name of names) {
      const title = toolWords(name, {}).title;
      // A one-word id such as "moments" is a plain word; any other id must not show.
      if (TOOL_ID.test(name)) expect(title, name).not.toContain(name);
      expect(title, name).not.toMatch(TOOL_ID);
    }
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

describe("platform guide", () => {
  test("names the platforms it is checking, in plain words", () => {
    expect(toolWords("platform_guide", { platforms: ["TikTok"] })?.title).toBe(
      "Checking what TikTok takes",
    );
    expect(toolWords("platform_guide", { platforms: ["TikTok", "X", "LinkedIn"] })?.title).toBe(
      "Checking what TikTok, X and LinkedIn take",
    );
    expect(toolWords("platform_guide", {})).toEqual({
      title: "Checking what each platform takes",
      question: "",
      lines: [],
    });
  });

  test("shows only the platforms it did not know, never the guide itself", () => {
    expect(resultWords("platform_guide", { text: "## TikTok", unknown: [] })).toEqual([]);
    expect(resultWords("platform_guide", { text: "", unknown: ["Myspace"] })).toEqual([
      "Not in the guide: Myspace",
    ]);
  });
});

describe("files and folders", () => {
  test("looking in a folder never asks", () => {
    expect(toolWords("list_folder", { folder: "Podcasts/Raw/" })).toEqual({
      title: "Looking in Podcasts/Raw",
      question: "",
      lines: [],
    });
    expect(toolWords("list_folder", {})?.title).toBe("Looking at your files");
  });

  test("making a folder asks first and names the whole path", () => {
    const words = toolWords("make_folder", { path: "/Podcasts/Raw/" });
    expect(words?.question).toBe("Make this folder?");
    expect(words?.lines[0]).toBe("Podcasts/Raw");
  });

  test("moving lists file names, never full keys, and where they go", () => {
    expect(toolWords("move_files", { keys: ["ep12.mp4"], toFolder: "Podcasts/Raw/" })).toEqual({
      title: "Moving files",
      question: "Move this file?",
      lines: ["ep12.mp4", "Into Podcasts/Raw"],
    });
    const many = toolWords("move_files", {
      keys: ["a/1.mp4", "a/2.mp4", "a/3.mp4", "a/4.mp4", "a/5.mp4", "a/6.mp4", "a/7.mp4"],
      toFolder: "",
    });
    expect(many?.question).toBe("Move these files?");
    expect(many?.lines).toEqual([
      "1.mp4",
      "2.mp4",
      "3.mp4",
      "4.mp4",
      "5.mp4",
      "and 2 more",
      "Into the top of your storage",
    ]);
  });

  test("renaming says the old and the new name", () => {
    expect(
      toolWords("rename_file", { key: "Raw/ep12.mp4", name: "Episode 12.mp4" })?.lines,
    ).toEqual(['ep12.mp4 becomes "Episode 12.mp4"']);
  });

  test("what came back, in plain words", () => {
    expect(resultWords("list_folder", { folders: [], files: [] })).toEqual(["Nothing here yet."]);
    expect(
      resultWords("list_folder", { folders: ["Raw/"], files: [{ name: "a" }, { name: "b" }] }),
    ).toEqual(["1 folder, 2 files"]);
    expect(resultWords("make_folder", { made: ["Podcasts/", "Podcasts/Raw/"] })).toEqual([
      "Made Podcasts, Podcasts/Raw",
    ]);
    expect(resultWords("make_folder", { made: [] })).toEqual(["It was already there."]);
    expect(resultWords("move_files", { moved: 1 })).toEqual(["Moved 1 file"]);
  });
});

describe("the workflow tools in plain words", () => {
  test("say what a set-up changes and what switching does", () => {
    const words = toolWords("set_up_workflow", {
      name: "Weekly ads",
      kind: "ugc",
      review: { on: true, reviewers: ["a", "b"], timeLimit: 2, timeLimitUnit: "days" },
    });
    expect(words.question).toBe("Set up this workflow?");
    expect(words.lines).toEqual([
      'Called "Weekly ads"',
      "For UGC and ads",
      "One review just before the last files go out",
      "2 people picked to approve",
      "Decides by itself after 2 days",
    ]);
    expect(toolWords("set_up_workflow", { kind: "quick", review: { on: false } }).lines).toEqual([
      "For a quick personal job",
      "No review: the files go out as soon as they are made",
    ]);
    expect(toolWords("switch_workflow", { on: true }).question).toBe(
      "Switch this whole workflow on?",
    );
    expect(toolWords("describe_workflow", {}).title).toBe("Reading the workflow");
  });
});
