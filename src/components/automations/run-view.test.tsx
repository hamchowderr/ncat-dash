import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf, toastSuccess } from "@/test/convex";
import { renderInApp } from "@/test/render";

import type { ApprovalView } from "./approval-status";
import { RunView } from "./run-view";

const approval = (over: Partial<ApprovalView>): ApprovalView => ({
  asked: [],
  forYou: true,
  mayDecide: true,
  decideBy: null,
  whenTimeUp: "reject",
  decidedBy: null,
  decidedAutomatically: false,
  ...over,
});

/** A run that is one Approval step, in the shape runs.get returns. */
function runWith(step: Record<string, unknown>) {
  return {
    _id: "run1",
    automationId: "auto1",
    automationName: "Weekly clips",
    status: "waiting",
    triggerKind: "webhook",
    startedAt: 1_700_000_000_000,
    finishedAt: null,
    retryLimit: 0,
    startedByRun: null,
    startedRuns: [],
    hasCuts: false,
    nodes: [{ id: "approval", kind: "approval", input: {}, position: { x: 0, y: 0 } }],
    edges: [],
    steps: [
      {
        _id: "step1",
        nodeId: "approval",
        status: "waiting_approval",
        jobs: [],
        outputs: [],
        facts: [],
        retries: 0,
        retryAt: null,
        retryError: null,
        error: null,
        ...step,
      },
    ],
  };
}

function show(step: Record<string, unknown>) {
  answerQuery(api.runs.get, runWith(step));
  answerQuery(api.reviews.forStep, null);
  renderInApp(<RunView automationId={"auto1" as Id<"automations">} runId={"run1" as Id<"runs">} />);
  return within(document.querySelector("[data-step=approval]") as HTMLElement);
}

describe("an approval on the run page", () => {
  test("the person asked can approve, and sees the deadline", () => {
    const card = show({
      approval: approval({ asked: ["Ana Reyes"], decideBy: Date.UTC(2026, 10, 18, 15) }),
    });
    expect(card.getByText("You are asked to decide.")).toBeInTheDocument();
    expect(card.getByText(/it is rejected by itself/)).toBeInTheDocument();
    fireEvent.click(card.getByRole("button", { name: "Approve" }));
    expect(mutationOf(api.runs.decide)).toHaveBeenCalledWith({
      runStepId: "step1",
      approved: true,
    });
  });

  test("someone not asked cannot press Approve or Reject, and is told why", () => {
    const card = show({
      approval: approval({ asked: ["Ana Reyes"], forYou: false, mayDecide: false }),
    });
    expect(card.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(card.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(
      card.getByText("Only Ana Reyes, or a team owner or admin, can decide this one."),
    ).toBeInTheDocument();
  });

  test("once decided, says who decided", () => {
    const card = show({
      status: "done",
      approval: approval({ decidedBy: "Olu Bello" }),
    });
    expect(card.getByText("Approved by Olu Bello.")).toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  test("a rejection by time-up shows its reason once", () => {
    const card = show({
      status: "failed",
      error: "Nobody decided within 1 day, so it was rejected.",
      approval: approval({ decidedAutomatically: true }),
    });
    expect(card.getAllByText(/Nobody decided/)).toHaveLength(1);
  });
});

describe("the run's canvas", () => {
  test("has its view buttons in a strip above it, with nothing floating over the steps", () => {
    show({});
    const view = document.querySelector("[role=group][aria-label=View]") as HTMLElement;
    expect(view).not.toBeNull();
    expect(view.closest("[data-canvas-bar]")).not.toBeNull();
    expect(view.closest(".react-flow")).toBeNull();
    expect(document.querySelector(".react-flow__controls")).toBeNull();
  });
});

describe("a failed run on the run page", () => {
  function showFailed(pickUp: Record<string, unknown>) {
    answerQuery(api.runs.get, {
      ...runWith({ status: "failed", error: "FFmpeg gave up." }),
      status: "failed",
      error: "FFmpeg gave up.",
      finishedAt: 1_700_000_060_000,
      pickUp,
    });
    answerQuery(api.reviews.forStep, null);
    renderInApp(
      <RunView automationId={"auto1" as Id<"automations">} runId={"run1" as Id<"runs">} />,
    );
  }

  test("picks up from the step that failed, beside Run again", async () => {
    showFailed({ ok: true, stepId: "step1", stepName: "Video thumbnail" });
    mutationOf(api.runs.pickUp).mockResolvedValue({ withCurrentSettings: true });
    fireEvent.click(screen.getByRole("button", { name: "Pick up from Video thumbnail" }));
    expect(screen.getByRole("button", { name: "Run again" })).toBeInTheDocument();
    await waitFor(() =>
      expect(mutationOf(api.runs.pickUp)).toHaveBeenCalledWith({ runId: "run1" }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Picked up where it stopped."));
  });

  test("offers only Run again when it cannot be picked up", () => {
    showFailed({ ok: false, reason: "It was rejected at an approval step." });
    expect(screen.queryByRole("button", { name: /Pick up/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run again" })).toBeInTheDocument();
  });
});
