import { api } from "@convex/_generated/api";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { EmailCard } from "./email-card";

const email = {
  configured: true,
  canEdit: false,
  fromEmail: "clips@example.test",
  fromName: "Salt House",
  alertEmails: true,
  approvalEmails: true,
};

describe("the alert emails a person gets", () => {
  test("approval emails switch off on their own, leaving failure emails on", () => {
    answerQuery(api.email.get, email);
    renderInApp(<EmailCard />);
    const approvals = screen.getByRole("switch", {
      name: "Email me when an approval is waiting for me",
    });
    expect(approvals).toBeChecked();
    expect(screen.getByRole("switch", { name: "Email me when a run fails" })).toBeChecked();

    fireEvent.click(approvals);
    expect(mutationOf(api.email.setAlertEmails)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      enabled: false,
      kind: "approval_waiting",
    });
  });

  test("failure emails keep their own switch", () => {
    answerQuery(api.email.get, { ...email, alertEmails: false, approvalEmails: false });
    renderInApp(<EmailCard />);
    fireEvent.click(screen.getByRole("switch", { name: "Email me when a run fails" }));
    expect(mutationOf(api.email.setAlertEmails)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      enabled: true,
      kind: undefined,
    });
  });
});
