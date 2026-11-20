import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/creator_take.mp4";
const CUT = "https://files.example/out/cut.mp4";
const CAPTIONED = "https://files.example/out/captioned.mp4";

type Node = Doc<"automations">["nodes"][number];
type Trigger = Doc<"automations">["trigger"];

const at = (x: number) => ({ x, y: 0 });
const step = (id: string, stepId: string, x: number): Node => ({
  id,
  kind: "step",
  stepId,
  input: stepId === "video-caption" ? { settings: { style: "classic" } } : {},
  position: at(x),
});
const approval = (id: string, x: number, input: Record<string, unknown> = {}): Node => ({
  id,
  kind: "approval",
  input,
  position: at(x),
});
const line = (...ids: string[]) =>
  ids.slice(1).map((target, index) => ({ id: `e${index}`, source: ids[index], target }));

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const jon = await addPerson(t, "Jon Bell", [team]);
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
      createdBy: maya.id,
    });
  });

  const add = (
    name: string,
    nodes: Node[],
    edges: Doc<"automations">["edges"] = [],
    trigger: Trigger = { kind: "manual" },
    extra: Partial<Doc<"automations">> = {},
  ) =>
    t.run((ctx) =>
      ctx.db.insert("automations", {
        organizationId: team,
        name,
        enabled: false,
        trigger,
        nodes,
        edges,
        hookToken: `token-${name}`,
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
        ...extra,
      }),
    );

  /** Cut, then (when Cut works) Captions with its own Approval step at the end. */
  const chain = async () => {
    const cut = await add("Cut", [step("trim", "video-trim", 0), approval("check", 220)], line("trim", "check"));
    const captions = await add(
      "Captions",
      [step("caption", "video-caption", 0), approval("approve", 220, { reviewers: [jon.id] })],
      line("caption", "approve"),
      { kind: "finished", automationId: cut, when: "done" },
    );
    return { cut, captions };
  };

  const start = (automationId: Id<"automations">, test?: string) =>
    t.run(async (ctx) => {
      const automation = (await ctx.db.get(automationId))!;
      const started = await startRun(
        ctx,
        automation,
        "manual",
        { file_url: FILE },
        maya.id,
        test ? { test } : {},
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });

  const look = (runId: Id<"runs">) =>
    t.run(async (ctx) => {
      const run = (await ctx.db.get(runId))!;
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
      const byNode = Object.fromEntries(steps.map((one) => [one.nodeId, one]));
      const jobs = await Promise.all(steps.flatMap((one) => one.jobIds).map((id) => ctx.db.get(id)));
      return { run, byNode, jobs: jobs.filter((job) => job !== null) };
    });

  const runsOf = (automationId: Id<"automations">) =>
    t.run((ctx) =>
      ctx.db
        .query("runs")
        .withIndex("by_automation", (q) => q.eq("automationId", automationId))
        .collect(),
    );

  const finish = (jobId: Id<"jobs">, result: string | null) =>
    t.mutation(internal.jobs.finish, {
      jobId,
      ok: result !== null,
      ...(result !== null ? { result } : { error: "FFmpeg gave up." }),
      permanent: true,
    });

  /** Finishes a captions run's jobs: the timed words, then the burn. */
  const caption = async (runId: Id<"runs">) => {
    const words = (await look(runId)).jobs[0];
    await finish(words._id, "https://files.example/out/words.ass");
    const burn = (await look(runId)).jobs.find((job) => job.stepId === "ffmpeg-compose")!;
    await finish(burn._id, CAPTIONED);
  };

  return { t, team, maya, jon, add, chain, start, look, runsOf, finish, caption };
}

