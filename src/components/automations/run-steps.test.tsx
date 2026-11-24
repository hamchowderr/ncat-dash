import { api } from "@convex/_generated/api";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { aiLine, passedAlong, type RunDetails, RunSteps } from "./run-steps";

const AT = 1_700_000_000_000;
const CLIP = "https://files.example/out/video-caption-29.mp4";

function step(over: Partial<RunDetails["steps"][number]> & { nodeId: string }) {
  return {
    _id: `s_${over.nodeId}`,
    status: "done",
    outputs: [],
    error: undefined,
    startedAt: AT,
    finishedAt: AT + 63_000,
    jobs: [],
    stage: undefined,
    plan: undefined,
    branches: undefined,
    resumeAt: undefined,
    retries: 0,
    retryAt: null,
    retryError: null,
    facts: [],
    ...over,
  } as RunDetails["steps"][number];
}

function run(over: Partial<RunDetails> = {}): RunDetails {
  return {
    _id: "run_1",
    automationId: "a_1",
    automationName: "Sort uploads by length",
    status: "done",
    triggerKind: "upload",
    error: undefined,
    startedAt: AT,
    finishedAt: AT + 70_000,
    retries: 0,
    hasCuts: false,
    trigger: {},
    startedWith: "long-interview.mp4",
    retryLimit: 2,
    startedByRun: null,
    startedRuns: [],
    nodes: [
      // Listed out of order on purpose: the rows follow the canvas, left to right.
      {
        id: "caption",
        kind: "step",
        stepId: "video-caption",
        input: {},
        position: { x: 400, y: 120 },
      },
      { id: "if", kind: "if", input: {}, position: { x: 200, y: 0 } },
      {
        id: "clips",
        kind: "clips",
        input: { platform: "Instagram Reels" },
        position: { x: 400, y: 0 },
      },
    ],
    edges: [],
    steps: [
      step({ nodeId: "if", branches: { yes: [], no: [CLIP] } }),
      step({ nodeId: "clips", status: "skipped", startedAt: undefined, finishedAt: undefined }),
      step({
        nodeId: "caption",
        outputs: [CLIP],
        facts: [{ label: "Duration", value: "8" }],
      }),
    ],
    ...over,
  } as unknown as RunDetails;
}

function rows() {
  return within(screen.getByRole("region", { name: "What happened" })).getAllByRole("listitem");
}

describe("what a run spent on AI", () => {
  test("shows beside the tally, with the team's limit when it has one", () => {
    const spent = run({
      aiSpent: 120_000,
      aiLimit: 1_000_000,
      nodes: [{ id: "chapters", kind: "chapters", input: {}, position: { x: 0, y: 0 } }],
      steps: [step({ nodeId: "chapters", aiSpent: 120_000 })],
    } as Partial<RunDetails>);
    renderInApp(<RunSteps run={spent} highlighted={null} busy={false} onDecide={vi.fn()} />);
    expect(screen.getByText("AI $0.12 of $1.00")).toHaveAttribute("data-ai-spent", "run");
    const row = screen.getByRole("heading", { name: "Chapters and show notes" }).closest("li")!;
    expect(within(row).getByText("AI $0.12")).toHaveAttribute("data-ai-spent", "step");
  });

  test("says nothing for a run that asked nothing and has no limit", () => {
    renderInApp(<RunSteps run={run()} highlighted={null} busy={false} onDecide={vi.fn()} />);
    expect(document.querySelector("[data-ai-spent]")).toBeNull();
    expect(aiLine({ aiSpent: 0, aiLimit: null })).toBeNull();
    expect(aiLine({ aiSpent: 0, aiLimit: 500_000 })).toBe("AI $0.00 of $0.50");
    expect(aiLine({ aiSpent: 3_000, aiLimit: null })).toBe("AI under $0.01");
  });
});

