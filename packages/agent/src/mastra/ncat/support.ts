import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { dash, dashFor, plainError } from "./convex";

/**
 * The categories a request can be filed under, as convex/lib/supportCategories.ts has
 * them. The agent's image holds only this package, so it keeps its own copy;
 * support.test.ts fails when the two differ.
 */
export const SUPPORT_CATEGORIES = [
  ["automations", "Automations and runs", "Something didn't start, stopped or failed."],
  ["results", "Clips, captions and edits", "Something came out looking or sounding wrong."],
  ["files", "Uploads and files", "A file won't upload, play or show up."],
  ["connections", "Connected apps", "Slack, Discord, Telegram, n8n or an AI app."],
  ["account", "Account and team", "Signing in, members and invites."],
  ["billing", "Plan and billing", "Your trial, plan or a payment."],
  ["idea", "An idea", "Something you'd like Takewon to do."],
  ["other", "Something else", "Anything that fits nowhere above."],
] as const;

const CATEGORY_IDS = SUPPORT_CATEGORIES.map(([id]) => id) as unknown as [
  (typeof SUPPORT_CATEGORIES)[number][0],
  ...(typeof SUPPORT_CATEGORIES)[number][0][],
];

/**
 * Asking a human. When the agent can't fix something, or the person wants a person, it
 * writes a help request for them, as Intercom's Fin does when it hands over: a subject
 * and a summary in the person's words, filed under a category. It is not a read or an
 * edit (tools.ts), so every one shows its card and goes only when the person says yes.
 * It calls the same support.open the Get Help form calls, as the person, so the request
 * is theirs: it shows on Get Help, answers come there and by email.
 */

type ToolCtx = { agent?: { resourceId?: string } } | undefined;

export const askForHelp = createTool({
  id: "ask_for_help",
  description:
    "Sends a help request to the people who run Takewon, as the person, with their team and latest runs attached. The person sees the subject and message on a card and must say yes before it goes. The answer comes back in Get Help and by email.",
  inputSchema: z.object({
    subject: z.string().min(1).max(200).describe("One short line, as the person would put it."),
    message: z
      .string()
      .min(1)
      .max(10_000)
      .describe(
        'What they were doing, what happened and what they expected, with the names of the automation, run or file. Plain words, written as the person ("I", not "the user"). No ids unless they help.',
      ),
    category: z
      .enum(CATEGORY_IDS)
      .describe(
        SUPPORT_CATEGORIES.map(([id, title, hint]) => `${id}: ${title} (${hint})`).join("; "),
      ),
  }),
  outputSchema: z.object({ number: z.number(), address: z.string() }),
  execute: async ({ subject, message, category }, ctx) => {
    const { client, session } = dashFor((ctx as ToolCtx)?.agent?.resourceId);
    if (!session.organizationId) throw new Error("No team is open on the dashboard.");
    try {
      const opened = (await client.mutation(dash.support.open, {
        organizationId: session.organizationId,
        subject,
        body: message,
        category,
        via: "assistant",
      })) as { number: number; address: string };
      return { number: opened.number, address: opened.address };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const SUPPORT_INSTRUCTIONS = `- Asking a human: when something is broken that you can't fix (a step keeps failing for a reason outside the automation, the server or an app connection misbehaves, something in Takewon itself looks wrong), when the person asks about their plan or payments, or when they ask for a person, offer to ask Takewon support for them. Don't offer it for things you can do yourself. ask_for_help shows the person a card with the subject and message, and nothing is sent until they say yes, so write it well: what they were doing, what happened, what they expected, the names of the automation, run or file, and what you already tried. Pick the category that fits. Once sent, tell them the request number and link to it like [See your request](/help?ticket=...) with the address it returned: the answer shows there and comes by email.`;