describe("making a workflow", () => {
  test("proposes one from the chain: named after the first, reviewed, reviewers from its approvals", async () => {
    const { maya, chain } = await setUp();
    const { cut, captions } = await chain();
    const seen = await maya.as.query(api.workflows.forAutomation, { automationId: captions });
    expect(seen?.workflow).toBeNull();
    expect(seen?.proposal).toMatchObject({
      name: "Cut",
      kind: "own",
      clientId: null,
      review: { on: true, reviewers: [] },
      automations: [
        { automationId: cut, end: false, ownApproval: true },
        { automationId: captions, end: true, ownApproval: true },
      ],
    });
    // The first Approval step found is Cut's, which names nobody.
    expect(seen?.proposal.review.reviewers).toEqual([]);
  });

  test("makes it once, lists it, and refuses a second one for the same chain", async () => {
    const { maya, jon, team, chain } = await setUp();
    const { cut, captions } = await chain();
    const workflowId = await maya.as.mutation(api.workflows.create, {
      automationId: cut,
      name: "Weekly UGC",
      kind: "ugc",
      review: { reviewers: [jon.id], timeLimit: 2, timeLimitUnit: "days", whenTimeUp: "approve" },
    });
    const [listed] = await maya.as.query(api.workflows.list, { organizationId: team });
    expect(listed).toMatchObject({
      workflowId,
      name: "Weekly UGC",
      kind: "ugc",
      review: { on: true, reviewers: [jon.id], timeLimit: 2, timeLimitUnit: "days", whenTimeUp: "approve" },
      reviewWords: "Jon Bell, approves after 2 days",
      on: "off",
      joinedTo: null,
    });
    expect(listed.automations.map((each) => each.automationId)).toEqual([cut, captions]);
    await expect(
      maya.as.mutation(api.workflows.create, { automationId: captions }),
    ).rejects.toThrow("already the Weekly UGC workflow");
  });

  test("a quick personal job comes without a review, and changing the kind brings its default", async () => {
    const { maya, team, chain } = await setUp();
    const { cut } = await chain();
    const workflowId = await maya.as.mutation(api.workflows.create, { automationId: cut, kind: "quick" });
    const read = async () => (await maya.as.query(api.workflows.list, { organizationId: team }))[0];
    expect((await read()).review.on).toBe(false);
    await maya.as.mutation(api.workflows.update, { workflowId, kind: "client" });
    expect((await read()).review.on).toBe(true);
    // Sent together, the person's own choice wins over the kind's default.
    await maya.as.mutation(api.workflows.update, { workflowId, kind: "quick", review: { on: true } });
    expect((await read()).review.on).toBe(true);
    await expect(
      maya.as.mutation(api.workflows.update, { workflowId, review: { timeLimit: 8, timeLimitUnit: "days" } }),
    ).rejects.toThrow("6 days at most");
    await maya.as.mutation(api.workflows.update, { workflowId, review: { timeLimit: 3, timeLimitUnit: "hours" } });
    expect((await read()).review.timeLimit).toBe(3);
    await maya.as.mutation(api.workflows.update, { workflowId, review: { timeLimit: 0 } });
    expect((await read()).review.timeLimit).toBeUndefined();
  });

  test("its client is put on every automation in it", async () => {
    const { t, maya, team, chain } = await setUp();
    const { cut, captions } = await chain();
    const client = await t.run((ctx) =>
      ctx.db.insert("clients", { organizationId: team, name: "Brightside", createdBy: maya.id }),
    );
    const workflowId = await maya.as.mutation(api.workflows.create, { automationId: cut, clientId: client });
    const clientOf = (id: Id<"automations">) => t.run(async (ctx) => (await ctx.db.get(id))?.clientId);
    expect(await clientOf(cut)).toBe(client);
    expect(await clientOf(captions)).toBe(client);
    const [listed] = await maya.as.query(api.workflows.list, { organizationId: team });
    expect(listed).toMatchObject({ clientName: "Brightside", kind: "client" });
    await maya.as.mutation(api.workflows.update, { workflowId, clientId: null });
    expect((await clientOf(captions)) ?? null).toBeNull();
  });

  test("a chain that is already a client's is proposed as client work", async () => {
    const { t, maya, team, add } = await setUp();
    const client = await t.run((ctx) =>
      ctx.db.insert("clients", { organizationId: team, name: "Brightside", createdBy: maya.id }),
    );
    const only = await add("Ads", [step("trim", "video-trim", 0)], [], { kind: "manual" }, { clientId: client });
    const seen = await maya.as.query(api.workflows.forAutomation, { automationId: only });
    expect(seen?.proposal).toMatchObject({ kind: "client", clientId: client, review: { on: true } });
  });

  test("switches every automation on or off together, or says which one cannot be", async () => {
    const { t, maya, team, add, chain } = await setUp();
    const { cut, captions } = await chain();
    const workflowId = await maya.as.mutation(api.workflows.create, { automationId: cut });
    await maya.as.mutation(api.workflows.setOn, { workflowId, on: true });
    const enabled = (id: Id<"automations">) => t.run(async (ctx) => (await ctx.db.get(id))?.enabled);
    expect([await enabled(cut), await enabled(captions)]).toEqual([true, true]);
    expect((await maya.as.query(api.workflows.list, { organizationId: team }))[0].on).toBe("on");

    await maya.as.mutation(api.automations.setEnabled, { automationId: cut, enabled: false });
    expect((await maya.as.query(api.workflows.list, { organizationId: team }))[0].on).toBe("partly");
    await maya.as.mutation(api.workflows.setOn, { workflowId, on: false });
    expect([await enabled(cut), await enabled(captions)]).toEqual([false, false]);

    // A third automation joins by following Captions, but has a step with nothing picked.
    const broken = await add("Thumbnail", [{ id: "x", kind: "step", input: {}, position: at(0) }], [], {
      kind: "finished",
      automationId: captions,
      when: "done",
    });
    await expect(maya.as.mutation(api.workflows.setOn, { workflowId, on: true })).rejects.toThrow(/^.*Thumbnail: /);
    // All or nothing: the others stayed off.
    expect([await enabled(cut), await enabled(captions), await enabled(broken)]).toEqual([false, false, false]);
  });

  test("taking it away leaves the automations as they are", async () => {
    const { maya, team, chain, start, look } = await setUp();
    const { cut } = await chain();
    const workflowId = await maya.as.mutation(api.workflows.create, { automationId: cut });
    await maya.as.mutation(api.workflows.remove, { workflowId });
    expect(await maya.as.query(api.workflows.list, { organizationId: team })).toEqual([]);
    const runId = await start(cut);
    expect((await look(runId)).run.nodes.map((node) => node.id)).toEqual(["trim", "check"]);
  });

  test("only the team's people can see or change it", async () => {
    const { t, maya, team, chain } = await setUp();
    const { cut } = await chain();
    const workflowId = await maya.as.mutation(api.workflows.create, { automationId: cut });
    const other = await addTeam(t, "Elsewhere");
    const stranger = await addPerson(t, "Sam Stone", [other]);
    await expect(stranger.as.query(api.workflows.list, { organizationId: team })).rejects.toThrow();
    await expect(stranger.as.mutation(api.workflows.setOn, { workflowId, on: true })).rejects.toThrow();
    await expect(stranger.as.mutation(api.workflows.remove, { workflowId })).rejects.toThrow();
  });
});

