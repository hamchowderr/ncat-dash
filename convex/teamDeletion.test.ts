import { afterEach, describe, expect, test, vi } from "vitest";

import { components, internal } from "./_generated/api";
import type { TableNames } from "./_generated/dataModel";
import { KEPT_AFTER_DELETION, PURGE_TABLES } from "./lib/teamPurge";
import schema from "./schema";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

/**
 * Deleting a team takes away everything it made: its rows in every table, its folder in
 * storage and the results the toolkit wrote for its jobs. Another team on the same
 * toolkit keeps all of its own.
 */
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
afterEach(() => {
  toolkit?.restore();
  toolkit = null;
  vi.useRealTimers();
});

const JOB_OUTPUT = "ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10_output_0.mp4";
const OTHER_OUTPUT = "0b1c2d3e-5b1f-4c3e-9a77-0d2f1b6e8a10_output_0.mp4";

type Fields = Record<string, unknown>;
const tables = schema.tables as unknown as Record<
  string,
  { validator: { fields: Fields }; " indexes"(): { indexDescriptor: string; fields: string[] }[] }
>;

describe("the list of tables a deleted team is taken out of", () => {
  test("has every table that holds a team's rows, or says why one is kept", () => {
    const withTeam = Object.keys(tables).filter(
      (name) => "organizationId" in tables[name].validator.fields,
    );
    const listed = new Set(PURGE_TABLES.map((entry) => entry.table as string));
    const missing = withTeam.filter((name) => !listed.has(name) && !(name in KEPT_AFTER_DELETION));
    expect(missing).toEqual([]);
    expect(PURGE_TABLES.filter((entry) => entry.table in KEPT_AFTER_DELETION)).toEqual([]);
    expect(listed.size).toBe(PURGE_TABLES.length);
  });

  test("finds each table's rows by an index that starts with the team", () => {
    for (const entry of PURGE_TABLES) {
      const index = tables[entry.table]
        [" indexes"]()
        .find((one) => one.indexDescriptor === entry.index);
      expect(index?.fields[0], `${entry.table}.${entry.index}`).toBe("organizationId");
    }
  });

  test("ends with the toolkit connection, which the files are deleted through", () => {
    expect(PURGE_TABLES.at(-1)?.table).toBe("toolkitConnections");
    expect(PURGE_TABLES[0].table).toBe("automations");
  });
});

async function twoTeams() {
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  toolkit = fakeToolkitStorage();
  const t = backend();
  const doomed = await addTeam(t, "Example Studio");
  const maya = await addPerson(t, "Maya Ortiz", [doomed], "owner");
  const kept = await addTeam(t, "Pine Studio");
  const olu = await addPerson(t, "Olu Bello", [kept], "owner");
  await connectToolkit(t, doomed, maya.id);
  await connectToolkit(t, kept, olu.id);
  return { t, doomed, maya, kept, olu, toolkit };
}

