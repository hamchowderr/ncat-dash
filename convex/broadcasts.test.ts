import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

// The operator's own emails: written once, sent a hundred at a time through toSend's
// batch call, each with its own unsubscribe link, and counted on Sent Emails.

type Sent = {
  emails: {
    to: { email: string }[];
    subject: string;
    text: string;
    headers?: Record<string, string>;
  }[];
};
let batches: Sent[] = [];
let singles: { to: { email: string }[]; subject: string }[] = [];
let answer: (emails: Sent["emails"]) => Response;

beforeEach(() => {
  process.env.OPERATOR_EMAILS = "owner@example.test";
  process.env.TOSEND_API_KEY = "tsend_test";
  process.env.EMAIL_FROM = "news@takewon.test";
  batches = [];
  singles = [];
  answer = (emails) =>
    new Response(
      JSON.stringify({
        results: emails.map((_, index) => ({ status: "success", message_id: `m${index}` })),
      }),
      { status: 200 },
    );
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.endsWith("/v2/emails/batch")) {
      batches.push(body);
      return answer(body.emails);
    }
    singles.push(body);
    return new Response(JSON.stringify({ message_id: "single" }), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const name of ["OPERATOR_EMAILS", "TOSEND_API_KEY", "EMAIL_FROM"]) delete process.env[name];
});

const draft = {
  subject: "New: Best Moments",
  body: "Takewon now finds the best parts of a video.\n\nTry it on your next upload.",
  audience: "news" as const,
};

async function setUp() {
  const t = backend();
  const owner = await addPerson(t, "Owner");
  const customer = await addPerson(t, "Customer");
  return { t, owner, customer };
}

async function subscribe(t: ReturnType<typeof backend>, emails: string[]) {
  for (const email of emails) {
    await t.mutation(internal.news.fromSignUp, { userId: `user-${email}`, email });
  }
}

