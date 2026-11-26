import { afterEach, describe, expect, it, vi } from "vitest";
import {
  announcementEmail,
  confirmNewsEmail,
  paragraphsOf,
  sendBatch,
  withUnsubscribe,
} from "../src";

const branding = { appName: "Takewon" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("announcement emails", () => {
  it("turns blank lines into paragraphs and escapes what the operator typed", () => {
    expect(paragraphsOf("One\nline\n\n\nTwo\r\n\r\nThree ")).toEqual(["One line", "Two", "Three"]);
    const email = announcementEmail(
      { subject: "New: Best Moments", body: "Find <the> best parts.\n\nTry it today." },
      "news",
      branding,
    );
    expect(email.subject).toBe("New: Best Moments");
    expect(email.html).toContain("Find &lt;the&gt; best parts.");
    expect(email.html).not.toContain("<the>");
    expect(email.text).toContain("Try it today.");
    expect(email.text).toContain("You get this because you asked for Takewon product news.");
  });

  it("says an account notice is about the account, not marketing", () => {
    const email = announcementEmail(
      { subject: "Planned upkeep", body: "Down for 10 minutes." },
      "accounts",
      branding,
    );
    expect(email.text).toContain("not marketing");
  });

  it("carries a button, a postal address for other copies, and the unsubscribe link", () => {
    const email = withUnsubscribe(
      announcementEmail(
        {
          subject: "Hi",
          body: "Body",
          button: { label: "See it", url: "https://app.example/x" },
        },
        "news",
        { appName: "Acme Studio" },
        { postalAddress: "1 Main St, Springfield" },
      ),
      "https://dash.example/email/news/unsubscribe?token=t",
    );
    expect(email.html).toContain("https://app.example/x");
    expect(email.text).toContain("1 Main St, Springfield");
    expect(email.html).toContain("Unsubscribe");
    expect(email.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("asks a website sign-up to confirm before anything else", () => {
    const email = confirmNewsEmail(
      { url: "https://dash.example/email/news/confirm?t=1" },
      branding,
    );
    expect(email.subject).toBe("Confirm you want Takewon product news");
    expect(email.html).toContain("https://dash.example/email/news/confirm?t=1");
  });
});

describe("sendBatch", () => {
  const message = { to: "a@example.com", subject: "Hi", text: "Hello", html: "<p>Hello</p>" };

  it("sends up to 100 in one call and reads each outcome", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          results: [
            { status: "success", message_id: "m1" },
            { status: "error", message: "Bad address" },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch);
    const result = await sendBatch("tsend_key", { email: "news@takewon.com", name: "Takewon" }, [
      message,
      { ...message, to: "b@example.com", headers: { "List-Unsubscribe": "<https://x>" } },
    ]);
    expect(calls[0].url).toBe("https://api.tosend.com/v2/emails/batch");
    const sent = calls[0].body as { emails: { to: { email: string }[]; headers?: object }[] };
    expect(sent.emails.map((email) => email.to[0].email)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    expect(sent.emails[1].headers).toEqual({ "List-Unsubscribe": "<https://x>" });
    expect(result).toEqual({
      ok: true,
      results: [
        { ok: true, messageId: "m1" },
        { ok: false, detail: "Bad address" },
      ],
    });
  });

  it("reports a refused call without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      (async () =>
        new Response(JSON.stringify({ message: "Subscription required" }), {
          status: 402,
        })) as unknown as typeof fetch,
    );
    const result = await sendBatch("tsend_key", { email: "news@takewon.com" }, [message]);
    expect(result).toMatchObject({ ok: false, reason: "billing" });
  });
});