/** A little of everything a team makes, as rows here. */
async function fillTeam(
  t: ReturnType<typeof backend>,
  organizationId: string,
  userId: string,
  output: string,
) {
  return await t.run(async (ctx) => {
    const automation = await ctx.db.insert("automations", {
      organizationId,
      name: "Clips",
      enabled: true,
      trigger: { kind: "manual" },
      nodes: [],
      edges: [],
      hookToken: `token-${organizationId}`,
      nextRunAt: null,
      createdBy: userId,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("watchedFiles", { automationId: automation, key: "in/a.mp4", etag: "1" });
    const upload = await ctx.db.insert("uploads", {
      organizationId,
      key: "uploads/1/talk.mp4",
      fileName: "talk.mp4",
      contentType: "video/mp4",
      size: 1000,
      status: "ready",
      createdBy: userId,
    });
    const connection = (await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .first())!;
    const job = await ctx.db.insert("jobs", {
      organizationId,
      connectionId: connection._id,
      stepId: "video-thumbnail",
      input: {},
      status: "done",
      webhookToken: "w",
      toolkitJobId: "j",
      outputs: [`https://r2.example/test-bucket/${output}`],
      error: null,
      createdBy: userId,
      startedAt: 1,
      finishedAt: 2,
    });
    const review = await ctx.db.insert("reviews", {
      organizationId,
      title: "Cut one",
      status: "open",
      createdBy: userId,
    });
    const clip = await ctx.db.insert("reviewClips", {
      reviewId: review,
      organizationId,
      title: "Cut one",
      versions: [{ url: "https://r2.example/test-bucket/cut.mp4", addedBy: userId, addedAt: 1 }],
    });
    const comment = await ctx.db.insert("reviewComments", {
      reviewId: review,
      clipId: clip,
      organizationId,
      version: 0,
      time: 0,
      body: "Tighten the start",
      authorId: userId,
      authorName: "Maya Ortiz",
      resolved: false,
    });
    await ctx.db.insert("slackReplies", {
      slackTeamId: "T1",
      channelId: "C1",
      ts: `${organizationId}.1`,
      commentId: comment,
    });
    await ctx.db.insert("notificationPreferences", { organizationId, userId });
    return { automation, upload, job, comment };
  });
}

async function runAll(t: ReturnType<typeof backend>) {
  vi.useFakeTimers();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("deleting a team", () => {
  test("takes away its rows, its folder in storage and its jobs' results, and nothing of another team's", async () => {
    const { t, doomed, maya, kept, olu, toolkit } = await twoTeams();
    const gone = await fillTeam(t, doomed, maya.id, JOB_OUTPUT);
    const stays = await fillTeam(t, kept, olu.id, OTHER_OUTPUT);
    toolkit.put(`teams/${doomed}/uploads/1/talk.mp4`);
    toolkit.put(`teams/${doomed}/Finished/Clips/clip.mp4`);
    toolkit.put(JOB_OUTPUT);
    toolkit.put(`teams/${kept}/uploads/1/talk.mp4`);
    toolkit.put(OTHER_OUTPUT);

    await t.mutation(internal.teamDeletion.begin, {
      organizationId: doomed,
      name: "Example Studio",
      by: maya.id,
      reason: "team",
    });
    await runAll(t);

    const left = [...toolkit.files.keys()];
    expect(left.filter((key) => key.startsWith(`teams/${doomed}/`) || key === JOB_OUTPUT)).toEqual(
      [],
    );
    expect(left).toContain(`teams/${kept}/uploads/1/talk.mp4`);
    expect(left).toContain(OTHER_OUTPUT);
    await t.run(async (ctx) => {
      expect(await ctx.db.get(gone.automation)).toBeNull();
      expect(await ctx.db.get(gone.upload)).toBeNull();
      expect(await ctx.db.get(gone.job)).toBeNull();
      expect(await ctx.db.get(gone.comment)).toBeNull();
      expect(await ctx.db.query("watchedFiles").collect()).toHaveLength(1);
      expect(
        (await ctx.db.query("slackReplies").collect()).map((reply) => reply.commentId),
      ).toEqual([stays.comment]);
      for (const entry of PURGE_TABLES) {
        const left = await (
          ctx.db.query(entry.table as TableNames) as unknown as {
            collect(): Promise<{ organizationId?: string }[]>;
          }
        ).collect();
        expect(
          left.filter((row) => row.organizationId === doomed),
          entry.table,
        ).toEqual([]);
      }
      // The other team keeps everything.
      expect(await ctx.db.get(stays.automation)).not.toBeNull();
      expect(await ctx.db.get(stays.upload)).not.toBeNull();
      expect(await ctx.db.get(stays.job)).not.toBeNull();
    });

    const record = await t.query(internal.teamDeletion.status, { organizationId: doomed });
    expect(record).toMatchObject({ phase: "done", filesDeleted: 3, reason: "team" });
    expect(record?.rowsDeleted).toBeGreaterThan(5);
    expect(record?.filesProblem).toBeUndefined();
  });

  test("keeps the trial record, so deleting a team doesn't give a fresh free trial", async () => {
    const { t, doomed, maya } = await twoTeams();
    await t.run((ctx) =>
      ctx.db.insert("teamTrials", {
        organizationId: doomed,
        startedAt: Date.now(),
        endsAt: Date.now() + 1000,
        ownerId: maya.id,
        emailKey: "hash",
      }),
    );
    await t.mutation(internal.teamDeletion.begin, {
      organizationId: doomed,
      name: "Example Studio",
      by: maya.id,
      reason: "team",
    });
    await runAll(t);
    const trials = await t.run((ctx) => ctx.db.query("teamTrials").collect());
    expect(trials.map((trial) => trial.organizationId)).toEqual([doomed]);
  });

  test("starting twice deletes once", async () => {
    const { t, doomed, maya } = await twoTeams();
    for (let i = 0; i < 2; i++) {
      await t.mutation(internal.teamDeletion.begin, {
        organizationId: doomed,
        name: "Example Studio",
        by: maya.id,
        reason: "team",
      });
    }
    await runAll(t);
    const records = await t.run((ctx) => ctx.db.query("teamDeletions").collect());
    expect(records).toHaveLength(1);
  });

  test("ends the AI agents connected to the team", async () => {
    const { t, doomed, maya, kept, olu } = await twoTeams();
    const consent = (referenceId: string, userId: string) =>
      t.run((ctx) =>
        ctx.runMutation(components.betterAuth.adapter.create, {
          input: {
            model: "oauthConsent",
            data: {
              clientId: "https://agent.example/client.json",
              userId,
              referenceId,
              scopes: ["openid"],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          } as never,
        }),
      );
    await consent(doomed, maya.id);
    await consent(kept, olu.id);
    await t.mutation(internal.teamDeletion.begin, {
      organizationId: doomed,
      name: "Example Studio",
      by: maya.id,
      reason: "team",
    });
    const left = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.agents.forTeam, { organizationId: doomed }),
    );
    expect(left).toEqual([]);
    const other = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.agents.forTeam, { organizationId: kept }),
    );
    expect(other).toHaveLength(1);
  });

  test("when storage can't be reached after every try, the rows still go and the record says so", async () => {
    process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
    toolkit = fakeToolkitStorage();
    const t = backend();
    const doomed = await addTeam(t, "Example Studio");
    const maya = await addPerson(t, "Maya Ortiz", [doomed], "owner");
    await connectToolkit(t, doomed, maya.id);
    await fillTeam(t, doomed, maya.id, JOB_OUTPUT);
    toolkit.restore();
    toolkit = fakeToolkitStorage({ broken: "The bucket is not there." });

    await t.mutation(internal.teamDeletion.begin, {
      organizationId: doomed,
      name: "Example Studio",
      by: maya.id,
      reason: "team",
    });
    await runAll(t);
    const record = await t.query(internal.teamDeletion.status, { organizationId: doomed });
    expect(record?.phase).toBe("done");
    expect(record?.filesProblem).toContain("The bucket is not there.");
    const automations = await t.run((ctx) => ctx.db.query("automations").collect());
    expect(automations).toEqual([]);
  });

  test("a team with no storage connected only loses its rows", async () => {
    const t = backend();
    const doomed = await addTeam(t, "Example Studio");
    const maya = await addPerson(t, "Maya Ortiz", [doomed], "owner");
    await t.run((ctx) =>
      ctx.db.insert("automationFolders", {
        organizationId: doomed,
        name: "Shows",
        createdBy: maya.id,
      }),
    );
    await t.mutation(internal.teamDeletion.begin, {
      organizationId: doomed,
      name: "Example Studio",
      by: maya.id,
      reason: "team",
    });
    await runAll(t);
    expect(await t.run((ctx) => ctx.db.query("automationFolders").collect())).toEqual([]);
    expect(await t.query(internal.teamDeletion.status, { organizationId: doomed })).toMatchObject({
      phase: "done",
      filesDeleted: 0,
    });
  });
});

