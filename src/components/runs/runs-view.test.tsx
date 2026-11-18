import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf, place, replaced, toastSuccess } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { RunsView } from "./runs-view";

const START = new Date("2026-11-18T09:00:00Z").getTime();

function run(id: string, over: Record<string, unknown> = {}) {
  return {
    _id: id,
    automationId: "auto1",
    automationName: "Weekly clips",
    status: "failed",
    triggerKind: "upload",
    error: "FFmpeg gave up.",
    startedAt: START,
    finishedAt: START + 65_000,
    retries: 2,
    pickedUp: 0,
    testOf: null,
    startedWith: "episode-12.mp4",
    failedStep: "Video thumbnail",
    canPickUp: true,
    whyNot: null,
    ...over,
  };
}

const FAILED = [
  run("r1"),
  run("r2", { automationName: "Podcast audiograms", startedWith: "ep-7.mp3", pickedUp: 1 }),
  run("r3", {
    automationName: "Client review",
    failedStep: null,
    canPickUp: false,
    error: "Rejected at the approval step.",
    whyNot: "It was rejected at an approval step. Run it again to ask for approval again.",
  }),
];

function showFailed() {
  place.pathname = "/runs";
  place.search = "show=failed";
  answerQuery(api.runs.listForTeam, ({ status }: Record<string, unknown>) => ({
    runs: status === "failed" ? FAILED : [run("r0", { status: "done", error: null }), ...FAILED],
    failedCount: 3,
  }));
  return renderInApp(<RunsView />);
}

describe("the Runs page", () => {
  test("lists every run across the team, each linking to its page", () => {
    place.pathname = "/runs";
    answerQuery(api.runs.listForTeam, {
      runs: [run("r0", { status: "done", error: null, failedStep: null, canPickUp: false })],
      failedCount: 3,
    });
    renderInApp(<RunsView />);
    expect(screen.getByRole("tab", { name: "All runs" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Failed/ }).textContent).toContain("3");
    expect(screen.getByText("episode-12.mp4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View/ })).toHaveAttribute(
      "href",
      "/automations/auto1/runs/r0",
    );
    // A run that worked has nothing to pick up, and the list has no boxes to tick.
    expect(screen.queryByRole("button", { name: /Pick up/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  test("the Failed view says where each run stopped and why one cannot be picked up", () => {
    showFailed();
    expect(screen.getByRole("tab", { name: /Failed/ })).toHaveAttribute("aria-selected", "true");
    const first = document.querySelector("[data-run='r1']") as HTMLElement;
    expect(within(first).getByText("At Video thumbnail.")).toBeInTheDocument();
    expect(screen.getByText("Picked up once")).toBeInTheDocument();
    const rejected = document.querySelector("[data-run='r3']") as HTMLElement;
    expect(
      within(rejected).getByText(/Run it again to ask for approval again/),
    ).toBeInTheDocument();
    expect(within(rejected).queryByRole("button", { name: /Pick up/ })).not.toBeInTheDocument();
    expect(within(rejected).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  test("picks up one run from its row", async () => {
    showFailed();
    mutationOf(api.runs.pickUp).mockResolvedValue({ withCurrentSettings: true });
    const row = document.querySelector("[data-run='r1']") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /Pick up/ }));
    await waitFor(() => expect(mutationOf(api.runs.pickUp)).toHaveBeenCalledWith({ runId: "r1" }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Picked up the run where it stopped."),
    );
  });

  test("picks up every failed run at once, or only the ones chosen", async () => {
    showFailed();
    const many = mutationOf(api.runs.pickUpMany);
    many.mockResolvedValue({ pickedUp: 2, passedOver: 0, more: false });
    fireEvent.click(screen.getByRole("button", { name: "Pick up all 2" }));
    await waitFor(() => expect(many).toHaveBeenCalledWith({ organizationId: "team_1" }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Picked up 2 runs where they stopped."),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /Choose Podcast audiograms/ }));
    fireEvent.click(screen.getByRole("button", { name: "Pick up 1 chosen" }));
    await waitFor(() =>
      expect(many).toHaveBeenLastCalledWith({ organizationId: "team_1", runIds: ["r2"] }),
    );
  });

  test("switching views keeps it in the address", () => {
    place.pathname = "/runs";
    answerQuery(api.runs.listForTeam, { runs: [], failedCount: 0 });
    renderInApp(<RunsView />);
    expect(screen.getByText(/Nothing has run yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Failed" }));
    expect(replaced).toHaveBeenCalledWith("/runs?show=failed");
  });
});
