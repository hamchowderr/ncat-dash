import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

const SHARED = "https://toolkit.shared.example";

// Every team on the toolkit the operator lends shares one total of jobs at once
// (HOSTED_TOOLKIT_JOBS_AT_ONCE). Waiting teams take turns, one job each, so one team's big
// batch cannot hold up the rest. Sending itself is held back by a fake clock throughout.
describe("the toolkit teams share", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("HOSTED_TOOLKIT_URL", SHARED);
    vi.stubEnv("HOSTED_TOOLKIT_JOBS_AT_ONCE", "2");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  async function world() {
    const t = backend();
    const made = new Map<string, { connectionId: Id<"toolkitConnections">; personId: string }>();
    async function team(name: string, baseUrl = SHARED) {
      const organizationId = await addTeam(t, name);
      const person = await addPerson(t, `${name} Owner`, [organizationId]);
      const connectionId = await t.run((ctx) =>
        ctx.db.insert("toolkitConnections", {
          organizationId,
          baseUrl,
          apiKeyCipher: "x",
          apiKeyHint: "abcd",
          status: "ok",
          buildNumber: null,
          lastCheckedAt: 0,
          lastError: null,
          createdBy: person.id,
        }),
      );
      made.set(organizationId, { connectionId, personId: person.id });
      return organizationId;
    }
    async function wait(organizationId: string, count: number) {
      const { connectionId, personId } = made.get(organizationId)!;
      const ids: Id<"jobs">[] = [];
      for (let i = 0; i < count; i++) {
        ids.push(
          await t.run((ctx) =>
            ctx.db.insert("jobs", {
              organizationId,
              connectionId,
              stepId: "media-metadata",
              input: { media_url: `https://files.example/${organizationId}-${i}.mp4` },
              status: "queued",
              webhookToken: "token",
              toolkitJobId: null,
              outputs: [],
              error: null,
              createdBy: personId,
              startedAt: null,
              finishedAt: null,
            }),
          ),
        );
      }
      return ids;
    }
    const pump = (organizationId: string) => t.mutation(internal.jobs.pumpTeam, { organizationId });
    const sent = (organizationId: string) =>
      t.run(
        async (ctx) =>
          (
            await ctx.db
              .query("jobs")
              .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
              .collect()
          ).filter((job) => job.dispatchedAt !== undefined && job.status === "queued").length,
      );
    async function finishOne(organizationId: string) {
      await t.run(async (ctx) => {
        const job = (
          await ctx.db
            .query("jobs")
            .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
            .collect()
        ).find((one) => one.dispatchedAt !== undefined && one.status === "queued")!;
        await ctx.db.patch(job._id, { status: "done", finishedAt: Date.now() });
      });
      await pump(organizationId);
    }
    return { t, team, wait, pump, sent, finishOne };
  }

  test("sends no more than the total, while a team's own toolkit is not held to it", async () => {
    const { team, wait, pump, sent } = await world();
    const big = await team("Big Batch");
    const own = await team("Own Toolkit", "https://toolkit.own.example");
    await wait(big, 5);
    await wait(own, 3);
    await pump(big);
    await pump(own);
    expect(await sent(big)).toBe(2);
    // Its own limit of 3 at once, untouched by the shared total.
    expect(await sent(own)).toBe(3);
  });

  test("gives each waiting team a turn instead of finishing one team's batch first", async () => {
    const { team, wait, pump, sent, finishOne } = await world();
    const big = await team("Big Batch");
    const small = await team("Small Shop");
    await wait(big, 6);
    await pump(big);
    expect(await sent(big)).toBe(2);
    await wait(small, 2);
    await pump(small);
    // Full: the small team waits, but it is next in line.
    expect(await sent(small)).toBe(0);

    await finishOne(big);
    expect(await sent(small)).toBe(1);
    expect(await sent(big)).toBe(1);
    // The next free place goes to the team served longest ago: the big one.
    await finishOne(big);
    expect(await sent(big)).toBe(1);
    expect(await sent(small)).toBe(1);
    // And then back to the small one.
    await finishOne(big);
    expect(await sent(small)).toBe(2);
    expect(await sent(big)).toBe(0);
  });

  test("still holds each team to its own limit under the total", async () => {
    vi.stubEnv("HOSTED_TOOLKIT_JOBS_AT_ONCE", "10");
    const { t, team, wait, pump, sent } = await world();
    const one = await team("One At A Time");
    await t.run((ctx) =>
      ctx.db.insert("teamSettings", { organizationId: one, maxParallelJobs: 1 }),
    );
    await wait(one, 4);
    await pump(one);
    expect(await sent(one)).toBe(1);
  });

  test("lets a team go of its place once nothing of its is waiting", async () => {
    const { t, team, wait, pump, finishOne } = await world();
    const shop = await team("Small Shop");
    await wait(shop, 3);
    await pump(shop);
    const turns = () => t.run((ctx) => ctx.db.query("toolkitTurns").collect());
    expect(await turns()).toHaveLength(1);
    await finishOne(shop);
    expect(await turns()).toHaveLength(0);
  });

  test("changes nothing when no total is set", async () => {
    vi.stubEnv("HOSTED_TOOLKIT_JOBS_AT_ONCE", "");
    const { t, team, wait, pump, sent } = await world();
    const big = await team("Big Batch");
    await wait(big, 5);
    await pump(big);
    expect(await sent(big)).toBe(3);
    expect(await t.run((ctx) => ctx.db.query("toolkitTurns").collect())).toHaveLength(0);
  });
});

