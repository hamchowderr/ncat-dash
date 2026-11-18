import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireMember } from "./lib/authz";
import { finishedFiles } from "./lib/exports";
import { handOutputNames, outputNamesOf, startingFileName } from "./lib/outputs";

/** Steps that hand on the files they were given rather than making new ones. */
const PASSES_ON = new Set(["approval", "if", "wait"]);

type FileGroup = {
  nodeId: string;
  kind: string;
  stepId: string | null;
  label: string | null;
  files: string[];
};

/**
 * One run's files, by the step on the canvas that made them. A run's finished files are
 * what its last steps handed on; the rest were made on the way there, such as the clips
 * before captions went on them. A file is counted once, under the first step that made it.
 */
export function filesOfRun(
  run: Doc<"runs">,
  steps: Doc<"runSteps">[],
): { finished: FileGroup[]; along: FileGroup[] } {
  const finishedSet = new Set(finishedFiles(run, steps));
  const byNode = new Map(steps.map((step) => [step.nodeId, step]));
  const seen = new Set<string>();
  const finished: FileGroup[] = [];
  const along: FileGroup[] = [];
  for (const node of run.nodes) {
    if (PASSES_ON.has(node.kind)) continue;
    const step = byNode.get(node.id);
    if (!step || step.outputs.length === 0) continue;
    const made = step.outputs.filter((url) => !seen.has(url));
    made.forEach((url) => seen.add(url));
    const group = {
      nodeId: node.id,
      kind: node.kind,
      stepId: node.stepId ?? null,
      label: node.label ?? null,
    };
    const last = made.filter((url) => finishedSet.has(url));
    const before = made.filter((url) => !finishedSet.has(url));
    if (last.length > 0) finished.push({ ...group, files: last });
    if (before.length > 0) along.push({ ...group, files: before });
  }
  return { finished, along };
}

/**
 * Runs that made files, newest first, each with its automation, the file that started it
 * and its files by step. One automation's runs when `automationId` is given. Members only.
 */
export const byRun = query({
  args: {
    organizationId: v.string(),
    automationId: v.optional(v.id("automations")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const automationId = args.automationId;
    const page = automationId
      ? await ctx.db
          .query("runs")
          .withIndex("by_automation", (q) => q.eq("automationId", automationId))
          .order("desc")
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("runs")
          .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
          .order("desc")
          .paginate(args.paginationOpts);
    const runs = await Promise.all(
      page.page
        .filter((run) => run.organizationId === args.organizationId)
        .map(async (run) => {
          const steps = await ctx.db
            .query("runSteps")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .collect();
          const { finished, along } = filesOfRun(run, steps);
          return {
            runId: run._id,
            automationId: run.automationId,
            automationName: run.automationName,
            status: run.status,
            triggerKind: run.triggerKind,
            test: run.test !== undefined,
            startedAt: run._creationTime,
            finishedAt: run.finishedAt,
            startedWith: startingFileName(run.trigger),
            finished,
            along,
            // Readable names for the files, by link.
            names: outputNamesOf(run, steps),
          };
        }),
    );
    return { ...page, page: runs.filter((run) => run.finished.length + run.along.length > 0) };
  },
});

/** Files from steps run by hand on the Steps page, outside any automation, newest first. */
export const byHand = query({
  args: { organizationId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const page = await ctx.db
      .query("jobs")
      .withIndex("by_organization_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "done"),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page
        .filter((job) => job.runStepId === undefined && job.outputs.length > 0)
        .map((job) => ({
          jobId: job._id,
          stepId: job.stepId,
          finishedAt: job.finishedAt,
          urls: job.outputs,
          names: handOutputNames(job),
        })),
    };
  },
});
