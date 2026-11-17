import { api } from "@convex/_generated/api";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { type RunDetails, RunSteps } from "./run-steps";

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

  test("past eight files, the rest are in Outputs", () => {
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
    expect(screen.getByRole("link", { name: "Outputs" }).getAttribute("href")).toBe("/outputs");
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
