import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { addPerson, addTeam, backend } from "./test.setup";

type Node = Doc<"automations">["nodes"][number];

const FILE = "https://files.example/uploads/interview.mp4";
const step = (id: string, stepId: string, x: number, y = 0): Node => ({
  id,
  kind: "step",
  stepId,
  input: {},
  position: { x, y },
});
const daily = {
  kind: "schedule" as const,
  schedule: { mode: "interval" as const, minutes: 60 },
};

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  await t.run(async (ctx) => {
    await ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: "https://toolkit.example",
      apiKeyCipher: "x",
      apiKeyHint: "abcd",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: 0,
      lastError: null,
      storage: { bucket: "media", endpoint: null, publicUrl: null },
      createdBy: maya.id,
    });
  });
  // Uploads start transcribe, then a thumbnail; every hour, a trim runs on its own.
  const automationId = await t.run((ctx) =>
    ctx.db.insert("automations", {
      organizationId: team,
      name: "Two ways in",
      enabled: false,
      trigger: { kind: "upload", fileType: "video" },
      moreTriggers: [{ id: "__trigger_2", trigger: daily, starts: ["trim"] }],
      nodes: [
        step("transcribe", "media-transcribe", 0),
        step("thumb", "video-thumbnail", 220),
        step("trim", "video-trim", 0, 150),
      ],
      edges: [{ id: "e1", source: "transcribe", target: "thumb" }],
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    }),
  );
  const runsOf = () =>
    t.run((ctx) =>
      ctx.db
        .query("runs")
        .withIndex("by_automation", (q) => q.eq("automationId", automationId))
        .collect(),
    );
  return { t, team, maya, automationId, runsOf };
}

