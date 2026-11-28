import { readFileSync } from "node:fs";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { resolveToolCategory } from "../../src/mastra/lib/tool-categories";
import { type DashClient, useDashClientForTests } from "../../src/mastra/ncat/convex";
import { forgetSessions, rememberSession } from "../../src/mastra/ncat/session-store";
import { askForHelp, SUPPORT_CATEGORIES } from "../../src/mastra/ncat/support";
import { NCAT_INSTRUCTIONS, ncatTools } from "../../src/mastra/ncat/tools";

/**
 * Asking a human from the chat: the agent writes the request, the person says yes on its
 * card, and it goes through the same support.open as the Get Help form, as them.
 */
const USER = "u-help";
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];

const client = {
  query: async () => {
    throw new Error("no queries here");
  },
  action: async () => {
    throw new Error("no actions here");
  },
  mutation: async (ref: never, args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    if (name === "support:open") {
      return { ticketId: "tk_1", number: 7, address: "/help?ticket=tk_1" };
    }
    throw new Error(`No answer for ${name}`);
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

describe("ask_for_help", () => {
  it("opens the request as the person, on their team, marked as the assistant's", async () => {
    const result = await askForHelp.execute?.(
      {
        subject: "Captions are a second late",
        message: "My Podcast Clips run made captions a second after the words.",
        category: "results",
      },
      ctx,
    );
    expect(result).toEqual({ number: 7, address: "/help?ticket=tk_1" });
    expect(calls).toEqual([
      {
        name: "support:open",
        args: {
          organizationId: "team_1",
          subject: "Captions are a second late",
          body: "My Podcast Clips run made captions a second after the words.",
          category: "results",
          via: "assistant",
        },
      },
    ]);
  });

  it("only takes a category from the list", () => {
    const parsed = (askForHelp.inputSchema as unknown as z.ZodType).safeParse({
      subject: "S",
      message: "M",
      category: "refunds",
    });
    expect(parsed?.success).toBe(false);
  });

  it("asks every time: it is neither a read nor an edit, so no Always allow covers it", () => {
    expect(ncatTools.ask_for_help).toBe(askForHelp);
    expect(resolveToolCategory("ask_for_help")).toBeNull();
  });

  it("is told when to offer it", () => {
    expect(NCAT_INSTRUCTIONS).toContain("ask_for_help");
  });

  it("keeps the same categories as the app, in the same order", () => {
    // Read as text: the agent's package can't import the app's Convex files.
    const app = readFileSync(
      new URL("../../../../convex/lib/supportCategories.ts", import.meta.url),
      "utf8",
    );
    const found = [...app.matchAll(/id: "([a-z]+)",\s*title: "([^"]+)",\s*hint: "([^"]+)"/g)].map(
      ([, id, title, hint]) => [id, title, hint],
    );
    expect(found).toEqual(SUPPORT_CATEGORIES.map((each) => [...each]));
  });
});
