import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveToolCategory } from "../../src/mastra/lib/tool-categories";
import { type DashClient, useDashClientForTests } from "../../src/mastra/ncat/convex";
import { forgetSessions, rememberSession } from "../../src/mastra/ncat/session-store";
import {
  makeStoryboardVideo,
  matchStoryboardTakes,
  readStoryboard,
  storyboardFromUpload,
  writeStoryboard,
} from "../../src/mastra/ncat/storyboard";
import { NCAT_INSTRUCTIONS, NCAT_READ_TOOLS, ncatTools } from "../../src/mastra/ncat/tools";

/**
 * The agent's storyboard tools: read a project's storyboard, write it from a script or from
 * an upload's transcript, put recorded takes in by what was said, and make the video.
 * Convex is stood in for by a client that writes down what it was asked.
 */
const USER = "u-storyboard";
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];

const BOARD = {
  project: "Launch Video",
  storyboard: {
    storyboardId: "sb_1",
    aspect: "16:9",
    length: "about 1 min",
    script: "## Open\n[Full Screen · You] Hello and welcome.",
    chapters: [
      {
        chapterId: "ch_1",
        title: "Open",
        takes: [
          { number: 1, line: "Hello and welcome.", scene: "full", status: "Waiting for your take" },
        ],
      },
      { chapterId: "ch_2", title: "Close", takes: [] },
    ],
  },
};

const client = {
  query: async (ref: never, args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    if (name === "storyboards:forProject") {
      return args.projectId === "p_empty" ? { project: "Empty", storyboard: null } : BOARD;
    }
    if (name === "library:byShortId")
      return args.shortId === "V404" ? null : { _id: `item_${args.shortId}` };
    throw new Error(`No answer for ${name}`);
  },
  mutation: async (ref: never, args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    if (name === "storyboards:writeForProject") return { chapters: 2, takes: 5, started: true };
    if (name === "storyboards:gatherUploadDraft") return { chapters: 3, takes: 14 };
    if (name === "storyboardVideos:start")
      return { videoId: "v1", takes: 4, skipped: [2], plain: [3] };
    throw new Error(`No answer for ${name}`);
  },
  action: async (ref: never, args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    if (name === "storyboardMatch:match")
      return { matched: 3, picked: [1], missing: [4], notReady: [] };
    throw new Error(`No answer for ${name}`);
  },
};

// biome-ignore lint/suspicious/noExplicitAny: a tool's context is wide; these tools read only agent.resourceId
const ctx = { agent: { resourceId: USER } } as any;
// biome-ignore lint/suspicious/noExplicitAny: execute's input type comes from each schema
const run = (tool: { execute?: (input: any, ctx: any) => unknown }, input: unknown) =>
  tool.execute?.(input, ctx);

const onScreen = (screen: { kind: "project"; id: string } | null) =>
  rememberSession(USER, {
    convexToken: "t",
    organizationId: "team_1",
    automationId: null,
    screen,
  });

beforeEach(() => {
  calls = [];
  useDashClientForTests(() => client as unknown as DashClient);
  onScreen({ kind: "project", id: "p_1" });
});
afterEach(() => {
  useDashClientForTests();
  forgetSessions();
});

describe("reading and writing a storyboard", () => {
  it("reads the project on screen, with its script and each take", async () => {
    const read = (await run(readStoryboard, {})) as Record<string, unknown>;
    expect(calls).toEqual([{ name: "storyboards:forProject", args: { projectId: "p_1" } }]);
    expect(read).toMatchObject({
      project: "Launch Video",
      hasStoryboard: true,
      script: BOARD.storyboard.script,
      takes: [{ number: 1, chapter: "Open", status: "Waiting for your take" }],
      link: "/projects/p_1?view=storyboard",
    });
  });

  it("says when a project has none yet, and asks which project when none is open", async () => {
    expect(await run(readStoryboard, { projectId: "p_empty" })).toMatchObject({
      hasStoryboard: false,
      script: null,
      takes: [],
    });
    onScreen(null);
    await expect(run(readStoryboard, {})).rejects.toThrow(/No project is open/);
  });

  it("writes a script, with the shape and where the lines came from", async () => {
    const written = await run(writeStoryboard, {
      script: "## Open\n[Panel · Graphic] Here is the plan.",
      aspect: "9:16",
      source: "From the script Launch Day",
    });
    expect(calls[0]).toEqual({
      name: "storyboards:writeForProject",
      args: {
        projectId: "p_1",
        script: "## Open\n[Panel · Graphic] Here is the plan.",
        aspect: "9:16",
        source: "From the script Launch Day",
      },
    });
    expect(written).toMatchObject({ chapters: 2, takes: 5, started: true });
  });

  it("makes one from what was said in an upload, by its short ID", async () => {
    const added = await run(storyboardFromUpload, { file: "V12" });
    expect(calls.map((call) => call.name)).toEqual([
      "library:byShortId",
      "storyboards:gatherUploadDraft",
    ]);
    expect(calls[1].args).toEqual({ projectId: "p_1", libraryItemId: "item_V12" });
    expect(added).toMatchObject({ chapters: 3, takes: 14 });
    await expect(run(storyboardFromUpload, { file: "V404" })).rejects.toThrow(/no file V404/);
  });
});

describe("takes and the finished video", () => {
  it("matches recordings named by short ID to the storyboard", async () => {
    const matched = await run(matchStoryboardTakes, { files: ["V3", "V4"], replace: true });
    expect(calls.at(-1)).toEqual({
      name: "storyboardMatch:match",
      args: { storyboardId: "sb_1", libraryItemIds: ["item_V3", "item_V4"], replace: true },
    });
    expect(matched).toMatchObject({ matched: 3, picked: [1], missing: [4] });
  });

  it("makes the whole video, or one chapter named by its title", async () => {
    expect(await run(makeStoryboardVideo, {})).toMatchObject({
      takes: 4,
      skipped: [2],
      plain: [3],
    });
    expect(calls.at(-1)).toEqual({
      name: "storyboardVideos:start",
      args: { storyboardId: "sb_1" },
    });
    await run(makeStoryboardVideo, { chapter: "close" });
    expect(calls.at(-1)?.args).toEqual({ storyboardId: "sb_1", chapterId: "ch_2" });
    await expect(run(makeStoryboardVideo, { chapter: "Middle" })).rejects.toThrow(
      /no chapter called Middle/,
    );
  });

  it("only reading looks without asking; writing, matching and making ask first", () => {
    expect(Object.keys(ncatTools)).toEqual(
      expect.arrayContaining([
        "read_storyboard",
        "write_storyboard",
        "storyboard_from_upload",
        "match_storyboard_takes",
        "make_storyboard_video",
      ]),
    );
    expect(NCAT_READ_TOOLS).toContain("read_storyboard");
    expect(resolveToolCategory("read_storyboard")).toBe("read");
    for (const name of ["write_storyboard", "match_storyboard_takes", "make_storyboard_video"]) {
      expect(NCAT_READ_TOOLS).not.toContain(name);
      expect(resolveToolCategory(name)).not.toBe("read");
    }
    expect(NCAT_INSTRUCTIONS).toContain("[Panel · Graphic]");
  });
});
