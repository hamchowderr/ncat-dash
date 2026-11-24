import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import { isTimeZone } from "./profiles";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * Your profile beyond your name and email: a role, the time zone the app works in for
 * you, and the stored file of your photo.
 */
async function storePicture(t: ReturnType<typeof backend>, type = "image/webp", bytes = 10) {
  return await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)], { type })));
}

describe("role and time zone", () => {
  test("nobody signed in has no profile, and someone new has an empty one", async () => {
    const t = backend();
    expect(await t.query(api.profiles.mine, {})).toBeNull();
    const maya = await addPerson(t, "Maya Ortiz");
    expect(await maya.as.query(api.profiles.mine, {})).toEqual({ timeZone: null, title: null });
  });

  test("a role and a time zone are saved, tidied, and a blank role clears it", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await maya.as.mutation(api.profiles.update, {
      title: "  Video   editor ",
      timeZone: "Europe/Berlin",
    });
    expect(await maya.as.query(api.profiles.mine, {})).toEqual({
      timeZone: "Europe/Berlin",
      title: "Video editor",
    });
    await maya.as.mutation(api.profiles.update, { title: "" });
    expect(await maya.as.query(api.profiles.mine, {})).toEqual({
      timeZone: "Europe/Berlin",
      title: null,
    });
  });

  test("a made-up time zone or a long role is refused", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await expect(
      maya.as.mutation(api.profiles.update, { timeZone: "Mars/Olympus" }),
    ).rejects.toThrow(/Pick a time zone/);
    await expect(maya.as.mutation(api.profiles.update, { title: "x".repeat(61) })).rejects.toThrow(
      /60 characters/,
    );
    expect(isTimeZone("America/Los_Angeles")).toBe(true);
    expect(isTimeZone("")).toBe(false);
  });

  test("the browser fills the time zone once, and never over one picked by hand", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await maya.as.mutation(api.profiles.fillTimeZone, { timeZone: "America/New_York" });
    expect((await maya.as.query(api.profiles.mine, {}))?.timeZone).toBe("America/New_York");
    await maya.as.mutation(api.profiles.update, { timeZone: "Asia/Tokyo" });
    await maya.as.mutation(api.profiles.fillTimeZone, { timeZone: "Europe/London" });
    expect((await maya.as.query(api.profiles.mine, {}))?.timeZone).toBe("Asia/Tokyo");
  });

  test("teammates see each other's role and photo on Members and in the reviewer picker", async () => {
    const t = backend();
    const team = await addTeam(t, "Example Studio");
    const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
    const olu = await addPerson(t, "Olu Bello", [team]);
    await olu.as.mutation(api.profiles.update, { title: "Producer" });
    const people = await maya.as.query(api.teams.people, { organizationId: team });
    expect(people.members.map((person) => [person.name, person.title])).toEqual(
      expect.arrayContaining([
        ["Maya Ortiz", null],
        ["Olu Bello", "Producer"],
      ]),
    );
    expect(people.members.every((person) => "image" in person)).toBe(true);
    const members = await maya.as.query(api.teams.members, { organizationId: team });
    expect(members.find((member) => member.name === "Olu Bello")?.title).toBe("Producer");
  });
});

describe("profile photo", () => {
  test("an uploaded picture is kept and its address handed back; a new one replaces it", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    expect(typeof (await maya.as.mutation(api.profiles.avatarUploadUrl, {}))).toBe("string");
    const first = await storePicture(t);
    const kept = await maya.as.mutation(api.profiles.setAvatar, { file: first });
    expect("url" in kept && kept.url).toMatch(/^https?:\/\//);
    const second = await storePicture(t);
    await maya.as.mutation(api.profiles.setAvatar, { file: second });
    expect(await t.run((ctx) => ctx.db.system.get(first))).toBeNull();
    expect(await t.run((ctx) => ctx.db.system.get(second))).not.toBeNull();
  });

  test("a file that isn't a picture, or is too big, is refused and thrown away", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    const text = await storePicture(t, "text/plain");
    expect(await maya.as.mutation(api.profiles.setAvatar, { file: text })).toEqual({
      problem: "Use a picture file under 2 MB.",
    });
    expect(await t.run((ctx) => ctx.db.system.get(text))).toBeNull();
    const huge = await storePicture(t, "image/png", 2 * 1024 * 1024 + 1);
    expect(await maya.as.mutation(api.profiles.setAvatar, { file: huge })).toEqual({
      problem: "Use a picture file under 2 MB.",
    });
    expect(await t.run((ctx) => ctx.db.system.get(huge))).toBeNull();
  });

  test("removing the photo deletes its file", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    const file = await storePicture(t);
    await maya.as.mutation(api.profiles.setAvatar, { file });
    await maya.as.mutation(api.profiles.removeAvatar, {});
    expect(await t.run((ctx) => ctx.db.system.get(file))).toBeNull();
  });

  test("only someone signed in can upload", async () => {
    const t = backend();
    await expect(t.mutation(api.profiles.avatarUploadUrl, {})).rejects.toThrow(/Sign in/);
  });

  test("deleting the account takes the profile and the photo with it", async () => {
    const t = backend();
    const maya = await addPerson(t, "Maya Ortiz");
    await maya.as.mutation(api.profiles.update, { title: "Host", timeZone: "Europe/Berlin" });
    const file = await storePicture(t);
    await maya.as.mutation(api.profiles.setAvatar, { file });
    await t.mutation(internal.accountDeletion.prepare, { userId: maya.id });
    expect(await t.run((ctx) => ctx.db.query("profiles").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.system.get(file))).toBeNull();
  });
});
