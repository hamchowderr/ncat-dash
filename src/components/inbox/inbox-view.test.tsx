import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TeamContext } from "@/lib/team-context";
import {
  answerQuery,
  mutationOf,
  place,
  pushed,
  toastDismiss,
  toastError,
  toastInfo,
} from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { alertDetail, alertTitle } from "./alert-look";
import { AlertNotices } from "./alert-notices";
import { alertTime, dayGroup, InboxView } from "./inbox-view";

// Midday, so "a few minutes ago" is always today whatever time the tests run.
const NOW = new Date(2026, 10, 18, 12).getTime();
const HOUR = 3_600_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const alert = (over: Record<string, unknown>) => ({
  _id: "a1",
  kind: "run_failed",
  at: NOW - HOUR / 6,
  href: "/automations/auto1/runs/run1",
  from: null,
  automationName: "Weekly clips",
  stepName: "Captions",
  message: "The toolkit could not be reached.",
  retries: 0,
  seen: false,
  ...over,
});

const MIXED = {
  unseen: 3,
  alerts: [
    alert({
      _id: "a3",
      kind: "approval_waiting",
      stepName: "Approval",
      message: "If nobody decides within 24 hours, it is rejected by itself.",
    }),
    alert({
      _id: "a2",
      kind: "mention",
      automationName: "Cut review",
      from: "Maya Ortiz",
      stepName: null,
      message: "@Dev Patel tighten the cut",
      href: "/review/r1?clip=c1&comment=m1",
    }),
    alert({ _id: "a1" }),
    alert({ _id: "a0", seen: true, automationName: "Old clips", at: NOW - 10 * 24 * HOUR }),
  ],
};

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

describe("failures in plain words", () => {
  test("a developer error from the toolkit is never shown as it came", () => {
    const raw = alert({ message: "Error: connect ECONNREFUSED 127.0.0.1:8080" });
    expect(alertDetail(raw as Parameters<typeof alertDetail>[0])).toBe(
      "Captions: The toolkit could not be reached. It is set to an address on this computer, so check the toolkit's address in Settings.",
    );
    answerQuery(api.alerts.list, { unseen: 1, alerts: [raw] });
    renderInApp(<InboxView />);
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

describe("days and times", () => {
  test("alerts sit under today, yesterday, this week or earlier", () => {
    const noon = new Date(2026, 10, 18, 12).getTime();
    expect(dayGroup(noon - HOUR, noon)).toBe("Today");
    expect(dayGroup(noon - 20 * HOUR, noon)).toBe("Yesterday");
    expect(dayGroup(noon - 3 * 24 * HOUR, noon)).toBe("Earlier this week");
    expect(dayGroup(noon - 9 * 24 * HOUR, noon)).toBe("Earlier");
    expect(alertTime(noon - 9 * 24 * HOUR, noon)).toMatch(/2026/);
  });
});

describe("the Inbox page", () => {
  test("lists approvals, mentions and failures under the day they came", () => {
    answerQuery(api.alerts.list, MIXED);
    renderInApp(<InboxView />);
    const today = screen.getByRole("region", { name: "Today" });
    const links = within(today).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("data-alert-kind"))).toEqual([
      "approval_waiting",
      "mention",
      "run_failed",
    ]);
    expect(links[0]).toHaveTextContent("Approval: If nobody decides within 24 hours");
    expect(links[0]).toHaveTextContent("Review");
    expect(links[1]).toHaveAttribute("href", "/review/r1?clip=c1&comment=m1");
    const earlier = screen.getByRole("region", { name: "Earlier" });
    expect(within(earlier).getByRole("link", { name: /Old clips failed/ })).toHaveAttribute(
      "data-alert",
      "seen",
    );
  });

  test("opening an alert counts it as seen", () => {
    answerQuery(api.alerts.list, MIXED);
    renderInApp(<InboxView />);
    fireEvent.click(screen.getByRole("link", { name: /waiting for your approval/ }));
    expect(mutationOf(api.alerts.markSeen)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      alertId: "a3",
    });
  });

  test("one can be marked as seen without opening it, or all at once", () => {
    answerQuery(api.alerts.list, MIXED);
    renderInApp(<InboxView />);
    // Seen ones have nothing left to mark.
    expect(screen.getAllByRole("button", { name: /^Mark as seen/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Mark as seen: Weekly clips failed" }));
    expect(mutationOf(api.alerts.markSeen)).toHaveBeenLastCalledWith({
      organizationId: TEAM.id,
      alertId: "a1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark all as seen" }));
    expect(mutationOf(api.alerts.markSeen)).toHaveBeenLastCalledWith({ organizationId: TEAM.id });
  });

  test("each view shows only its kinds, and says how many are new", () => {
    answerQuery(api.alerts.list, MIXED);
    renderInApp(<InboxView />);
    expect(screen.getByRole("tab", { name: /^All\W+3 new$/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: /^Needs you\W+1 new$/ }));
    expect(
      screen.getAllByRole("link").filter((link) => link.hasAttribute("data-alert-kind")),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: /^Failed runs\W+1 new$/ }));
    expect(screen.getByRole("link", { name: /Old clips failed/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /waiting/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /^Mentions and feedback\W+1 new$/ }));
    expect(screen.getByRole("link", { name: /Maya Ortiz mentioned you/ })).toBeInTheDocument();
  });

  test("says what will show up when there is nothing, and where to choose what you hear about", () => {
    answerQuery(api.alerts.list, { unseen: 0, alerts: [] });
    renderInApp(<InboxView />);
    expect(screen.getByText(/approvals waiting for you and mentions show up here/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Mark all as seen" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose what you hear about" })).toHaveAttribute(
      "href",
      "/settings/notifications",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Needs you" }));
    expect(screen.getByText(/Nothing is waiting for you/)).toBeVisible();
  });
});

describe("Inbox in the menu", () => {
  beforeEach(() => {
    // The menu asks whether the screen is a phone's; this one is wide.
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });

  function menu() {
    return render(
      <TeamContext.Provider value={TEAM}>
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar
              teamName={TEAM.name}
              edition="Self-hosted"
              user={{ name: "Ana Reyes", email: "ana@example.test", image: null }}
            />
          </SidebarProvider>
        </TooltipProvider>
      </TeamContext.Provider>,
    );
  }

  test("sits under Home with how many alerts are new", () => {
    answerQuery(api.alerts.list, MIXED);
    answerQuery(api.teamSettings.get, { brand: {} });
    menu();
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links.indexOf("/inbox")).toBe(links.lastIndexOf("/") + 1);
    const inbox = screen.getByRole("link", { name: /Inbox/ });
    expect(inbox).toHaveAttribute("href", "/inbox");
    expect(inbox).toHaveAccessibleName(/^Inbox\W+3 new$/);
    expect(inbox.querySelector("[data-alerts-count]")).toHaveTextContent("3");
  });

  test("shows no count once everything is seen", () => {
    answerQuery(api.alerts.list, { unseen: 0, alerts: [] });
    answerQuery(api.teamSettings.get, { brand: {} });
    menu();
    expect(
      screen.getByRole("link", { name: "Inbox" }).querySelector("[data-alerts-count]"),
    ).toBeNull();
  });
});

