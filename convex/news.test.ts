import { afterEach, describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import { forgetNews, SIGN_UP_WORDING, SETTINGS_WORDING, WEBSITE_WORDING } from "./lib/news";
import { newsToken } from "./lib/newsToken";
import { addPerson, backend } from "./test.setup";

// Product news consent: an unticked box at sign-up, a switch in Settings, a website box
// that confirms by email, one-click unsubscribe, and a record of every change.

afterEach(() => {
  delete process.env.OPERATOR_EMAILS;
  delete process.env.NEWS_SIGNUP_ORIGINS;
});

const records = (t: ReturnType<typeof backend>) =>
  t.run((ctx) => ctx.db.query("consentRecords").collect());
const subscriber = (t: ReturnType<typeof backend>, email: string) =>
  t.run((ctx) =>
    ctx.db
      .query("subscribers")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first(),
  );

describe("my product news", () => {
  test("is off until I switch it on, and each change is kept with its words", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    expect((await maya.as.query(api.news.mine, {})).subscribed).toBe(false);

    await maya.as.mutation(api.news.setMine, { subscribed: true });
    const on = await maya.as.query(api.news.mine, {});
    expect(on.subscribed).toBe(true);
    expect(on.since).toBeTypeOf("number");

    await maya.as.mutation(api.news.setMine, { subscribed: false });
    expect((await maya.as.query(api.news.mine, {})).subscribed).toBe(false);
    expect((await records(t)).map((row) => [row.action, row.source, row.wording])).toEqual([
      ["given", "settings", SETTINGS_WORDING],
      ["withdrawn", "settings", SETTINGS_WORDING],
    ]);
  });

  test("a ticked box at sign-up subscribes, with the words beside it", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await t.mutation(internal.news.fromSignUp, {
      userId: maya.id,
      email: "Maya.Ortiz@example.test",
      networkKey: "net_abc",
      userAgent: "Firefox",
    });
    expect((await maya.as.query(api.news.mine, {})).subscribed).toBe(true);
    const [row] = await records(t);
    expect(row).toMatchObject({
      email: "maya.ortiz@example.test",
      action: "given",
      source: "signup",
      wording: SIGN_UP_WORDING,
      networkKey: "net_abc",
      userAgent: "Firefox",
    });
  });
});

describe("the website's newsletter box", () => {
  test("waits for the emailed confirmation before anything is sent (double opt-in)", async () => {
    const t = backend();
    expect(await t.mutation(internal.news.requestFromWebsite, { email: " Ana@Example.com " })).toBe(
      "ok",
    );
    expect((await subscriber(t, "ana@example.com"))?.status).toBe("pending");
    const booked = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(booked.map((job) => job.name)).toContain("broadcasts:sendConfirmation");

    const token = await newsToken({
      purpose: "confirm",
      email: "ana@example.com",
      issuedAt: Date.now(),
    });
    expect(await t.mutation(internal.news.confirm, { token })).toBe("ana@example.com");
    expect((await subscriber(t, "ana@example.com"))?.status).toBe("subscribed");
    expect((await records(t)).map((row) => [row.action, row.source, row.wording])).toEqual([
      ["requested", "website", WEBSITE_WORDING],
      ["given", "website", WEBSITE_WORDING],
    ]);
  });

  test("refuses a bad address, an old link, and a link after unsubscribing", async () => {
    const t = backend();
    expect(await t.mutation(internal.news.requestFromWebsite, { email: "not an email" })).toBe(
      "invalid",
    );
    await t.mutation(internal.news.requestFromWebsite, { email: "ana@example.com" });
    const old = await newsToken({
      purpose: "confirm",
      email: "ana@example.com",
      issuedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    });
    expect(await t.mutation(internal.news.confirm, { token: old })).toBeNull();
    expect(await t.mutation(internal.news.confirm, { token: "made.up" })).toBeNull();

    const fresh = await newsToken({
      purpose: "confirm",
      email: "ana@example.com",
      issuedAt: Date.now(),
    });
    await t.mutation(internal.news.confirm, { token: fresh });
    const stop = await newsToken({ purpose: "unsubscribe", email: "ana@example.com" });
    await t.mutation(internal.news.unsubscribe, { token: stop });
    expect(await t.mutation(internal.news.confirm, { token: fresh })).toBeNull();
    expect((await subscriber(t, "ana@example.com"))?.status).toBe("unsubscribed");
  });

  test("an address that already gets news gets no second confirmation", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await maya.as.mutation(api.news.setMine, { subscribed: true });
    await t.mutation(internal.news.requestFromWebsite, { email: "maya.ortiz@example.test" });
    const booked = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(booked.map((job) => job.name)).not.toContain("broadcasts:sendConfirmation");
  });

  test("takes a plain form post and says to check the inbox; a bot's hidden field does nothing", async () => {
    const t = backend();
    const form = (fields: Record<string, string>) =>
      t.fetch("/email/news/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      });
    const answer = await form({ email: "ana@example.com" });
    expect(await answer.text()).toContain("Check your inbox");
    await form({ email: "bot@example.com", website: "http://spam" });
    expect(await subscriber(t, "bot@example.com")).toBeNull();
    expect((await subscriber(t, "ana@example.com"))?.status).toBe("pending");
  });

  test("answers a browser on an allowed site with CORS, and no one else", async () => {
    process.env.NEWS_SIGNUP_ORIGINS = "https://takewon.com";
    const t = backend();
    const call = (origin: string) =>
      t.fetch("/email/news/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ email: "ana@example.com" }),
      });
    const ok = await call("https://takewon.com");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://takewon.com");
    const other = await call("https://elsewhere.example");
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await t.fetch("/email/news/subscribe", {
      method: "OPTIONS",
      headers: { Origin: "https://elsewhere.example" },
    });
    expect(preflight.status).toBe(403);
  });
});

