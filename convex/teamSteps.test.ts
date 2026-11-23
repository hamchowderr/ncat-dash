import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

const VIDEO = "https://files.example/uploads/podcast.mp4?X-Amz-Signature=abc";

/** "Blur the background behind a vertical video": one video in, one setting. */
const BLUR = {
  title: "Blur the background behind a vertical video",
  description: "Puts the video in the middle of a 9:16 frame over a blurred copy of itself.",
  blanks: [
    { name: "video_url", label: "Video", kind: "file" as const },
    { name: "blur", label: "Blur amount", kind: "number" as const, default: 20, min: 1, max: 60 },
  ],
  primary: "video_url",
  request: {
    inputs: [{ file_url: "{{video_url}}" }],
    filters: [
      {
        filter:
          "[0:v]scale=1080:1920,boxblur={{blur}}[bg];[0:v]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2",
      },
    ],
    outputs: [
      {
        options: [
          { option: "-c:v", argument: "libx264" },
          { option: "-f", argument: "mp4" },
        ],
      },
    ],
  },
};

async function setUp({ toolkit = true } = {}) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const otherTeam = await addTeam(t, "Other Team");
  const outsider = await addPerson(t, "Someone Else", [otherTeam]);
  if (toolkit) {
    await t.run(async (ctx) => {
      await ctx.db.insert("toolkitConnections", {
        organizationId: team,
        baseUrl: "https://toolkit.example",
        apiKeyCipher: "x",
        apiKeyHint: "abcd",
        status: "ok",
        buildNumber: null,
        lastCheckedAt: 0,
        lastError: null,
        createdBy: maya.id,
      });
    });
  }
  const jobs = () => t.run((ctx) => ctx.db.query("jobs").collect());
  return { t, team, maya, outsider, otherTeam, jobs };
}

