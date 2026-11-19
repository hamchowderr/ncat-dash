import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

// Sunday 1 November 2026, 12:00 UTC. The Mondays after are the 2nd, 9th and 16th.
const NOW = Date.parse("2026-11-01T12:00:00Z");
const at = (iso: string) => Date.parse(iso);
const NOVEMBER = { from: at("2026-11-01T00:00:00Z"), to: at("2026-12-01T00:00:00Z") };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

async function team() {
  const t = backend();
  const org = await addTeam(t, "Harbor Cuts");
  const ana = await addPerson(t, "Ana Reyes", [org], "owner");
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  const range = (more: Record<string, unknown> = {}) =>
    ana.as.query(api.calendar.range, { organizationId: org, ...NOVEMBER, ...more });
  const waiting = (more: Record<string, unknown> = {}) =>
    ana.as.query(api.calendar.waiting, { organizationId: org, ...more });
  return { t, org, ana, outsider, range, waiting };
}

const instagramMondays = { weekday: 1, time: "10:00", timeZone: "UTC", platform: "instagram" };

describe("planned posts", () => {
  test("go on the calendar at their time, or wait in the side list without one", async () => {
    const { org, ana, range, waiting } = await team();
    await ana.as.mutation(api.calendar.addPost, {
      organizationId: org,
      title: "  Episode 12   teaser ",
      platform: "tiktok",
      at: at("2026-11-05T17:00:00Z"),
    });
    await ana.as.mutation(api.calendar.addPost, {
      organizationId: org,
      title: "Behind the scenes",
      platform: "youtube",
    });

    const { posts } = await range();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      title: "Episode 12 teaser",
      platform: "tiktok",
      at: at("2026-11-05T17:00:00Z"),
      status: "planned",
      fromSlot: false,
      file: null,
    });
    const side = await waiting();
    expect(side.posts.map((post) => post.title)).toEqual(["Behind the scenes"]);
    expect(side.posts[0]).toMatchObject({ at: null, queued: false });
  });

  test("move by dragging, go back to the side list, and are marked posted by hand", async () => {
    const { org, ana, range, waiting } = await team();
    const postId = await ana.as.mutation(api.calendar.addPost, {
      organizationId: org,
      title: "Recap",
      platform: "instagram",
    });
    await ana.as.mutation(api.calendar.movePost, { postId, at: at("2026-11-20T15:00:00Z") });
    expect((await range()).posts[0]).toMatchObject({ _id: postId, at: at("2026-11-20T15:00:00Z") });
    expect((await waiting()).posts).toEqual([]);

    await ana.as.mutation(api.calendar.updatePost, { postId, posted: true, title: "Weekly recap" });
    expect((await range()).posts[0]).toMatchObject({ status: "posted", title: "Weekly recap" });

    await ana.as.mutation(api.calendar.movePost, { postId, at: null });
    expect((await range()).posts).toEqual([]);
    expect((await waiting()).posts.map((post) => post._id)).toEqual([postId]);

    await ana.as.mutation(api.calendar.removePost, { postId });
    expect((await waiting()).posts).toEqual([]);
  });

  test("need a title and a known platform", async () => {
    const { org, ana } = await team();
    await expect(
      ana.as.mutation(api.calendar.addPost, {
        organizationId: org,
        title: " ",
        platform: "instagram",
      }),
    ).rejects.toThrow(/title/);
    await expect(
      ana.as.mutation(api.calendar.addPost, {
        organizationId: org,
        title: "Hi",
        platform: "myspace",
      }),
    ).rejects.toThrow(/posted/);
  });

  test("can name a library file by its short ID and take its title and client", async () => {
    const { t, org, ana, range } = await team();
    const clientId = await ana.as.mutation(api.clients.create, {
      organizationId: org,
      name: "Acme",
    });
    const itemId = await t.run((ctx) =>
      ctx.db.insert("libraryItems", {
        organizationId: org,
        shortId: "C7",
        kind: "video",
        source: "automation",
        title: "Best moment 3",
        url: "https://files.example/c7.mp4",
        clientId,
        tags: [],
        searchText: "c7 best moment 3",
        createdBy: "someone",
      }),
    );
    await ana.as.mutation(api.calendar.addPost, {
      organizationId: org,
      title: "",
      platform: "youtube",
      file: "c7",
      at: at("2026-11-03T12:00:00Z"),
    });
    expect((await range()).posts[0]).toMatchObject({
      title: "Best moment 3",
      file: { _id: itemId, shortId: "C7" },
      client: { _id: clientId, name: "Acme" },
    });
    await expect(
      ana.as.mutation(api.calendar.addPost, {
        organizationId: org,
        title: "",
        platform: "x",
        file: "C99",
      }),
    ).rejects.toThrow(/no C99/);

    // Taking the file out of the library leaves the post, without the file.
    await ana.as.mutation(api.library.remove, { itemId });
    expect((await range()).posts[0]).toMatchObject({ title: "Best moment 3", file: null });
  });

  test("are only for their team", async () => {
    const { org, ana, outsider } = await team();
    const postId = await ana.as.mutation(api.calendar.addPost, {
      organizationId: org,
      title: "Mine",
      platform: "x",
    });
    await expect(
      outsider.as.query(api.calendar.range, { organizationId: org, ...NOVEMBER }),
    ).rejects.toThrow();
    await expect(
      outsider.as.query(api.calendar.waiting, { organizationId: org }),
    ).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.calendar.movePost, { postId, at: NOW }),
    ).rejects.toThrow();
    await expect(outsider.as.mutation(api.calendar.removePost, { postId })).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.calendar.addSlot, { organizationId: org, ...instagramMondays }),
    ).rejects.toThrow();
  });

  test("are read at most six weeks at a time", async () => {
    const { range } = await team();
    await expect(
      range({ from: NOVEMBER.from, to: NOVEMBER.from + 50 * 86_400_000 }),
    ).rejects.toThrow(/six weeks/);
  });
});

