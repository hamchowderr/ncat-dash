import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveToolCategory } from "../../src/mastra/lib/tool-categories";
import { type DashClient, useDashClientForTests } from "../../src/mastra/ncat/convex";
import { forgetSessions, rememberSession } from "../../src/mastra/ncat/session-store";
import {
  NCAT_INSTRUCTIONS,
  NCAT_READ_TOOLS,
  ncatTools,
  platformGuide,
} from "../../src/mastra/ncat/tools";

/**
 * platform_guide: the agent's knowledge of each platform's formats, asked of the
 * dashboard so it is always the running dashboard's own.
 */
const USER = "u-guide";
let calls: { name: string; args: Record<string, unknown> }[] = [];

const client = {
  query: async (ref: never, args: Record<string, unknown>) => {
    calls.push({ name: getFunctionName(ref), args });
    return { text: "## TikTok (short vertical video)", unknown: [] };
  },
  mutation: async () => {
    throw new Error("platform_guide never changes anything");
  },
  action: async () => {
    throw new Error("platform_guide never changes anything");
  },
};

// biome-ignore lint/suspicious/noExplicitAny: a tool's context is wide; this tool reads only agent.resourceId
const ctx = { agent: { resourceId: USER } } as any;

beforeEach(() => {
  calls = [];
  useDashClientForTests(() => client as unknown as DashClient);
  rememberSession(USER, { convexToken: "t", organizationId: "team_1", automationId: null });
});
afterEach(() => {
  useDashClientForTests();
  forgetSessions();
});

describe("platform_guide", () => {
  it("asks the dashboard's guide for the platforms named", async () => {
    const result = await platformGuide.execute?.({ platforms: ["TikTok"] }, ctx);
    expect(calls).toEqual([{ name: "automations:platformGuide", args: { platforms: ["TikTok"] } }]);
    expect(result).toEqual({ text: "## TikTok (short vertical video)", unknown: [] });
  });

  it("asks for every platform when none is named", async () => {
    await platformGuide.execute?.({}, ctx);
    expect(calls[0]?.args).toEqual({});
  });

  it("is a look-only tool the agent can call without an approval card", () => {
    expect(ncatTools.platform_guide).toBe(platformGuide);
    expect(NCAT_READ_TOOLS).toContain("platform_guide");
    expect(resolveToolCategory("platform_guide")).toBe("read");
  });

  it("is in the agent's instructions, so it reads the guide before building", () => {
    expect(NCAT_INSTRUCTIONS).toContain(
      "read platform_guide for the platforms you are building for",
    );
  });
});