describe("a team's own FFmpeg steps", () => {
  test("a saved step is listed for its team only, under its own id", async () => {
    const { team, maya, outsider, otherTeam } = await setUp();
    const saved = await maya.as.mutation(api.teamSteps.save, {
      organizationId: team,
      template: BLUR,
    });
    expect(saved.stepId).toMatch(/^team-/);
    expect(saved.title).toBe(BLUR.title);
    const listed = await maya.as.query(api.teamSteps.list, { organizationId: team });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ stepId: saved.stepId, primary: "video_url" });
    expect(await outsider.as.query(api.teamSteps.list, { organizationId: otherTeam })).toEqual([]);
    await expect(outsider.as.query(api.teamSteps.list, { organizationId: team })).rejects.toThrow();
  });

  test("shows in the team's step types for the canvas and the agent", async () => {
    const { team, maya } = await setUp();
    const { stepId } = await maya.as.mutation(api.teamSteps.save, {
      organizationId: team,
      template: BLUR,
    });
    const { index } = await maya.as.query(api.automations.nodeTypes, { organizationId: team });
    expect(index).toContain(`step:${stepId}`);
    const { type } = await maya.as.query(api.automations.nodeTypes, {
      organizationId: team,
      type: `step:${stepId}`,
    });
    expect(type).toMatchObject({ title: BLUR.title, takes: "file" });
  });

  test("a step with a setting it never uses is turned away in plain words", async () => {
    const { team, maya } = await setUp();
    await expect(
      maya.as.mutation(api.teamSteps.save, {
        organizationId: team,
        template: {
          ...BLUR,
          blanks: [...BLUR.blanks, { name: "unused", label: "Unused", kind: "text" as const }],
        },
      }),
    ).rejects.toThrow(/unused/);
  });

  test("a step that sends its result somewhere else is turned away", async () => {
    const { team, maya } = await setUp();
    await expect(
      maya.as.mutation(api.teamSteps.save, {
        organizationId: team,
        template: { ...BLUR, request: { ...BLUR.request, webhook_url: "https://evil.example" } },
      }),
    ).rejects.toThrow();
  });

  test("changing a step keeps its id", async () => {
    const { team, maya } = await setUp();
    const first = await maya.as.mutation(api.teamSteps.save, {
      organizationId: team,
      template: BLUR,
    });
    const changed = await maya.as.mutation(api.teamSteps.save, {
      organizationId: team,
      stepId: first.stepId,
      template: { ...BLUR, title: "Blurred background, vertical" },
    });
    expect(changed.stepId).toBe(first.stepId);
    const listed = await maya.as.query(api.teamSteps.list, { organizationId: team });
    expect(listed.map((step) => step.title)).toEqual(["Blurred background, vertical"]);
  });

  test("another team cannot change or remove it", async () => {
    const { team, maya, outsider, otherTeam } = await setUp();
    const { stepId } = await maya.as.mutation(api.teamSteps.save, {
      organizationId: team,
      template: BLUR,
    });
    await expect(
      outsider.as.mutation(api.teamSteps.save, {
        organizationId: otherTeam,
        stepId,
        template: BLUR,
      }),
    ).rejects.toThrow(/not one of your team's steps/);
    await outsider.as.mutation(api.teamSteps.remove, { organizationId: otherTeam, stepId });
    expect(await maya.as.query(api.teamSteps.list, { organizationId: team })).toHaveLength(1);
  });

  test("trying it queues one FFmpeg compose job with the settings filled in", async () => {
    const { team, maya, jobs } = await setUp();
    const { jobId } = await maya.as.mutation(api.teamSteps.tryOut, {
      organizationId: team,
      template: BLUR,
      values: { video_url: VIDEO, blur: 30 },
    });
    const [job] = await jobs();
    expect(job._id).toBe(jobId);
    expect(job.stepId).toBe("ffmpeg-compose");
    const input = job.input as { inputs: { file_url: string }[]; filters: { filter: string }[] };
    expect(input.inputs[0].file_url).toBe(VIDEO);
    expect(input.filters[0].filter).toContain("boxblur=30");
  });

  test("trying it with a setting out of range says which one", async () => {
    const { team, maya } = await setUp();
    await expect(
      maya.as.mutation(api.teamSteps.tryOut, {
        organizationId: team,
        template: BLUR,
        values: { video_url: VIDEO, blur: 500 },
      }),
    ).rejects.toThrow(/blur/);
  });

  test("an automation using it runs it as FFmpeg compose, and it cannot be removed while used", async () => {
    const { t, team, maya, jobs } = await setUp();
    const { stepId } = await maya.as.mutation(api.teamSteps.save, {
      organizationId: team,
      template: BLUR,
    });
    const node = {
      id: "blur",
      kind: "step" as const,
      stepId,
      input: { blur: 12 },
      position: { x: 0, y: 0 },
    };
    const automationId = await t.run((ctx) =>
      ctx.db.insert("automations", {
        organizationId: team,
        name: "Vertical podcast",
        enabled: true,
        trigger: { kind: "upload", fileType: "video" },
        nodes: [node],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      }),
    );
    await maya.as.mutation(api.automations.testStep, { automationId, node, fileUrl: VIDEO });
    const [job] = await jobs();
    expect(job.stepId).toBe("ffmpeg-compose");
    const input = job.input as { inputs: { file_url: string }[]; filters: { filter: string }[] };
    expect(input.inputs[0].file_url).toBe(VIDEO);
    expect(input.filters[0].filter).toContain("boxblur=12");

    await expect(
      maya.as.mutation(api.teamSteps.remove, { organizationId: team, stepId }),
    ).rejects.toThrow(/Vertical podcast still uses this step/);
    await t.run((ctx) => ctx.db.patch(automationId as Id<"automations">, { nodes: [] }));
    await maya.as.mutation(api.teamSteps.remove, { organizationId: team, stepId });
    expect(await maya.as.query(api.teamSteps.list, { organizationId: team })).toEqual([]);
  });
});
