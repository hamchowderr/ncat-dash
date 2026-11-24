import { api } from "@convex/_generated/api";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery, loadMore, mutationOf, pushed, toastError } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { MadeFiles } from "./made-files";

const captioned = [
  "https://files.example/clip-1-captioned.mp4",
  "https://files.example/clip-2-captioned.mp4",
];
const clips = ["https://files.example/clip-1.mp4", "https://files.example/clip-2.mp4"];

function run(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run_1",
    automationId: "auto_1",
    automationName: "Shorts",
    status: "done",
    triggerKind: "upload",
    test: false,
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_060_000,
    startedWith: "podcast episode 12.mp4",
    finished: [
      { nodeId: "caps", kind: "step", stepId: "video-caption", label: null, files: captioned },
    ],
    along: [{ nodeId: "cut", kind: "clips", stepId: null, label: "TikTok clips", files: clips }],
    names: {},
    ...overrides,
  };
}

const AUTOMATIONS = [
  { _id: "auto_1", name: "Shorts" },
  { _id: "auto_2", name: "Audio" },
];

function show(runs: unknown, byHand: unknown = []) {
  answerQuery(api.automations.list, AUTOMATIONS);
  answerQuery(api.outputs.byRun, runs);
  answerQuery(api.outputs.byHand, byHand);
  renderInApp(<MadeFiles />);
}

describe("Recently made, by run", () => {
  test("says which automation and file made the files, with a link to the run", () => {
    show([run()]);
    const card = screen.getByRole("region", { name: /^Shorts, / });
    expect(within(card).getByRole("link", { name: "Shorts" })).toHaveAttribute(
      "href",
      "/automations/auto_1",
    );
    expect(card).toHaveTextContent("From podcast episode 12.mp4 · New upload");
    expect(card).toHaveTextContent("4 files");
    expect(within(card).getByRole("link", { name: "See the run" })).toHaveAttribute(
      "href",
      "/automations/auto_1/runs/run_1",
    );
  });

  test("shows the finished files by step name, and folds away those made along the way", async () => {
    show([run()]);
    expect(screen.getByRole("heading", { name: "Caption video · 2 files" })).toBeInTheDocument();
    expect(screen.getByText("clip-1-captioned.mp4")).toBeInTheDocument();
    expect(screen.queryByText("clip-1.mp4")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /Made along the way/ }));
    expect(screen.getByRole("heading", { name: "TikTok clips · 2 files" })).toBeInTheDocument();
    expect(screen.getByText("clip-1.mp4")).toBeInTheDocument();
  });

  test("shows files the toolkit named after its job ids by readable names, and reviews them so", async () => {
    const made = "https://files.example/ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10_output_0.mp4";
    const names = { [made]: "Podcast episode 12 clip 1" };
    show([
      run({
        finished: [
          { nodeId: "cut", kind: "step", stepId: "video-split", label: null, files: [made] },
        ],
        along: [],
        names,
      }),
    ]);
    expect(screen.getByText("Podcast episode 12 clip 1")).toBeInTheDocument();
    expect(screen.queryByText(/ca4934e3/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Send to review" }));
    expect(mutationOf(api.reviews.create)).toHaveBeenCalledWith(
      expect.objectContaining({ urls: [made], names }),
    );
  });

  test("marks a run that did not finish, and a test of one step", () => {
    show([
      run({ status: "failed", runId: "run_2" }),
      run({ test: true, runId: "run_3", startedWith: null }),
    ]);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText(/Test of one step/)).toBeInTheDocument();
  });

  test("sends a run's finished files to review", async () => {
    show([run()]);
    mutationOf(api.reviews.create).mockResolvedValueOnce("rev_9");
    await userEvent.setup().click(screen.getByRole("button", { name: "Send to review" }));
    expect(mutationOf(api.reviews.create)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      title: "Shorts: podcast episode 12.mp4",
      urls: captioned,
      names: {},
    });
    await waitFor(() =>
      expect(pushed).toHaveBeenCalledWith("/review/rev_9", { transitionTypes: ["nav-forward"] }),
    );
  });

  test("says so when the review could not be opened, and can be tried again", async () => {
    show([run()]);
    mutationOf(api.reviews.create).mockRejectedValueOnce(new Error("offline"));
    const button = screen.getByRole("button", { name: "Send to review" });
    await userEvent.setup().click(button);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("The review could not be opened."));
    expect(pushed).not.toHaveBeenCalled();
    expect(button).toBeEnabled();
  });

  test("shows one automation's runs when picked", async () => {
    const asked: unknown[] = [];
    show((args: Record<string, unknown>) => {
      asked.push(args.automationId);
      return [run()];
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Made by" }));
    await user.click(await screen.findByRole("option", { name: "Audio" }));
    expect(asked.at(-1)).toBe("auto_2");
    expect(asked[0]).toBeUndefined();
  });

  test("loads more on request, and looks further back by itself when a page is short", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => run({ runId: `run_${i}` }));
    show({ results: ten, status: "CanLoadMore" });
    expect(loadMore).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Load more" }));
    expect(loadMore).toHaveBeenCalledWith(10);
  });

  test("keeps looking when a page held runs that made no files", () => {
    show({ results: [run()], status: "CanLoadMore" });
    expect(loadMore).toHaveBeenCalledWith(10);
  });

  test("says when nothing has been made yet", () => {
    show([]);
    expect(screen.getByText(/No files yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Automations" })).toHaveAttribute(
      "href",
      "/automations",
    );
  });
});

describe("Recently made, steps run by hand", () => {
  test("are picked from the same Made by list, and one is sent to review", async () => {
    show(
      [],
      [
        {
          jobId: "j1",
          stepId: "video-split",
          finishedAt: 1_700_000_000_000,
          urls: ["https://files.example/a.mp4"],
          names: {},
        },
      ],
    );
    mutationOf(api.reviews.create).mockResolvedValueOnce("rev_3");
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Made by" }));
    await user.click(await screen.findByRole("option", { name: "Steps run by hand" }));
    expect(await screen.findByText("a.mp4")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send to review" }));
    expect(mutationOf(api.reviews.create)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      title: "Split video",
      urls: ["https://files.example/a.mp4"],
      names: {},
    });
  });
});
