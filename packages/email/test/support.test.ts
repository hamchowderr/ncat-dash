import { describe, expect, it } from "vitest";

import { supportReplyEmail, supportTicketEmail } from "../src";

const branding = { appName: "Takewon" };

describe("support emails", () => {
  it("an answer quotes it with its line breaks and sends them back to the app", () => {
    const email = supportReplyEmail(
      {
        name: "Ana",
        number: 12,
        subject: "Captions\nare late",
        from: "Takewon support",
        reply: "Fixed.\n\nTry again <now>.",
        ticketUrl: "https://app.example/help?ticket=abc",
      },
      branding,
    );
    expect(email.subject).toBe("Re: Captions are late [#12]");
    expect(email.text).toContain("Fixed.\n\nTry again <now>.");
    expect(email.html).toContain("Try again &lt;now&gt;.");
    expect(email.html).toContain("white-space:pre-wrap");
    expect(email.html).toContain("https://app.example/help?ticket=abc");
    expect(email.text).toContain("Replies to this email are not read.");
    // It is the answer they asked for, not marketing: nothing to unsubscribe from.
    expect(email.headers).toBeUndefined();
  });

  it("tells support about a new request and about a new message", () => {
    const fresh = supportTicketEmail(
      {
        kind: "new",
        number: 3,
        subject: "Billing",
        from: "Ana Lima",
        teamName: "Example Studio",
        body: "Where is my invoice?",
        ticketUrl: "https://app.example/admin/support?ticket=abc",
      },
      branding,
    );
    expect(fresh.subject).toBe("New help request #3: Billing");
    expect(fresh.text).toContain("Ana Lima from Example Studio");
    expect(fresh.text).toContain("Where is my invoice?");

    const again = supportTicketEmail(
      { kind: "message", number: 3, subject: "Billing", from: "Ana Lima", body: "Hi", ticketUrl: "u" },
      branding,
    );
    expect(again.subject).toBe("Ana Lima wrote again on #3: Billing");
  });
});
