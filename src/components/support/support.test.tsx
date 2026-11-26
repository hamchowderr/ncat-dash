import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { barTitle } from "@/components/app-shell/app-shell";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TeamContext } from "@/lib/team-context";
import { answerQuery, mutationOf, place, replaced } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { describeBrowser, HelpView } from "./help-view";
import { SupportInbox } from "./support-inbox";

const NOW = Date.now();

const request = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  number: 7,
  subject: "Captions are late",
  status: "open",
  preview: "Fixed now, try again.",
  lastMessageAt: NOW,
  answered: true,
  unread: true,
  ...over,
});

const messages = [
  {
    id: "m1",
    at: NOW - 60_000,
    from: "customer",
    authorName: "Ana Reyes",
    body: "My captions are a second late.",
    private: false,
  },
  { id: "m2", at: NOW, from: "staff", authorName: "Support", body: "Fixed now.", private: false },
];

beforeEach(() => {
  answerQuery(api.support.contact, { email: "support@example.test" });
});

describe("Get Help", () => {
  test("with no questions yet, it opens on the form and sends what was written", async () => {
    place.pathname = "/help";
    place.search = "from=%2Fruns";
    answerQuery(api.support.mine, []);
    const open = mutationOf(api.support.open);
    open.mockResolvedValue({ ticketId: "t9", number: 9 });
    renderInApp(<HelpView />);

    expect(screen.getByRole("link", { name: /Or email support@example.test/ })).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What is it about?"), {
      target: { value: "Export fails" },
    });
    fireEvent.change(screen.getByLabelText("Tell us more"), {
      target: { value: "The CapCut pack never finishes." },
    });
    fireEvent.click(send);

    await waitFor(() =>
      expect(replaced).toHaveBeenCalledWith("/help?from=%2Fruns&ticket=t9", {
        scroll: false,
      }),
    );
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: TEAM.id,
        subject: "Export fails",
        body: "The CapCut pack never finishes.",
        page: "/runs",
      }),
    );
  });

  test("lists questions with a new answer, and opening one shows it and counts it read", () => {
    place.pathname = "/help";
    place.search = "ticket=t1";
    answerQuery(api.support.mine, [
      request(),
      request({ id: "t2", subject: "Old one", status: "closed", unread: false }),
    ]);
    answerQuery(api.support.conversation, { ticket: request(), messages });
    const markRead = mutationOf(api.support.markRead);
    renderInApp(<HelpView />);

    expect(screen.getByText("New answer")).toBeTruthy();
    expect(screen.getByText("Solved")).toBeTruthy();
    expect(screen.getByText("Fixed now.")).toBeTruthy();
    expect(markRead).toHaveBeenCalledWith({ ticketId: "t1" });

    fireEvent.click(screen.getByRole("button", { name: "This is solved" }));
    expect(mutationOf(api.support.close)).toHaveBeenCalledWith({ ticketId: "t1" });
  });

  test("writing again sends with Ctrl+Enter", async () => {
    place.pathname = "/help";
    place.search = "ticket=t1";
    answerQuery(api.support.mine, [request({ unread: false })]);
    answerQuery(api.support.conversation, { ticket: request({ unread: false }), messages });
    renderInApp(<HelpView />);
    const box = screen.getByLabelText("Your message");
    fireEvent.change(box, { target: { value: "Thanks, works now" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(mutationOf(api.support.reply)).toHaveBeenCalledWith({
        ticketId: "t1",
        body: "Thanks, works now",
      }),
    );
  });

  test("reads the browser for support", () => {
    expect(
      describeBrowser(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
      ),
    ).toBe("Firefox 140 on Windows 10");
    expect(describeBrowser("")).toBeUndefined();
  });
});

