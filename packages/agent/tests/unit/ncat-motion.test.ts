import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveToolCategory } from "../../src/mastra/lib/tool-categories";
import { type DashClient, useDashClientForTests } from "../../src/mastra/ncat/convex";
import { forgetSessions, rememberSession } from "../../src/mastra/ncat/session-store";
import {
  MOTION_INSTRUCTIONS,
  motionGuide,
  NCAT_INSTRUCTIONS,
  NCAT_READ_TOOLS,
  ncatTools,
} from "../../src/mastra/ncat/tools";

/** Motion graphics: when the agent adds the steps, where the style lives, and motion_guide. */
const USER = "u-motion";
let calls: { name: string; args: Record<string, unknown> }[] = [];

const client = {
  query: async (ref: never, args: Record<string, unknown>) => {
    calls.push({ name: getFunctionName(ref), args });
    return { text: "## Preset styles\n- bold-hook (Bold Hook): Coaching." };
  },
  mutation: async () => {
    throw new Error("motion_guide never changes anything");
  },
  action: async () => {
    throw new Error("motion_guide never changes anything");
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

describe("motion_guide", () => {
  it("asks the dashboard's motion guide", async () => {
    const result = await motionGuide.execute?.({}, ctx);
    expect(calls).toEqual([{ name: "automations:motionGuide", args: {} }]);
    expect(result).toEqual({ text: "## Preset styles\n- bold-hook (Bold Hook): Coaching." });
  });

  it("is a look-only tool the agent can call without an approval card", () => {
    expect(ncatTools.motion_guide).toBe(motionGuide);
    expect(NCAT_READ_TOOLS).toContain("motion_guide");
    expect(resolveToolCategory("motion_guide")).toBe("read");
  });
});

describe("what the agent knows about motion graphics", () => {
  it("is part of the agent's instructions", () => {
    expect(NCAT_INSTRUCTIONS).toContain(MOTION_INSTRUCTIONS);
  });

  it("puts Chapters before the motion steps, and picture steps such as Add B-Roll before motion", () => {
    expect(MOTION_INSTRUCTIONS).toContain("put Chapters before them");
    expect(MOTION_INSTRUCTIONS).toMatch(/Add B-Roll, go before Add Motion Graphics/);
  });

  it("knows the team's style is in Settings > Motion and a step can pick a preset by id", () => {
    expect(MOTION_INSTRUCTIONS).toContain("Settings > Motion");
    expect(MOTION_INSTRUCTIONS).toContain("set the step's style to a preset id");
    expect(MOTION_INSTRUCTIONS).toContain("read motion_guide");
  });

  it("adds Plan Motion Graphics only when asked, straight before Add Motion Graphics", () => {
    expect(MOTION_INSTRUCTIONS).toContain("Plan Motion Graphics is the one AI step here");
    expect(MOTION_INSTRUCTIONS).toContain("Put it straight before Add Motion Graphics");
    expect(MOTION_INSTRUCTIONS).toContain("lookFor");
  });

  it("knows the steps use no AI, and never suggests hosted services", () => {
    expect(MOTION_INSTRUCTIONS).toContain("no AI");
    expect(MOTION_INSTRUCTIONS).toContain("Never mention or suggest hosted");
  });
});
