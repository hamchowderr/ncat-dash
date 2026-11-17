import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { type ApprovalView, ApprovalWaitingNote, decidedSentence } from "./approval-status";

const view = (over: Partial<ApprovalView>): ApprovalView => ({
  asked: [],
  forYou: true,
  mayDecide: true,
  decideBy: null,
  whenTimeUp: "reject",
  decidedBy: null,
  decidedAutomatically: false,
  ...over,
});

describe("what the run page says about an approval", () => {
  test("anyone on the team, with no time limit", () => {
    render(<ApprovalWaitingNote view={view({})} />);
    expect(screen.getByText("Anyone on the team can decide.")).toBeInTheDocument();
    expect(screen.queryByText(/by itself/)).not.toBeInTheDocument();
  });

  test("the person asked is told it is theirs, with the deadline", () => {
    render(
      <ApprovalWaitingNote
        view={view({
          asked: ["Ana Reyes"],
          decideBy: Date.UTC(2026, 10, 18, 15),
          whenTimeUp: "approve",
        })}
      />,
    );
    expect(screen.getByText("You are asked to decide.")).toBeInTheDocument();
    expect(
      screen.getByText(/If nobody decides by .*, it is approved by itself\./),
    ).toBeInTheDocument();
  });

  test("someone not asked sees who can decide", () => {
    render(
      <ApprovalWaitingNote
        view={view({ asked: ["Ana Reyes", "Ben Cho"], forYou: false, mayDecide: false })}
      />,
    );
    expect(screen.getByText("Ana Reyes or Ben Cho are asked to decide.")).toBeInTheDocument();
    expect(
      screen.getByText("Only Ana Reyes or Ben Cho, or a team owner or admin, can decide this one."),
    ).toBeInTheDocument();
  });

  test("who decided, once decided", () => {
    expect(decidedSentence(view({ decidedBy: "Olu Bello" }), true)).toBe("Approved by Olu Bello.");
    expect(decidedSentence(view({ decidedAutomatically: true }), false)).toBe(
      "Nobody decided in time, so it was rejected by itself.",
    );
    expect(decidedSentence(view({}), true)).toBeNull();
  });
});
