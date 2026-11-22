import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { RunView } from "./run-view";
import { RunsAtOnce } from "./runs-at-once";

describe("runs at once", () => {
  test("can be limited, and the limit taken away again", async () => {
    const user = userEvent.setup();
    renderInApp(<RunsAtOnce automationId="auto1" runsAtOnce={null} />);
    await user.click(screen.getByRole("combobox", { name: "Runs at once" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "As many as are started",
      "One at a time",
      "2 at a time",
      "3 at a time",
      "5 at a time",
      "10 at a time",
    ]);
    await user.click(screen.getByRole("option", { name: "One at a time" }));
    expect(mutationOf(api.automations.setRunsAtOnce)).toHaveBeenLastCalledWith({
      automationId: "auto1",
      runsAtOnce: 1,
    });
    expect(screen.getByText(/wait their turn, and start in the order they came in/)).toBeTruthy();
  });

  test("says when saving did not work", async () => {
    mutationOf(api.automations.setRunsAtOnce).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    renderInApp(<RunsAtOnce automationId="auto1" runsAtOnce={2} />);
    await user.click(screen.getByRole("combobox", { name: "Runs at once" }));
    await user.click(screen.getByRole("option", { name: "As many as are started" }));
    expect(await screen.findByText("That could not be saved. Try again.")).toBeTruthy();
  });

  test("a run waiting its turn says so on the run page", () => {
    answerQuery(api.runs.get, {
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
      waitingForTurn: 1,
      hasCuts: false,
      nodes: [
        { id: "trim", kind: "step", stepId: "video-trim", input: {}, position: { x: 0, y: 0 } },
      ],
      edges: [],
      steps: [
        {
          _id: "step1",
          nodeId: "trim",
          status: "pending",
          jobs: [],
          outputs: [],
          facts: [],
          retries: 0,
          retryAt: null,
          retryError: null,
          error: null,
        },
      ],
    });
    answerQuery(api.reviews.forStep, null);
    renderInApp(
      <RunView automationId={"auto1" as Id<"automations">} runId={"run1" as Id<"runs">} />,
    );
    expect(
      screen.getByText(
        "Waiting for its turn. Weekly clips runs one at a time, so this run starts when an earlier one ends.",
      ),
    ).toBeTruthy();
  });
});
