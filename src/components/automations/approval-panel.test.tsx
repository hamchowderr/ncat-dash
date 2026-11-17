import { api } from "@convex/_generated/api";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { answerQuery } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { TeamApprovalSettings } from "./approval-panel";

const members = [
  { userId: "olu", name: "Olu Bello", email: "olu@example.test", role: "owner" },
  { userId: "ana", name: "Ana Reyes", email: "ana@example.test", role: "member" },
];

function show(input: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  renderInApp(
    <TeamApprovalSettings node={{ id: "approval", kind: "approval", input }} onChange={onChange} />,
  );
  return onChange;
}

describe("the Approval step's settings", () => {
  test("lists the active team and says anyone can approve when nobody is picked", () => {
    let asked: unknown;
    answerQuery(api.teams.members, (args: Record<string, unknown>) => {
      asked = args;
      return members;
    });
    show();
    expect(asked).toEqual({ organizationId: TEAM.id });
    expect(
      screen.getByText(/Nobody picked, so anyone on the team can approve/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Olu Bello/)).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Ana Reyes/ })).not.toBeChecked();
  });

  test("ticking a person names them as reviewer", () => {
    answerQuery(api.teams.members, members);
    const onChange = show();
    fireEvent.click(screen.getByRole("checkbox", { name: /Ana Reyes/ }));
    expect(onChange).toHaveBeenCalledWith({ input: { reviewers: ["ana"] } });
  });

  test("a named reviewer is described with owners and admins", () => {
    answerQuery(api.teams.members, members);
    show({ reviewers: ["ana"] });
    expect(screen.getByRole("checkbox", { name: /Ana Reyes/ })).toBeChecked();
    expect(
      screen.getByText(/Only Ana Reyes can approve, plus team owners and admins/),
    ).toBeInTheDocument();
  });

  test("switching the time limit on starts at 24 hours, rejecting", () => {
    answerQuery(api.teams.members, members);
    const onChange = show();
    expect(screen.queryByLabelText("If nobody decides within")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /Decide by itself/ }));
    expect(onChange).toHaveBeenCalledWith({
      input: { timeLimit: 24, timeLimitUnit: "hours", whenTimeUp: "reject" },
    });
  });

  test("a limit over 6 days is explained", () => {
    answerQuery(api.teams.members, members);
    show({ timeLimit: 8, timeLimitUnit: "days" });
    expect(screen.getByLabelText("If nobody decides within")).toHaveValue("8");
    expect(screen.getByText(/6 days at most/)).toBeInTheDocument();
  });

  test("shows the team loading", () => {
    answerQuery(api.teams.members, undefined);
    show();
    expect(screen.getByText("Loading the team…")).toBeInTheDocument();
  });
});
