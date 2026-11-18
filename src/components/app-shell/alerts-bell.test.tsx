import { api } from "@convex/_generated/api";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf, toastDismiss, toastError } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { AlertsBell, alertDetail, alertTitle } from "./alerts-bell";

const alert = (over: Record<string, unknown>) => ({
  _id: "a1",
  kind: "run_failed",
  at: 1_700_000_000_000,
  href: "/automations/auto1/runs/run1",
  from: null,
  automationName: "Weekly clips",
  stepName: "Captions",
  message: "The toolkit could not be reached.",
  retries: 0,
  seen: false,
  ...over,
});

describe("alert titles", () => {
  test("say what happened in a few words", () => {
    expect(alertTitle({ kind: "run_failed", automationName: "Weekly clips", retries: 2 })).toBe(
      "Weekly clips failed after 3 tries",
    );
    expect(
      alertTitle({ kind: "approval_waiting", automationName: "Weekly clips", retries: 0 }),
    ).toBe("Weekly clips is waiting for your approval");
    expect(
      alertTitle({ kind: "approval_timed_out", automationName: "Weekly clips", retries: 0 }),
    ).toBe("Weekly clips: an approval ran out of time");
    expect(
      alertTitle({ kind: "mention", automationName: "Cut review", retries: 0, from: "Maya" }),
    ).toBe("Maya mentioned you in Cut review");
  });
});

describe("the bell", () => {
  test("lists approvals waiting for the person next to failed runs", () => {
    answerQuery(api.alerts.list, {
      unseen: 2,
      alerts: [
        alert({
          _id: "a2",
          kind: "approval_waiting",
          stepName: "Approval",
          message: "If nobody decides within 24 hours, it is rejected by itself.",
        }),
        alert({}),
      ],
    });
    renderInApp(<AlertsBell />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts, 2 you have not seen/ }));
    const approval = screen.getByRole("link", { name: /waiting for your approval/ });
    expect(approval).toHaveAttribute("href", "/automations/auto1/runs/run1");
    expect(approval).toHaveTextContent("Approval: If nobody decides within 24 hours");
    expect(screen.getByRole("link", { name: /Weekly clips failed/ })).toBeInTheDocument();

    fireEvent.click(approval);
    expect(mutationOf(api.alerts.markSeen)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      alertId: "a2",
    });
  });

  test("a mention opens the review at its thread", () => {
    answerQuery(api.alerts.list, {
      unseen: 1,
      alerts: [
        alert({
          kind: "mention",
          automationName: "Cut review",
          from: "Maya Ortiz",
          stepName: null,
          message: "@Dev Patel tighten the cut",
          href: "/review/r1?clip=c1&comment=m1",
        }),
      ],
    });
    renderInApp(<AlertsBell />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts, 1 you have not seen/ }));
    const link = screen.getByRole("link", { name: /Maya Ortiz mentioned you in Cut review/ });
    expect(link).toHaveAttribute("href", "/review/r1?clip=c1&comment=m1");
    expect(link).toHaveAttribute("data-alert-kind", "mention");
  });

  test("points to the notification settings when there is nothing", () => {
    answerQuery(api.alerts.list, { unseen: 0, alerts: [] });
    renderInApp(<AlertsBell />);
    fireEvent.click(screen.getByRole("button", { name: "Alerts" }));
    expect(screen.getByText(/approvals for you and mentions show up here/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings#notifications",
    );
  });
});

describe("failures in plain words", () => {
  test("a developer error from the toolkit is never shown as it came", () => {
    const raw = alert({ message: "Error: connect ECONNREFUSED 127.0.0.1:8080" });
    expect(alertDetail(raw as Parameters<typeof alertDetail>[0])).toBe(
      "Captions: The toolkit could not be reached. It is set to an address on this computer, so check the toolkit's address in Settings.",
    );
    answerQuery(api.alerts.list, { unseen: 1, alerts: [raw] });
    renderInApp(<AlertsBell />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts, 1 you have not seen/ }));
    const link = screen.getByRole("link", { name: /Weekly clips failed/ });
    expect(link).toHaveTextContent("The toolkit could not be reached.");
    expect(link).not.toHaveTextContent("ECONNREFUSED");
  });

  test("other kinds keep their words as they are", () => {
    expect(
      alertDetail({
        kind: "mention",
        automationName: "Cut review",
        retries: 0,
        stepName: null,
        message: "Error: this is what Maya typed",
      }),
    ).toBe("Error: this is what Maya typed");
  });
});

describe("the failure notice", () => {
  test("pops up in plain words and goes away when the list opens, so nothing covers it", () => {
    answerQuery(api.alerts.list, { unseen: 0, alerts: [] });
    const { rerender } = renderInApp(<AlertsBell />);
    answerQuery(api.alerts.list, {
      unseen: 1,
      alerts: [alert({ message: "Error: connect ECONNREFUSED 127.0.0.1:8080" })],
    });
    rerender(<AlertsBell />);
    expect(toastError).toHaveBeenCalledTimes(1);
    const [title, options] = toastError.mock.calls[0];
    expect(title).toBe("Weekly clips failed");
    expect(options.description).not.toContain("ECONNREFUSED");
    expect(options.id).toBe("alert-a1");

    fireEvent.click(screen.getByRole("button", { name: /Alerts, 1 you have not seen/ }));
    expect(toastDismiss).toHaveBeenCalledWith("alert-a1");
  });

  test("an alert that arrives while the list is open is not announced on top of it", () => {
    answerQuery(api.alerts.list, { unseen: 0, alerts: [] });
    const { rerender } = renderInApp(<AlertsBell />);
    fireEvent.click(screen.getByRole("button", { name: "Alerts" }));
    answerQuery(api.alerts.list, { unseen: 1, alerts: [alert({})] });
    rerender(<AlertsBell />);
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Weekly clips failed/ })).toBeInTheDocument();
  });
});