const ids = (run: Doc<"runs">) => run.nodes.map((node) => node.id);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("an automation with more than one trigger", () => {
  test("Run now does only the chosen trigger's steps and says which trigger it was", async () => {
    const { maya, automationId, runsOf } = await setUp();
    await maya.as.mutation(api.automations.runNow, { automationId, fileUrl: FILE });
    await maya.as.mutation(api.automations.runNow, { automationId, triggerId: "__trigger_2" });
    const [first, second] = await runsOf();
    expect(ids(first)).toEqual(["transcribe", "thumb"]);
    expect(first.triggerId).toBeUndefined();
    expect(ids(second)).toEqual(["trim"]);
    expect(second.edges).toEqual([]);
    expect(second.triggerId).toBe("__trigger_2");
    await expect(
      maya.as.mutation(api.automations.runNow, { automationId, triggerId: "__trigger_7" }),
    ).rejects.toThrow(/no longer on this automation/);
  });

  test("switching on schedules each schedule trigger, and the tick runs only its branch", async () => {
    vi.useFakeTimers();
    const { t, maya, automationId, runsOf } = await setUp();
    await maya.as.mutation(api.automations.setEnabled, { automationId, enabled: true });
    const on = await t.run((ctx) => ctx.db.get(automationId));
    expect(on?.scheduleTimes).toEqual([{ triggerId: "__trigger_2", at: on!.nextRunAt }]);
    expect(on?.nextRunAt).toBeGreaterThan(Date.now());

    vi.setSystemTime(on!.nextRunAt! + 1000);
    await t.mutation(internal.automations.tick, {});
    const [run] = await runsOf();
    expect(run.triggerKind).toBe("schedule");
    expect(run.triggerId).toBe("__trigger_2");
    expect(ids(run)).toEqual(["trim"]);
    const after = await t.run((ctx) => ctx.db.get(automationId));
    expect(after!.nextRunAt).toBeGreaterThan(on!.nextRunAt!);
  });

  test("an upload starts only the upload trigger's branch", async () => {
    const { t, team, maya, automationId, runsOf } = await setUp();
    await maya.as.mutation(api.automations.setEnabled, { automationId, enabled: true });
    const uploadId = await t.run((ctx) =>
      ctx.db.insert("uploads", {
        organizationId: team,
        key: "uploads/interview.mp4",
        fileName: "interview.mp4",
        contentType: "video/mp4",
        size: 1000,
        status: "ready",
        createdBy: maya.id,
      }),
    );
    const found = await t.query(internal.automations.loadUploadForTrigger, { uploadId });
    expect(found?.starts).toEqual([{ automationId, triggerId: "__trigger" }]);
    await t.mutation(internal.automations.startFromUpload, {
      starts: found!.starts,
      trigger: { file_url: FILE },
    });
    const [run] = await runsOf();
    expect(ids(run)).toEqual(["transcribe", "thumb"]);
  });

  test("a finished upload starts each automation that wants it in its own mutation", async () => {
    const { t, team, maya, automationId, runsOf } = await setUp();
    // A real key, so a link to the file can be signed.
    process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
    const apiKeyCipher = await encryptSecret("toolkit-key");
    await t.run(async (ctx) => {
      const connection = await ctx.db.query("toolkitConnections").first();
      await ctx.db.patch(connection!._id, { apiKeyCipher });
    });
    // The toolkit signs the link.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const { key } = JSON.parse(String(init.body)) as { key: string };
        return Response.json({ response: { url: `https://files.example/${key}?signed` } });
      }),
    );
    await maya.as.mutation(api.automations.setEnabled, { automationId, enabled: true });
    const automation = (await t.run((ctx) => ctx.db.get(automationId)))!;
    const { _id, _creationTime, ...copy } = automation;
    const secondId = await t.run((ctx) =>
      ctx.db.insert("automations", { ...copy, name: "Also on upload", hookToken: "token-2" }),
    );
    const uploadId = await t.run((ctx) =>
      ctx.db.insert("uploads", {
        organizationId: team,
        key: "uploads/interview.mp4",
        fileName: "interview.mp4",
        contentType: "video/mp4",
        size: 1000,
        status: "ready",
        createdBy: maya.id,
      }),
    );
    await t.action(internal.automations.uploadFinished, { uploadId });
    // Nothing has started yet: one start is waiting for each automation.
    expect(await runsOf()).toHaveLength(0);
    const waiting = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const starts = waiting.filter((each) => each.name.includes("startFromUpload"));
    expect(starts.map((each) => (each.args[0] as { starts: unknown[] }).starts)).toEqual([
      [{ automationId, triggerId: "__trigger" }],
      [{ automationId: secondId, triggerId: "__trigger" }],
    ]);
    for (const each of starts) {
      await t.mutation(internal.automations.startFromUpload, each.args[0] as never);
    }
    const runs = await t.run((ctx) => ctx.db.query("runs").collect());
    expect(runs.map((run) => run.automationId).sort()).toEqual([automationId, secondId].sort());
    const { trigger } = starts[0]!.args[0] as { trigger: Record<string, unknown> };
    expect(trigger).toMatchObject({ file_name: "interview.mp4", upload_id: uploadId });
    expect(String(trigger.file_url)).toContain("uploads/interview.mp4");
  });

  test("saving keeps every trigger and refuses one that starts nothing when switching on", async () => {
    const { t, maya, automationId } = await setUp();
    const automation = (await t.run((ctx) => ctx.db.get(automationId)))!;
    const saved = await maya.as.mutation(api.automations.save, {
      automationId,
      name: automation.name,
      trigger: automation.trigger,
      moreTriggers: [
        ...automation.moreTriggers!,
        { id: "__trigger_3", trigger: { kind: "webhook" }, starts: [] },
      ],
      nodes: automation.nodes,
      edges: automation.edges,
    });
    expect(saved.problem).toMatch(/not connected to a step/);
    const stored = await t.run((ctx) => ctx.db.get(automationId));
    expect(stored?.moreTriggers?.map((each) => each.id)).toEqual(["__trigger_2", "__trigger_3"]);
    expect(stored?.multiTrigger).toBe(true);
    await expect(
      maya.as.mutation(api.automations.setEnabled, { automationId, enabled: true }),
    ).rejects.toThrow(/not connected to a step/);
  });

  test("the agent's changes add a trigger and hang a step off it", async () => {
    const { t, maya, automationId } = await setUp();
    const described = await maya.as.mutation(api.automations.change, {
      automationId,
      operations: [
        { op: "addTrigger", trigger: { kind: "webhook" } },
        { op: "add", type: "step:video-thumbnail", id: "hook_thumb", after: "__trigger_3" },
      ],
    });
    expect(described.outline).toContain("- __trigger_3 [trigger:webhook] {} starts hook_thumb");
    expect(described.problems).toEqual([]);
    const stored = (await t.run((ctx) => ctx.db.get(automationId)))!;
    expect(stored.moreTriggers?.[1]).toEqual({
      id: "__trigger_3",
      trigger: { kind: "webhook" },
      starts: ["hook_thumb"],
    });
    // The webhook address starts only its own branch.
    await maya.as.mutation(api.automations.setEnabled, { automationId, enabled: true });
    const started = await t.mutation(internal.automations.startFromHook, {
      automationId,
      token: "token",
      body: { file_url: FILE },
    });
    expect(started.outcome).toBe("started");
    const run = await t.run((ctx) => ctx.db.get((started as { runId: Id<"runs"> }).runId));
    expect(run?.nodes.map((node) => node.id)).toEqual(["hook_thumb"]);
    expect(run?.triggerId).toBe("__trigger_3");
  });

  test("a folder trigger after the first is watched too", async () => {
    const { t, maya, automationId } = await setUp();
    await maya.as.mutation(api.automations.change, {
      automationId,
      operations: [
        {
          op: "addTrigger",
          trigger: { kind: "folder", prefix: "drop/", fileType: "video" },
          starts: ["transcribe"],
        },
      ],
    });
    await maya.as.mutation(api.automations.setEnabled, { automationId, enabled: true });
    const first = await t.query(internal.watch.watchers, {});
    expect(first.found).toEqual([]);
    expect(first.next).toEqual({ source: "several", cursor: null });
    const { found: watchers, next } = await t.query(internal.watch.watchers, first.next!);
    expect(next).toBeNull();
    expect(watchers.map(({ triggerId, prefix }) => ({ triggerId, prefix }))).toEqual([
      { triggerId: "__trigger_3", prefix: "drop/" },
    ]);
  });

  test("a follower whose second trigger waits for another automation starts that branch", async () => {
    const { t, team, maya, automationId, runsOf } = await setUp();
    const leader = await t.run((ctx) =>
      ctx.db.insert("automations", {
        organizationId: team,
        name: "Leader",
        enabled: true,
        trigger: { kind: "manual" },
        nodes: [{ ...step("off_step", "video-trim", 0), off: true }],
        edges: [],
        hookToken: "lead",
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      }),
    );
    await maya.as.mutation(api.automations.change, {
      automationId,
      operations: [
        {
          op: "trigger",
          id: "__trigger_2",
          trigger: { kind: "finished", automationId: leader, when: "done" },
        },
      ],
    });
    await maya.as.mutation(api.automations.setEnabled, { automationId, enabled: true });
    await maya.as.mutation(api.automations.runNow, { automationId: leader, fileUrl: FILE });
    const [run] = await runsOf();
    expect(run?.triggerKind).toBe("finished");
    expect(run?.triggerId).toBe("__trigger_2");
    expect(ids(run)).toEqual(["trim"]);
  });
});
