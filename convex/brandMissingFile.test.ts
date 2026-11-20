import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

const ref = (id: Id<"uploads">) => `upload:${id}`;

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  const upload = (fileName: string, contentType: string) =>
    t.run((ctx) =>
      ctx.db.insert("uploads", {
        organizationId: team,
        key: `uploads/${fileName}`,
        fileName,
        contentType,
        size: 1000,
        status: "ready",
        createdBy: owner.id,
      }),
    );
  const remove = (id: Id<"uploads">) => t.run((ctx) => ctx.db.delete(id));
  return { t, team, owner, upload, remove };
}

describe("saving a brand when one of its uploads was removed", () => {
  test("the rest of the brand still saves, and the removed music track is kept", async () => {
    const { team, owner, upload, remove } = await setUp();
    const logo = await upload("logo.png", "image/png");
    const song = await upload("upbeat.mp3", "audio/mpeg");
    await owner.as.mutation(api.teamSettings.setBrand, {
      organizationId: team,
      brand: { logo: ref(logo) },
      music: [{ name: "Upbeat", file: ref(song) }],
    });
    await remove(song);

    const newLogo = await upload("new-logo.png", "image/png");
    await owner.as.mutation(api.teamSettings.setBrand, {
      organizationId: team,
      brand: { logo: ref(newLogo), color: "#FFCC00" },
      music: [{ name: "Upbeat", file: ref(song) }],
    });
    const settings = await owner.as.query(api.teamSettings.get, { organizationId: team });
    expect(settings.brand).toMatchObject({ logo: ref(newLogo), color: "#FFCC00" });
    expect(settings.music).toEqual([{ name: "Upbeat", file: ref(song) }]);
  });

  test("a saved logo whose upload was removed doesn't stop other changes", async () => {
    const { team, owner, upload, remove } = await setUp();
    const logo = await upload("logo.png", "image/png");
    await owner.as.mutation(api.teamSettings.setBrand, {
      organizationId: team,
      brand: { logo: ref(logo) },
    });
    await remove(logo);
    await owner.as.mutation(api.teamSettings.setBrand, {
      organizationId: team,
      brand: { logo: ref(logo), font: "Inter" },
    });
    const settings = await owner.as.query(api.teamSettings.get, { organizationId: team });
    expect(settings.brand).toMatchObject({ logo: ref(logo), font: "Inter" });
  });

  test("a newly picked upload that is gone is refused, saying which file", async () => {
    const { team, owner, upload, remove } = await setUp();
    const intro = await upload("intro.mp4", "video/mp4");
    await remove(intro);
    await expect(
      owner.as.mutation(api.teamSettings.setBrand, {
        organizationId: team,
        brand: { intro: ref(intro) },
      }),
    ).rejects.toThrow(/The intro you picked is no longer in your uploads/);

    const song = await upload("calm.mp3", "audio/mpeg");
    await remove(song);
    await expect(
      owner.as.mutation(api.teamSettings.setBrand, {
        organizationId: team,
        brand: {},
        music: [{ name: "Calm", file: ref(song) }],
      }),
    ).rejects.toThrow(/The file for .{0,3}Calm.{0,3} is no longer in your uploads/);
  });

  test("a client's brand keeps its removed file the same way", async () => {
    const { team, owner, upload, remove } = await setUp();
    const client = await owner.as.mutation(api.clients.create, {
      organizationId: team,
      name: "Acme",
    });
    const card = await upload("card.png", "image/png");
    await owner.as.mutation(api.clients.setBrand, { clientId: client, brand: { card: ref(card) } });
    await remove(card);
    await owner.as.mutation(api.clients.setBrand, {
      clientId: client,
      brand: { card: ref(card), color: "#112233" },
    });
    const other = await upload("other.png", "image/png");
    await remove(other);
    await expect(
      owner.as.mutation(api.clients.setBrand, { clientId: client, brand: { card: ref(other) } }),
    ).rejects.toThrow(/The card template you picked/);
  });
});

describe("the names of uploads a brand points at", () => {
  test("gives each upload's name, and none for one that was removed or isn't the team's", async () => {
    const { t, team, owner, upload, remove } = await setUp();
    const logo = await upload("logo.png", "image/png");
    const song = await upload("upbeat.mp3", "audio/mpeg");
    await remove(song);
    const otherTeam = await addTeam(t, "Other Team");
    const outsider = await addPerson(t, "Someone Else", [otherTeam]);
    const names = await owner.as.query(api.storage.uploadNames, {
      organizationId: team,
      ids: [logo, song, "not-an-id"],
    });
    expect(names).toEqual([
      { id: logo, fileName: "logo.png" },
      { id: song, fileName: null },
      { id: "not-an-id", fileName: null },
    ]);
    const theirs = await outsider.as.query(api.storage.uploadNames, {
      organizationId: otherTeam,
      ids: [logo],
    });
    expect(theirs).toEqual([{ id: logo, fileName: null }]);
    await expect(
      outsider.as.query(api.storage.uploadNames, { organizationId: team, ids: [logo] }),
    ).rejects.toThrow();
  });
});
