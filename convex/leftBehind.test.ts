import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { bucketForFile, LEFT_BEHIND_MESSAGE } from "./lib/bucket";
import { encryptSecret } from "./lib/crypto";
import { addPerson, addTeam, backend } from "./test.setup";

// A team starts on the hosted server and storage, uploads a video, then switches to its
// own server and storage. The video stays where it was: it is marked as on Takewon's
// storage and still read from there, not looked for on the new storage and not found.

const HOSTED = "https://media.takewon.example";
const OWN = "https://media.studio.example";
const HOSTED_STORAGE = {
  bucket: "takewon-media",
  endpoint: "https://r2.takewon.example",
  publicUrl: null,
};
const OWN_STORAGE = {
  bucket: "studio-media",
  endpoint: "https://r2.studio.example",
  publicUrl: null,
};

afterEach(() => {
  vi.useRealTimers();
  delete process.env.HOSTED_TOOLKIT_URL;
  delete process.env.HOSTED_TOOLKIT_API_KEY;
});

async function setUp() {
  vi.useFakeTimers();
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.HOSTED_TOOLKIT_URL = HOSTED;
  process.env.HOSTED_TOOLKIT_API_KEY = "hosted-key";
  const t = backend();
  const team = await addTeam(t, "Kim Talks");
  const rae = await addPerson(t, "Rae Kim", [team]);
  const connect = async (baseUrl: string, storage: typeof HOSTED_STORAGE) =>
    await t.mutation(internal.toolkitConnections.save, {
      organizationId: team,
      baseUrl,
      apiKeyCipher: await encryptSecret("key"),
      apiKeyHint: "abcd",
      buildNumber: null,
      storage,
      createdBy: rae.id,
    });
  await connect(HOSTED, HOSTED_STORAGE);
  const { uploadId, itemId } = await t.run(async (ctx) => {
    const uploadId = await ctx.db.insert("uploads", {
      organizationId: team,
      key: "uploads/one/Branches and PRs.mp4",
      fileName: "Branches and PRs.mp4",
      contentType: "video/mp4",
      size: 1000,
      status: "ready",
      createdBy: rae.id,
    });
    const itemId = await ctx.db.insert("libraryItems", {
      organizationId: team,
      shortId: "V1",
      kind: "video",
      source: "upload",
      title: "Branches and PRs",
      key: "uploads/one/Branches and PRs.mp4",
      uploadId,
      tags: [],
      searchText: "V1 Branches and PRs",
      createdBy: rae.id,
    });
    return { uploadId, itemId };
  });
  const settle = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const files = () =>
    t.run(async (ctx) => ({
      upload: await ctx.db.get(uploadId as Id<"uploads">),
      item: await ctx.db.get(itemId as Id<"libraryItems">),
    }));
  return { t, team, rae, connect, settle, files };
}

test("switching to its own server marks the files left on Takewon's storage, which still work", async () => {
  const { t, team, rae, connect, settle, files } = await setUp();
  await connect(OWN, OWN_STORAGE);
  await settle();
  const { upload, item } = await files();
  const left = { hosted: true, bucket: "takewon-media", endpoint: "https://r2.takewon.example" };
  expect(upload?.storedOn).toEqual(left);
  expect(item?.storedOn).toEqual(left);

  // Its link is made by the hosted server, in the team's own folder of Takewon's bucket.
  const connection = await t.run(async (ctx) =>
    ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", team))
      .first(),
  );
  const bucket = await bucketForFile(connection!, item!);
  expect(bucket).toMatchObject({ baseUrl: HOSTED, apiKey: "hosted-key", bucket: "takewon-media" });
  expect(bucket.root).toContain(team);

  // The library says where it is.
  const listed = (await rae.as.query(api.library.list, { organizationId: team })).items;
  expect(listed[0].storedElsewhere).toBe("hosted");
});

test("switching back to Takewon's server clears the mark", async () => {
  const { connect, settle, files } = await setUp();
  await connect(OWN, OWN_STORAGE);
  await settle();
  await connect(HOSTED, HOSTED_STORAGE);
  await settle();
  const { upload, item } = await files();
  expect(upload?.storedOn).toBeUndefined();
  expect(item?.storedOn).toBeUndefined();
});

test("a file on an earlier storage of the team's own is out of reach, and says so", async () => {
  const { t, team, rae, connect, settle, files } = await setUp();
  await connect(OWN, OWN_STORAGE);
  await settle();
  // Its files from the hosted storage stay marked; files made on its own storage are
  // marked once it moves again.
  await t.run(async (ctx) => {
    await ctx.db.insert("libraryItems", {
      organizationId: team,
      shortId: "V2",
      kind: "video",
      source: "upload",
      title: "Pricing talk",
      key: "Pricing talk.mp4",
      tags: [],
      searchText: "V2 Pricing talk",
      createdBy: rae.id,
    });
  });
  await connect("https://media.other.example", {
    bucket: "other-media",
    endpoint: "https://s3.other.example",
    publicUrl: null,
  });
  await settle();
  const listed = (await rae.as.query(api.library.list, { organizationId: team })).items;
  const where = Object.fromEntries(listed.map((one) => [one.shortId, one.storedElsewhere]));
  expect(where).toEqual({ V1: "hosted", V2: "earlier" });

  const connection = await t.run(async (ctx) =>
    ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", team))
      .first(),
  );
  const pricing = listed.find((one) => one.shortId === "V2")!;
  const item = await t.run((ctx) => ctx.db.get(pricing._id));
  await expect(bucketForFile(connection!, item!)).rejects.toThrow(LEFT_BEHIND_MESSAGE);
  expect((await files()).item?.storedOn?.hosted).toBe(true);
});

test("files of a team that switched before marking began are marked by when they were made", async () => {
  const { t, team, settle, files } = await setUp();
  // The team's connection is replaced without the switch being noticed, as happened before.
  await t.run(async (ctx) => {
    const connection = await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", team))
      .first();
    await ctx.db.patch(connection!._id, { baseUrl: OWN, storage: OWN_STORAGE });
  });
  const left = { hosted: true, bucket: "takewon-media", endpoint: "https://r2.takewon.example" };
  await t.mutation(internal.leftBehind.markOlder, { organizationId: team, left, before: 0 });
  await settle();
  expect((await files()).item?.storedOn).toBeUndefined();
  await t.mutation(internal.leftBehind.markOlder, {
    organizationId: team,
    left,
    before: Date.now() + 1,
  });
  await settle();
  const { upload, item } = await files();
  expect(upload?.storedOn).toEqual(left);
  expect(item?.storedOn).toEqual(left);
});
