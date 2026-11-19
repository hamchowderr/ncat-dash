import { afterEach, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

/**
 * Files over 100 MiB go up in parts (one PUT stops at 5 GiB), so a team can bring in
 * files of any size R2 takes, up to 4.9 TB.
 */
const GIB = 1024 * 1024 * 1024;

let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
let current: ReturnType<typeof backend> | null = null;
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await current?.finishInProgressScheduledFunctions();
  current = null;
  toolkit?.restore();
});

async function studio() {
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  toolkit = fakeToolkitStorage();
  const t = backend();
  current = t;
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  await connectToolkit(t, team, owner.id);
  return { t, team, owner, outsider, toolkit };
}

describe("big uploads go up in parts", () => {
  test("a 20 GB file gets a plan for 320 parts instead of one link", async () => {
    const { t, team, owner, toolkit } = await studio();
    const started = await owner.as.action(api.storage.startUpload, {
      organizationId: team,
      fileName: "Full Shoot.mov",
      contentType: "video/quicktime",
      size: 20 * GIB,
    });
    expect(started.uploadUrl).toBeNull();
    expect(started.parts).toEqual({ partSize: 64 * 1024 * 1024, partCount: 320 });
    const upload = await t.run((ctx) => ctx.db.get(started.uploadId));
    expect(upload?.partsUploadId).toBe("parts-1");
    expect(toolkit.calls.at(-1)).toEqual({
      request: "upload/start",
      body: { key: `teams/${team}/${upload?.key}`, content_type: "video/quicktime" },
    });
  });

  test("a small file still gets one PUT link", async () => {
    const { team, owner } = await studio();
    const started = await owner.as.action(api.storage.startUpload, {
      organizationId: team,
      fileName: "clip.mp4",
      contentType: "video/mp4",
      size: 5000,
    });
    expect(started.uploadUrl).toMatch(/method=PUT/);
    expect(started.parts).toBeNull();
  });

  test("parts are signed, joined, and then the file is ready like any upload", async () => {
    const { t, team, owner, toolkit } = await studio();
    const started = await owner.as.action(api.storage.startUpload, {
      organizationId: team,
      fileName: "Long Talk.mp4",
      contentType: "video/mp4",
      size: 150 * 1024 * 1024,
    });
    expect(started.parts?.partCount).toBe(3);
    const links = await owner.as.action(api.storage.signUploadParts, {
      uploadId: started.uploadId,
      partNumbers: [1, 2, 3],
    });
    expect(links.map((link) => link.partNumber)).toEqual([1, 2, 3]);
    expect(links[0].url).toContain("partNumber=1");

    // Marking it ready before the parts are joined is refused.
    await expect(
      owner.as.mutation(api.storage.finishUpload, { uploadId: started.uploadId }),
    ).rejects.toThrow(/not put together/);
    // Joining needs every part.
    await expect(
      owner.as.action(api.storage.completeUploadParts, {
        uploadId: started.uploadId,
        parts: [{ partNumber: 1, etag: "a" }],
      }),
    ).rejects.toThrow(/Every part/);

    await owner.as.action(api.storage.completeUploadParts, {
      uploadId: started.uploadId,
      parts: [1, 2, 3].map((partNumber) => ({ partNumber, etag: `e${partNumber}` })),
    });
    expect(toolkit.calls.at(-1)?.request).toBe("upload/complete");
    expect(toolkit.calls.at(-1)?.body.parts).toEqual([
      { part_number: 1, etag: "e1" },
      { part_number: 2, etag: "e2" },
      { part_number: 3, etag: "e3" },
    ]);
    await owner.as.mutation(api.storage.finishUpload, { uploadId: started.uploadId });
    const upload = await t.run((ctx) => ctx.db.get(started.uploadId));
    expect(upload?.status).toBe("ready");
    expect(upload?.partsUploadId).toBeUndefined();
    // It joins the content library like every upload.
    const item = await t.run((ctx) =>
      ctx.db
        .query("libraryItems")
        .withIndex("by_upload", (q) => q.eq("uploadId", started.uploadId))
        .first(),
    );
    expect(item).not.toBeNull();
  });

  test("part numbers outside the file are refused", async () => {
    const { team, owner } = await studio();
    const started = await owner.as.action(api.storage.startUpload, {
      organizationId: team,
      fileName: "Long Talk.mp4",
      contentType: "video/mp4",
      size: 150 * 1024 * 1024,
    });
    for (const partNumbers of [[0], [4], [1.5], []]) {
      await expect(
        owner.as.action(api.storage.signUploadParts, { uploadId: started.uploadId, partNumbers }),
      ).rejects.toThrow();
    }
  });

  test("another team cannot sign, join or cancel the parts", async () => {
    const { team, owner, outsider } = await studio();
    const started = await owner.as.action(api.storage.startUpload, {
      organizationId: team,
      fileName: "Long Talk.mp4",
      contentType: "video/mp4",
      size: 150 * 1024 * 1024,
    });
    await expect(
      outsider.as.action(api.storage.signUploadParts, {
        uploadId: started.uploadId,
        partNumbers: [1],
      }),
    ).rejects.toThrow();
    await expect(
      outsider.as.action(api.storage.completeUploadParts, {
        uploadId: started.uploadId,
        parts: [1, 2, 3].map((partNumber) => ({ partNumber, etag: "x" })),
      }),
    ).rejects.toThrow();
    await expect(
      outsider.as.action(api.storage.cancelUpload, { uploadId: started.uploadId }),
    ).rejects.toThrow();
  });

  test("cancelling drops the parts and the record", async () => {
    const { t, team, owner, toolkit } = await studio();
    const started = await owner.as.action(api.storage.startUpload, {
      organizationId: team,
      fileName: "Long Talk.mp4",
      contentType: "video/mp4",
      size: 150 * 1024 * 1024,
    });
    await owner.as.action(api.storage.cancelUpload, { uploadId: started.uploadId });
    expect(toolkit.calls.at(-1)?.request).toBe("upload/abort");
    expect(toolkit.openUploads.size).toBe(0);
    expect(await t.run((ctx) => ctx.db.get(started.uploadId))).toBeNull();
  });

  test("the limit is what R2 takes, not 5 GB", async () => {
    const { team, owner } = await studio();
    await expect(
      owner.as.action(api.storage.startUpload, {
        organizationId: team,
        fileName: "too big.mp4",
        contentType: "video/mp4",
        size: 5 * 1024 * GIB,
      }),
    ).rejects.toThrow(/up to 4.9 TB/);
  });

  test("the Files page sends big files in parts too, into the open folder", async () => {
    const { t, team, owner } = await studio();
    const started = await owner.as.action(api.files.startUpload, {
      organizationId: team,
      prefix: "Instagram/Reels/",
      fileName: "Big Reel.mp4",
      contentType: "video/mp4",
      size: 6 * GIB,
    });
    expect(started.key).toBe("Instagram/Reels/Big Reel.mp4");
    expect(started.uploadUrl).toBeNull();
    expect(started.parts?.partCount).toBe(96);
    const upload = await t.run((ctx) => ctx.db.get(started.uploadId));
    expect(upload?.partsUploadId).toBeTruthy();
  });
});
