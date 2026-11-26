import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { actionOf, answerQuery, mutationOf } from "@/test/convex";

import { SendEmailView } from "./send-email-view";
import { countsLine, SentEmailsView, SentEmailView } from "./sent-emails-view";
import { SubscribersView } from "./subscribers-view";

const audiences = {
  sending: true,
  hasTrials: true,
  needsAddress: false,
  counts: { news: 12, accounts: 40, trial_teams: 5, paid_teams: 3 },
};

const row = {
  _id: "b1",
  subject: "New: Best Moments",
  audience: "news" as const,
  status: "sent" as const,
  createdAt: Date.UTC(2026, 10, 25),
  startedAt: Date.UTC(2026, 10, 25),
  createdBy: "owner@example.test",
  recipients: 12,
  sent: 11,
  failed: 1,
  skipped: 0,
  bounced: 2,
  complaints: 0,
  unsubscribed: 1,
};

beforeEach(() => {
  answerQuery(api.operator.me, true);
  answerQuery(api.broadcasts.audiences, audiences);
  answerQuery(api.broadcasts.preview, {
    subject: "New: Best Moments",
    html: "<p>Preview</p>",
    text: "Preview",
  });
});

describe("the Admin pages", () => {
  test("tell anyone who isn't the operator that the page isn't for them", () => {
    answerQuery(api.operator.me, false);
    render(<SendEmailView />);
    expect(screen.getByText(/Only the people who run this copy/)).toBeTruthy();
    expect(screen.queryByLabelText("Subject")).toBeNull();
  });
});

describe("Send An Email", () => {
  test("lists each audience with how many it reaches, product news first", () => {
    render(<SendEmailView />);
    const choices = within(screen.getByRole("radiogroup", { name: "Who gets it" })).getAllByRole(
      "radio",
    );
    expect(choices).toHaveLength(4);
    expect((choices[0] as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Product news subscribers")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getAllByText(/never marketing/).length).toBeGreaterThan(0);
  });

  test("hides the trial audiences on a copy without trials", () => {
    answerQuery(api.broadcasts.audiences, { ...audiences, hasTrials: false });
    render(<SendEmailView />);
    expect(
      within(screen.getByRole("radiogroup", { name: "Who gets it" })).getAllByRole("radio"),
    ).toHaveLength(2);
  });

  test("can't send until there's a subject and a message, then asks before sending", async () => {
    const create = mutationOf(api.broadcasts.create);
    create.mockResolvedValue("b1");
    render(<SendEmailView />);
    const send = screen.getByRole("button", { name: "Send" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Body" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByText("Send to 12 people now?")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Send" }).at(-1)!);
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        draft: { subject: "Hello", body: "Body", audience: "news" },
      }),
    );
  });

  test("sends a test to me", async () => {
    const sendTest = actionOf(api.broadcasts.sendTest);
    sendTest.mockResolvedValue({ ok: true, to: "owner@example.test" });
    render(<SendEmailView />);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Body" } });
    fireEvent.click(screen.getByRole("button", { name: "Send me a test" }));
    await waitFor(() => expect(sendTest).toHaveBeenCalled());
  });

  test("books it for later with Schedule", async () => {
    const create = mutationOf(api.broadcasts.create);
    create.mockResolvedValue("b1");
    render(<SendEmailView />);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Body" } });
    fireEvent.click(screen.getByRole("radio", { name: "Send later" }));
    fireEvent.change(screen.getByLabelText("Send at"), { target: { value: "2030-01-02T09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Schedule" }).at(-1)!);
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ sendAt: new Date("2030-01-02T09:30").getTime() }),
      ),
    );
  });

  test("says when email isn't set up", () => {
    answerQuery(api.broadcasts.audiences, { ...audiences, sending: false });
    render(<SendEmailView />);
    expect(screen.getByText(/Email isn.t set up yet/)).toBeTruthy();
  });
});

describe("Sent Emails", () => {
  test("lists each email with how it went", () => {
    answerQuery(api.broadcasts.list, [row]);
    render(<SentEmailsView />);
    expect(screen.getByText("New: Best Moments")).toBeTruthy();
    expect(screen.getByText("Sent to 11 · 1 failed · 2 bounced · 1 unsubscribed")).toBeTruthy();
  });

  test("leaves out what is zero", () => {
    expect(countsLine({ ...row, failed: 0, bounced: 0, unsubscribed: 0 })).toBe("Sent to 11");
  });

  test("one email shows its numbers and why some didn't go", () => {
    answerQuery(api.broadcasts.get, {
      broadcast: { ...row, body: "Body" },
      failures: [{ email: "x@example.com", detail: "Bad address" }],
    });
    render(<SentEmailView id="b1" />);
    expect(screen.getByRole("heading", { level: 1, name: "New: Best Moments" })).toBeTruthy();
    expect(screen.getByText("Bounced")).toBeTruthy();
    expect(screen.getByText(/Bad address/)).toBeTruthy();
  });

  test("a scheduled email can be called off", async () => {
    const cancel = mutationOf(api.broadcasts.cancel);
    cancel.mockResolvedValue(true);
    answerQuery(api.broadcasts.get, {
      broadcast: { ...row, status: "scheduled", scheduledFor: Date.UTC(2030, 0, 1), body: "Body" },
      failures: [],
    });
    render(<SentEmailView id="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Call it off" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ broadcastId: "b1" }));
  });
});

describe("Subscribers", () => {
  test("shows the counts and each address with where it came from", () => {
    answerQuery(api.news.counts, { subscribed: 3, pending: 1, unsubscribed: 2 });
    answerQuery(api.news.list, [
      {
        _id: "s1",
        email: "rosa@example.com",
        status: "subscribed",
        source: "signup",
        userId: "u1",
        updatedAt: Date.UTC(2026, 10, 25),
      },
      {
        _id: "s2",
        email: "ana@example.com",
        status: "pending",
        source: "website",
        updatedAt: Date.UTC(2026, 10, 25),
      },
    ]);
    render(<SubscribersView />);
    expect(screen.getByText("rosa@example.com")).toBeTruthy();
    expect(screen.getByText("From Sign-up form")).toBeTruthy();
    expect(screen.getAllByText("Not confirmed").length).toBeGreaterThan(0);
    expect(screen.getByText("No account")).toBeTruthy();
  });
});
