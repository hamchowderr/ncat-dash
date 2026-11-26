import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { dash, dashFor, plainError } from "./convex";

/**
 * The agent's hands on a project's storyboard: read it, write it from a script or from what
 * was said in an upload, put recorded takes in by what was said, and make it into one
 * finished video. Each calls the same Convex function the Storyboard tab calls, as the
 * person, so the agent can do nothing they could not do themselves.
 */

type ToolCtx = { agent?: { resourceId?: string } } | undefined;
const userOf = (ctx: ToolCtx) => ctx?.agent?.resourceId;

const projectId = z
  .string()
  .optional()
  .describe("The project's id. Leave out to mean the project open on the person's screen.");

/** The project asked for, or the one on the person's screen. */
function projectOf(id: string | undefined, ctx: ToolCtx) {
  const { client, session } = dashFor(userOf(ctx));
  const open = session.screen?.kind === "project" ? session.screen.id : null;
  const chosen = id ?? open;
  if (!chosen) {
    throw new Error(
      "No project is open on the dashboard. Ask the person which project, or have them open it.",
    );
  }
  return { client, session, projectId: chosen };
}

const linkOf = (project: string) => `/projects/${project}?view=storyboard`;

type Read = {
  project: string;
  storyboard: {
    storyboardId: string;
    aspect: string;
    length: string;
    script: string;
    chapters: {
      chapterId: string;
      title: string;
      takes: { number: number; line: string; scene: string; status: string }[];
    }[];
  } | null;
};

async function readBoard(client: ReturnType<typeof dashFor>["client"], id: string) {
  return (await client.query(dash.storyboards.forProject, { projectId: id })) as Read;
}

