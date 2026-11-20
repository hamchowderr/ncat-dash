import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { type RunDetails, RunSteps } from "./run-steps";

const step = (nodeId: string, status: string) => ({
  _id: `s_${nodeId}`,
  nodeId,
  status,
  outputs: status === "done" ? ["https://files.example/out/captioned.mp4"] : [],
  startedAt: 1000,
  finishedAt: status === "done" || status === "skipped" ? 1000 : null,
  jobs: [],
  retries: 0,
  retryAt: null,
  retryError: null,
  facts: [],
});

function show(runStatus: string, reviewStatus: string) {
  const run = {
    _id: "run_1",
    automationId: "a_1",
    automationName: "Captions",
    status: runStatus,
    triggerKind: "finished",
    finishedAt: null,
    retries: 0,
    hasCuts: false,
    trigger: {},
    retryLimit: 2,
    startedByRun: null,
    startedRuns: [],
    nodes: [
      { id: "approve", kind: "approval", off: true, input: { coveredByWorkflow: true }, position: { x: 0, y: 0 } },
      {
        id: "workflow-review",
        kind: "approval",
        label: "Weekly UGC review",
        input: { reviewers: [], workflowId: "wf_1", workflowName: "Weekly UGC" },
        position: { x: 220, y: 0 },
      },
    ],
    edges: [{ id: "e", source: "approve", target: "workflow-review" }],
    steps: [step("approve", "done"), step("workflow-review", reviewStatus)],
  } as unknown as RunDetails;
  renderInApp(<RunSteps run={run} highlighted={null} busy={false} onDecide={vi.fn()} />);
}

test("a run in a workflow says its own Approval step was covered, and shows the one review", () => {
  show("waiting", "waiting_approval");
  const own = screen.getByRole("heading", { name: "Approval" }).closest("li")!;
  expect(own.textContent).toContain("Passed straight on: the workflow's one review at the end covers it.");
  const review = screen.getByRole("heading", { name: "Weekly UGC review" }).closest("li")!;
  expect(review.textContent).toContain("Waiting for someone to check the files.");
});

test("a failed run says the workflow's review was not needed", () => {
  show("failed", "skipped");
  const review = screen.getByRole("heading", { name: "Weekly UGC review" }).closest("li")!;
  expect(review.textContent).toContain("Not needed, since the run had already failed.");
});
