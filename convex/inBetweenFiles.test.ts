import { afterEach, describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { KEEP_IN_BETWEEN_DAYS } from "./inBetweenFiles";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

/**
 * The daily clean-up takes away the files a team's runs made in the middle, once the run
 * finished a week ago and nothing points to them. A run's results, the files a team uses
 * elsewhere, other teams' files and files of runs not done well are left alone.
 */
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
afterEach(() => toolkit?.restore());

const LINK = "https://r2.example/test-bucket";
const DAY = 24 * 60 * 60 * 1000;
const OLD = Date.now() - (KEEP_IN_BETWEEN_DAYS + 1) * DAY;

async function setUp() {
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  toolkit = fakeToolkitStorage();
  const t = backend();
  const salt = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [salt], "owner");
  await connectToolkit(t, salt, maya.id);
  const pine = await addTeam(t, "Pine Studio");
  const olu = await addPerson(t, "Olu Bello", [pine], "owner");
  await connectToolkit(t, pine, olu.id);
  return { t, salt, maya, pine, olu, toolkit };
}

/**
 * A two-step run: "cut" makes `middle`, which "caption" reads to make `last`. Each file
 * is in the bucket and each step has its job.
 */
async function addRun(
  t: ReturnType<typeof backend>,
  organizationId: string,
  userId: string,
  name: string,
  {
    status = "done" as "done" | "failed" | "running" | "cancelled",
    finishedAt = OLD as number | null,
  } = {},
) {
  const middle = `${LINK}/${name}-cut_output_0.mp4`;
  const last = `${LINK}/${name}-caption_output_0.mp4`;
  toolkit!.put(`${name}-cut_output_0.mp4`);
  toolkit!.put(`${name}-caption_output_0.mp4`);
  return await t.run(async (ctx) => {
    const connection = (await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .first())!;
    const automationId = await ctx.db.insert("automations", {
      organizationId,
      name: "Shorts",
      enabled: true,
      trigger: { kind: "manual" },
      nodes: [],
      edges: [],
      hookToken: `token-${name}`,
      nextRunAt: null,
      createdBy: userId,
      updatedAt: Date.now(),
    });
    const runId = await ctx.db.insert("runs", {
      organizationId,
      automationId,
      automationName: "Shorts",
      status,
      triggerKind: "manual",
      trigger: {},
      nodes: [
        { id: "cut", kind: "step", stepId: "video-cut", input: {}, position: { x: 0, y: 0 } },
        {
          id: "caption",
          kind: "step",
          stepId: "video-caption",
          input: {},
          position: { x: 1, y: 0 },
        },
      ],
      edges: [{ id: "e", source: "cut", target: "caption" }],
      error: null,
      startedBy: null,
      finishedAt,
    });
    const jobIds: Id<"jobs">[] = [];
    for (const [nodeId, output] of [
      ["cut", middle],
      ["caption", last],
    ] as const) {
      const runStepId = await ctx.db.insert("runSteps", {
        runId,
        organizationId,
        nodeId,
        status: "done",
        jobIds: [],
        outputs: [output],
        error: null,
        startedAt: 0,
        finishedAt: 0,
      });
      jobIds.push(
        await ctx.db.insert("jobs", {
          organizationId,
          connectionId: connection._id,
          stepId: nodeId === "cut" ? "video-cut" : "video-caption",
          input: {},
          status: "done",
          webhookToken: "w",
          toolkitJobId: name,
          outputs: [output],
          error: null,
          createdBy: userId,
          startedAt: 1,
          finishedAt: 2,
          runStepId,
        }),
      );
    }
    return { runId, middle, last, jobIds };
  });
}

const inBucket = (name: string) => toolkit!.files.has(name);

