import { afterEach, describe, expect, test, vi } from "vitest";

import { internal } from "./_generated/api";
import { backOfficeWebhook, contactUpdate } from "./lib/backOffice";
import { addPerson, addTeam, backend } from "./test.setup";

// The business's Back Office: FluentCRM's incoming webhook hears who signed up, whose team
// is on a free trial and whose team has bought.
const HOOK = "https://hub.takewon.example/?fluentcrm=1&route=contact&hash=abc";

afterEach(() => {
  delete process.env.BACK_OFFICE_WEBHOOK_URL;
  delete process.env.NCAT_EDITION;
  delete process.env.TRIAL_DAYS;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function listen(answer: () => Response = () => Response.json({ success: true })) {
  const posted: { url: string; body: Record<string, unknown>; redirect?: string }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    posted.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      redirect: init?.redirect,
    });
    return answer();
  });
  return posted;
}

describe("the webhook address", () => {
  test("only an https:// address is used", () => {
    expect(backOfficeWebhook({})).toBeNull();
    expect(backOfficeWebhook({ BACK_OFFICE_WEBHOOK_URL: "  " })).toBeNull();
    expect(backOfficeWebhook({ BACK_OFFICE_WEBHOOK_URL: "http://hub.example/?hash=1" })).toBeNull();
    expect(backOfficeWebhook({ BACK_OFFICE_WEBHOOK_URL: "not a url" })).toBeNull();
    expect(backOfficeWebhook({ BACK_OFFICE_WEBHOOK_URL: ` ${HOOK} ` })).toBe(HOOK);
  });
});

describe("what each event sends", () => {
  const maya = { email: " Maya@Studio.Example ", name: "Maya  de la Cruz" };
  test("a sign-up is a contact with a name and no tags", () => {
    expect(contactUpdate("signedUp", maya)).toEqual({
      email: "maya@studio.example",
      first_name: "Maya",
      last_name: "de la Cruz",
    });
  });
  test("a trial tags Trial; paying swaps it for Customer", () => {
    expect(contactUpdate("trialStarted", maya).tags).toEqual(["Trial"]);
    const paid = contactUpdate("paid", maya);
    expect(paid.tags).toEqual(["Customer"]);
    expect(paid.detach_tags).toEqual(["Trial"]);
  });
  test("an empty name is left out", () => {
    expect(contactUpdate("signedUp", { email: "a@b.example", name: " " })).toEqual({
      email: "a@b.example",
    });
  });
});

describe("telling the Back Office", () => {
  test("a trial and a purchase reach the webhook, by tag", async () => {
    vi.useFakeTimers();
    process.env.BACK_OFFICE_WEBHOOK_URL = HOOK;
    process.env.NCAT_EDITION = "hosted";
    const posted = listen();
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
    await t.mutation(internal.trial.begin, { organizationId: team, ownerId: maya.id });
    await t.mutation(internal.trial.markPaid, { organizationId: team });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const updates = posted.filter((post) => post.url === HOOK).map((post) => post.body);
    expect(updates).toContainEqual({
      email: "maya.ortiz@example.test",
      first_name: "Maya",
      last_name: "Ortiz",
      tags: ["Trial"],
    });
    expect(updates).toContainEqual({
      email: "maya.ortiz@example.test",
      first_name: "Maya",
      last_name: "Ortiz",
      tags: ["Customer"],
      detach_tags: ["Trial"],
    });
    expect(posted.every((post) => post.redirect === "error")).toBe(true);
  });

  test("a sign-up is sent; nothing goes out while no address is set", async () => {
    vi.useFakeTimers();
    const posted = listen();
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await t.mutation(internal.backOffice.tell, { event: "signedUp", userId: maya.id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(posted).toHaveLength(0);

    process.env.BACK_OFFICE_WEBHOOK_URL = HOOK;
    await t.mutation(internal.backOffice.tell, { event: "signedUp", userId: maya.id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(posted.map((post) => post.body)).toEqual([
      { email: "maya.ortiz@example.test", first_name: "Maya", last_name: "Ortiz" },
    ]);
  });

  test("an update FluentCRM turns away is tried again", async () => {
    vi.useFakeTimers();
    process.env.BACK_OFFICE_WEBHOOK_URL = HOOK;
    let calls = 0;
    const posted = listen(() =>
      ++calls < 3
        ? Response.json({ success: false }, { status: 500 })
        : Response.json({ success: true }),
    );
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await t.mutation(internal.backOffice.tell, { event: "signedUp", userId: maya.id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(posted).toHaveLength(3);
  });
});