async function run(t: ReturnType<typeof backend>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

const broadcast = (t: ReturnType<typeof backend>, id: Id<"broadcasts">) =>
  t.run((ctx) => ctx.db.get(id));

describe("sending an email", () => {
  test("only the operator can, and an empty subject or a bad button is refused", async () => {
    const { owner, customer } = await setUp();
    await expect(customer.as.mutation(api.broadcasts.create, { draft })).rejects.toThrow(
      /operator/,
    );
    await expect(
      owner.as.mutation(api.broadcasts.create, { draft: { ...draft, subject: " " } }),
    ).rejects.toThrow(/subject/);
    await expect(
      owner.as.mutation(api.broadcasts.create, {
        draft: { ...draft, button: { label: "See", url: "javascript:alert(1)" } },
      }),
    ).rejects.toThrow(/https/);
  });

  test("goes to everyone who asked for product news, each with their own unsubscribe link", async () => {
    vi.useFakeTimers();
    const { t, owner } = await setUp();
    await subscribe(t, ["a@example.com", "b@example.com", "c@example.com"]);
    // Someone whose earlier email bounced for good is skipped.
    await t.mutation(internal.email.recordProblem, {
      email: "c@example.com",
      kind: "bounced",
      permanent: true,
      reason: "no such user",
      at: Date.now(),
    });
    // And someone who stopped gets nothing.
    await t.mutation(internal.news.fromSignUp, { userId: "user-d", email: "d@example.com" });
    const stop = await t.run(async (ctx) => {
      const { withdrawConsent } = await import("./lib/news");
      return withdrawConsent(ctx, { email: "d@example.com", source: "settings" });
    });
    expect(stop).toBe(true);

    const id = await owner.as.mutation(api.broadcasts.create, { draft });
    await run(t);

    expect(batches).toHaveLength(1);
    const emails = batches[0].emails;
    expect(emails.map((email) => email.to[0].email).sort()).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    expect(emails[0].subject).toBe("New: Best Moments");
    expect(emails[0].text).toContain("You get this because you asked for Takewon product news.");
    const links = emails.map((email) => email.headers?.["List-Unsubscribe"]);
    expect(new Set(links).size).toBe(2);
    expect(emails[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    expect(await broadcast(t, id)).toMatchObject({
      status: "sent",
      recipients: 3,
      sent: 2,
      skipped: 1,
      failed: 0,
    });
  });

  test("sends more than 100 people in batches of 100", async () => {
    vi.useFakeTimers();
    const { t, owner } = await setUp();
    await subscribe(
      t,
      Array.from({ length: 150 }, (_, index) => `p${index}@example.com`),
    );
    const id = await owner.as.mutation(api.broadcasts.create, { draft });
    await run(t);
    expect(batches.map((batch) => batch.emails.length).sort()).toEqual([100, 50]);
    expect(await broadcast(t, id)).toMatchObject({ status: "sent", sent: 150 });
  });

  test("an account notice goes to every account and says it isn't marketing", async () => {
    vi.useFakeTimers();
    const { t, owner } = await setUp();
    const id = await owner.as.mutation(api.broadcasts.create, {
      draft: { ...draft, subject: "Planned upkeep", audience: "accounts" },
    });
    await run(t);
    const emails = batches[0].emails;
    expect(emails.map((email) => email.to[0].email).sort()).toEqual([
      "customer@example.test",
      "owner@example.test",
    ]);
    expect(emails[0].text).toContain("not marketing");
    expect((await broadcast(t, id))?.sent).toBe(2);
  });

  test("trial and paying teams reach the people on those teams", async () => {
    vi.useFakeTimers();
    const { t, owner } = await setUp();
    const trial = await addTeam(t, "Trial Studio");
    const paid = await addTeam(t, "Paid Studio");
    await addPerson(t, "Tia", [trial], "owner");
    await addPerson(t, "Pat", [paid], "owner");
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("teamTrials", {
        organizationId: trial,
        startedAt: now,
        endsAt: now + 86_400_000,
      });
      await ctx.db.insert("teamTrials", {
        organizationId: paid,
        startedAt: now - 10 * 86_400_000,
        endsAt: now - 7 * 86_400_000,
        paidAt: now - 8 * 86_400_000,
      });
    });
    await owner.as.mutation(api.broadcasts.create, {
      draft: { ...draft, audience: "trial_teams" },
    });
    await run(t);
    expect(batches[0].emails.map((email) => email.to[0].email)).toEqual(["tia@example.test"]);
    const counts = await owner.as.query(api.broadcasts.audiences, {});
    expect(counts.counts).toMatchObject({ trial_teams: 1, paid_teams: 1, accounts: 4 });
  });

  test("a refused batch is marked failed, with toSend's reason", async () => {
    vi.useFakeTimers();
    const { t, owner } = await setUp();
    await subscribe(t, ["a@example.com"]);
    answer = () =>
      new Response(JSON.stringify({ message: "Subscription required" }), { status: 402 });
    const id = await owner.as.mutation(api.broadcasts.create, { draft });
    await run(t);
    expect(await broadcast(t, id)).toMatchObject({ status: "failed", failed: 1, sent: 0 });
    const details = await owner.as.query(api.broadcasts.get, { broadcastId: id });
    expect(details?.failures[0].detail).toMatch(/Subscription required/);
  });

  test("a later bounce, complaint and unsubscribe are counted against it", async () => {
    vi.useFakeTimers();
    const { t, owner } = await setUp();
    await subscribe(t, ["a@example.com", "b@example.com", "c@example.com"]);
    const id = await owner.as.mutation(api.broadcasts.create, { draft });
    await run(t);
    await t.mutation(internal.email.recordProblem, {
      email: "a@example.com",
      kind: "bounced",
      permanent: true,
      reason: "gone",
      at: Date.now(),
    });
    await t.mutation(internal.email.recordProblem, {
      email: "b@example.com",
      kind: "complaint",
      permanent: true,
      reason: "spam",
      at: Date.now(),
    });
    const link = batches[0].emails
      .find((email) => email.to[0].email === "c@example.com")!
      .headers!["List-Unsubscribe"].slice(1, -1);
    const token = new URL(link).searchParams.get("token")!;
    await t.mutation(internal.news.unsubscribe, { token });
    expect(await broadcast(t, id)).toMatchObject({ bounced: 1, complaints: 1, unsubscribed: 1 });
  });
});

describe("booking for later", () => {
  test("waits for its time and can be called off", async () => {
    const { t, owner } = await setUp();
    const at = Date.now() + 3_600_000;
    const id = await owner.as.mutation(api.broadcasts.create, { draft, sendAt: at });
    expect(await broadcast(t, id)).toMatchObject({ status: "scheduled", scheduledFor: at });
    const job = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).find(
        (entry) => entry.name === "broadcasts:begin",
      ),
    );
    expect(job?.scheduledTime).toBe(at);
    expect(await owner.as.mutation(api.broadcasts.cancel, { broadcastId: id })).toBe(true);
    expect((await broadcast(t, id))?.status).toBe("cancelled");
    const list = await owner.as.query(api.broadcasts.list, {});
    expect(list.map((row) => row.status)).toEqual(["cancelled"]);
  });

  test("refuses a time that has passed", async () => {
    const { owner } = await setUp();
    await expect(
      owner.as.mutation(api.broadcasts.create, { draft, sendAt: Date.now() - 3_600_000 }),
    ).rejects.toThrow(/passed/);
  });
});

describe("a test email and the preview", () => {
  test("a test goes to me only, marked [Test]", async () => {
    const { owner } = await setUp();
    expect(await owner.as.action(api.broadcasts.sendTest, { draft })).toEqual({
      ok: true,
      to: "owner@example.test",
    });
    expect(singles).toHaveLength(1);
    expect(singles[0].to[0].email).toBe("owner@example.test");
    expect(singles[0].subject).toBe("[Test] New: Best Moments");
  });

  test("the preview is the email itself, with an unsubscribe link", async () => {
    const { owner } = await setUp();
    const preview = await owner.as.query(api.broadcasts.preview, { draft });
    expect(preview.html).toContain("Try it on your next upload.");
    expect(preview.html).toContain("Unsubscribe");
  });
});
