import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DashClient, useDashClientForTests } from "../../src/mastra/ncat/convex";
import { forgetSessions, rememberSession } from "../../src/mastra/ncat/session-store";
import {
  NCAT_EDIT_TOOLS,
  NCAT_INSTRUCTIONS,
  ncatTools,
  setUpFollowOn,
} from "../../src/mastra/ncat/tools";

/** The tool that builds a ready-made follow-on after an automation. Convex is stood in for. */
const USER = "u-follow";
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let answer: unknown = null;

const client = {
  mutation: async (ref: never, args: Record<string, unknown>) => {
    calls.push({ name: getFunctionName(ref), args });
    if (answer instanceof Error) throw answer;
    return answer;
  },
};
// biome-ignore lint/suspicious/noExplicitAny: a tool's context is wide; this tool reads only agent.resourceId
const ctx = { agent: { resourceId: USER } } as any;
// biome-ignore lint/suspicious/noExplicitAny: execute's input type comes from its schema
const run = (input: any) => setUpFollowOn.execute?.(input, ctx);

beforeEach(() => {
  calls = [];
  useDashClientForTests(() => client as unknown as DashClient);
  rememberSession(USER, { convexToken: "t", organizationId: "team_1", automationId: "auto_open" });
});
afterEach(() => {
  useDashClientForTests();
  forgetSessions();
});

describe("set_up_follow_on", () => {
  it("builds the follow-on after the open automation and says whether it is on", async () => {
    answer = { automationId: "auto_new", on: false, problem: "Add a logo in Settings." };
    expect(await run({ followOn: "brand-every-clip" })).toEqual({
      automationId: "auto_new",
      on: false,
      problem: "Add a logo in Settings.",
      address: "/automations/auto_new",
    });
    expect(calls).toEqual([
      {
        name: "automations:setUpFollowOn",
        args: { automationId: "auto_open", starterId: "brand-every-clip" },
      },
    ]);
  });

  it("passes on the dashboard's reason when it cannot", async () => {
    answer = new Error("Unknown starter.");
    await expect(run({ automationId: "auto_2", followOn: "nope" })).rejects.toThrow(/Unknown/);
  });

  it("is offered as an edit, and the agent is told when to suggest follow-ons", () => {
    expect(ncatTools.set_up_follow_on).toBe(setUpFollowOn);
    expect(NCAT_EDIT_TOOLS).toContain("set_up_follow_on");
    expect(NCAT_INSTRUCTIONS).toContain("followOns");
    expect(NCAT_INSTRUCTIONS).toContain("Never set one up without being asked");
  });
});
