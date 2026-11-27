import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveToolCategory } from "../../src/mastra/lib/tool-categories";
import { type DashClient, useDashClientForTests } from "../../src/mastra/ncat/convex";
import { findInLibrary, libraryFile, runOnLibraryFile } from "../../src/mastra/ncat/library";
import { forgetSessions, rememberSession } from "../../src/mastra/ncat/session-store";
import { NCAT_INSTRUCTIONS, NCAT_READ_TOOLS, ncatTools } from "../../src/mastra/ncat/tools";

/**
 * The agent's way into the content library: find a file by what was said, its name or its
 * short ID, and run an automation on it ("caption C99"). Convex is stood in for by a client
 * that writes down what it was asked.
 */
const USER = "u-library";
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];

const HIT = {
  _id: "item_1",
  shortId: "C99",
  title: "Episode 4 clip 2",
  kind: "video",
  source: "automation",
  automationName: "Podcast clips",
  parent: { shortId: "V12", title: "Episode 4" },
  client: { name: "Acme Coffee" },
  tags: ["pricing"],
  duration: 45.2,
  searchable: "ready",
  moments: [{ start: 751.4, text: "Let's talk about pricing." }],
};

const made = (n: number) => ({
  _id: `item_c${n}`,
  shortId: `C${n}`,
  title: `Crew interview clip ${n}`,
  kind: "video",
  source: "automation",
  automationName: "Interview clips",
  parent: { shortId: "V1", title: "Crew interview" },
  client: null,
  tags: [],
  duration: 30,
  searchable: "no",
});

const V1 = {
  _id: "item_v1",
  shortId: "V1",
  title: "Crew interview",
  kind: "video",
  source: "upload",
  automationName: null,
  parent: null,
  client: null,
  tags: [],
  duration: 600,
  searchable: "ready",
  children: [1, 2, 3, 4, 9, 10].map(made),
};

const client = {
  query: async (ref: never, args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    if (name === "library:search") return [HIT];
    if (name === "library:byShortId") {
      if (args.shortId === "C99") return { _id: "item_1" };
      if (args.shortId === "V1") return { _id: "item_v1" };
      return null;
    }
    if (name === "library:get" && args.itemId === "item_v1") return V1;
    throw new Error(`No answer for ${name}`);
  },
  mutation: async () => {
    throw new Error("no mutations here");
  },
  action: async (ref: never, args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    if (name === "library:runAutomation") return "run_7";
    throw new Error(`No answer for ${name}`);
  },
};

// biome-ignore lint/suspicious/noExplicitAny: a tool's context is wide; these tools read only agent.resourceId
const ctx = { agent: { resourceId: USER } } as any;
// biome-ignore lint/suspicious/noExplicitAny: execute's input type comes from each schema
const run = (tool: { execute?: (input: any, ctx: any) => unknown }, input: unknown) =>
  tool.execute?.(input, ctx);

beforeEach(() => {
  calls = [];
  useDashClientForTests(() => client as unknown as DashClient);
  rememberSession(USER, { convexToken: "t", organizationId: "team_1", automationId: null });
});
afterEach(() => {
  useDashClientForTests();
  forgetSessions();
});

describe("library_file", () => {
  it("lists exactly the files made from a video, as the Library does", async () => {
    const result = (await run(libraryFile, { file: "V1" })) as {
      file: { id: string; from: string; link: string };
      madeFromIt: { id: string; link: string }[];
    };
    expect(calls.map((c) => c.name)).toEqual(["library:byShortId", "library:get"]);
    expect(result.file).toMatchObject({ id: "V1", from: "Uploaded", link: "/library/item_v1" });
    expect(result.madeFromIt.map((f) => f.id)).toEqual(["C1", "C2", "C3", "C4", "C9", "C10"]);
    expect(result.madeFromIt[0]).toMatchObject({
      madeBy: "Interview clips",
      link: "/library/item_c1",
    });
  });

  it("says plainly when there is no such file", async () => {
    expect(await run(libraryFile, { file: "V404" })).toEqual({
      found: false,
      file: null,
      madeFromIt: [],
    });
  });

  it("only looks, and the instructions send lineage questions to it", () => {
    expect(NCAT_READ_TOOLS).toContain("library_file");
    expect(Object.keys(ncatTools)).toContain("library_file");
    expect(NCAT_INSTRUCTIONS).toContain("use library_file");
  });
});

describe("find_in_library", () => {
  it("finds files and the moments the words were said", async () => {
    const result = await run(findInLibrary, { search: "pricing" });
    expect(calls).toEqual([
      { name: "library:search", args: { organizationId: "team_1", text: "pricing" } },
    ]);
    expect(result).toEqual({
      files: [
        {
          id: "C99",
          title: "Episode 4 clip 2",
          kind: "video",
          from: "Made by Podcast clips from V12",
          client: "Acme Coffee",
          tags: ["pricing"],
          length: "0:45",
          searchable: true,
          transcript: "Ready.",
          storage: null,
          said: [{ at: "12:31", seconds: 751, text: "Let's talk about pricing." }],
          link: "/library/item_1",
        },
      ],
    });
  });

  it("only looks, so it runs without asking", () => {
    expect(NCAT_READ_TOOLS).toContain("find_in_library");
    expect(resolveToolCategory("find_in_library")).toBe("read");
  });
});

describe("run_on_library_file", () => {
  it("runs an automation on the file with that short ID", async () => {
    const result = await run(runOnLibraryFile, { file: "C99", automationId: "auto_1" });
    expect(calls.at(-1)).toEqual({
      name: "library:runAutomation",
      args: { itemId: "item_1", automationId: "auto_1" },
    });
    expect(result).toEqual({ runId: "run_7", link: "/automations/auto_1/runs/run_7" });
  });

  it("says so when there is no such file", async () => {
    await expect(run(runOnLibraryFile, { file: "C5", automationId: "auto_1" })).rejects.toThrow(
      /no file C5/,
    );
  });

  it("asks before running, like trying an automation", () => {
    expect(resolveToolCategory("run_on_library_file")).not.toBe("read");
  });
});

describe("the agent knows about the library", () => {
  it("has both tools and is told how short IDs work", () => {
    expect(Object.keys(ncatTools)).toEqual(
      expect.arrayContaining(["find_in_library", "run_on_library_file"]),
    );
    expect(NCAT_INSTRUCTIONS).toContain("caption C99");
  });
});