describe("what happened in a run", () => {
  test("lists the start and then each step in the canvas's order, with a tally", () => {
    renderInApp(<RunSteps run={run()} highlighted={null} busy={false} onDecide={vi.fn()} />);
    expect(screen.getByText("2 done, 1 skipped")).toBeTruthy();
    const headings = within(screen.getByRole("region", { name: "What happened" }))
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["New upload", "If", "Clips for a platform", "Caption video"]);
    expect(rows()[0].textContent).toContain("Started with long-interview.mp4");
  });

  test("says in words what each step did, and how long it took", () => {
    renderInApp(<RunSteps run={run()} highlighted={null} busy={false} onDecide={vi.fn()} />);
    const ifRow = screen.getByRole("heading", { name: "If" }).closest("li")!;
    expect(ifRow.textContent).toContain("The file went out by No.");
    expect(ifRow.textContent).toContain("1m 3s");
    const skipped = screen.getByRole("heading", { name: "Clips for a platform" }).closest("li")!;
    expect(skipped.textContent).toContain("No files came this way.");
    expect(skipped.textContent).not.toContain("1m 3s");
  });

  test("Add Motion Graphics with nothing to draw says the video went on unchanged", () => {
    const note = "Nothing to draw on the video, so it went on unchanged.";
    renderInApp(
      <RunSteps
        run={run({
          nodes: [{ id: "motion", kind: "motion", input: {}, position: { x: 0, y: 0 } }],
          steps: [step({ nodeId: "motion", outputs: [CLIP], pickNote: note })],
        } as never)}
        highlighted={null}
        busy={false}
        onDecide={vi.fn()}
      />,
    );
    const row = screen.getByRole("heading", { name: "Add Motion Graphics" }).closest("li")!;
    expect(row.textContent).toContain(note);
    expect(row.textContent).not.toContain("Nothing to add");
  });

  test("shows what a step found out as labelled facts, never raw data", () => {
    renderInApp(<RunSteps run={run()} highlighted={null} busy={false} onDecide={vi.fn()} />);
    const caption = screen.getByRole("heading", { name: "Caption video" }).closest("li")!;
    expect(within(caption).getByText("Duration").tagName).toBe("DT");
    expect(within(caption).getByText("8").tagName).toBe("DD");
    expect(caption.textContent).toContain("Made 1 file.");
    expect(document.body.textContent).not.toContain("{");
  });

  test("files show as small tiles, and choosing one plays it larger", () => {
    renderInApp(<RunSteps run={run()} highlighted={null} busy={false} onDecide={vi.fn()} />);
    const files = screen.getByRole("list", { name: "Files from Caption video" });
    fireEvent.click(within(files).getByRole("button", { name: /video-caption-29\.mp4/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "video-caption-29.mp4" })).toBeTruthy();
    expect(dialog.querySelector("video[controls]")?.getAttribute("src")).toBe(CLIP);
  });

  test("files the toolkit named after a job id show by readable names", () => {
    renderInApp(
      <RunSteps
        run={run({ outputNames: { [CLIP]: "Long interview clip 1" } })}
        highlighted={null}
        busy={false}
        onDecide={vi.fn()}
      />,
    );
    const files = screen.getByRole("list", { name: "Files from Caption video" });
    fireEvent.click(within(files).getByRole("button", { name: /Long interview clip 1/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Long interview clip 1" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("video-caption-29.mp4");
  });

  test("past eight files, the rest are in Files", () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://files.example/out/clip-${i}.mp4`);
    renderInApp(
      <RunSteps
        run={run({ steps: [step({ nodeId: "caption", outputs: many })] })}
        highlighted={null}
        busy={false}
        onDecide={vi.fn()}
      />,
    );
    const files = screen.getByRole("list", { name: "Files from Caption video" });
    expect(within(files).getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByRole("link", { name: "Files" }).getAttribute("href")).toBe(
      "/files?tab=made",
    );
  });

  test("an approval waiting on someone can be decided from its row", () => {
    answerQuery(api.reviews.forStep, "review_1");
    const onDecide = vi.fn();
    renderInApp(
      <RunSteps
        run={run({
          status: "waiting",
          nodes: [{ id: "ok", kind: "approval", input: {}, position: { x: 0, y: 0 } }],
          steps: [step({ nodeId: "ok", status: "waiting_approval", finishedAt: undefined })],
        } as Partial<RunDetails>)}
        highlighted={null}
        busy={false}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByText("Waiting for someone to check the files.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onDecide).toHaveBeenCalledWith("s_ok", false);
    expect(screen.getByRole("link", { name: "Open the review room" }).getAttribute("href")).toBe(
      "/review/review_1",
    );
  });

  test("a failed step shows why, and a step chosen on the canvas is marked", () => {
    renderInApp(
      <RunSteps
        run={run({
          status: "failed",
          steps: [
            step({ nodeId: "caption", status: "failed", error: "The toolkit could not read it." }),
          ],
        })}
        highlighted="caption"
        busy={false}
        onDecide={vi.fn()}
      />,
    );
    const row = screen.getByRole("heading", { name: "Caption video" }).closest("li")!;
    expect(row.textContent).toContain("Stopped here.");
    expect(within(row).getByText("The toolkit could not read it.")).toBeTruthy();
    expect(row.getAttribute("data-marked")).toBe("true");
  });

  test("a run with no starting file just says it started", () => {
    renderInApp(
      <RunSteps
        run={run({ startedWith: null, triggerKind: "manual" })}
        highlighted={null}
        busy={false}
        onDecide={vi.fn()}
      />,
    );
    expect(rows()[0].textContent).toContain("Run by hand");
    expect(rows()[0].textContent).toContain("Started this run.");
  });
});

describe("what passed between steps", () => {
  const START = "https://files.example/uploads/long-interview.mp4?sig=1";
  const withLines = () =>
    run({
      trigger: { file_url: START },
      edges: [
        { id: "e1", source: "if", target: "clips", branch: "yes" },
        { id: "e2", source: "if", target: "caption", branch: "no" },
      ],
    } as Partial<RunDetails>);

  test("each line carries the files that went along it, by the way out of an If", () => {
    const passed = passedAlong(withLines() as Parameters<typeof passedAlong>[0]);
    expect(passed.get("__trigger>if")).toEqual([START]);
    expect(passed.get("if>clips")).toEqual([]);
    expect(passed.get("if>caption")).toEqual([CLIP]);
  });

  test("a line from a step that has not finished carries nothing yet", () => {
    const passed = passedAlong({
      trigger: {},
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ source: "a", target: "b" }],
      steps: [{ nodeId: "a", status: "running", outputs: [] }],
    });
    expect(passed.has("a>b")).toBe(false);
    expect(passed.get("__trigger>a")).toEqual([]);
  });

  test("each step's row says which files it got", () => {
    renderInApp(<RunSteps run={withLines()} highlighted={null} busy={false} onDecide={vi.fn()} />);
    const ifRow = screen.getByRole("heading", { name: "If" }).closest("li")!;
    expect(ifRow.querySelector("[data-got]")?.textContent).toBe("Got long-interview.mp4");
    const caption = screen.getByRole("heading", { name: "Caption video" }).closest("li")!;
    expect(caption.querySelector("[data-got]")?.textContent).toBe("Got video-caption-29.mp4");
    // A skipped step got nothing, and says nothing about it.
    const clips = screen.getByRole("heading", { name: "Clips for a platform" }).closest("li")!;
    expect(clips.querySelector("[data-got]")).toBeNull();
  });
});

test("an If's own reading of the file is not shown as facts", () => {
  renderInApp(
    <RunSteps
      run={run({
        steps: [
          step({
            nodeId: "if",
            branches: { yes: [], no: [CLIP] },
            facts: [{ label: "Audio codec", value: "aac" }],
          }),
        ],
      })}
      highlighted={null}
      busy={false}
      onDecide={vi.fn()}
    />,
  );
  expect(screen.queryByText("Audio codec")).toBeNull();
});

describe("a step that failed with FFmpeg's whole log", () => {
  const LOG = [
    "Failed to load audio: ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers",
    "  built with gcc 13",
    "  configuration: --prefix=/usr --enable-gpl --enable-libass",
    "  libavutil      58. 29.100 / 58. 29.100",
    "Input #0, png_pipe, from 'still.png':",
    "  Duration: N/A, bitrate: N/A",
    "  Stream #0:0: Video: png, rgb24, 64x64, 25 fps",
    "Output #0, s16le, to 'pipe:':",
    "[out#0/s16le @ 0x5596e5244280] Output file does not contain any stream",
  ].join("\n");

  function failed(over: Partial<RunDetails["steps"][number]>) {
    renderInApp(
      <RunSteps
        run={run({
          status: "failed",
          steps: [step({ nodeId: "caption", status: "failed", ...over })],
        })}
        highlighted={null}
        busy={false}
        onDecide={vi.fn()}
      />,
    );
    return screen.getByRole("heading", { name: "Caption video" }).closest("li")!;
  }

  test("shows a short plain reason, with the log folded away until asked for", () => {
    const row = failed({ error: LOG });
    expect(row.textContent).toContain(
      "This file is a still image. This step needs a video or audio file.",
    );
    expect(row.textContent).not.toContain("configuration");
    fireEvent.click(within(row).getByRole("button", { name: /Show details/ }));
    expect(row.textContent).toContain("configuration: --prefix=/usr");
    expect(within(row).getByRole("button", { name: /Hide details/ })).toBeTruthy();
  });

  test("the last failed try waiting to go again is shortened the same way", () => {
    const row = failed({ status: "running", retryAt: Date.now() + 60_000, retryError: LOG });
    expect(row.textContent).toContain(
      "The last try failed: This file is a still image. This step needs a video or audio file.",
    );
    expect(row.textContent).not.toContain("libavutil");
  });

  test("a short message has nothing to fold away", () => {
    const row = failed({ error: "Could not download the file." });
    expect(row.textContent).toContain("Could not download the file.");
    expect(within(row).queryByRole("button", { name: /Show details/ })).toBeNull();
  });
});
