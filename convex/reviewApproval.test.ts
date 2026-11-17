import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/station_interview.mp4";

/** A team with an automation that is only an approval step, and a run of it. */
async function waitingRun(trigger: Record<string, unknown> = { file_url: FILE }) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  const runId = await t.run(async (ctx) => {
    const automationId = await ctx.db.insert("automations", {
      organizationId: team,
      name: "Weekly clips",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [{ id: "approval", kind: "approval", input: {}, position: { x: 0, y: 0 } }],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    });
    const automation = await ctx.db.get(automationId);
    const started = await startRun(ctx, automation!, "webhook", trigger, null);
    if (!started.ok) throw new Error(started.message);
    return started.runId;
  });
  const state = () =>
    t.run(async (ctx) => ({
      run: await ctx.db.get(runId),
      step: await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .unique(),
    }));
  return { t, team, maya, outsider, runId, state };
}

describe("an approval step and its review room", () => {
  test("reaching the step opens a room with the files it was handed", async () => {
    const { maya, team, state } = await waitingRun();
    const { run, step } = await state();
    expect(run?.status).toBe("waiting");
    expect(step?.status).toBe("waiting_approval");

    const [listed] = await maya.as.query(api.reviews.list, { organizationId: team });
    expect(listed).toMatchObject({
      title: "Weekly clips",
      status: "open",
      fromRun: true,
      clips: 1,
    });
    const review = await maya.as.query(api.reviews.get, { reviewId: listed._id });
    expect(review?.holdsRun).toBe(true);
    expect(review?.clips[0].versions[0].url).toBe(FILE);
    expect(await maya.as.query(api.reviews.forStep, { runStepId: step!._id })).toBe(listed._id);
  });

  test("with no files to show, no room opens", async () => {
    const { maya, team } = await waitingRun({});
    expect(await maya.as.query(api.reviews.list, { organizationId: team })).toEqual([]);
  });

  test("approving the room approves the step and the run carries on", async () => {
    const { maya, team, state } = await waitingRun();
    const [listed] = await maya.as.query(api.reviews.list, { organizationId: team });
    await maya.as.mutation(api.reviews.decide, { reviewId: listed._id, approved: true });

    const { run, step } = await state();
    expect(step).toMatchObject({ status: "done", decidedBy: maya.id, outputs: [FILE] });
    expect(run?.status).toBe("done");
    const review = await maya.as.query(api.reviews.get, { reviewId: listed._id });
    expect(review).toMatchObject({ status: "approved", decidedBy: maya.id, holdsRun: false });
  });

  test("asking for changes in the room stops the run", async () => {
    const { maya, team, state } = await waitingRun();
    const [listed] = await maya.as.query(api.reviews.list, { organizationId: team });
    await maya.as.mutation(api.reviews.decide, { reviewId: listed._id, approved: false });

    const { run, step } = await state();
    expect(step?.status).toBe("failed");
    expect(run?.status).toBe("failed");
    expect((await maya.as.query(api.reviews.get, { reviewId: listed._id }))?.status).toBe(
      "rejected",
    );
  });

  test("deciding on the run's page closes the room too", async () => {
    const { maya, team, state } = await waitingRun();
    const { step } = await state();
    await maya.as.mutation(api.runs.decide, { runStepId: step!._id, approved: true });
    const [listed] = await maya.as.query(api.reviews.list, { organizationId: team });
    expect(listed.status).toBe("approved");
  });

  test("a room a run is waiting on cannot be deleted, and outsiders cannot decide it", async () => {
    const { maya, outsider, team, state } = await waitingRun();
    const [listed] = await maya.as.query(api.reviews.list, { organizationId: team });
    await expect(maya.as.mutation(api.reviews.remove, { reviewId: listed._id })).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.reviews.decide, { reviewId: listed._id, approved: true }),
    ).rejects.toThrow();
    expect((await state()).step?.status).toBe("waiting_approval");
  });
});

describe("who is in the room", () => {
  test("only the team can join, under their own id", async () => {
    const { maya, outsider, team } = await waitingRun();
    const [listed] = await maya.as.query(api.reviews.list, { organizationId: team });
    const join = { roomId: listed._id, sessionId: "tab-1", interval: 10_000 };

    await expect(
      outsider.as.mutation(api.presence.heartbeat, { ...join, userId: outsider.id }),
    ).rejects.toThrow();
    // The id sent by the browser is ignored; the signed-in person is who joins.
    const { roomToken } = await maya.as.mutation(api.presence.heartbeat, {
      ...join,
      userId: outsider.id,
    });
    const here = await maya.as.query(api.presence.list, { roomToken });
    expect(here.map((state) => state.userId)).toEqual([maya.id]);
  });
});
