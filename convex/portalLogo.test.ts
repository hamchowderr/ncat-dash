import { uploadRef } from "@ncat-dash/automation-core";
import { afterEach, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

// Found while recording the explainer videos (2026-11-22): a portal visitor is not signed
// in, so an uploaded logo never showed and the portal fell back to the letter mark.
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
let current: ReturnType<typeof backend> | null = null;
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await current?.finishInProgressScheduledFunctions();
  current = null;
  toolkit?.restore();
  toolkit = null;
});

async function upload(
  t: ReturnType<typeof backend>,
  person: Awaited<ReturnType<typeof addPerson>>,
  team: string,
  fileName: string,
) {
  const started = await person.as.action(api.storage.startUpload, {
    organizationId: team,
    fileName,
    contentType: "image/png",
    size: 2000,
    purpose: "brand",
  });
  await t.run((ctx) => ctx.db.patch(started.uploadId as Id<"uploads">, { status: "ready" }));
  return started.uploadId as Id<"uploads">;
}

async function agency() {
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  toolkit = fakeToolkitStorage();
  const t = backend();
  current = t;
  const team = await addTeam(t, "Northlight Media");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  await connectToolkit(t, team, owner.id);
  const acme = await owner.as.mutation(api.clients.create, { organizationId: team, name: "Acme" });
  const token = await owner.as.mutation(api.portal.set, {
    clientId: acme,
    allowVerdict: true,
    showTeamComments: false,
  });
  return { t, team, owner, acme, token };
}

async function setLogo(owner: Awaited<ReturnType<typeof addPerson>>, team: string, logo: string) {
  await owner.as.mutation(api.teamSettings.setBrand, { organizationId: team, brand: { logo } });
}

describe("the agency's uploaded logo in a client's portal", () => {
  test("shows to a visitor who is not signed in, through the portal's link", async () => {
    const { t, team, owner, token } = await agency();
    const logo = await upload(t, owner, team, "Northlight.png");
    await setLogo(owner, team, uploadRef(logo));
    const key = (await t.run((ctx) => ctx.db.get(logo)))!.key;

    const view = await t.query(api.portal.view, { token });
    expect(view?.agency.logo).toBe(uploadRef(logo));
    const link = await t.action(api.portal.logoLink, { token });
    expect(link).toEqual(expect.any(String));
    expect(decodeURIComponent(new URL(link!).pathname)).toContain(key);
  });

  test("the portal's link opens only the logo, and the rest of storage stays shut", async () => {
    const { t, team, owner, token } = await agency();
    const logo = await upload(t, owner, team, "Northlight.png");
    await setLogo(owner, team, uploadRef(logo));
    // Signed out, the team's own file links still refuse.
    await expect(t.action(api.storage.linkFor, { uploadId: logo })).rejects.toThrow();
    // A made-up or wrong secret gets nothing.
    expect(await t.action(api.portal.logoLink, { token: "b".repeat(64) })).toBeNull();
    expect(await t.action(api.portal.logoLink, { token: "not-a-token" })).toBeNull();
  });

  test("stops when the portal is switched off", async () => {
    const { t, team, owner, acme, token } = await agency();
    await setLogo(owner, team, uploadRef(await upload(t, owner, team, "Northlight.png")));
    await owner.as.mutation(api.portal.stop, { clientId: acme });
    expect(await t.action(api.portal.logoLink, { token })).toBeNull();
  });

  test("gives nothing for a logo that is a web address or an upload since removed", async () => {
    const { t, team, owner, token } = await agency();
    await setLogo(owner, team, "https://files.example/northlight.png");
    expect(await t.action(api.portal.logoLink, { token })).toBeNull();
    const logo = await upload(t, owner, team, "Northlight.png");
    await setLogo(owner, team, uploadRef(logo));
    await t.run((ctx) => ctx.db.delete(logo));
    expect(await t.action(api.portal.logoLink, { token })).toBeNull();
  });

  test("never signs another team's file, even when the brand points at it", async () => {
    const { t, team, owner, token } = await agency();
    await setLogo(owner, team, uploadRef(await upload(t, owner, team, "Northlight.png")));
    const otherTeam = await addTeam(t, "Other Team");
    const other = await addPerson(t, "Someone Else", [otherTeam], "owner");
    await connectToolkit(t, otherTeam, other.id);
    const theirs = await upload(t, other, otherTeam, "Secret.png");
    // Written straight in, as the settings screen would refuse it.
    await t.run(async (ctx) => {
      const settings = await ctx.db
        .query("teamSettings")
        .withIndex("by_organization", (q) => q.eq("organizationId", team))
        .first();
      await ctx.db.patch(settings!._id, { brand: { logo: uploadRef(theirs) } });
    });
    expect(await t.action(api.portal.logoLink, { token })).toBeNull();
  });
});
