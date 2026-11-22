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
    edges: [],
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

  test("shows TikTok clips tall, in the shape they were cut", () => {
    renderInApp(<PicksPanel run={runWith(MOMENTS)} busy={false} onFindMore={vi.fn()} />);
    expect(document.querySelector("video")?.style.aspectRatio).toBe("0.5625 / 1");
  });

  test("keeps the video's own shape when the clips go on to Follow the speaker", () => {
    const run = runWith(MOMENTS, {
      edges: [{ id: "m>f", source: "moments", target: "follow" }],
    } as Partial<RunDetails>);
    (run.nodes as unknown[]).push({
      id: "follow",
      kind: "step",
      stepId: "video-reframe",
      input: {},
      position: { x: 300, y: 0 },
    });
    renderInApp(<PicksPanel run={run} busy={false} onFindMore={vi.fn()} />);
    expect(document.querySelector("video")?.style.aspectRatio).toBe("1.77778 / 1");
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

describe("what Add B-Roll laid over the video", () => {
  test("lists each cutaway with its words, and credits stock footage with a link", () => {
    const run = runWith({
      nodeId: "broll",
      pickNote: "2 cutaways: 1 from your library and 1 from free stock.",
      cutaways: [
        {
          source: SOURCE,
          start: 4,
          end: 7,
          said: "Last summer I rebuilt an old truck in my garage.",
          show: "old truck garage",
          kind: "library",
          ref: "V7",
          title: "Truck build",
          score: 0.31,
        },
        {
          source: SOURCE,
          start: 16.5,
          end: 19.5,
          said: "Every morning started with strong coffee.",
          show: "strong coffee",
          kind: "stock",
          ref: "pixabay:1234",
          title: "coffee, cup, morning",
          score: 0.29,
          credit: { site: "Pixabay", page: "https://pixabay.com/videos/id-1234/", by: "Brewer" },
        },
      ],
    } as Partial<Step>);
    (run.nodes as unknown[]).push({
      id: "broll",
      kind: "broll",
      input: {},
      position: { x: 0, y: 0 },
    });
    renderInApp(<PicksPanel run={run} busy={false} onFindMore={vi.fn()} />);
    const section = screen.getByRole("region", { name: "Add B-Roll" });
    expect(section.textContent).toContain("2 cutaways over the video");
    expect(section.textContent).toContain("Truck build");
    expect(section.textContent).toContain("V7 in your library");
    expect(section.textContent).toContain("0:04 to 0:07");
    expect(screen.getByRole("link", { name: "coffee, cup, morning" }).getAttribute("href")).toBe(
      "https://pixabay.com/videos/id-1234/",
    );
    expect(section.textContent).toContain("Brewer on Pixabay");
  });
});

describe("the paid-ad disclosure kept by Length Cuts", () => {
  const cutsRun = (disclosures: { source: string; text: string | null }[]) =>
    runWith(
      { nodeId: "lengths", disclosures } as Partial<Step>,
      {
        nodes: [
          {
            id: "lengths",
            kind: "step",
            stepId: "recipe-length-cuts",
            input: {},
            position: { x: 0, y: 0 },
          },
        ],
      } as Partial<RunDetails>,
    );

  test("quotes the line kept in every cut of each video", () => {
    renderInApp(
      <PicksPanel
        run={cutsRun([
          {
            source: "https://files.example/uploads/Boots%20ad.mp4",
            text: "This is a paid partnership with Boots.",
          },
        ])}
        busy={false}
        onFindMore={vi.fn()}
      />,
    );
    const section = screen.getByRole("region", { name: /paid-ad disclosure/ });
    expect(section.textContent).toContain("Boots ad.mp4");
    expect(section.textContent).toContain("Kept in every cut:");
    expect(section.textContent).toContain("This is a paid partnership with Boots.");
  });

  test("says when none was heard, so the creator can add one", () => {
    renderInApp(
      <PicksPanel
        run={cutsRun([{ source: "https://files.example/uploads/take.mp4", text: null }])}
        busy={false}
        onFindMore={vi.fn()}
      />,
    );
    expect(screen.getByText(/No disclosure was heard, so the cuts have none/)).toBeTruthy();
  });

  test("shows nothing for a step that was not keeping it", () => {
    const { container } = renderInApp(
      <PicksPanel run={cutsRun([])} busy={false} onFindMore={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });
});
