import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

const RECORDING = "https://files.example/uploads/abc/talk.mp4?sig=1";

describe("the files to open in an editor", () => {
  test("name the folder to save into and the recording the timelines point at", async () => {
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
    const stranger = await addPerson(t, "Ana Cruz", [await addTeam(t, "Far Away")], "owner");
    const automationId = await owner.as.mutation(api.automations.create, {
      organizationId: team,
      name: "Weekly clips",
      starterId: "social-clips",
    });
    const runId = await t.run(async (ctx) => {
      const runId = await ctx.db.insert("runs", {
        organizationId: team,
        automationId,
        automationName: "Weekly clips",
        status: "done",
        triggerKind: "manual",
        trigger: { file_url: RECORDING },
        nodes: [
          { id: "clips", kind: "step", stepId: "clips", input: {}, position: { x: 0, y: 0 } },
        ],
        edges: [],
        error: null,
        startedBy: null,
        finishedAt: Date.now(),
      });
      await ctx.db.insert("runSteps", {
        runId,
        organizationId: team,
        nodeId: "clips",
        status: "done",
        jobIds: [],
        outputs: ["https://files.example/out/clip-a.mp4"],
        plan: [{ source: RECORDING, part: 1, parts: 1, start: 2, seconds: 30 }],
        sources: [
          { url: RECORDING, fps: 30, width: 1920, height: 1080, duration: 60, hasAudio: true },
        ],
        error: null,
        startedAt: 0,
        finishedAt: 0,
      });
      return runId;
    });

    const files = await owner.as.query(api.runs.editorFiles, { runId });
    expect(files?.folder).toMatch(/^Weekly clips \d{4}-\d{2}-\d{2}$/);
    expect(files?.recordings).toEqual([{ url: RECORDING, name: "talk.mp4" }]);
    // The timelines link the recording by that same name, so it opens from the folder.
    expect(files?.files.some((file) => file.text.includes("talk.mp4"))).toBe(true);

    expect(await stranger.as.query(api.runs.editorFiles, { runId })).toBeNull();
  });
});