describe("unsubscribing from product news", () => {
  test("opening the link changes nothing; the button and one-click do", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await maya.as.mutation(api.news.setMine, { subscribed: true });
    const token = await newsToken({ purpose: "unsubscribe", email: "maya.ortiz@example.test" });
    const page = await t.fetch(`/email/news/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(await page.text()).toContain("Unsubscribe");
    expect((await maya.as.query(api.news.mine, {})).subscribed).toBe(true);

    const oneClick = await t.fetch(`/email/news/unsubscribe?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(oneClick.status).toBe(200);
    expect((await maya.as.query(api.news.mine, {})).subscribed).toBe(false);
    expect((await records(t)).at(-1)).toMatchObject({
      action: "withdrawn",
      source: "unsubscribe_link",
    });
  });

  test("a spam complaint stops product news", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await maya.as.mutation(api.news.setMine, { subscribed: true });
    await t.mutation(internal.email.recordProblem, {
      email: "maya.ortiz@example.test",
      kind: "complaint",
      permanent: true,
      reason: "abuse",
      at: Date.now(),
    });
    expect((await maya.as.query(api.news.mine, {})).subscribed).toBe(false);
    expect((await records(t)).at(-1)).toMatchObject({ action: "withdrawn", source: "complaint" });
  });

  test("deleting an account removes its subscription and records", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await maya.as.mutation(api.news.setMine, { subscribed: true });
    await t.run((ctx) => forgetNews(ctx, { userId: maya.id, email: "maya.ortiz@example.test" }));
    expect(await subscriber(t, "maya.ortiz@example.test")).toBeNull();
    expect(await records(t)).toEqual([]);
  });
});

describe("the Subscribers page", () => {
  test("is for the operator only, and finds addresses by how they start", async () => {
    process.env.OPERATOR_EMAILS = "owner@example.test";
    const t = backend();
    const owner = await addPerson(t, "Owner");
    const customer = await addPerson(t, "Customer");
    await customer.as.mutation(api.news.setMine, { subscribed: true });
    await t.mutation(internal.news.requestFromWebsite, { email: "ana@example.com" });

    await expect(customer.as.query(api.news.counts, {})).rejects.toThrow(/operator/);
    expect(await owner.as.query(api.news.counts, {})).toEqual({
      subscribed: 1,
      pending: 1,
      unsubscribed: 0,
    });
    const found = await owner.as.query(api.news.list, {
      search: "Cust",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(found.page.map((row) => row.email)).toEqual(["customer@example.test"]);
    const pending = await owner.as.query(api.news.list, {
      status: "pending",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(pending.page.map((row) => row.email)).toEqual(["ana@example.com"]);

    expect(await owner.as.mutation(api.news.stopFor, { email: "customer@example.test" })).toBe(
      true,
    );
    const history = await owner.as.query(api.news.history, { email: "customer@example.test" });
    expect(history.map((row) => [row.action, row.source])).toEqual([
      ["withdrawn", "operator"],
      ["given", "settings"],
    ]);
  });
});