describe("runs of a workflow", () => {
  test("one review at the end: earlier approvals pass through, nothing goes out until it is approved", async () => {
    const { t, maya, jon, chain, start, look, runsOf, finish, caption } = await setUp();
    const { cut, captions } = await chain();
    const workflowId = await maya.as.mutation(api.workflows.create, {
      automationId: cut,
      name: "Weekly UGC",
      kind: "ugc",
      review: { reviewers: [jon.id] },
    });
    await maya.as.mutation(api.workflows.setOn, { workflowId, on: true });

    // Cut's own Approval step is passed through, so Captions starts straight away.
    const first = await start(cut);
    await finish((await look(first)).byNode.trim.jobIds[0], CUT);
    const cutRun = await look(first);
    expect(cutRun.run).toMatchObject({ status: "done", workflowId });
    expect(cutRun.byNode.check).toMatchObject({ status: "done", outputs: [CUT] });
    expect(cutRun.run.nodes.find((node) => node.id === "check")).toMatchObject({
      off: true,
      input: { coveredByWorkflow: true },
    });

    const [captionsRun] = await runsOf(captions);
    await caption(captionsRun._id);
    const waiting = await look(captionsRun._id);
    // Its own approval passes through too; the workflow's review asks once, at the end.
    expect(waiting.byNode.approve.status).toBe("done");
    expect(waiting.byNode["workflow-review"]).toMatchObject({
      status: "waiting_approval",
      reviewers: [jon.id],
    });
    expect(waiting.run.status).toBe("waiting");

    // The review room is named after the workflow and shows the captioned video.
    const room = await t.run((ctx) =>
      ctx.db
        .query("reviews")
        .withIndex("by_runStep", (q) => q.eq("runStepId", waiting.byNode["workflow-review"]._id))
        .first(),
    );
    expect(room?.title).toBe("Weekly UGC");
    const alert = await t.run((ctx) =>
      ctx.db
        .query("alerts")
        .filter((q) => q.eq(q.field("kind"), "approval_waiting"))
        .first(),
    );
    expect(alert).toMatchObject({ recipients: [jon.id], stepName: "Weekly UGC review" });

    await jon.as.mutation(api.runs.decide, {
      runStepId: waiting.byNode["workflow-review"]._id,
      approved: true,
    });
    const done = await look(captionsRun._id);
    expect(done.run.status).toBe("done");
    expect(done.byNode["workflow-review"]).toMatchObject({ status: "done", outputs: [CAPTIONED] });
  });

  test("a rejected review stops the run", async () => {
    const { maya, chain, start, look, runsOf, finish, caption } = await setUp();
    const { cut, captions } = await chain();
    const workflowId = await maya.as.mutation(api.workflows.create, { automationId: cut });
    await maya.as.mutation(api.workflows.setOn, { workflowId, on: true });
    const first = await start(cut);
    await finish((await look(first)).byNode.trim.jobIds[0], CUT);
    const [captionsRun] = await runsOf(captions);
    await caption(captionsRun._id);
    const review = (await look(captionsRun._id)).byNode["workflow-review"];
    await maya.as.mutation(api.runs.decide, { runStepId: review._id, approved: false });
    expect((await look(captionsRun._id)).run.status).toBe("failed");
  });

  test("a run that already failed skips the review, since nothing goes out", async () => {
    const { maya, add, start, look, finish } = await setUp();
    const both = await add(
      "Both",
      [step("trim", "video-trim", 0), step("thumb", "video-thumbnail", 0)],
      [],
    );
    await maya.as.mutation(api.workflows.create, { automationId: both });
    const runId = await start(both);
    const now = await look(runId);
    await finish(now.byNode.trim.jobIds[0], null);
    await finish(now.byNode.thumb.jobIds[0], "https://files.example/out/thumb.png");
    const after = await look(runId);
    expect(after.byNode["workflow-review"].status).toBe("skipped");
    expect(after.run.status).toBe("failed");
  });

  test("with the review off, the automations run exactly as they are built", async () => {
    const { maya, chain, start, look, finish } = await setUp();
    const { cut } = await chain();
    await maya.as.mutation(api.workflows.create, { automationId: cut, review: { on: false } });
    const runId = await start(cut);
    await finish((await look(runId)).byNode.trim.jobIds[0], CUT);
    const now = await look(runId);
    expect(now.byNode.check.status).toBe("waiting_approval");
    expect(now.byNode["workflow-review"]).toBeUndefined();
    expect(now.run.workflowId).toBeUndefined();
  });

  test("testing one step never adds the review", async () => {
    const { maya, chain, start, look } = await setUp();
    const { captions } = await chain();
    await maya.as.mutation(api.workflows.create, { automationId: captions });
    const runId = await start(captions, "caption");
    expect((await look(runId)).byNode["workflow-review"]).toBeUndefined();
  });
});

