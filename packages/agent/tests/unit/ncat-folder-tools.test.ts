import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DashClient, useDashClientForTests } from "../../src/mastra/ncat/convex";
import { forgetSessions, rememberSession } from "../../src/mastra/ncat/session-store";
import {
  folderKey,
  listFolder,
  makeFolder,
  moveFiles,
  NCAT_EDIT_TOOLS,
  NCAT_READ_TOOLS,
  ncatTools,
  renameFile,
} from "../../src/mastra/ncat/tools";
import { resolveToolCategory } from "../../src/mastra/lib/tool-categories";

/**
 * The agent's hands on the team's storage: look in a folder, make folders, move and
 * rename files. Convex is stood in for by a client that writes down what it was asked,
 * and a tiny bucket so make_folder can see what already exists.
 */
const USER = "u-files";
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let folders: Set<string>;

const client = {
  query: async () => {
    throw new Error("no queries here");
  },
  mutation: async () => {
    throw new Error("no mutations here");
  },
  action: async (ref: never, args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    if (name === "files:folders") {
      const prefix = args.prefix as string;
      return [...folders]
        .filter((key) => key.startsWith(prefix) && key.slice(prefix.length).split("/").length === 2)
        .map((key) => ({ key, name: key.slice(prefix.length, -1) }));
    }
    if (name === "files:createFolder") {
      const key = `${args.prefix}${args.name}/`;
      folders.add(key);
      return key;
    }
    if (name === "files:list") {
      return {
        bucket: "media",
        folders: [{ key: "Podcasts/", name: "Podcasts" }],
        files: [
          {
            key: "episode-12.mp4",
            name: "episode-12.mp4",
            kind: "video",
            size: 1000,
            lastModified: 1,
            uploadId: null,
            details: null,
            usedAs: null,
          },
        ],
        next: null,
      };
    }
    if (name === "files:move") return { moved: (args.keys as string[]).length, leftBehind: 0 };
    if (name === "files:rename") return { moved: 1, leftBehind: 0 };
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
  folders = new Set(["Podcasts/"]);
  useDashClientForTests(() => client as unknown as DashClient);
  rememberSession(USER, { convexToken: "t", organizationId: "team_1", automationId: null });
});
afterEach(() => {
  useDashClientForTests();
  forgetSessions();
});

describe("folderKey", () => {
  it("writes a folder the way the bucket does", () => {
    expect(folderKey("Podcasts/Raw")).toBe("Podcasts/Raw/");
    expect(folderKey(" /Podcasts// Raw / ")).toBe("Podcasts/Raw/");
    expect(folderKey("")).toBe("");
    expect(folderKey(undefined)).toBe("");
  });
});

describe("list_folder", () => {
  it("lists one folder of the team's storage", async () => {
    const result = await run(listFolder, { folder: "/" });
    expect(calls).toEqual([
      { name: "files:list", args: { organizationId: "team_1", prefix: "" } },
    ]);
    expect(result).toEqual({
      folder: "",
      folders: ["Podcasts/"],
      files: [{ key: "episode-12.mp4", name: "episode-12.mp4", kind: "video", size: 1000 }],
      more: false,
    });
  });
});

describe("make_folder", () => {
  it("makes only the folders that are missing, top down", async () => {
    const result = await run(makeFolder, { path: "Podcasts/Raw/2026" });
    expect(result).toEqual({ folder: "Podcasts/Raw/2026/", made: ["Podcasts/Raw/", "Podcasts/Raw/2026/"] });
    expect(calls.filter((call) => call.name === "files:createFolder").map((call) => call.args)).toEqual([
      { organizationId: "team_1", prefix: "Podcasts/", name: "Raw" },
      { organizationId: "team_1", prefix: "Podcasts/Raw/", name: "2026" },
    ]);
  });

  it("leaves a folder that already exists alone", async () => {
    const result = await run(makeFolder, { path: "Podcasts" });
    expect(result).toEqual({ folder: "Podcasts/", made: [] });
    expect(calls.some((call) => call.name === "files:createFolder")).toBe(false);
  });

  it("refuses to make the top of the bucket", async () => {
    await expect(run(makeFolder, { path: "/" })).rejects.toThrow(/which folder/);
  });
});

describe("move_files and rename_file", () => {
  it("moves a file from the top of the bucket into a folder", async () => {
    const result = await run(moveFiles, { keys: ["episode-12.mp4"], toFolder: "Podcasts/Raw" });
    expect(calls).toEqual([
      {
        name: "files:move",
        args: { organizationId: "team_1", keys: ["episode-12.mp4"], toFolder: "Podcasts/Raw/" },
      },
    ]);
    expect(result).toEqual({ folder: "Podcasts/Raw/", moved: 1, leftBehind: 0 });
  });

  it("renames a file where it is", async () => {
    await run(renameFile, { key: "Podcasts/ep12.mp4", name: "Episode 12.mp4" });
    expect(calls).toEqual([
      {
        name: "files:rename",
        args: { organizationId: "team_1", key: "Podcasts/ep12.mp4", name: "Episode 12.mp4" },
      },
    ]);
  });
});

describe("asking first", () => {
  it("looks without asking, makes folders as an edit, and asks every time to move or rename", () => {
    expect(ncatTools.list_folder).toBe(listFolder);
    expect(NCAT_READ_TOOLS).toContain("list_folder");
    expect(NCAT_EDIT_TOOLS).toContain("make_folder");
    expect(resolveToolCategory("list_folder")).toBe("read");
    expect(resolveToolCategory("make_folder")).toBe("edit");
    expect(resolveToolCategory("move_files")).toBeNull();
    expect(resolveToolCategory("rename_file")).toBeNull();
  });
});