export const readStoryboard = createTool({
  id: "read_storyboard",
  description:
    "Read a project's storyboard: its script as text (the form write_storyboard takes), and each take's number, line, scene and where it stands (waiting for your take, needs a graphic, ready). Read it before changing one.",
  inputSchema: z.object({ projectId }),
  outputSchema: z.object({
    project: z.string(),
    hasStoryboard: z.boolean(),
    aspect: z.string().nullable(),
    length: z.string().nullable(),
    script: z.string().nullable(),
    takes: z.array(
      z.object({
        number: z.number(),
        chapter: z.string(),
        line: z.string(),
        scene: z.string(),
        status: z.string(),
      }),
    ),
    link: z.string(),
  }),
  execute: async (input, ctx) => {
    const { client, projectId: id } = projectOf(input.projectId, ctx);
    try {
      const read = await readBoard(client, id);
      const board = read.storyboard;
      return {
        project: read.project,
        hasStoryboard: !!board,
        aspect: board?.aspect ?? null,
        length: board?.length ?? null,
        script: board?.script ?? null,
        takes: (board?.chapters ?? []).flatMap((chapter) =>
          chapter.takes.map((take) => ({ ...take, chapter: chapter.title })),
        ),
        link: linkOf(id),
      };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const writeStoryboard = createTool({
  id: "write_storyboard",
  description:
    "Write a project's storyboard from a script, starting it if the project has none and otherwise replacing its chapters and takes. Lines kept word for word keep their files. Write the script in the storyboard's text form (see the instructions).",
  inputSchema: z.object({
    projectId,
    script: z
      .string()
      .min(1)
      .max(400_000)
      .describe('"## Chapter" lines, then one take a line: "[Scene · Part] The line said."'),
    aspect: z
      .enum(["16:9", "9:16", "1:1", "4:5"])
      .optional()
      .describe("The video's shape. Left out: 16:9 for a new one, else unchanged."),
    source: z
      .string()
      .max(200)
      .optional()
      .describe('Where the lines came from, such as "From the script Launch Day".'),
  }),
  outputSchema: z.object({
    chapters: z.number(),
    takes: z.number(),
    started: z.boolean(),
    link: z.string(),
  }),
  execute: async (input, ctx) => {
    const { client, projectId: id } = projectOf(input.projectId, ctx);
    try {
      const written = (await client.mutation(dash.storyboards.writeForProject, {
        projectId: id,
        script: input.script,
        ...(input.aspect ? { aspect: input.aspect } : {}),
        ...(input.source ? { source: input.source } : {}),
      })) as { chapters: number; takes: number; started: boolean };
      return { ...written, link: linkOf(id) };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const storyboardFromUpload = createTool({
  id: "storyboard_from_upload",
  description:
    "Add the lines said in one of the team's uploads to a project's storyboard: a line for every sentence with its own clip, retakes left out, chapters at long pauses. Use it to make a storyboard from a transcript. Name the upload by its library short ID, like V12.",
  inputSchema: z.object({
    projectId,
    file: z.string().min(1).describe("The upload's short ID, like V12."),
  }),
  outputSchema: z.object({ chapters: z.number(), takes: z.number(), link: z.string() }),
  execute: async (input, ctx) => {
    const { client, session, projectId: id } = projectOf(input.projectId, ctx);
    if (!session.organizationId) throw new Error("No team is open on the dashboard.");
    try {
      const found = (await client.query(dash.library.byShortId, {
        organizationId: session.organizationId,
        shortId: input.file,
      })) as { _id: string } | null;
      if (!found) throw new Error(`There is no file ${input.file} in the library.`);
      const added = (await client.mutation(dash.storyboards.gatherUploadDraft, {
        projectId: id,
        libraryItemId: found._id,
      })) as { chapters: number; takes: number };
      return { ...added, link: linkOf(id) };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const matchStoryboardTakes = createTool({
  id: "match_storyboard_takes",
  description:
    "Put recorded takes into a project's storyboard by what was said in them: each line is found in the named recordings, and when a line was said more than once the best take is used. Lines with a take keep it unless replace is true.",
  inputSchema: z.object({
    projectId,
    files: z
      .array(z.string().min(1))
      .min(1)
      .max(20)
      .describe("The recordings' short IDs, like V12."),
    replace: z.boolean().optional().describe("Pick again for lines that already have a take."),
  }),
  outputSchema: z.object({
    matched: z.number(),
    picked: z.array(z.number()).describe("Take numbers said more than once, best one used."),
    missing: z.array(z.number()).describe("Take numbers not found in the recordings."),
    notReady: z.array(z.string()).describe("Recordings still being transcribed."),
    link: z.string(),
  }),
  execute: async (input, ctx) => {
    const { client, session, projectId: id } = projectOf(input.projectId, ctx);
    if (!session.organizationId) throw new Error("No team is open on the dashboard.");
    try {
      const read = await readBoard(client, id);
      if (!read.storyboard) throw new Error("This project has no storyboard yet. Write one first.");
      const itemIds: string[] = [];
      for (const file of input.files) {
        const found = (await client.query(dash.library.byShortId, {
          organizationId: session.organizationId,
          shortId: file,
        })) as { _id: string } | null;
        if (!found) throw new Error(`There is no file ${file} in the library.`);
        itemIds.push(found._id);
      }
      const result = (await client.action(dash.storyboardMatch.match, {
        storyboardId: read.storyboard.storyboardId,
        libraryItemIds: itemIds,
        ...(input.replace ? { replace: true } : {}),
      })) as { matched: number; picked: number[]; missing: number[]; notReady: string[] };
      return { ...result, link: linkOf(id) };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const makeStoryboardVideo = createTool({
  id: "make_storyboard_video",
  description:
    "Make a project's storyboard, or one chapter of it, into one finished video: every take in its scene, joined in order, kept in the Library. Takes still waiting for the person's take are left out and named. It runs in the background; the Storyboard tab shows how far it is.",
  inputSchema: z.object({
    projectId,
    chapter: z
      .string()
      .optional()
      .describe("Only this chapter, by its title as read_storyboard gives it."),
  }),
  outputSchema: z.object({
    takes: z.number(),
    skipped: z.array(z.number()).describe("Take numbers left out: waiting for a file."),
    plain: z
      .array(z.number())
      .describe("Take numbers shown Full Screen until their graphic is in."),
    link: z.string(),
  }),
  execute: async (input, ctx) => {
    const { client, projectId: id } = projectOf(input.projectId, ctx);
    try {
      const read = await readBoard(client, id);
      const board = read.storyboard;
      if (!board) throw new Error("This project has no storyboard yet. Write one first.");
      let chapterId: string | undefined;
      if (input.chapter) {
        const wanted = input.chapter.trim().toLowerCase();
        chapterId = board.chapters.find((one) => one.title.toLowerCase() === wanted)?.chapterId;
        if (!chapterId) throw new Error(`The storyboard has no chapter called ${input.chapter}.`);
      }
      const started = (await client.mutation(dash.storyboardVideos.start, {
        storyboardId: board.storyboardId,
        ...(chapterId ? { chapterId } : {}),
      })) as { takes: number; skipped: number[]; plain: number[] };
      return { ...started, link: linkOf(id) };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const storyboardTools = {
  read_storyboard: readStoryboard,
  write_storyboard: writeStoryboard,
  storyboard_from_upload: storyboardFromUpload,
  match_storyboard_takes: matchStoryboardTakes,
  make_storyboard_video: makeStoryboardVideo,
};

export const STORYBOARD_INSTRUCTIONS = `- Storyboards: a project's video planned line by line, on its Storyboard tab. read_storyboard shows one. To write one from a script the person gives or describes, or from a transcript you have read, use write_storyboard with the script in this form, one take a line:
  ## Chapter title
  [Full Screen] A line the person says to camera.
  [Panel · Graphic] A line said with points shown beside them.
  [Circle · Page recording] A line said over a recording of a web page, with a small circle of them.
  [Centre · Graphic] A line comparing two things, one either side of them.
  [Full Graphic · Graphic · No voice] A line shown only as a graphic, said by nobody.
  Scenes are Full Screen, Panel, Centre, Full Graphic and Circle; parts are Graphic, Page recording and Your screen. Keep each line to one or two spoken sentences, use the person's own words when they gave them, and use few scenes in short videos. Writing replaces the storyboard, so read it first and keep what the person did not ask to change.
- To make a storyboard from what was said in an upload, use storyboard_from_upload with the upload's short ID. After the person records their takes, match_storyboard_takes puts each take in by what was said. make_storyboard_video makes the finished video; say which takes were left out or shown plainly, and link the Storyboard tab with the address the tool returned.`;