describe("the daily clean-up of in-between files", () => {
  test("takes away a finished run's in-between file and keeps its result", async () => {
    const { t, salt, maya } = await setUp();
    const run = await addRun(t, salt, maya.id, "a");
    const removed = await t.action(internal.inBetweenFiles.clearTeam, {
      organizationId: salt,
      cursor: null,
    });
    expect(removed).toBe(1);
    expect(inBucket("a-cut_output_0.mp4")).toBe(false);
    expect(inBucket("a-caption_output_0.mp4")).toBe(true);
    // Both jobs are done with and not read again.
    const jobs = await t.run((ctx) => Promise.all(run.jobIds.map((id) => ctx.db.get(id))));
    expect(jobs.every((job) => typeof job?.outputsClearedAt === "number")).toBe(true);
    // A second day finds nothing more.
    expect(
      await t.action(internal.inBetweenFiles.clearTeam, { organizationId: salt, cursor: null }),
    ).toBe(0);
  });

  test("waits a week after the run finished", async () => {
    const { t, salt, maya } = await setUp();
    const run = await addRun(t, salt, maya.id, "b", { finishedAt: Date.now() - DAY });
    await t.action(internal.inBetweenFiles.clearTeam, { organizationId: salt, cursor: null });
    expect(inBucket("b-cut_output_0.mp4")).toBe(true);
    // Not marked, so a later day looks again.
    const job = await t.run((ctx) => ctx.db.get(run.jobIds[0]!));
    expect(job?.outputsClearedAt).toBeUndefined();
  });

  test("leaves runs that failed, were stopped or are still going", async () => {
    const { t, salt, maya } = await setUp();
    await addRun(t, salt, maya.id, "f", { status: "failed" });
    await addRun(t, salt, maya.id, "s", { status: "cancelled" });
    await addRun(t, salt, maya.id, "r", { status: "running", finishedAt: null });
    await t.action(internal.inBetweenFiles.clearTeam, { organizationId: salt, cursor: null });
    for (const name of ["f", "s", "r"]) expect(inBucket(`${name}-cut_output_0.mp4`)).toBe(true);
  });

  test("keeps an in-between file the team uses in the library, a review or a deliverable", async () => {
    const { t, salt, maya } = await setUp();
    const inLibrary = await addRun(t, salt, maya.id, "l");
    const inReview = await addRun(t, salt, maya.id, "v");
    const inProject = await addRun(t, salt, maya.id, "p");
    await t.run(async (ctx) => {
      await ctx.db.insert("libraryItems", {
        organizationId: salt,
        shortId: "C1",
        kind: "video",
        source: "automation",
        title: "Cut",
        url: inLibrary.middle,
        tags: [],
        searchText: "",
        createdBy: maya.id,
      });
      const reviewId = await ctx.db.insert("reviews", {
        organizationId: salt,
        title: "Cut one",
        status: "open",
        createdBy: maya.id,
      });
      await ctx.db.insert("reviewClips", {
        reviewId,
        organizationId: salt,
        title: "Cut one",
        versions: [{ url: inReview.middle, addedBy: maya.id, addedAt: 1 }],
      });
      const projectId = await ctx.db.insert("projects", {
        organizationId: salt,
        name: "Launch",
        package: "custom",
        createdBy: maya.id,
        updatedAt: 1,
      });
      await ctx.db.insert("deliverables", {
        projectId,
        organizationId: salt,
        kind: "video",
        label: "Short 1",
        order: 0,
        status: "todo",
        versions: [{ url: inProject.middle, addedBy: null, addedAt: 1 }],
        updatedAt: 1,
      });
    });
    const removed = await t.action(internal.inBetweenFiles.clearTeam, {
      organizationId: salt,
      cursor: null,
    });
    expect(removed).toBe(0);
    for (const name of ["l", "v", "p"]) expect(inBucket(`${name}-cut_output_0.mp4`)).toBe(true);
  });

  test("works only from the team's own jobs, never another team's", async () => {
    const { t, salt, maya, pine, olu } = await setUp();
    await addRun(t, salt, maya.id, "mine");
    await addRun(t, pine, olu.id, "theirs");
    await t.action(internal.inBetweenFiles.clearTeam, { organizationId: salt, cursor: null });
    expect(inBucket("mine-cut_output_0.mp4")).toBe(false);
    expect(inBucket("theirs-cut_output_0.mp4")).toBe(true);
  });

  test("never takes away a file inside a team's folder, or a job's not sent by a run", async () => {
    const { t, salt, maya } = await setUp();
    const inFolder = `teams/${salt}/Finished/Shorts/cut.mp4`;
    toolkit!.put(inFolder);
    toolkit!.put("agent_output_0.mp4");
    await t.run(async (ctx) => {
      const connection = (await ctx.db
        .query("toolkitConnections")
        .withIndex("by_organization", (q) => q.eq("organizationId", salt))
        .first())!;
      await ctx.db.insert("jobs", {
        organizationId: salt,
        connectionId: connection._id,
        stepId: "video-cut",
        input: {},
        status: "done",
        webhookToken: "w",
        toolkitJobId: "agent",
        outputs: [`${LINK}/agent_output_0.mp4`, `${LINK}/${inFolder}`],
        error: null,
        createdBy: maya.id,
        startedAt: 1,
        finishedAt: 2,
      });
    });
    await t.action(internal.inBetweenFiles.clearTeam, { organizationId: salt, cursor: null });
    expect(inBucket("agent_output_0.mp4")).toBe(true);
    expect(inBucket(inFolder)).toBe(true);
  });

  test("when storage does not answer, nothing is marked and the next day tries again", async () => {
    const { t, salt, maya } = await setUp();
    const run = await addRun(t, salt, maya.id, "x");
    toolkit!.restore();
    const files = toolkit!.files;
    toolkit = fakeToolkitStorage({ broken: "The bucket is not there." });
    await t.action(internal.inBetweenFiles.clearTeam, { organizationId: salt, cursor: null });
    expect(files.has("x-cut_output_0.mp4")).toBe(true);
    const job = await t.run((ctx) => ctx.db.get(run.jobIds[0]!));
    expect(job?.outputsClearedAt).toBeUndefined();
  });

  test("the daily run gives each team with storage its turn", async () => {
    const { t } = await setUp();
    const teams = await t.mutation(internal.inBetweenFiles.daily, {});
    expect(teams).toBe(2);
  });
});