describe("data left behind by teams deleted before this", () => {
  test("is found, and cleaned up only once the team is really gone", async () => {
    const t = backend();
    const live = await addTeam(t, "Pine Studio");
    const gone = "k57abc0000000000000000000000000";
    for (const organizationId of [live, gone]) {
      await t.run((ctx) => ctx.db.insert("teamSettings", { organizationId, maxParallelJobs: 2 }));
    }
    expect(await t.query(internal.teamDeletion.findLeftovers, {})).toEqual([gone]);
    expect(
      await t.mutation(internal.teamDeletion.cleanUpLeftovers, { organizationId: live }),
    ).toMatch(/still exists/);
    expect(await t.mutation(internal.teamDeletion.cleanUpLeftovers, { organizationId: gone })).toBe(
      "Started.",
    );
    await runAll(t);
    const settings = await t.run((ctx) => ctx.db.query("teamSettings").collect());
    expect(settings.map((row) => row.organizationId)).toEqual([live]);
    expect(await t.query(internal.teamDeletion.findLeftovers, {})).toEqual([]);
  });
});

describe("Better Auth's own team delete", () => {
  test("starts the clean-up once the team is gone", async () => {
    const { createAuthOptions } = await import("./auth");
    const runMutation = vi.fn();
    const ctx = { runMutation, runQuery: vi.fn(), runAction: vi.fn(), scheduler: {} };
    const options = createAuthOptions(ctx as never);
    const organization = options.plugins.find(
      (plugin) => plugin.id === "organization",
    ) as unknown as {
      options: {
        organizationHooks: {
          afterDeleteOrganization: (data: {
            organization: { id: string; name: string };
            user: { id: string };
          }) => Promise<void>;
        };
      };
    };
    await organization.options.organizationHooks.afterDeleteOrganization({
      organization: { id: "team_9", name: "Example Studio" },
      user: { id: "user_1" },
    });
    expect(runMutation).toHaveBeenCalledWith(internal.teamDeletion.begin, {
      organizationId: "team_9",
      name: "Example Studio",
      by: "user_1",
      reason: "team",
    });
  });
});
