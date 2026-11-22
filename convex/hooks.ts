// The Webhook trigger's other half: telling the caller how the run it started went.
// A caller can read a run's state at its status address, or send a callback_url to have
// the run's end posted to it. Reading the call itself is in lib/hooks.ts.
import { outboundProblem } from "./lib/outbound";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { finishedFilesOf } from "./lib/chain";
import { CALLBACK_WAITS_MS, HOOK_KEY_MS, sameSecret, signCallback } from "./lib/hooks";

/** What a caller is told about a run: its state, and its finished files once done. */
export interface RunReport {
  run_id: string;
  automation_id: string;
  automation: string;
  status: Doc<"runs">["status"];
  error: string | null;
  files: string[];
  started_at: number;
  finished_at: number | null;
}

async function reportOf(ctx: QueryCtx, run: Doc<"runs">): Promise<RunReport> {
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  return {
    run_id: run._id,
    automation_id: run.automationId,
    automation: run.automationName,
    status: run.status,
    error: run.error,
    files: run.status === "done" ? finishedFilesOf(run, steps) : [],
    started_at: run._creationTime,
    finished_at: run.finishedAt,
  };
}

/** A run of this automation, for a caller holding its token. Null when there is none. */
export const runForCaller = internalQuery({
  args: { automationId: v.string(), runId: v.string(), token: v.string() },
  handler: async (ctx, args): Promise<RunReport | "forbidden" | null> => {
    const automationId = ctx.db.normalizeId("automations", args.automationId);
    const automation = automationId ? await ctx.db.get(automationId) : null;
    if (!automation) return null;
    if (!sameSecret(args.token, automation.hookToken)) return "forbidden";
    const runId = ctx.db.normalizeId("runs", args.runId);
    const run = runId ? await ctx.db.get(runId) : null;
    if (!run || run.automationId !== automation._id) return null;
    return await reportOf(ctx, run);
  },
});

export const loadCallback = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run?.callbackUrl) return null;
    const automation = await ctx.db.get(run.automationId);
    if (!automation) return null;
    return { url: run.callbackUrl, token: automation.hookToken, report: await reportOf(ctx, run) };
  },
});

/**
 * Posts a run's end to its callback address, signed with the automation's token in
 * X-Takewon-Signature (sha256=<hex of the HMAC of the body>), so the caller can tell it
 * came from here. A caller that does not answer with a 2xx is tried again a few times.
 */
export const sendCallback = internalAction({
  args: { runId: v.id("runs"), attempt: v.number() },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.hooks.loadCallback, { runId: args.runId });
    if (!loaded) return;
    // A copy strangers sign up to never posts inside its own network (lib/outbound.ts).
    if (outboundProblem(loaded.url)) return;
    const body = JSON.stringify(loaded.report);
    let ok = false;
    try {
      const response = await fetch(loaded.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-takewon-signature": `sha256=${await signCallback(body, loaded.token)}`,
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      ok = response.ok;
    } catch {
      ok = false;
    }
    const wait = CALLBACK_WAITS_MS[args.attempt];
    if (!ok && wait !== undefined) {
      await ctx.scheduler.runAfter(wait, internal.hooks.sendCallback, {
        runId: args.runId,
        attempt: args.attempt + 1,
      });
    }
  },
});

/** Every day: forgets Idempotency-Keys older than a day. */
export const forgetOldCalls = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("hookCalls")
      .withIndex("by_at", (q) => q.lt("at", Date.now() - HOOK_KEY_MS))
      .take(500);
    for (const call of old) await ctx.db.delete(call._id);
    if (old.length === 500) await ctx.scheduler.runAfter(0, internal.hooks.forgetOldCalls, {});
  },
});
