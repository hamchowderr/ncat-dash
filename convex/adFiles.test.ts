import { afterEach, describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import { adFilesCsv, adFolder, readAdCode, shapeFolder, stemOf } from "./lib/adFiles";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

/**
 * Hook variants, length cuts and shapes carry a code on each file. When the run finishes,
 * the files go into one folder per shape and a CSV list for an ads manager sits beside them.
 */
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
afterEach(() => toolkit?.restore());

const LINK = "https://r2.example/test-bucket";
const JOB = "ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10";

describe("reading an ad file's code", () => {
  test("splits the code into hook, ending, length, shape and captions", () => {
    expect(readAdCode("h02_c01_15s_9x16_captioned")).toEqual({
      hook: "h02",
      ending: "c01",
      length: "15s",
      shape: "9x16",
      captioned: true,
      music: false,
      concept: ["h02", "c01"],
    });
    // The copy with the team's music under it says so; it is the same idea as without.
    expect(readAdCode("h02_c01_15s_9x16_captioned_music")).toMatchObject({
      captioned: true,
      music: true,
      concept: ["h02", "c01"],
    });
    expect(readAdCode("t03").concept).toEqual(["t03"]);
    expect(shapeFolder("h01_c01_30s_4x5")).toBe("4x5/");
    expect(shapeFolder("h01_c01_30s")).toBe("");
    expect(shapeFolder(null)).toBe("");
    expect(stemOf("Boots ad h02_c01_15s.mp4", "h02_c01_15s")).toBe("Boots ad");
  });

  test("one creative ID across every length and shape of a pairing", () => {
    const csv = adFilesCsv([
      { name: "Boots ad h02_c01_15s_9x16.mp4", folder: "9x16/", label: "h02_c01_15s_9x16" },
      { name: "Boots ad h02_c01_30s_4x5.mp4", folder: "4x5/", label: "h02_c01_30s_4x5" },
      { name: "Boots ad h01_c01_15s_9x16.mp4", folder: "9x16/", label: "h01_c01_15s_9x16" },
    ]);
    const rows = csv
      .trim()
      .split("\r\n")
      .map((row) => row.split(","));
    expect(rows[0]).toEqual([
      "file_name",
      "folder",
      "creative_id",
      "creator",
      "hook",
      "ending",
      "length",
      "shape",
      "captioned",
      "music",
      "primary_text",
      "headline",
      "script_type",
      "creator_role",
      "visual_format",
      "visual_hook",
    ]);
    expect(rows.slice(1).map((row) => row[2])).toEqual([
      "boots_ad_h02_c01",
      "boots_ad_h02_c01",
      "boots_ad_h01_c01",
    ]);
    expect(rows[2]).toEqual([
      "Boots ad h02_c01_30s_4x5.mp4",
      "4x5/",
      "boots_ad_h02_c01",
      "",
      "h02",
      "c01",
      "30s",
      "4:5",
      "no",
      "no",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  });

  test("a creator gets a folder of their own and is in the creative ID", () => {
    expect(adFolder("h01_c01_15s_9x16", "Jane Doe")).toBe("Jane Doe/9x16/");
    expect(adFolder("h01_c01_15s_9x16", "  ")).toBe("9x16/");
    expect(adFolder("h01_c01_15s_9x16", "a/b")).toBe("a-b/9x16/");
    expect(adFolder("h01_c01_15s_9x16", "..")).toBe("9x16/");
    expect(adFolder(null, "Jane Doe")).toBe("");
    const csv = adFilesCsv([
      {
        name: "Boots ad h02_c01_15s_9x16.mp4",
        folder: "Jane Doe/9x16/",
        label: "h02_c01_15s_9x16",
        creator: "Jane Doe",
      },
    ]);
    const row = csv.split("\r\n")[1]!.split(",");
    expect(row.slice(1, 4)).toEqual(["Jane Doe/9x16/", "boots_ad_h02_c01_jane_doe", "Jane Doe"]);
  });

  test("the copies with and without music share a creative ID and say which is which", () => {
    const csv = adFilesCsv([
      { name: "Boots ad h02_c01_15s_9x16.mp4", folder: "9x16/", label: "h02_c01_15s_9x16" },
      {
        name: "Boots ad h02_c01_15s_9x16_music.mp4",
        folder: "9x16/",
        label: "h02_c01_15s_9x16_music",
      },
    ]);
    const rows = csv
      .trim()
      .split("\r\n")
      .map((row) => row.split(","));
    const music = rows[0].indexOf("music");
    expect(rows.slice(1).map((row) => [row[2], row[music]])).toEqual([
      ["boots_ad_h02_c01", "no"],
      ["boots_ad_h02_c01", "yes"],
    ]);
  });

  test("names with commas or quotes stay in one cell", () => {
    const csv = adFilesCsv([{ name: 'Boots, "red" 15s.mp4', folder: "", label: "15s" }]);
    expect(csv.split("\r\n")[1]?.startsWith('"Boots, ""red"" 15s.mp4",')).toBe(true);
  });
});

describe("a finished run of ad files", () => {
  async function adRun(labelled: boolean, creator?: string) {
    process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
    toolkit = fakeToolkitStorage();
    const t = backend();
    const salt = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [salt], "owner");
    await connectToolkit(t, salt, maya.id);
    const codes = ["h01_c01_15s_9x16", "h01_c01_15s_4x5", "h02_c01_15s_9x16"];
    const outputs = codes.map((_, i) => `${LINK}/${JOB}_output_${i}.mp4`);
    const runId = await t.run(async (ctx) => {
      const automationId = await ctx.db.insert("automations", {
        organizationId: salt,
        name: "Boots Ads",
        enabled: true,
        trigger: { kind: "manual" },
        nodes: [],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      });
      const runId = await ctx.db.insert("runs", {
        organizationId: salt,
        automationId,
        automationName: "Boots Ads",
        status: "done",
        triggerKind: "manual",
        trigger: { file_url: `${LINK}/teams/${salt}/uploads/x/boots.mp4`, file_name: "boots.mp4" },
        nodes: [
          {
            id: "shape",
            kind: "step",
            stepId: "recipe-blur-fill",
            input: creator ? { creator } : {},
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
        error: null,
        startedBy: null,
        finishedAt: Date.now(),
      });
      await ctx.db.insert("runSteps", {
        runId,
        organizationId: salt,
        nodeId: "shape",
        status: "done",
        jobIds: [],
        outputs,
        ...(labelled ? { labels: outputs.map((url, i) => ({ url, label: codes[i]! })) } : {}),
        error: null,
        startedAt: 0,
        finishedAt: 0,
      });
      return runId;
    });
    outputs.forEach((_, i) => toolkit!.put(`${JOB}_output_${i}.mp4`));
    return { t, salt, runId, toolkit };
  }

  test("go into one folder per shape, with a CSV list beside them", async () => {
    const { t, salt, runId, toolkit } = await adRun(true);
    const kept = await t.action(internal.files.keepFinished, { runId });
    const folder = "Finished/Boots Ads/";
    expect(kept.filter((key) => key.startsWith(`${folder}9x16/`))).toHaveLength(2);
    expect(kept.filter((key) => key.startsWith(`${folder}4x5/`))).toHaveLength(1);
    expect(kept).toContain(`${folder}Ad files.csv`);
    for (const key of kept) expect(toolkit.files.has(`teams/${salt}/${key}`)).toBe(true);
    const csv = toolkit.texts.get(`teams/${salt}/${folder}Ad files.csv`) ?? "";
    const rows = csv.trim().split("\r\n");
    expect(rows).toHaveLength(4);
    expect(rows.slice(1).map((row) => row.split(",")[1])).toEqual(["9x16/", "4x5/", "9x16/"]);
    // Every file the list names is in the folder it says.
    for (const row of rows.slice(1)) {
      const [name, sub] = row.split(",");
      expect(kept).toContain(`${folder}${sub}${name}`);
    }
  });

  test("a creator's files go in their own folder, then one per shape", async () => {
    const { t, salt, runId, toolkit } = await adRun(true, "Jane Doe");
    const kept = await t.action(internal.files.keepFinished, { runId });
    const folder = "Finished/Boots Ads/";
    expect(kept.filter((key) => key.startsWith(`${folder}Jane Doe/9x16/`))).toHaveLength(2);
    expect(kept.filter((key) => key.startsWith(`${folder}Jane Doe/4x5/`))).toHaveLength(1);
    const csv = toolkit.texts.get(`teams/${salt}/${folder}Ad files.csv`) ?? "";
    const rows = csv
      .trim()
      .split("\r\n")
      .slice(1)
      .map((row) => row.split(","));
    expect(rows.map((row) => row[3])).toEqual(["Jane Doe", "Jane Doe", "Jane Doe"]);
    for (const row of rows) expect(kept).toContain(`${folder}${row[1]}${row[0]}`);
  });

  test("a second run does not overwrite the first's files or list", async () => {
    const { t, runId } = await adRun(true);
    await t.action(internal.files.keepFinished, { runId });
    const again = await t.action(internal.files.keepFinished, { runId });
    expect(again).toContain("Finished/Boots Ads/Ad files (2).csv");
    expect(again.filter((key) => key.includes("(2).mp4"))).toHaveLength(3);
  });

  test("files without codes keep the plain folder and no list", async () => {
    const { t, runId } = await adRun(false);
    const kept = await t.action(internal.files.keepFinished, { runId });
    expect(kept).toHaveLength(3);
    for (const key of kept) expect(key.split("/")).toHaveLength(3);
    expect(kept.some((key) => key.endsWith(".csv"))).toBe(false);
  });
});