// With no total set, the toolkit's own count of workers is the total.
describe("the total taken from the toolkit's workers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("HOSTED_TOOLKIT_URL", SHARED);
    vi.stubEnv("HOSTED_TOOLKIT_JOBS_AT_ONCE", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  async function shop(t: ReturnType<typeof backend>, count: number) {
    const organizationId = await addTeam(t, "Small Shop");
    const person = await addPerson(t, "Small Shop Owner", [organizationId]);
    const connectionId = await t.run((ctx) =>
      ctx.db.insert("toolkitConnections", {
        organizationId,
        baseUrl: SHARED,
        apiKeyCipher: "x",
        apiKeyHint: "abcd",
        status: "ok",
        buildNumber: null,
        lastCheckedAt: 0,
        lastError: null,
        createdBy: person.id,
      }),
    );
    for (let i = 0; i < count; i++) {
      await t.run((ctx) =>
        ctx.db.insert("jobs", {
          organizationId,
          connectionId,
          stepId: "media-metadata",
          input: { media_url: `https://files.example/${i}.mp4` },
          status: "queued",
          webhookToken: "token",
          toolkitJobId: null,
          outputs: [],
          error: null,
          createdBy: person.id,
          startedAt: null,
          finishedAt: null,
        }),
      );
    }
    const sent = () =>
      t.run(
        async (ctx) =>
          (await ctx.db.query("jobs").collect()).filter(
            (job) => job.dispatchedAt !== undefined && job.status === "queued",
          ).length,
      );
    return { organizationId, sent };
  }

  test("uses the number of workers the toolkit reports", async () => {
    const t = backend();
    await t.mutation(internal.toolkitHealth.recordShared, { workers: 1 });
    const { organizationId, sent } = await shop(t, 3);
    await t.mutation(internal.jobs.pumpTeam, { organizationId });
    expect(await sent()).toBe(1);
  });

  test("sends waiting jobs at once when the toolkit gains workers", async () => {
    const t = backend();
    await t.mutation(internal.toolkitHealth.recordShared, { workers: 1 });
    const { organizationId, sent } = await shop(t, 3);
    await t.mutation(internal.jobs.pumpTeam, { organizationId });
    await t.mutation(internal.toolkitHealth.recordShared, { workers: 2 });
    expect(await sent()).toBe(2);
  });

  test("stops trusting a count that is old", async () => {
    const t = backend();
    await t.mutation(internal.toolkitHealth.recordShared, { workers: 1 });
    vi.advanceTimersByTime(31 * 60 * 1000);
    const { organizationId, sent } = await shop(t, 4);
    await t.mutation(internal.jobs.pumpTeam, { organizationId });
    // Back to the team's own limit of 3.
    expect(await sent()).toBe(3);
  });

  test("lets the setting override the count", async () => {
    vi.stubEnv("HOSTED_TOOLKIT_JOBS_AT_ONCE", "2");
    const t = backend();
    await t.mutation(internal.toolkitHealth.recordShared, { workers: 1 });
    const { organizationId, sent } = await shop(t, 3);
    await t.mutation(internal.jobs.pumpTeam, { organizationId });
    expect(await sent()).toBe(2);
  });
});
