import { api } from "@convex/_generated/api";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { hourLabel, NotificationsCard } from "./notifications-card";

const kinds = [
  ["run_failed", "A run fails", false],
  ["approval_waiting", "An approval is waiting for me", true],
  ["approval_timed_out", "An approval ran out of time", false],
  ["mention", "Someone mentions me in a review", false],
] as const;

function settings(over: Record<string, unknown> = {}) {
  return {
    kinds: kinds.map(([kind, title, alwaysRightAway]) => ({
      kind,
      title,
      description: `About ${title}.`,
      bell: true,
      email: true,
      alwaysRightAway,
    })),
    emailTiming: "now",
    digestHour: 8,
    timeZone: null,
    emailReady: true,
    ...over,
  };
}

describe("notification settings", () => {
  test("list every kind of news with a bell and an email switch", () => {
    answerQuery(api.notifications.get, settings());
    renderInApp(<NotificationsCard />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("switch").length)).toEqual([2, 2, 2, 2]);
    expect(screen.getByRole("switch", { name: "A run fails: in the Inbox" })).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Someone mentions me in a review: by email" }),
    ).toBeChecked();
  });

  test("switching one off saves just that kind and channel", () => {
    answerQuery(api.notifications.get, settings());
    renderInApp(<NotificationsCard />);
    fireEvent.click(
      screen.getByRole("switch", { name: "An approval ran out of time: in the Inbox" }),
    );
    expect(mutationOf(api.notifications.set)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      kind: "approval_timed_out",
      channel: "bell",
      enabled: false,
    });
  });

  test("turning on the daily summary sends the browser's time zone", () => {
    answerQuery(api.notifications.get, settings());
    renderInApp(<NotificationsCard />);
    expect(screen.queryByText("Send it at")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "One summary email a day" }));
    expect(mutationOf(api.notifications.setEmailTiming)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      emailTiming: "daily",
      digestHour: undefined,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  test("with a daily summary, shows the hour and says approvals still come at once", () => {
    answerQuery(
      api.notifications.get,
      settings({ emailTiming: "daily", digestHour: 9, timeZone: "America/Los_Angeles" }),
    );
    renderInApp(<NotificationsCard />);
    expect(screen.getByText("Send it at")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveTextContent(hourLabel(9));
    expect(screen.getByText(/America\/Los Angeles/)).toBeInTheDocument();
    expect(screen.getByText(/Emailed straight away even with a daily summary/)).toBeInTheDocument();
  });

  test("says nothing is emailed yet when email is not set up", () => {
    answerQuery(api.notifications.get, settings({ emailReady: false }));
    renderInApp(<NotificationsCard />);
    expect(screen.getByText(/Email is not set up for this dashboard yet/)).toBeInTheDocument();
  });

  test("with every email off, the summary choice is greyed out", () => {
    const allOff = settings();
    allOff.kinds = allOff.kinds.map((entry) => ({ ...entry, email: false }));
    answerQuery(api.notifications.get, allOff);
    renderInApp(<NotificationsCard />);
    expect(screen.getByRole("switch", { name: "One summary email a day" })).toBeDisabled();
  });
});
