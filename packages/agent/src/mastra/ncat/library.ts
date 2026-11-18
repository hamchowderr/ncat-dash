import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { dash, dashFor, plainError } from "./convex";

/**
 * The agent's way into the team's content library: find a file by what was said in it, its
 * name, a tag, or its short ID ("C99"), and run an automation on one. People say "caption
 * C99", so the agent needs to know what C99 is.
 */

type ToolCtx = { agent?: { resourceId?: string } } | undefined;
const userOf = (ctx: ToolCtx) => ctx?.agent?.resourceId;

type Hit = {
  _id: string;
  shortId: string;
  title: string;
  kind: string;
  source: string;
  automationName: string | null;
  parent: { shortId: string; title: string } | null;
  tags: string[];
  duration: number | null;
  searchable: string;
  moments: { start: number; text: string }[];
};

function moment(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const fileOut = z.object({
  id: z.string().describe("The short ID people use, like C99."),
  title: z.string(),
  kind: z.string(),
  from: z.string().describe("Uploaded, or which automation made it, and from which file."),
  tags: z.array(z.string()),
  length: z.string().nullable(),
  searchable: z.boolean().describe("Whether what was said in it can be searched."),
  said: z
    .array(z.object({ at: z.string(), seconds: z.number(), text: z.string() }))
    .describe("Moments where the words searched for were said."),
  link: z.string().describe("Its page in the dashboard, for a markdown link."),
});

export const findInLibrary = createTool({
  id: "find_in_library",
  description:
    "Search the team's content library: every file they uploaded or an automation made. Finds files by what was said in them (with the moments), by name, tag, or short ID (like V12 or C99). Use it when the person names a file by its ID or asks where they talked about something.",
  inputSchema: z.object({
    search: z.string().min(1).max(200).describe("Words, a name, a tag, or a short ID."),
  }),
  outputSchema: z.object({ files: z.array(fileOut) }),
  execute: async ({ search }, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    if (!session.organizationId) throw new Error("No team is open on the dashboard.");
    try {
      const hits = (await client.query(dash.library.search, {
        organizationId: session.organizationId,
        text: search,
      })) as Hit[];
      return {
        files: hits.slice(0, 20).map((hit) => ({
          id: hit.shortId,
          title: hit.title,
          kind: hit.kind,
          from:
            hit.source === "upload"
              ? "Uploaded"
              : `Made by ${hit.automationName ?? "an automation"}${hit.parent ? ` from ${hit.parent.shortId}` : ""}`,
          tags: hit.tags,
          length: hit.duration === null ? null : moment(hit.duration),
          searchable: hit.searchable === "ready",
          said: hit.moments.map((one) => ({
            at: moment(one.start),
            seconds: Math.floor(one.start),
            text: one.text,
          })),
          link: `/library/${hit._id}`,
        })),
      };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const runOnLibraryFile = createTool({
  id: "run_on_library_file",
  description:
    "Run one of the team's automations, as published, on a file from the library, named by its short ID (like C99). What it makes joins the library as made from that file. Use it for asks like 'caption C99': find or build the automation, then run it here.",
  inputSchema: z.object({
    file: z.string().min(1).describe("The file's short ID, like C99."),
    automationId: z.string().min(1),
  }),
  outputSchema: z.object({ runId: z.string(), link: z.string() }),
  execute: async ({ file, automationId }, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    if (!session.organizationId) throw new Error("No team is open on the dashboard.");
    try {
      const found = (await client.query(dash.library.byShortId, {
        organizationId: session.organizationId,
        shortId: file,
      })) as { _id: string } | null;
      if (!found) {
        throw new Error(`There is no file ${file} in the library. Search with find_in_library.`);
      }
      const runId = (await client.action(dash.library.runAutomation, {
        itemId: found._id,
        automationId,
      })) as string;
      return { runId, link: `/automations/${automationId}/runs/${runId}` };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const libraryTools = {
  find_in_library: findInLibrary,
  run_on_library_file: runOnLibraryFile,
};

export const LIBRARY_INSTRUCTIONS = `- The library: every file the team uploaded or an automation made has a short ID (V for videos brought in, C for clips automations made, A for sound, I for pictures, F for other files). When the person names a file by its ID ("caption C99") or asks where they talked about something, use find_in_library. To work on one file, find or build the automation, then run_on_library_file with the file's ID; report it with the link it returns. Link to a file with the address find_in_library gives, like [C99](/library/...).`;
