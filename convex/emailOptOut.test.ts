import { createHmac } from "node:crypto";
import { afterEach, describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import { readUnsubscribeToken, unsubscribeToken, unsubscribeUrl } from "./lib/unsubscribe";
import { addPerson, addTeam, backend } from "./test.setup";

// One-click unsubscribe on alert and summary emails, and what toSend tells us about
// addresses that bounce or mark us as spam.

afterEach(() => {
  delete process.env.TOSEND_WEBHOOK_SECRET;
});

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const settings = () => maya.as.query(api.notifications.get, { organizationId: team });
  const emailOn = async (kind: string) =>
    (await settings()).kinds.find((entry) => entry.kind === kind)?.email;
  return { t, team, maya, settings, emailOn };
}

describe("unsubscribe links", () => {
  test("carry one person, team and kind, and refuse anything we did not sign", async () => {
    backend(); // sets the signing secret
    const token = await unsubscribeToken({ userId: "u1", organizationId: "o1", scope: "mention" });
    expect(await readUnsubscribeToken(token)).toEqual({
      userId: "u1",
      organizationId: "o1",
      scope: "mention",
    });
    const [payload] = token.split(".");
    expect(await readUnsubscribeToken(`${payload}.forged`)).toBeNull();
    expect(await readUnsubscribeToken("nonsense")).toBeNull();
    expect(unsubscribeUrl(token)).toMatch(/\/email\/unsubscribe\?token=/);
  });

  test("opening one changes nothing; the button switches just that email off", async () => {
    const { t, team, maya, emailOn } = await setUp();
    const token = await unsubscribeToken({
      userId: maya.id,
      organizationId: team,
      scope: "run_failed",
    });
    const page = await t.fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<form method="post">');
    expect(await emailOn("run_failed")).toBe(true);

    const done = await t.fetch("/email/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    expect(await done.text()).toContain("You're unsubscribed");
    expect(await emailOn("run_failed")).toBe(false);
    expect(await emailOn("mention")).toBe(true);
  });

  test("a mail app's one-click button works with the link alone", async () => {
    const { t, team, maya, emailOn } = await setUp();
    const token = await unsubscribeToken({ userId: maya.id, organizationId: team, scope: "all" });
    const done = await t.fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(done.status).toBe(200);
    expect(await emailOn("run_failed")).toBe(false);
    expect(await emailOn("approval_waiting")).toBe(false);

    const forged = await t.fetch("/email/unsubscribe?token=abc.def", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(forged.status).toBe(400);
  });
});

describe("bounces and spam complaints", () => {
  const sign = (body: string) =>
    `sha256=${createHmac("sha256", "whsec").update(body).digest("hex")}`;
  const post = (t: ReturnType<typeof backend>, body: string, signature = sign(body)) =>
    t.fetch("/email/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ToSend-Signature": signature },
      body,
    });

  test("is off until a webhook secret is set, and refuses unsigned events", async () => {
    const { t } = await setUp();
    const body = JSON.stringify({ type: "bounced", data: { email: "a@b.test" } });
    expect((await post(t, body)).status).toBe(404);
    process.env.TOSEND_WEBHOOK_SECRET = "whsec";
    expect((await post(t, body, "sha256=00")).status).toBe(401);
  });

  test("tells a person when emails to them bounce for good, not for a full inbox", async () => {
    process.env.TOSEND_WEBHOOK_SECRET = "whsec";
    const { t, settings } = await setUp();
    const soft = JSON.stringify({
      type: "bounced",
      data: { email: "Maya.Ortiz@example.test", is_hard_bounce: false, reason: "mailbox full" },
    });
    expect((await post(t, soft)).status).toBe(200);
    expect((await settings()).emailProblem).toBeNull();

    const hard = JSON.stringify({
      type: "bounced",
      data: {
        email: "maya.ortiz@example.test",
        is_hard_bounce: true,
        reason: "smtp; 550 5.1.1 no such user",
        timestamp: "2026-11-23T10:00:00.000Z",
      },
    });
    expect((await post(t, hard)).status).toBe(200);
    expect((await settings()).emailProblem).toEqual({
      email: "maya.ortiz@example.test",
      kind: "bounced",
      at: Date.parse("2026-11-23T10:00:00.000Z"),
    });
  });

  test("ignores toSend's test events", async () => {
    process.env.TOSEND_WEBHOOK_SECRET = "whsec";
    const { t } = await setUp();
    const body = JSON.stringify({
      type: "complaint",
      test: true,
      data: { email: "maya.ortiz@example.test" },
    });
    expect((await post(t, body)).status).toBe(200);
    expect(await t.run((ctx) => ctx.db.query("emailProblems").collect())).toHaveLength(0);
  });
});

describe("who an alert goes to", () => {
  test("lists each person with their id, so each email gets its own unsubscribe link", async () => {
    const { t, team, maya } = await setUp();
    const alertId = await t.run((ctx) =>
      ctx.db.insert("alerts", {
        organizationId: team,
        kind: "run_failed",
        automationName: "Clips",
        message: "No reply",
        retries: 0,
        seenBy: [],
      }),
    );
    const found = await t.query(internal.email.alertRecipients, { alertId });
    expect(found?.people).toEqual([{ email: "maya.ortiz@example.test", userId: maya.id }]);
  });
});
