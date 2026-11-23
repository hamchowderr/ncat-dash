import { afterEach, describe, expect, test } from "vitest";

import { api, components, internal } from "./_generated/api";
import { INVITE_ONLY_MESSAGE, signUpsMode } from "./lib/signUps";
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

  test("invite-only works the same on the hosted edition", async () => {
    process.env.SIGN_UPS = "invite-only";
    process.env.NCAT_EDITION = "hosted";
    const t = backend();
    await addPerson(t, "Maya Ortiz", [await addTeam(t, "Salt House")], "owner");
    expect(await t.query(internal.access.signUpRefusal, { email: "stranger@example.test" })).toBe(
      INVITE_ONLY_MESSAGE,
    );
  });
});