describe("repeating slots", () => {
  test("show their free times from now on and fill from the queue in order", async () => {
    const { org, ana, range, waiting } = await team();
    const { slotId, placed } = await ana.as.mutation(api.calendar.addSlot, {
      organizationId: org,
      ...instagramMondays,
    });
    expect(placed).toBe(0);
    expect((await ana.as.query(api.calendar.slots, { organizationId: org }))[0]).toMatchObject({
      _id: slotId,
      weekday: 1,
      time: "10:00",
      platform: "instagram",
      client: null,
    });
    expect((await range()).openSlots.map((slot) => slot.at)).toEqual([
      at("2026-11-02T10:00:00Z"),
      at("2026-11-09T10:00:00Z"),
      at("2026-11-16T10:00:00Z"),
      at("2026-11-23T10:00:00Z"),
      at("2026-11-30T10:00:00Z"),
    ]);

    const first = await ana.as.mutation(api.calendar.addPost, {
      organizationId: org,
      title: "Clip 1",
      platform: "instagram",
      queue: true,
    });
    await ana.as.mutation(api.calendar.addPost, {
      organizationId: org,
      title: "Clip 2",
      platform: "instagram",
      queue: true,
    });
    // No Instagram slot fits a TikTok post, so it keeps waiting in the queue.
    await ana.as.mutation(api.calendar.addPost, {
      organizationId: org,
      title: "Clip 3",
      platform: "tiktok",
      queue: true,
    });

    const { posts, openSlots } = await range();
    expect(posts.map((post) => [post.title, post.at, post.fromSlot])).toEqual([
      ["Clip 1", at("2026-11-02T10:00:00Z"), true],
      ["Clip 2", at("2026-11-09T10:00:00Z"), true],
    ]);
    expect(openSlots).toHaveLength(3);
    expect((await waiting()).posts).toMatchObject([{ title: "Clip 3", queued: true }]);

    // Deleting a placed post frees its time for what is queued next.
    const third = await ana.as.mutation(api.calendar.addPost, {
      organizationId: org,
      title: "Clip 4",
      platform: "instagram",
      queue: true,
    });
    expect((await range()).posts.find((post) => post._id === third)?.at).toBe(
      at("2026-11-16T10:00:00Z"),
    );
    await ana.as.mutation(api.calendar.removePost, { postId: first });
    const after = await range();
    expect(after.posts.map((post) => post.title)).toEqual(["Clip 2", "Clip 4"]);
  });

  test("a new slot takes what was already queued, and removing it keeps the posts' times", async () => {
    const { org, ana, range } = await team();
    await ana.as.mutation(api.calendar.addPost, {
      organizationId: org,
      title: "Queued",
      platform: "instagram",
      queue: true,
    });
    const { slotId, placed } = await ana.as.mutation(api.calendar.addSlot, {
      organizationId: org,
      ...instagramMondays,
    });
    expect(placed).toBe(1);
    await ana.as.mutation(api.calendar.removeSlot, { slotId });
    expect((await range()).posts[0]).toMatchObject({
      at: at("2026-11-02T10:00:00Z"),
      fromSlot: false,
    });
    expect((await range()).openSlots).toEqual([]);
  });

  test("are checked, and the same one twice is refused", async () => {
    const { org, ana } = await team();
    await ana.as.mutation(api.calendar.addSlot, { organizationId: org, ...instagramMondays });
    await expect(
      ana.as.mutation(api.calendar.addSlot, { organizationId: org, ...instagramMondays }),
    ).rejects.toThrow(/already/);
    await expect(
      ana.as.mutation(api.calendar.addSlot, {
        organizationId: org,
        ...instagramMondays,
        time: "9am",
      }),
    ).rejects.toThrow(/time/);
  });

  test("a client's slot only takes that client's posts", async () => {
    const { org, ana, range, waiting } = await team();
    const clientId = await ana.as.mutation(api.clients.create, {
      organizationId: org,
      name: "Acme",
    });
    await ana.as.mutation(api.calendar.addSlot, {
      organizationId: org,
      ...instagramMondays,
      clientId,
    });
    await ana.as.mutation(api.calendar.addPost, {
      organizationId: org,
      title: "Ours",
      platform: "instagram",
      queue: true,
    });
    await ana.as.mutation(api.calendar.addPost, {
      organizationId: org,
      title: "Theirs",
      platform: "instagram",
      queue: true,
      clientId,
    });
    expect((await range()).posts.map((post) => post.title)).toEqual(["Theirs"]);
    expect((await range({ clientId })).posts.map((post) => post.title)).toEqual(["Theirs"]);
    expect((await waiting()).posts.map((post) => post.title)).toEqual(["Ours"]);
    expect((await waiting({ clientId })).posts).toEqual([]);

    // Deleting the client keeps its posts and slots for the team.
    await ana.as.mutation(api.clients.remove, { clientId });
    expect((await range()).posts[0]).toMatchObject({ title: "Theirs", client: null });
    expect((await ana.as.query(api.calendar.slots, { organizationId: org }))[0].client).toBeNull();
  });
});

