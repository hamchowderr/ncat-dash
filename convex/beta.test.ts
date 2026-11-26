import { afterEach, describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import { CHECK_IN_AFTER_MS, metAtEvent } from "./beta";
import { hasBetaSecret, readBetaSignUp } from "./lib/betaSignUp";
import { addPerson, backend } from "./test.setup";

// The beta: the website's form lands here, the operator invites, and the row turns
// joined when that address makes an account.

afterEach(() => {
  delete process.env.OPERATOR_EMAILS;
  delete process.env.BETA_SIGNUP_SECRET;
});

const SIGN_UP = {
  email: " Ana.Lopez@Example.com ",
  name: "Ana Lopez",
  source: "The KINN",
  link: "https://instagram.com/ana",
  answers: [
    { question: "What describes you", answer: "Creator" },
    { question: "Makes", answer: "Podcasts, Short-form video" },
  ],
};

const testers = (t: ReturnType<typeof backend>) =>
  t.run((ctx) => ctx.db.query("betaTesters").collect());
const booked = (t: ReturnType<typeof backend>) =>
  t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

describe("a sign-up from the website", () => {
  test("is kept with every answer, waiting for an invite", async () => {
    const t = backend();
    expect(await t.mutation(internal.beta.apply, SIGN_UP)).toBe("ok");
    const [row] = await testers(t);
    expect(row).toMatchObject({
      email: "ana.lopez@example.com",
      name: "Ana Lopez",
      source: "The KINN",
      status: "applied",
      newsletter: false,
      timesApplied: 1,
    });
    expect(row?.answers).toHaveLength(2);
    // No newsletter box ticked: no consent asked for, no email.
    expect(await t.run((ctx) => ctx.db.query("consentRecords").collect())).toEqual([]);
  });

  test("again from the same address updates the answers and keeps one row", async () => {
    const t = backend();
    await t.mutation(internal.beta.apply, SIGN_UP);
    await t.mutation(internal.beta.apply, {
      ...SIGN_UP,
      answers: [{ question: "Makes", answer: "Livestreams" }],
    });
    const rows = await testers(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.timesApplied).toBe(2);
    expect(rows[0]?.answers).toEqual([{ question: "Makes", answer: "Livestreams" }]);
  });

  test("with the news box ticked asks to confirm by email, keeping the words", async () => {
    const t = backend();
    await t.mutation(internal.beta.apply, {
      ...SIGN_UP,
      newsletter: true,
      newsletterWording: "Send me Takewon news now and then.",
      userAgent: "Safari",
    });
    const [record] = await t.run((ctx) => ctx.db.query("consentRecords").collect());
    expect(record).toMatchObject({
      email: "ana.lopez@example.com",
      action: "requested",
      source: "website",
      wording: "Send me Takewon news now and then.",
      userAgent: "Safari",
    });
    expect((await booked(t)).map((job) => job.name)).toContain("broadcasts:sendConfirmation");
  });

  test("refuses an address that isn't one, or no name", async () => {
    const t = backend();
    expect(await t.mutation(internal.beta.apply, { ...SIGN_UP, email: "nope" })).toBe("invalid");
    expect(await t.mutation(internal.beta.apply, { ...SIGN_UP, name: " " })).toBe("invalid");
    expect(await testers(t)).toEqual([]);
  });

  test("from someone who already has an account counts as joined", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await t.mutation(internal.beta.apply, { ...SIGN_UP, email: "maya.ortiz@example.test" });
    const [row] = await testers(t);
    expect(row).toMatchObject({ status: "joined", userId: maya.id });
  });
});

