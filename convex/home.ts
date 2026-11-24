import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireMember } from "./lib/authz";
import { storageConnection } from "./lib/bucket";
import { startingFileName } from "./lib/outputs";

const WEEK = 7 * 24 * 60 * 60 * 1000;
// Enough runs to count a busy week without reading the whole history.
const RUNS_READ = 300;
// Home fits the window without scrolling, so it shows only the latest few of each; the
// Runs page has the rest.
const RECENT = 5;
const FAILURES = 3;

/**
 * Everything the home page shows in one read: how the week went, the latest runs, the
 * runs that failed this week, and how far the team is through getting set up. Test runs
 * of a single step are left out, since the person testing already saw them.
 */
export const summary = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const since = Date.now() - WEEK;

    const runs = (
      await ctx.db
        .query("runs")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
        .order("desc")
        .take(RUNS_READ)
    ).filter((run) => run.test === undefined);
    const thisWeek = runs.filter((run) => run._creationTime >= since);
    const view = (run: (typeof runs)[number]) => ({
      runId: run._id,
      automationId: run.automationId,
      automationName: run.automationName,
      status: run.status,
      startedAt: run._creationTime,
      finishedAt: run.finishedAt,
      startedWith: startingFileName(run.trigger),
      error: run.error,
    });

    const automations = await ctx.db
      .query("automations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(500);
    const connection = await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();
    const storage = await storageConnection(ctx, args.organizationId);
    const settings = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first();

    return {
      week: {
        runs: thisWeek.length,
        done: thisWeek.filter((run) => run.status === "done").length,
        failed: thisWeek.filter((run) => run.status === "failed").length,
        going: thisWeek.filter((run) => run.status === "running" || run.status === "waiting")
          .length,
      },
      recentRuns: runs.slice(0, RECENT).map(view),
      failures: thisWeek
        .filter((run) => run.status === "failed")
        .slice(0, FAILURES)
        .map(view),
      automations: {
        total: automations.length,
        on: automations.filter((automation) => automation.enabled).length,
      },
      setup: {
        toolkit: connection !== null && connection.status === "ok",
        bucket: Boolean(storage?.storage),
        brand: Boolean(settings?.brand?.logo),
        automationOn: automations.some((automation) => automation.enabled),
        firstRun: runs.some((run) => run.status === "done"),
        goals: settings?.contentGoals !== undefined,
      },
    };
  },
});