describe("Support under Admin", () => {
  const row = {
    id: "t1",
    number: 7,
    subject: "Captions are late",
    status: "open",
    requesterName: "Ana Reyes",
    requesterEmail: "ana@example.test",
    team: "Example Studio",
    preview: "My captions are a second late.",
    lastMessageAt: NOW,
    waitingOnUs: true,
    unread: true,
  };

  test("is only for the operator", () => {
    place.pathname = "/admin/support";
    answerQuery(api.operator.me, false);
    renderInApp(<SupportInbox />);
    expect(screen.getByText(/for whoever runs this copy/)).toBeTruthy();
  });

  test("lists questions, shows who asked and from where, and adds a private note", async () => {
    place.pathname = "/admin/support";
    place.search = "ticket=t1";
    answerQuery(api.operator.me, true);
    answerQuery(api.support.inbox, { tickets: [row], counts: { open: 1, unread: 1 } });
    answerQuery(api.support.staffConversation, {
      ticket: row,
      context: { team: "Example Studio", page: "/runs", latestFailedRun: "Weekly clips (r1)" },
      messages: [
        messages[0],
        { ...messages[1], id: "m3", authorName: "Chris", body: "Checked the logs.", private: true },
      ],
    });
    const markRead = mutationOf(api.support.staffMarkRead);
    renderInApp(<SupportInbox />);

    expect(screen.getByText("Needs an answer")).toBeTruthy();
    expect(screen.getByText("Private note by Chris")).toBeTruthy();
    expect(screen.getByText("Weekly clips (r1)")).toBeTruthy();
    expect(screen.getByText("Came from")).toBeTruthy();
    expect(markRead).toHaveBeenCalledWith({ ticketId: "t1" });

    fireEvent.click(screen.getByRole("radio", { name: "Private note" }));
    fireEvent.change(screen.getByLabelText("Private note"), {
      target: { value: "Their toolkit timed out." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() =>
      expect(mutationOf(api.support.answer)).toHaveBeenCalledWith({
        ticketId: "t1",
        body: "Their toolkit timed out.",
        private: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(mutationOf(api.support.setStatus)).toHaveBeenCalledWith({
      ticketId: "t1",
      status: "closed",
    });
  });

  test("an answer goes out as an answer", async () => {
    place.pathname = "/admin/support";
    place.search = "ticket=t1";
    answerQuery(api.operator.me, true);
    answerQuery(api.support.inbox, { tickets: [row], counts: { open: 1, unread: 0 } });
    answerQuery(api.support.staffConversation, { ticket: row, context: {}, messages });
    renderInApp(<SupportInbox />);
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "Fixed." } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() =>
      expect(mutationOf(api.support.answer)).toHaveBeenCalledWith({
        ticketId: "t1",
        body: "Fixed.",
        private: false,
      }),
    );
  });
});

describe("Get Help in the menu", () => {
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });

  function sidebar() {
    render(
      <TeamContext.Provider value={TEAM}>
        <TooltipProvider>
          <SidebarProvider defaultOpen>
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

  test("remembers the page it was opened from and counts new answers", () => {
    place.pathname = "/runs";
    answerQuery(api.support.unread, 2);
    sidebar();
    const link = screen.getByRole("link", { name: /Get Help/ });
    expect(link.getAttribute("href")).toBe("/help?from=%2Fruns");
    expect(link.textContent).toContain("2");
  });

  test("on Get Help, only Get Help is the page you're on", () => {
    place.pathname = "/help";
    sidebar();
    expect(screen.getByRole("link", { name: /Get Help/ }).getAttribute("data-active")).toBe("true");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("data-active")).toBe("false");
  });

  test("the operator sees Support with its unread count", () => {
    place.pathname = "/";
    answerQuery(api.operator.me, true);
    answerQuery(api.support.staffUnread, 3);
    sidebar();
    const link = screen.getByRole("link", { name: /^Support/ });
    expect(link.getAttribute("href")).toBe("/admin/support");
    expect(link.textContent).toContain("3");
  });
});

test("the bar along the top names Get Help and Support", () => {
  expect(barTitle("/help")).toBe("Get Help");
  expect(barTitle("/admin/support")).toBe("Support");
  expect(barTitle("/runs")).toBe("Runs");
});