describe("the endpoint the website posts to", () => {
  test("needs the shared secret", async () => {
    process.env.BETA_SIGNUP_SECRET = "a-long-shared-secret-123";
    expect(await hasBetaSecret("Bearer a-long-shared-secret-123")).toBe(true);
    expect(await hasBetaSecret("Bearer a-long-shared-secret-124")).toBe(false);
    expect(await hasBetaSecret(null)).toBe(false);
    delete process.env.BETA_SIGNUP_SECRET;
    expect(await hasBetaSecret("Bearer a-long-shared-secret-123")).toBe(false);
  });

  test("keeps only fields of the right shape", () => {
    expect(
      readBetaSignUp({
        email: "a@b.co",
        name: "A",
        answers: [{ question: "Q", answer: "A" }, { question: 3 }, "junk"],
        newsletter: "yes",
      }),
    ).toEqual({ email: "a@b.co", name: "A", answers: [{ question: "Q", answer: "A" }] });
    expect(readBetaSignUp("nope")).toBeNull();
  });

  test("answers 401 without the secret and 200 with it", async () => {
    process.env.BETA_SIGNUP_SECRET = "a-long-shared-secret-123";
    const t = backend();
    const post = (authorization?: string) =>
      t.fetch("/beta/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body: JSON.stringify(SIGN_UP),
      });
    expect((await post()).status).toBe(401);
    expect((await post("Bearer wrong-but-long-enough")).status).toBe(401);
    const ok = await post("Bearer a-long-shared-secret-123");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ outcome: "ok" });
    expect(await testers(t)).toHaveLength(1);
  });
});

describe("the Beta Testers page", () => {
  test("is for the operator only; inviting books the email, joining marks the row", async () => {
    process.env.OPERATOR_EMAILS = "owner@example.test";
    const t = backend();
    const owner = await addPerson(t, "Owner");
    const customer = await addPerson(t, "Customer");
    await t.mutation(internal.beta.apply, SIGN_UP);
    const [row] = await testers(t);

    await expect(customer.as.query(api.beta.counts, {})).rejects.toThrow(/operator/);
    await expect(customer.as.mutation(api.beta.invite, { testerIds: [row!._id] })).rejects.toThrow(
      /operator/,
    );
    expect(await owner.as.query(api.beta.counts, {})).toEqual({ applied: 1, invited: 0, joined: 0 });
    const found = await owner.as.query(api.beta.list, {
      search: "ana",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(found.page.map((one) => one.name)).toEqual(["Ana Lopez"]);

    expect(await owner.as.mutation(api.beta.invite, { testerIds: [row!._id] })).toBe(1);
    expect((await owner.as.query(api.beta.get, { testerId: row!._id }))?.status).toBe("invited");
    expect((await booked(t)).map((job) => job.name)).toContain("email:sendBetaInvite");
    expect(await t.query(internal.beta.inviteFor, { testerId: row!._id })).toEqual({
      email: "ana.lopez@example.com",
      name: "Ana Lopez",
      metAt: "The KINN",
    });

    expect(
      await t.mutation(internal.beta.joined, { userId: "user_ana", email: "ANA.lopez@example.com" }),
    ).toBe(true);
    const joined = await owner.as.query(api.beta.get, { testerId: row!._id });
    expect(joined).toMatchObject({ status: "joined", userId: "user_ana" });
    const checkIn = (await booked(t)).find((job) => job.name === "email:sendBetaCheckIn");
    expect(checkIn?.scheduledTime).toBeGreaterThanOrEqual(Date.now() + CHECK_IN_AFTER_MS - 60_000);

    // Joined people aren't invited again.
    expect(await owner.as.mutation(api.beta.invite, { testerIds: [row!._id] })).toBe(0);
  });

  test("someone not on the list making an account changes nothing", async () => {
    const t = backend();
    expect(await t.mutation(internal.beta.joined, { userId: "u1", email: "x@example.com" })).toBe(
      false,
    );
  });
});

describe("the check-in", () => {
  test("knows whether a video went through, and goes once", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await t.mutation(internal.beta.apply, { ...SIGN_UP, email: "maya.ortiz@example.test" });
    const [row] = await testers(t);
    expect(await t.query(internal.beta.checkInFor, { testerId: row!._id })).toEqual({
      email: "maya.ortiz@example.test",
      name: "Ana Lopez",
      uploaded: false,
    });
    await t.mutation(internal.beta.markCheckIn, { testerId: row!._id });
    expect(await t.query(internal.beta.checkInFor, { testerId: row!._id })).toBeNull();
    expect(maya.id).toBeTruthy();
  });
});

describe("where they met", () => {
  test("only an event counts as meeting", () => {
    expect(metAtEvent("The KINN")).toBe("The KINN");
    expect(metAtEvent("a16z Tech Week Los Angeles")).toBe("a16z Tech Week Los Angeles");
    expect(metAtEvent("Claude Code Creators Summit")).toBe("Claude Code Creators Summit");
    expect(metAtEvent("Chowderr's socials")).toBeUndefined();
    expect(metAtEvent("A friend or colleague")).toBeUndefined();
  });
});
