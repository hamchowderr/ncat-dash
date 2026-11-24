// Makes the post for a Send to a URL step (lib/send.ts starts and ends the step).
import { outboundProblem } from "./lib/outbound";
import { type AutomationNode } from "@takewon/automation-core";
import { vOnCompleteArgs } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { signCallback } from "./lib/hooks";
import { OUTBOUND_TRIES } from "./lib/pools";
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

/** The post one try made: why it did not work, or null when the address took it. */
async function postOnce(url: string, token: string, body: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-takewon-signature": `sha256=${await signCallback(body, token)}`,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    return response.ok ? null : `The address answered ${response.status}.`;
  } catch {
    return "The address could not be reached.";
  }
}

/**
 * Posts a Send to a URL step's files. Run by the outbound pool (lib/pools.ts): a post the
 * address does not take throws, so the pool tries it again later; `done` ends the step.
 */
export const post = internalAction({
  args: { runStepId: v.id("runSteps") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const loaded = await ctx.runQuery(internal.send.load, { runStepId: args.runStepId });
    if (!loaded) return null;
    // A copy strangers sign up to never posts inside its own network (lib/outbound.ts).
    const refused = outboundProblem(loaded.url);
    if (refused) return refused;
    const problem = await postOnce(loaded.url, loaded.token, JSON.stringify(loaded.body));
    if (problem) throw new Error(problem);
    return null;
  },
});

/** Ends the step once its post was taken, refused, or the last try failed. */
export const done = internalMutation({
  args: vOnCompleteArgs(v.object({ runStepId: v.id("runSteps") })),
  handler: async (ctx, { context, result }) => {
    const error =
      result.kind === "success"
        ? ((result.returnValue as string | null) ?? null)
        : result.kind === "failed"
          ? `${plainError(result.error)} It was tried ${OUTBOUND_TRIES} times.`
          : "The post was stopped.";
    await finishSend(ctx, context.runStepId, error);
  },
});

/** Workpool hands back a thrown error as its text, sometimes with "Error: " in front. */
export function plainError(error: string): string {
  return error.replace(/^(Uncaught )?Error: /, "").split("\n")[0];
}
