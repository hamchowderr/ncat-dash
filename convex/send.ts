// Makes the post for a Send to a URL step (lib/send.ts starts and ends the step).
import { type AutomationNode } from "@ncat-dash/automation-core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { CALLBACK_WAITS_MS, signCallback } from "./lib/hooks";
import { finishSend } from "./lib/send";

/** What a Send to a URL step posts: the run, the step, and the files that reached it. */
export interface SendBody {
  run_id: string;
  automation_id: string;
  automation: string;
  step: string;
  files: string[];
  /** What the run was started with: the webhook body, the file, or the schedule. */
  trigger: unknown;
}

export const load = internalQuery({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "send") return null;
    const run = await ctx.db.get(step.runId);
    if (!run || (run.status !== "running" && run.status !== "waiting")) return null;
    const automation = await ctx.db.get(run.automationId);
    const node = (run.nodes as AutomationNode[]).find((each) => each.id === step.nodeId);
    if (!automation || !node) return null;
    const body: SendBody = {
      run_id: run._id,
      automation_id: run.automationId,
      automation: run.automationName,
      step: node.label ?? "Send to a URL",
      files: step.outputs,
      trigger: run.trigger,
    };
    return { url: String(node.input.url).trim(), token: automation.hookToken, body };
  },
});

/** Posts a Send to a URL step's files, tries again when the address does not answer. */
export const post = internalAction({
  args: { runStepId: v.id("runSteps"), attempt: v.number() },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.send.load, { runStepId: args.runStepId });
    if (!loaded) return;
    const body = JSON.stringify(loaded.body);
    let problem: string | null = null;
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
      if (!response.ok) problem = `The address answered ${response.status}.`;
    } catch {
      problem = "The address could not be reached.";
    }
    const wait = CALLBACK_WAITS_MS[args.attempt];
    if (problem && wait !== undefined) {
      await ctx.scheduler.runAfter(wait, internal.send.post, {
        runStepId: args.runStepId,
        attempt: args.attempt + 1,
      });
      return;
    }
    await ctx.runMutation(internal.send.done, {
      runStepId: args.runStepId,
      error: problem && `${problem} It was tried ${args.attempt + 1} times.`,
    });
  },
});

export const done = internalMutation({
  args: { runStepId: v.id("runSteps"), error: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await finishSend(ctx, args.runStepId, args.error);
  },
});