describe("the pop-up notice", () => {
  test("pops up in plain words for news that arrives, and goes away on the Inbox page", () => {
    answerQuery(api.alerts.list, { unseen: 0, alerts: [] });
    const { rerender } = renderInApp(<AlertNotices />);
    answerQuery(api.alerts.list, {
      unseen: 1,
      alerts: [alert({ message: "Error: connect ECONNREFUSED 127.0.0.1:8080" })],
    });
    rerender(<AlertNotices />);
    expect(toastError).toHaveBeenCalledTimes(1);
    const [title, options] = toastError.mock.calls[0];
    expect(title).toBe("Weekly clips failed");
    expect(options.description).not.toContain("ECONNREFUSED");
    expect(options.id).toBe("alert-a1");

    options.action.onClick();
    expect(mutationOf(api.alerts.markSeen)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      alertId: "a1",
    });
    expect(pushed).toHaveBeenCalledWith("/automations/auto1/runs/run1");

    place.pathname = "/inbox";
    rerender(<AlertNotices />);
    expect(toastDismiss).toHaveBeenCalledWith("alert-a1");
  });

  test("alerts already there when the page opens are not announced again", () => {
    answerQuery(api.alerts.list, MIXED);
    const { rerender } = renderInApp(<AlertNotices />);
    rerender(<AlertNotices />);
    expect(toastError).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  test("news that arrives while the Inbox is open is not announced on top of it", () => {
    place.pathname = "/inbox";
    answerQuery(api.alerts.list, { unseen: 0, alerts: [] });
    const { rerender } = renderInApp(<AlertNotices />);
    answerQuery(api.alerts.list, { unseen: 1, alerts: [alert({})] });
    rerender(<AlertNotices />);
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("alerts in the desktop app", () => {
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<boolean>>(async () => true);
  beforeEach(() => {
    invoke.mockClear();
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke };
  });
  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  test("each new alert is a system notification, and the unseen count goes to the app", async () => {
    answerQuery(api.alerts.list, MIXED);
    const { rerender } = renderInApp(<AlertNotices />);
    // Alerts already there are not notified again, but the count is shown.
    expect(invoke.mock.calls.filter(([command]) => command === "notify")).toHaveLength(0);
    expect(invoke).toHaveBeenCalledWith("set_unseen", { count: MIXED.unseen });

    const news = alert({ _id: "new1", message: "Error: connect ECONNREFUSED 127.0.0.1:8080" });
    answerQuery(api.alerts.list, { unseen: MIXED.unseen + 1, alerts: [news, ...MIXED.alerts] });
    rerender(<AlertNotices />);
    expect(invoke).toHaveBeenCalledWith("notify", {
      title: alertTitle(news as Parameters<typeof alertTitle>[0]),
      body: alertDetail(news as Parameters<typeof alertDetail>[0]),
    });
    expect(invoke).toHaveBeenCalledWith("set_unseen", { count: MIXED.unseen + 1 });
  });

  test("still notifies while the Inbox page is open, since the window may be hidden", () => {
    place.pathname = "/inbox";
    answerQuery(api.alerts.list, { unseen: 0, alerts: [] });
    const { rerender } = renderInApp(<AlertNotices />);
    answerQuery(api.alerts.list, { unseen: 1, alerts: [alert({})] });
    rerender(<AlertNotices />);
    expect(invoke.mock.calls.filter(([command]) => command === "notify")).toHaveLength(1);
    expect(toastError).not.toHaveBeenCalled();
  });
});
