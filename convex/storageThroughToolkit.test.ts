import { afterEach, describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import { NOT_FORK_DETAIL } from "./lib/bucket";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

/**
 * Files live in the toolkit's own bucket and every storage step goes through the toolkit,
 * so the only setup a team does is the toolkit's address and API key.
 */
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
afterEach(() => toolkit?.restore());

async function studio(options: Parameters<typeof fakeToolkitStorage>[0] = {}) {
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  toolkit = fakeToolkitStorage(options);
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  return { t, team, owner, outsider, toolkit };
}

describe("connecting a toolkit sets up storage too", () => {
  test("the fork is saved with the bucket it reports", async () => {
    const { t, team, owner } = await studio({ publicUrl: "https://files.example" });
    expect(await owner.as.query(api.storage.get, { organizationId: team })).toBeNull();

    const result = await owner.as.action(api.toolkitConnections.connect, {
      organizationId: team,
      baseUrl: "https://toolkit.example/",
      apiKey: "toolkit-key",
    });
    expect(result).toEqual({ ok: true, buildNumber: "210" });
    expect(await owner.as.query(api.storage.get, { organizationId: team })).toEqual({
      bucket: "test-bucket",
      publicUrl: "https://files.example",
      baseUrl: "https://toolkit.example",
    });
    const [saved] = await t.run((ctx) => ctx.db.query("toolkitConnections").collect());
    expect(saved.storage).toEqual({
      bucket: "test-bucket",
      endpoint: "https://r2.example",
      publicUrl: "https://files.example",
    });
  });

  test("Stephen's original toolkit is refused with how to switch to the fork", async () => {
    const { t, team, owner } = await studio({ fork: false });
    const result = await owner.as.action(api.toolkitConnections.connect, {
      organizationId: team,
      baseUrl: "https://toolkit.example",
      apiKey: "toolkit-key",
    });
    expect(result).toEqual({ ok: false, reason: "not_fork", detail: NOT_FORK_DETAIL });
    expect(await t.run((ctx) => ctx.db.query("toolkitConnections").collect())).toEqual([]);
  });

  test("a toolkit whose bucket does not answer says so and is not saved", async () => {
    const { t, team, owner } = await studio({
      broken: "The bucket set on this toolkit does not exist.",
    });
    const result = await owner.as.action(api.toolkitConnections.connect, {
      organizationId: team,
      baseUrl: "https://toolkit.example",
      apiKey: "toolkit-key",
    });
    expect(result).toMatchObject({ ok: false, reason: "storage" });
    expect(result.ok ? "" : result.detail).toContain("does not exist");
    expect(await t.run((ctx) => ctx.db.query("toolkitConnections").collect())).toEqual([]);
  });

  test("checking again reads the bucket for a toolkit connected before storage moved", async () => {
    const { t, team, owner } = await studio();
    const connectionId = await connectToolkit(t, team, owner.id);
    await t.run((ctx) => ctx.db.patch(connectionId, { storage: undefined }));
    expect(await owner.as.query(api.storage.get, { organizationId: team })).toBeNull();
    const result = await owner.as.action(api.toolkitConnections.recheck, { connectionId });
    expect(result.ok).toBe(true);
    expect(await owner.as.query(api.storage.get, { organizationId: team })).toMatchObject({
      bucket: "test-bucket",
    });
  });
});

describe("files go through the toolkit", () => {
  test("an upload gets a PUT link the toolkit signed for its own bucket", async () => {
    const { t, team, owner, toolkit } = await studio();
    await connectToolkit(t, team, owner.id);
    const { uploadId, uploadUrl } = await owner.as.action(api.storage.startUpload, {
      organizationId: team,
      fileName: "Big Talk.mp4",
      contentType: "video/mp4",
      size: 5000,
    });
    const upload = await t.run((ctx) => ctx.db.get(uploadId));
    expect(upload?.key).toMatch(new RegExp(`^uploads/${team}/[0-9a-f-]+/Big-Talk\\.mp4$`));
    expect(uploadUrl).toBe(
      `https://r2.example/test-bucket/${upload?.key}?method=PUT&expires=3600&signature=fake`,
    );
    expect(toolkit.calls.at(-1)).toEqual({
      request: "sign",
      body: { key: upload?.key, method: "PUT", expires_in: 3600 },
    });
  });

  test("without a toolkit there is nowhere for files to go", async () => {
    const { team, owner } = await studio();
    await expect(
      owner.as.action(api.storage.startUpload, {
        organizationId: team,
        fileName: "talk.mp4",
        contentType: "video/mp4",
        size: 5000,
      }),
    ).rejects.toThrow(/Connect your toolkit/);
  });

  test("the Files page lists, renames and deletes through the toolkit", async () => {
    const { t, team, owner, toolkit } = await studio();
    await connectToolkit(t, team, owner.id);
    toolkit.put("shows/ep1.mp4");
    toolkit.put("shows/raw/take.mp4");
    toolkit.put("top.mp4");

    const top = await owner.as.action(api.files.list, { organizationId: team, prefix: "" });
    expect(top.bucket).toBe("test-bucket");
    expect(top.folders.map((folder) => folder.key)).toEqual(["shows/"]);
    expect(top.files.map((file) => file.key)).toEqual(["top.mp4"]);

    await owner.as.action(api.files.rename, {
      organizationId: team,
      key: "shows/ep1.mp4",
      name: "Episode 1.mp4",
    });
    expect([...toolkit.files.keys()].sort()).toEqual([
      "shows/Episode 1.mp4",
      "shows/raw/take.mp4",
      "top.mp4",
    ]);

    await owner.as.action(api.files.remove, { organizationId: team, keys: ["top.mp4"] });
    expect(toolkit.files.has("top.mp4")).toBe(false);
  });

  test("a download link names the file", async () => {
    const { t, team, owner } = await studio();
    await connectToolkit(t, team, owner.id);
    const link = await owner.as.action(api.files.linkFor, {
      organizationId: team,
      key: "shows/Episode 1.mp4",
      use: "download",
    });
    expect(new URL(link).searchParams.get("download")).toBe("Episode 1.mp4");
  });

  test("another team cannot use this team's toolkit storage", async () => {
    const { t, team, owner, outsider } = await studio();
    await connectToolkit(t, team, owner.id);
    await expect(
      outsider.as.action(api.files.list, { organizationId: team, prefix: "" }),
    ).rejects.toThrow();
    await expect(outsider.as.query(api.storage.get, { organizationId: team })).rejects.toThrow();
  });
});

describe("the old storage settings", () => {
  test("are deleted, keys and all", async () => {
    const { t } = await studio();
    const removed = await t.mutation(internal.storage.forgetOldStorageSettings, {});
    expect(removed).toBe(0);
  });
});
