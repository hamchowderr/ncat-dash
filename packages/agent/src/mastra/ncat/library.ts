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
  client: { name: string } | null;
  tags: string[];
  duration: number | null;
  searchable: string;
  transcriptError?: string | null;
  transcriptSince?: number | null;
  storedElsewhere?: "hosted" | "earlier" | null;
  moments: { start: number; text: string }[];
};

function moment(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Where a file's transcript stands, for the agent to tell the person. */
export function transcriptNote(
  hit: Pick<Hit, "kind" | "searchable" | "transcriptError" | "transcriptSince">,
  now = Date.now(),
): string {
  if (hit.searchable === "ready") return "Ready.";
  if (hit.searchable === "failed") {
    return `It did not work${hit.transcriptError ? `: ${hit.transcriptError}` : "."} It can be tried again from the file's page.`;
  }
  if (hit.kind !== "video" && hit.kind !== "audio")
    return "Not a video or sound: it has no transcript.";
  if (hit.transcriptSince) {
    const minutes = Math.max(1, Math.round((now - hit.transcriptSince) / 60_000));
    const hours = Math.floor(minutes / 60);
    const span =
      hours === 0 ? `${minutes} min` : `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
    return `Being made now, ${span} so far. Its words cannot be read until it is done.`;
  }
  return "Waiting to be made. Its words cannot be read until it is done.";
}

const fileOut = z.object({
  id: z.string().describe("The short ID people use, like C99."),
  title: z.string(),
  kind: z.string(),
  from: z.string().describe("Uploaded, or which automation made it, and from which file."),
  client: z.string().nullable().describe("The client it is for; null for the team's own."),
  tags: z.array(z.string()),
  length: z.string().nullable(),
  searchable: z.boolean().describe("Whether what was said in it can be searched."),
  transcript: z
    .string()
    .describe(
      "Where its transcript stands, in words to pass on: ready, being made (and for how long), or why it did not work. When a file has no words, tell the person this.",
    ),
  storage: z
    .string()
    .nullable()
    .describe(
      "Null when it is on the team's storage now. Otherwise it is on the storage the team used before it switched servers: a video uploaded again after switching then shows twice, so count it once and say so.",
    ),
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
          client: hit.client?.name ?? null,
          tags: hit.tags,
          length: hit.duration === null ? null : moment(hit.duration),
          searchable: hit.searchable === "ready",
          transcript: transcriptNote(hit),
          storage:
            hit.storedElsewhere === "hosted"
              ? "On Takewon's storage, from before the team switched to its own server. It still works."
              : hit.storedElsewhere === "earlier"
                ? "On the storage the team used before it switched servers. It can no longer be reached; it must be uploaded again."
                : null,
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

type Summary = Omit<Hit, "moments">;

const madeOut = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  madeBy: z.string().nullable().describe("The automation that made it."),
  link: z.string(),
});

const linkOf = (file: { _id: string }) => `/library/${file._id}`;

export const libraryFile = createTool({
  id: "library_file",
  description:
    "Look up one library file by its short ID (like V1 or C99): what it is, where it came from, and every file made from it. Use it whenever the person asks what was made from a file, which clips came from a video, or where a clip came from. find_in_library searches words and cannot answer that.",
  inputSchema: z.object({
    file: z.string().min(1).describe("The file's short ID, like V1 or C99."),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    file: z
      .object({
        id: z.string(),
        title: z.string(),
        kind: z.string(),
        from: z.string(),
        client: z.string().nullable(),
        length: z.string().nullable(),
        link: z.string(),
      })
      .nullable(),
    madeFromIt: z
      .array(madeOut)
      .describe("Every file made from this one, oldest first. This list is complete."),
  }),
  execute: async ({ file }, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    if (!session.organizationId) throw new Error("No team is open on the dashboard.");
    try {
      const found = (await client.query(dash.library.byShortId, {
        organizationId: session.organizationId,
        shortId: file,
      })) as { _id: string } | null;
      if (!found) return { found: false, file: null, madeFromIt: [] };
      const item = (await client.query(dash.library.get, { itemId: found._id })) as
        (Summary & { children: Summary[] }) | null;
      if (!item) return { found: false, file: null, madeFromIt: [] };
      return {
        found: true,
        file: {
          id: item.shortId,
          title: item.title,
          kind: item.kind,
          from:
            item.source === "upload"
              ? "Uploaded"
              : `Made by ${item.automationName ?? "an automation"}${item.parent ? ` from ${item.parent.shortId}` : ""}`,
          client: item.client?.name ?? null,
          length: item.duration === null ? null : moment(item.duration),
          link: linkOf(item),
        },
        madeFromIt: item.children.map((child) => ({
          id: child.shortId,
          title: child.title,
          kind: child.kind,
          madeBy: child.automationName,
          link: linkOf(child),
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
  library_file: libraryFile,
  run_on_library_file: runOnLibraryFile,
};

export const LIBRARY_INSTRUCTIONS = `- The library: every file the team uploaded or an automation made has a short ID (V for videos brought in, C for clips automations made, A for sound, I for pictures, F for other files). When the person names a file by its ID ("caption C99") or asks where they talked about something, use find_in_library. To say what was made from a file ("which clips came from V1?") or where a file came from, use library_file and give exactly the files it lists; never work that out from find_in_library, which matches words and misses or adds files. To work on one file, find or build the automation, then run_on_library_file with the file's ID; report it with the link it returns. Link to a file with the address find_in_library gives, like [C99](/library/...).`;
