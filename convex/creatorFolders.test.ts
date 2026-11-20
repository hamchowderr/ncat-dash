import { STARTERS } from "@ncat-dash/automation-core";
import { afterEach, describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

/**
 * A watched folder with one folder per creator: each creator's hooks, body and endings
 * start one run of UGC Ad Variants together, with nobody pressing start or picking takes.
 */
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
afterEach(() => toolkit?.restore());

const MINUTE = 60_000;
const starter = STARTERS.find((each) => each.id === "ugc-ad-variants-from-creator-folders")!;

async function setUp() {
  toolkit = fakeToolkitStorage();
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  await connectToolkit(t, team, maya.id);
  const automationId = await t.run((ctx) =>
    ctx.db.insert("automations", {
      organizationId: team,
      name: starter.name,
      enabled: true,
      trigger: starter.trigger as Doc<"automations">["trigger"],
      nodes: starter.nodes as Doc<"automations">["nodes"],
      edges: starter.edges,
      hookToken: "token",
      nextRunAt: null,
      watchFrom: Date.now() - 60 * MINUTE,
      createdBy: maya.id,
      updatedAt: Date.now() - 60 * MINUTE,
    }),
  );
  /** Puts a file in the team's ugc/ folder, landed this many minutes ago. */
  const land = (key: string, minutesAgo = 10) => {
    const full = `teams/${team}/ugc/${key}`;
    toolkit!.put(full);
    toolkit!.files.get(full)!.lastModified = Date.now() - minutesAgo * MINUTE;
  };
  const runs = () =>
    t.run((ctx) =>
      ctx.db
        .query("runs")
        .withIndex("by_automation", (q) => q.eq("automationId", automationId))
        .collect(),
    );
  const poll = () => t.action(internal.watch.poll, {});
  return { t, land, runs, poll };
}

const variantsOf = (run: Doc<"runs">) =>
  run.nodes.find((node) => node.stepId === "recipe-hook-variants")!.input;

describe("creator folders", () => {
  test("a creator's body and hook takes start one run with every take", async () => {
    const { land, runs, poll } = await setUp();
    land("Maya/body/maya body.mp4");
    land("Maya/hooks/hook 1.mp4");
    land("Maya/hooks/hook 2.mp4");
    land("Maya/endings/cta 1.mp4");
    // Jordan has only a body so far, and Sam is still uploading.
    land("Jordan/body/body.mp4");
    land("Sam/body/body.mp4");
    land("Sam/hooks/a.mp4", 1);
    await poll();

    const [run, ...others] = await runs();
    expect(others).toHaveLength(0);
    expect(run.triggerKind).toBe("folder");
    expect(run.trigger.file_name).toBe("maya body.mp4");
    expect(run.trigger.creator).toBe("Maya");
    const input = variantsOf(run);
    expect(input.base_cut).toBe("is only the body");
    expect(input.creator).toBe("Maya");
    expect(decodeURIComponent(new URL(String(input.hook_1_url)).pathname)).toMatch(
      /\/ugc\/Maya\/hooks\/hook 1\.mp4$/,
    );
    expect(decodeURIComponent(new URL(String(input.hook_2_url)).pathname)).toMatch(/hook 2\.mp4$/);
    expect(decodeURIComponent(new URL(String(input.ending_1_url)).pathname)).toMatch(/cta 1\.mp4$/);
    expect(input.hook_3_url).toBeUndefined();
    // The length cuts step files them under the creator too.
    expect(run.nodes.find((node) => node.stepId === "recipe-length-cuts")!.input.creator).toBe(
      "Maya",
    );

    // Nothing new: no second run.
    await poll();
    expect(await runs()).toHaveLength(1);
  });

  test("a new take later makes the creator's whole set again", async () => {
    const { land, runs, poll } = await setUp();
    land("Maya/body/body.mp4");
    land("Maya/hooks/hook 1.mp4");
    await poll();
    expect(await runs()).toHaveLength(1);

    // A cleaned-up recording adds another hook take: it waits until it has settled.
    land("Maya/hooks/hook 2.mp4", 1);
    await poll();
    expect(await runs()).toHaveLength(1);
    land("Maya/hooks/hook 2.mp4", 5);
    await poll();
    const all = await runs();
    expect(all).toHaveLength(2);
    const latest = all.find((run) => variantsOf(run).hook_2_url)!;
    expect(variantsOf(latest).hook_1_url).toBeDefined();
  });

  test("files from before the folder was switched on are left alone", async () => {
    const { land, runs, poll } = await setUp();
    land("Maya/body/body.mp4", 120);
    land("Maya/hooks/hook 1.mp4", 120);
    await poll();
    expect(await runs()).toHaveLength(0);
    // A take after it counts, and brings the older body with it.
    land("Maya/hooks/hook 2.mp4", 10);
    await poll();
    const [run] = await runs();
    expect(variantsOf(run).hook_2_url).toBeDefined();
    expect(run.trigger.file_name).toBe("body.mp4");
  });

  test("hooks and body straight in the watched folder make a set with no creator", async () => {
    const { land, runs, poll } = await setUp();
    land("hooks/clean hook_01.mp4");
    land("body/clean.mp4");
    await poll();
    const [run] = await runs();
    expect(run.trigger.creator).toBe("");
    expect(variantsOf(run).creator).toBeUndefined();
    expect(variantsOf(run).hook_1_url).toBeDefined();
  });
});