describe("project slots", () => {
  test("wait in the side list until given a due date, then show on that day", async () => {
    const { org, ana, range, waiting } = await team();
    const projectId = await ana.as.mutation(api.projects.create, {
      organizationId: org,
      name: "Episode 12",
      package: "youtube_video",
    });
    const project = (await ana.as.query(api.projects.get, { projectId }))!;
    const [first] = project.slots;
    expect((await waiting()).deliverables).toHaveLength(project.slots.length);

    await ana.as.mutation(api.calendar.setDue, {
      deliverableId: first._id,
      dueAt: at("2026-11-12T17:00:00Z"),
    });
    expect((await range()).due).toEqual([
      {
        _id: first._id,
        label: first.label,
        kind: first.kind,
        status: "todo",
        dueAt: at("2026-11-12T17:00:00Z"),
        project: { _id: projectId, name: "Episode 12" },
      },
    ]);
    expect((await waiting()).deliverables).toHaveLength(project.slots.length - 1);

    await ana.as.mutation(api.calendar.setDue, { deliverableId: first._id, dueAt: null });
    expect((await range()).due).toEqual([]);
  });
});

describe("scheduled automations", () => {
  test("show when they run from now on; ones that run all day show once", async () => {
    const { t, org, ana, range } = await team();
    const base = {
      organizationId: org,
      enabled: true,
      nodes: [],
      edges: [],
      hookToken: "x",
      createdBy: "someone",
      updatedAt: NOW,
    };
    await t.run(async (ctx) => {
      await ctx.db.insert("automations", {
        ...base,
        name: "Morning digest",
        trigger: { kind: "schedule", schedule: { mode: "daily", time: "08:00", timeZone: "UTC" } },
        nextRunAt: at("2026-11-02T08:00:00Z"),
      });
      await ctx.db.insert("automations", {
        ...base,
        name: "Folder sweep",
        trigger: { kind: "schedule", schedule: { mode: "interval", minutes: 15 } },
        nextRunAt: NOW + 15 * 60_000,
      });
      await ctx.db.insert("automations", {
        ...base,
        enabled: false,
        name: "Switched off",
        trigger: { kind: "schedule", schedule: { mode: "daily", time: "09:00", timeZone: "UTC" } },
        nextRunAt: null,
      });
    });
    const { runs, repeating } = await range({ to: at("2026-11-04T00:00:00Z") });
    expect(runs.map((run) => [run.name, run.at])).toEqual([
      ["Morning digest", at("2026-11-02T08:00:00Z")],
      ["Morning digest", at("2026-11-03T08:00:00Z")],
    ]);
    expect(repeating).toMatchObject([{ name: "Folder sweep", minutes: 15 }]);
    // Another team's calendar does not show them.
    const other = await addTeam(t, "Third Team");
    const ben = await addPerson(t, "Ben", [other]);
    const theirs = await ben.as.query(api.calendar.range, { organizationId: other, ...NOVEMBER });
    expect(theirs.runs).toEqual([]);
    expect(ana).toBeDefined();
  });
});
