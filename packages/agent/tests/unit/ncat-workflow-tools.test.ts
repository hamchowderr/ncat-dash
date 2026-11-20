import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveToolCategory as categoryOf } from "../../src/mastra/lib/tool-categories";
import { type DashClient, useDashClientForTests } from "../../src/mastra/ncat/convex";
import { forgetSessions, rememberSession } from "../../src/mastra/ncat/session-store";
import {
  describeWorkflow,
  NCAT_EDIT_TOOLS,
  NCAT_INSTRUCTIONS,
  NCAT_READ_TOOLS,
  ncatTools,
  setUpWorkflow,
  switchWorkflow,
} from "../../src/mastra/ncat/tools";

/** The tools that make a chain of automations one workflow with one review. */
const USER = "u-workflow";
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let answer: unknown = null;

const record = async (ref: never, args: Record<string, unknown>) => {
  calls.push({ name: getFunctionName(ref), args });
  if (answer instanceof Error) throw answer;
  return answer;
};
const client = { query: record, mutation: record };
// biome-ignore lint/suspicious/noExplicitAny: a tool's context is wide; these tools read only agent.resourceId
const ctx = { agent: { resourceId: USER } } as any;
// biome-ignore lint/suspicious/noExplicitAny: execute's input type comes from its schema
const run = (tool: any, input: any) => tool.execute?.(input, ctx);

beforeEach(() => {
  calls = [];
  useDashClientForTests(() => client as unknown as DashClient);
  rememberSession(USER, { convexToken: "t", organizationId: "team_1", automationId: "auto_open" });
});
afterEach(() => {
  useDashClientForTests();
  forgetSessions();
});

describe("workflow tools", () => {
  it("reads the workflow of the open automation", async () => {
    answer = { workflow: null, proposal: { name: "Cut" } };
    expect(await run(describeWorkflow, {})).toEqual(answer);
    expect(calls).toEqual([{ name: "workflows:describeFor", args: { automationId: "auto_open" } }]);
  });

  it("sets one up with only what was given", async () => {
    answer = { made: true, workflow_id: "w1" };
    await run(setUpWorkflow, { kind: "ugc", review: { reviewers: ["u2"], timeLimit: 2, timeLimitUnit: "days" } });
    expect(calls).toEqual([
      {
        name: "workflows:setUp",
        args: {
          automationId: "auto_open",
          kind: "ugc",
          review: { reviewers: ["u2"], timeLimit: 2, timeLimitUnit: "days" },
        },
      },
    ]);
    calls = [];
    await run(setUpWorkflow, { automationId: "auto_2", clientId: null });
    expect(calls[0].args).toEqual({ automationId: "auto_2", clientId: null });
  });

  it("switches a whole workflow, and passes on why it cannot", async () => {
    answer = null;
    expect(await run(switchWorkflow, { workflowId: "w1", on: true })).toEqual({ workflowId: "w1", on: true });
    expect(calls).toEqual([{ name: "workflows:setOn", args: { workflowId: "w1", on: true } }]);
    answer = new Error("Thumbnail: A step has no action chosen.");
    await expect(run(switchWorkflow, { workflowId: "w1", on: true })).rejects.toThrow(/Thumbnail/);
  });

  it("reads without asking, asks before a change, and asks every time before switching", () => {
    expect(ncatTools.describe_workflow).toBe(describeWorkflow);
    expect(NCAT_READ_TOOLS).toContain("describe_workflow");
    expect(NCAT_EDIT_TOOLS).toContain("set_up_workflow");
    expect(categoryOf("set_up_workflow")).toBe("edit");
    expect(categoryOf("switch_workflow")).toBeNull();
    expect(NCAT_INSTRUCTIONS).toContain("set_up_workflow");
  });
});
