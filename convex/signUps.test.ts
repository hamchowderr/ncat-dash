import { afterEach, describe, expect, test } from "vitest";

import { api, components, internal } from "./_generated/api";
import { BETA_FORM_URL, CLOSED_BETA_MESSAGE, INVITE_ONLY_MESSAGE, signUpsMode } from "./lib/signUps";
import { addPerson, addTeam, backend } from "./test.setup";

// A self-hosted copy is reachable by anyone who has its address. With SIGN_UPS=invite-only
// only its owner (the first account) and people invited to a team can make an account.
afterEach(() => {
  delete process.env.SIGN_UPS;
  delete process.env.NCAT_EDITION;
});

const DAY = 24 * 60 * 60 * 1000;

async function invite(
  t: ReturnType<typeof backend>,
  organizationId: string,
  inviterId: string,
  email: string,
  { status = "pending", expiresAt = Date.now() + DAY } = {},
) {
  await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "invitation",
        data: {
          organizationId,
          email,
          role: "member",
          status,
          expiresAt,
          createdAt: Date.now(),
          inviterId,
        },
      } as never,
    }),
  );
}

describe("who may make an account", () => {
  test("open unless the owner sets invite-only", () => {
    expect(signUpsMode({})).toBe("open");
    expect(signUpsMode({ SIGN_UPS: "open" })).toBe("open");
    expect(signUpsMode({ SIGN_UPS: "invite-only" })).toBe("invite-only");
    expect(signUpsMode({ SIGN_UPS: " Invite-Only " })).toBe("invite-only");
  });

  test("open: anyone may, even with accounts already made", async () => {
    const t = backend();
    await addPerson(t, "Maya Ortiz", [await addTeam(t, "Salt House")], "owner");
    expect(
      await t.query(internal.access.signUpRefusal, { email: "stranger@example.test" }),
    ).toBeNull();
    expect((await t.query(api.settings.get, {})).inviteOnly).toBe(false);
  });

  test("invite-only: the very first account, the owner's, is always allowed", async () => {
    process.env.SIGN_UPS = "invite-only";
    const t = backend();
    expect(
      await t.query(internal.access.signUpRefusal, { email: "owner@example.test" }),
    ).toBeNull();
    // Nobody needs an invitation yet, so the page does not say so.
    expect((await t.query(api.settings.get, {})).inviteOnly).toBe(false);
  });

  test("invite-only: after that, a stranger is refused and told why", async () => {
    process.env.SIGN_UPS = "invite-only";
    const t = backend();
    await addPerson(t, "Maya Ortiz", [await addTeam(t, "Salt House")], "owner");
    expect(await t.query(internal.access.signUpRefusal, { email: "stranger@example.test" })).toBe(
      INVITE_ONLY_MESSAGE,
    );
    expect((await t.query(api.settings.get, {})).inviteOnly).toBe(true);
  });

  test("invite-only: someone with an open invitation may, however they type their address", async () => {
    process.env.SIGN_UPS = "invite-only";
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
    await invite(t, team, maya.id, "jo@studio.example");
    expect(await t.query(internal.access.signUpRefusal, { email: "jo@studio.example" })).toBeNull();
    expect(
      await t.query(internal.access.signUpRefusal, { email: " Jo@Studio.Example " }),
    ).toBeNull();
  });

  test("invite-only: an expired, cancelled or used invitation does not count", async () => {
    process.env.SIGN_UPS = "invite-only";
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
    await invite(t, team, maya.id, "late@studio.example", { expiresAt: Date.now() - 1000 });
    await invite(t, team, maya.id, "gone@studio.example", { status: "canceled" });
    await invite(t, team, maya.id, "done@studio.example", { status: "accepted" });
    for (const email of ["late@studio.example", "gone@studio.example", "done@studio.example"]) {
      expect(await t.query(internal.access.signUpRefusal, { email })).toBe(INVITE_ONLY_MESSAGE);
    }
  });

  test("on the hosted Takewon, a stranger is sent to the beta form instead", async () => {
    process.env.SIGN_UPS = "invite-only";
    process.env.NCAT_EDITION = "hosted";
    const t = backend();
    await addPerson(t, "Maya Ortiz", [await addTeam(t, "Salt House")], "owner");
    expect(await t.query(internal.access.signUpRefusal, { email: "stranger@example.test" })).toBe(
      CLOSED_BETA_MESSAGE,
    );
    expect(CLOSED_BETA_MESSAGE).toMatch(/takewon\.com/);
    const settings = await t.query(api.settings.get, {});
    expect(settings.inviteOnly).toBe(true);
    expect(settings.betaFormUrl).toBe(BETA_FORM_URL);
  });

  test("a self-hosted copy never points at the beta form", async () => {
    process.env.SIGN_UPS = "invite-only";
    const t = backend();
    await addPerson(t, "Maya Ortiz", [await addTeam(t, "Salt House")], "owner");
    expect((await t.query(api.settings.get, {})).betaFormUrl).toBeNull();
  });

  test("open sign-ups never point at the beta form", async () => {
    process.env.NCAT_EDITION = "hosted";
    const t = backend();
    await addPerson(t, "Maya Ortiz", [await addTeam(t, "Salt House")], "owner");
    expect((await t.query(api.settings.get, {})).betaFormUrl).toBeNull();
  });
});

describe("beta testers on an invite-only copy", () => {
  async function tester(t: ReturnType<typeof backend>, email: string, status: "applied" | "invited") {
    await t.run((ctx) =>
      ctx.db.insert("betaTesters", {
        email,
        name: "Jo Park",
        answers: [],
        newsletter: false,
        status,
        timesApplied: 1,
        appliedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
  }

  test("someone invited from Admin, Beta Testers may make their account, however they type it", async () => {
    process.env.SIGN_UPS = "invite-only";
    process.env.NCAT_EDITION = "hosted";
    const t = backend();
    await addPerson(t, "Maya Ortiz", [await addTeam(t, "Salt House")], "owner");
    await tester(t, "jo@studio.example", "invited");
    expect(await t.query(internal.access.signUpRefusal, { email: "jo@studio.example" })).toBeNull();
    expect(
      await t.query(internal.access.signUpRefusal, { email: " Jo@Studio.Example " }),
    ).toBeNull();
  });

  test("someone who only filled in the beta form waits for the invite", async () => {
    process.env.SIGN_UPS = "invite-only";
    process.env.NCAT_EDITION = "hosted";
    const t = backend();
    await addPerson(t, "Maya Ortiz", [await addTeam(t, "Salt House")], "owner");
    await tester(t, "jo@studio.example", "applied");
    expect(await t.query(internal.access.signUpRefusal, { email: "jo@studio.example" })).toBe(
      CLOSED_BETA_MESSAGE,
    );
  });
});
