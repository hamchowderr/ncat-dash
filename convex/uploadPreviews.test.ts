import { afterEach, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

/** The Uploads page shows each file: it asks for short-lived links to play and show them. */
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
afterEach(() => toolkit?.restore());

async function studio() {
  toolkit = fakeToolkitStorage();
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  const otherTeam = await addTeam(t, "Other Team");
  const outsider = await addPerson(t, "Someone Else", [otherTeam]);
  await connectToolkit(t, team, owner.id);
  const add = (
    organizationId: string,
    fileName: string,
    contentType: string,
    extra: {
      status?: "uploading" | "ready";
      details?: { hasVideo?: boolean; hasAudio?: boolean };
    } = {},
  ) =>
    t.run((ctx) =>
      ctx.db.insert("uploads", {
        organizationId,
        key: `uploads/${organizationId}/${fileName}`,
        fileName,
        contentType,
        size: 1000,
        status: extra.status ?? "ready",
        createdBy: owner.id,
        ...(extra.details ? { details: extra.details } : {}),
      }),
    );
  return { t, team, owner, otherTeam, outsider, toolkit, add };
}

describe("preview links for the Uploads page", () => {
  test("videos, sounds and pictures get a link signed for six hours", async () => {
    const { team, owner, toolkit, add } = await studio();
    const talk = await add(team, "talk.mp4", "video/mp4");
    const song = await add(team, "song.mp3", "audio/mpeg");
    const logo = await add(team, "logo.png", "image/png");

    const links = await owner.as.action(api.storage.previewLinks, {
      organizationId: team,
      uploadIds: [talk, song, logo],
    });

    expect(new Map(links.map((link) => [link.uploadId, link.url]))).toEqual(
      new Map([
        [
          talk,
          `https://r2.example/test-bucket/teams/${team}/uploads/${team}/talk.mp4?method=GET&expires=21600&signature=fake`,
        ],
        [
          song,
          `https://r2.example/test-bucket/teams/${team}/uploads/${team}/song.mp3?method=GET&expires=21600&signature=fake`,
        ],
        [
          logo,
          `https://r2.example/test-bucket/teams/${team}/uploads/${team}/logo.png?method=GET&expires=21600&signature=fake`,
        ],
      ]),
    );
    expect(toolkit.calls.filter((call) => call.request === "sign")).toHaveLength(3);
  });

  test("a file sent without a type is known as a video once the toolkit has read it", async () => {
    const { team, owner, add } = await studio();
    const read = await add(team, "clip", "application/octet-stream", {
      details: { hasVideo: true },
    });
    const unread = await add(team, "notes", "application/octet-stream");
    const links = await owner.as.action(api.storage.previewLinks, {
      organizationId: team,
      uploadIds: [read, unread],
    });
    expect(links.map((link) => link.uploadId)).toEqual([read]);
  });

  test("files still uploading and other files get none", async () => {
    const { team, owner, add, toolkit } = await studio();
    const sending = await add(team, "big.mp4", "video/mp4", { status: "uploading" });
    const sheet = await add(team, "plan.pdf", "application/pdf");
    const links = await owner.as.action(api.storage.previewLinks, {
      organizationId: team,
      uploadIds: [sending, sheet],
    });
    expect(links).toEqual([]);
    expect(toolkit.calls.filter((call) => call.request === "sign")).toHaveLength(0);
  });

  test("another team's upload is never signed, even when asked for by id", async () => {
    const { team, owner, otherTeam, add } = await studio();
    const theirs = await add(otherTeam, "secret.mp4", "video/mp4");
    const ours = await add(team, "ours.mp4", "video/mp4");
    const links = await owner.as.action(api.storage.previewLinks, {
      organizationId: team,
      uploadIds: [theirs, ours],
    });
    expect(links.map((link) => link.uploadId)).toEqual([ours]);
  });

  test("someone outside the team cannot ask for its previews", async () => {
    const { team, outsider, add } = await studio();
    const ours = await add(team, "ours.mp4", "video/mp4");
    await expect(
      outsider.as.action(api.storage.previewLinks, { organizationId: team, uploadIds: [ours] }),
    ).rejects.toThrow();
  });

  test("the same file asked for twice is signed once", async () => {
    const { team, owner, add, toolkit } = await studio();
    const talk = await add(team, "talk.mp4", "video/mp4");
    const links = await owner.as.action(api.storage.previewLinks, {
      organizationId: team,
      uploadIds: [talk, talk],
    });
    expect(links).toHaveLength(1);
    expect(toolkit.calls.filter((call) => call.request === "sign")).toHaveLength(1);
  });

  test("more than 25 at a time is refused", async () => {
    const { team, owner, add } = await studio();
    const talk = await add(team, "talk.mp4", "video/mp4");
    const many = Array.from({ length: 26 }, () => talk) as Id<"uploads">[];
    await expect(
      owner.as.action(api.storage.previewLinks, { organizationId: team, uploadIds: many }),
    ).rejects.toThrow(/up to 25/);
  });

  test("before a toolkit is connected there is nothing to sign with", async () => {
    const { t, add } = await studio();
    const fresh = await addTeam(t, "New Team");
    const member = await addPerson(t, "Ana Lopez", [fresh], "owner");
    const talk = await add(fresh, "talk.mp4", "video/mp4");
    expect(
      await member.as.action(api.storage.previewLinks, {
        organizationId: fresh,
        uploadIds: [talk],
      }),
    ).toEqual([]);
  });
});
