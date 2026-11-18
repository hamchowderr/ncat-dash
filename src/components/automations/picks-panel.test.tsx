import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { PicksPanel } from "./picks-panel";
import type { RunDetails } from "./run-steps";

const SOURCE = "https://files.example/podcast.mp4";
type Step = RunDetails["steps"][number];

function runWith(step: Partial<Step>, over: Partial<RunDetails> = {}): RunDetails {
  return {
    _id: "run_1",
    status: "done",
    testOf: undefined,
    nodes: [
      { id: "moments", kind: "moments", input: { platform: "TikTok" }, position: { x: 0, y: 0 } },
      { id: "chapters", kind: "chapters", input: {}, position: { x: 0, y: 200 } },
    ],
    steps: [
      {
        _id: "s1",
        nodeId: step.nodeId ?? "moments",
        status: "done",
        outputs: [],
        jobs: [],
        ...step,
      },
    ],
    ...over,
  } as unknown as RunDetails;
}

const MOMENTS: Partial<Step> = {
  moments: [
    {
      source: SOURCE,
      start: 22.8,
      end: 61.1,
      title: "Never quote on the first call",
      why: "A clear rule anyone can use.",
      text: "Never quote a price on the first call.",
    },
    {
      source: SOURCE,
      start: 8.3,
      end: 25.6,
      title: "Creators charge too little",
      why: "",
      text: "Most creators charge far too little.",
    },
  ],
  pickNote: "1 pick was left out: 1 did not match the transcript word for word.",
  jobs: [
    { status: "done", outputs: ["https://files.example/out/moment-1.mp4"] },
    { status: "failed", outputs: [] },
  ] as unknown as Step["jobs"],
};

describe("what Best moments picked", () => {
  test("shows each moment with its clip, its times and why it was picked", () => {
    renderInApp(<PicksPanel run={runWith(MOMENTS)} busy={false} onFindMore={vi.fn()} />);
    expect(screen.getByText("Never quote on the first call")).toBeTruthy();
    expect(screen.getByText("0:22 to 1:01 · 38 s")).toBeTruthy();
    expect(screen.getByText("A clear rule anyone can use.")).toBeTruthy();
    expect(screen.getByText(/1 pick was left out/)).toBeTruthy();
    expect(document.querySelector("video")?.getAttribute("src")).toBe(
      "https://files.example/out/moment-1.mp4",
    );
    expect(screen.getByText("This clip could not be cut")).toBeTruthy();
  });

  test("finds more moments once the run has finished", () => {
    const onFindMore = vi.fn();
    renderInApp(<PicksPanel run={runWith(MOMENTS)} busy={false} onFindMore={onFindMore} />);
    fireEvent.click(screen.getByRole("button", { name: "Find more moments" }));
    expect(onFindMore).toHaveBeenCalledOnce();
  });

  test("offers no Find more while the run is going, or on a test run", () => {
    renderInApp(
      <PicksPanel
        run={runWith(MOMENTS, { status: "running" })}
        busy={false}
        onFindMore={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Find more moments" })).toBeNull();
  });

  test("shows nothing before anything was picked", () => {
    const { container } = renderInApp(
      <PicksPanel run={runWith({})} busy={false} onFindMore={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("what Chapters picked", () => {
  const CHAPTERS: Partial<Step> = {
    nodeId: "chapters",
    chapters: [
      { source: SOURCE, start: 0, title: "Welcome", bullets: ["Who is on the show"] },
      { source: SOURCE, start: 95, title: "Pricing", bullets: [] },
    ],
  };

  test("lists the chapters and copies them the way YouTube reads them", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderInApp(<PicksPanel run={runWith(CHAPTERS)} busy={false} onFindMore={vi.fn()} />);
    expect(screen.getByText("Welcome")).toBeTruthy();
    expect(screen.getByText("Who is on the show")).toBeTruthy();
    expect(screen.getByText("1:35")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy YouTube chapters" }));
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith("0:00 Welcome\n1:35 Pricing");
    expect(screen.getByRole("button", { name: "Download show notes" })).toBeTruthy();
  });
});