describe("workflows over MCP", () => {
  test("sets one up, changes it, lists it and switches it on", async () => {
    const { t, maya, jon, team, chain } = await setUp();
    const { cut, captions } = await chain();
    const made = await t.mutation(internal.workflows.setUpAs, {
      organizationId: team,
      userId: maya.id,
      automationId: captions,
      name: "Creator ads",
      kind: "ugc",
    });
    expect(made).toMatchObject({
      made: true,
      name: "Creator ads",
      kind: "UGC and ads",
      on: "off",
      review: { who: "Anyone on the team", reviewers: [], time_limit: null },
      automations: [
        { automation_id: cut, reviewed_here: false, own_approval_covered: true },
        { automation_id: captions, reviewed_here: true, own_approval_covered: true },
      ],
    });
    const changed = await t.mutation(internal.workflows.setUpAs, {
      organizationId: team,
      userId: maya.id,
      automationId: cut,
      review: { reviewers: [jon.id], timeLimit: 1, timeLimitUnit: "days" },
    });
    expect(changed).toMatchObject({
      made: false,
      review: { who: "Jon Bell, rejects after 1 day", time_limit: "1 days, then reject" },
    });
    const switched = await t.mutation(internal.workflows.switchAs, {
      organizationId: team,
      workflowId: made.workflow_id,
      on: true,
    });
    expect(switched.on).toBe(true);
    const [listed] = await t.query(internal.workflows.listAs, { organizationId: team });
    expect(listed.on).toBe("on");
    await expect(
      t.mutation(internal.workflows.switchAs, { organizationId: "other", workflowId: made.workflow_id, on: false }),
    ).rejects.toThrow("no workflow with that id");
  });
});
