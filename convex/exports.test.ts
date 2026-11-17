import { parseSrt } from "@ncat-dash/timeline-export";
import { describe, expect, test } from "vitest";
import { api, components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const RECORDING = "https://files.example/team/Interview%20with%20Dana.mp4";
const TRIMMED = "https://files.example/team/out/trimmed.mp4";
const DETAILS = {
  fps: 25,
  width: 1920,
  height: 1080,
  duration: 300,
  hasAudio: true,
  audioChannels: 2,
  audioSampleRate: 48000,
};

type Backend = ReturnType<typeof backend>;
type Node = {
  id: string;
  kind: "step" | "clips" | "export";
  stepId?: string;
  input: Record<string, unknown>;
};

/** A team with one member, one owner, and someone on another team. */
async function team() {
  const t = backend();
  const teamId = await addTeam(t, "Northside Media");
  const member = await addPerson(t, "Maya Ortiz", [teamId]);
  const owner = await addPerson(t, "Sam Reyes");
  await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "member",
        data: { organizationId: teamId, userId: owner.id, role: "owner", createdAt: Date.now() },
      } as never,
    }),
  );
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  return { t, teamId, member, owner, outsider };
}

/** Saves an automation with the given steps wired in a row. */
async function addAutomation(t: Backend, teamId: string, name: string, nodes: Node[]) {
  return t.run(async (ctx) => {
    const automationId = await ctx.db.insert("automations", {
      organizationId: teamId,
      name,
      enabled: false,
      trigger: { kind: "manual" },
      nodes: nodes.map((node, index) => ({ ...node, position: { x: index * 220, y: 0 } })),
      edges: nodes.slice(1).map((node, index) => ({
        id: `e${index}`,
        source: nodes[index].id,
        target: node.id,
      })),
      hookToken: `token-${name}`,
      nextRunAt: null,
      createdBy: "seed",
      updatedAt: Date.now(),
    });
    return (await ctx.db.get(automationId))!;
  });
}

type Step = {
  nodeId: string;
  outputs?: string[];
  status?: "done" | "failed";
  /** Jobs the step ran: the settings each ran with and what it answered. */
  jobs?: { stepId: string; input: Record<string, unknown>; result?: unknown }[];
  plan?: { source: string; part: number; parts: number; start: number; seconds: number }[];
  sources?: (typeof DETAILS & { url: string })[];
};

/** A finished run, written straight into the tables as the runner would leave it. */
async function finishedRun(
  t: Backend,
  teamId: string,
  name: string,
  nodes: Node[],
  steps: Step[],
  trigger: Record<string, unknown> = { file_url: RECORDING, details: DETAILS },
): Promise<Id<"runs">> {
  const automation = await addAutomation(t, teamId, name, nodes);
  return t.run(async (ctx) => {
    const runId = await ctx.db.insert("runs", {
      organizationId: teamId,
      automationId: automation._id,
      automationName: name,
      status: "done",
      triggerKind: "manual",
      trigger,
      nodes: automation.nodes,
      edges: automation.edges,
      error: null,
      startedBy: null,
      finishedAt: Date.now(),
    });
    const connectionId = await ctx.db.insert("toolkitConnections", {
      organizationId: teamId,
      baseUrl: "https://toolkit.example",
      apiKeyCipher: "cipher",
      apiKeyHint: "abcd",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: Date.now(),
      lastError: null,
      createdBy: "seed",
    });
    for (const step of steps) {
      const jobIds = [];
      for (const job of step.jobs ?? []) {
        jobIds.push(
          await ctx.db.insert("jobs", {
            organizationId: teamId,
            connectionId,
            stepId: job.stepId,
            input: job.input,
            status: "done",
            webhookToken: "token",
            toolkitJobId: null,
            result: job.result,
            outputs: [],
            error: null,
            createdBy: "seed",
            startedAt: 1,
            finishedAt: 2,
          }),
        );
      }
      await ctx.db.insert("runSteps", {
        runId,
        organizationId: teamId,
        nodeId: step.nodeId,
        status: step.status ?? "done",
        jobIds,
        outputs: step.outputs ?? [],
        error: null,
        startedAt: 1,
        finishedAt: 2,
        ...(step.plan ? { stage: "cut" as const, plan: step.plan, sources: step.sources } : {}),
      });
    }
    return runId;
  });
}

const CLIPS: Node[] = [
  { id: "clips", kind: "clips", input: { platform: "TikTok" } },
  { id: "export", kind: "export", input: {} },
];

/** A run whose Clips step cut one recording into three clips. */
const clipsRun = (t: Backend, teamId: string) =>
  finishedRun(t, teamId, "Podcast to TikTok clips", CLIPS, [
    {
      nodeId: "clips",
      outputs: ["https://files.example/out/a.mp4", "https://files.example/out/b.mp4"],
      plan: [0, 100, 200].map((start, index) => ({
        source: RECORDING,
        part: index + 1,
        parts: 3,
        start,
        seconds: 100,
      })),
      sources: [{ url: RECORDING, ...DETAILS }],
    },
    {
      nodeId: "export",
      outputs: ["https://files.example/out/a.mp4", "https://files.example/out/b.mp4"],
    },
  ]);

const TRIM: Node[] = [
  { id: "words", kind: "step", stepId: "media-transcribe", input: {} },
  { id: "trim", kind: "step", stepId: "video-trim", input: {} },
  { id: "export", kind: "export", input: {} },
];

const SRT = [
  "1\n00:00:12,000 --> 00:00:15,500\nThanks for having me.",
  "2\n00:00:31,000 --> 00:00:34,000\nWe started in a garage.",
  "3\n00:02:10,000 --> 00:02:12,000\nThis was said after the kept part.",
].join("\n\n");

/** A run that transcribed a recording and trimmed it to 0:10 - 1:40. */
const trimRun = (
  t: Backend,
  teamId: string,
  more: { trigger?: Record<string, unknown>; trimmedFile?: string; srt?: unknown } = {},
) =>
  finishedRun(
    t,
    teamId,
    "Interview trim",
    TRIM,
    [
      {
        nodeId: "words",
        jobs: [
          {
            stepId: "media-transcribe",
            input: { media_url: RECORDING },
            result: { srt: more.srt ?? SRT },
          },
        ],
      },
      {
        nodeId: "trim",
        outputs: [TRIMMED],
        jobs: [
          {
            stepId: "video-trim",
            input: { video_url: more.trimmedFile ?? RECORDING, start: "00:00:10", end: "00:01:40" },
            result: TRIMMED,
          },
        ],
      },
      { nodeId: "export", outputs: [TRIMMED] },
    ],
    more.trigger,
  );

describe("opening a run's cuts in an editor", () => {
  test("a Clips run gives one timeline per clip, in the files each editor opens", async () => {
    const { t, teamId, member } = await team();
    const runId = await clipsRun(t, teamId);

    expect((await member.as.query(api.runs.get, { runId }))?.hasCuts).toBe(true);
    const result = await member.as.query(api.runs.editorFiles, { runId });
    expect(result?.timelines).toBe(3);
    // Until a team says which editors it uses: every editor that opens a timeline.
    expect(result?.editors).toEqual(["Premiere Pro", "DaVinci Resolve", "Final Cut Pro"]);
    expect(result?.usesCapCut).toBe(false);
    expect(result?.files.map((file) => file.name)).toEqual([
      "Podcast to TikTok clips.xml",
      "Podcast to TikTok clips.fcpxml",
      "How to open.txt",
    ]);
    const [xml, fcpxml] = result!.files;
    expect(xml.editors).toEqual(["Premiere Pro", "DaVinci Resolve"]);
    expect(xml.text).toContain("<xmeml");
    expect(xml.text.match(/<sequence/g)).toHaveLength(3);
    expect(fcpxml.editors).toEqual(["Final Cut Pro"]);
    expect(fcpxml.text).toContain("<fcpxml");
    // The timeline names the recording by file name and never carries its address.
    expect(xml.text).toContain("Interview%20with%20Dana.mp4");
    expect(xml.text).not.toContain("files.example");
  });

  test("the finished clips are what the last step handed on, once each", async () => {
    const { t, teamId, member } = await team();
    const result = await member.as.query(api.runs.editorFiles, {
      runId: await clipsRun(t, teamId),
    });
    expect(result?.clips).toEqual([
      "https://files.example/out/a.mp4",
      "https://files.example/out/b.mp4",
    ]);
  });

  test("someone on another team sees nothing", async () => {
    const { t, teamId, outsider } = await team();
    const runId = await clipsRun(t, teamId);
    expect(await outsider.as.query(api.runs.editorFiles, { runId })).toBeNull();
    expect(await outsider.as.query(api.runs.get, { runId })).toBeNull();
  });

  test("a Trim of the recording gives a timeline and captions timed to the cut", async () => {
    const { t, teamId, member } = await team();
    const runId = await trimRun(t, teamId);

    expect((await member.as.query(api.runs.get, { runId }))?.hasCuts).toBe(true);
    const result = await member.as.query(api.runs.editorFiles, { runId });
    expect(result?.timelines).toBe(1);
    expect(result?.files.map((file) => file.name)).toEqual([
      "Interview trim.xml",
      "Interview trim.fcpxml",
      "Interview with Dana trimmed.srt",
      "How to open.txt",
    ]);
    const captions = result!.files[2];
    expect(captions.captions).toBe(true);
    const cues = parseSrt(captions.text);
    // The cut starts at 0:10, so each caption sits ten seconds earlier; the one said
    // after 1:40 is gone.
    expect(cues.map((cue) => [cue.start, cue.text])).toEqual([
      [2, "Thanks for having me."],
      [21, "We started in a garage."],
    ]);
    expect(result?.clips).toEqual([TRIMMED]);
  });

  test("captions handed back as a link are left out", async () => {
    const { t, teamId, member } = await team();
    const runId = await trimRun(t, teamId, { srt: "https://files.example/out/words.srt" });
    const result = await member.as.query(api.runs.editorFiles, { runId });
    expect(result?.files.some((file) => file.captions)).toBe(false);
  });

  test("a cut of a cut has no timeline, because no original file matches it", async () => {
    const { t, teamId, member } = await team();
    const runId = await trimRun(t, teamId, {
      trimmedFile: "https://files.example/team/out/already-cut.mp4",
    });
    expect((await member.as.query(api.runs.get, { runId }))?.hasCuts).toBe(false);
    expect(await member.as.query(api.runs.editorFiles, { runId })).toBeNull();
  });

  test("without the recording's frame rate and size there is no timeline", async () => {
    const { t, teamId, member } = await team();
    const runId = await trimRun(t, teamId, { trigger: { file_url: RECORDING } });
    expect((await member.as.query(api.runs.get, { runId }))?.hasCuts).toBe(false);
  });
});

describe("the team's editors", () => {
  test("only an owner or admin can change them", async () => {
    const { teamId, member, owner, outsider } = await team();
    const pick = { organizationId: teamId, editors: ["capcut" as const] };
    await expect(member.as.mutation(api.teamSettings.setEditors, pick)).rejects.toThrow();
    await expect(outsider.as.mutation(api.teamSettings.setEditors, pick)).rejects.toThrow();
    await owner.as.mutation(api.teamSettings.setEditors, pick);

    const settings = await member.as.query(api.teamSettings.get, { organizationId: teamId });
    expect(settings.editors).toEqual(["capcut"]);
    expect(settings.canEdit).toBe(false);
    expect((await owner.as.query(api.teamSettings.get, { organizationId: teamId })).canEdit).toBe(
      true,
    );
  });

  test("a new team starts with every editor that opens a timeline", async () => {
    const { teamId, member } = await team();
    const settings = await member.as.query(api.teamSettings.get, { organizationId: teamId });
    expect(settings.editors).toEqual(["premiere", "resolve", "finalcut"]);
  });

  test("an editor ticked twice is saved once, and changing it again replaces the list", async () => {
    const { t, teamId, owner } = await team();
    await owner.as.mutation(api.teamSettings.setEditors, {
      organizationId: teamId,
      editors: ["premiere", "premiere", "capcut"],
    });
    await owner.as.mutation(api.teamSettings.setEditors, {
      organizationId: teamId,
      editors: ["resolve", "resolve"],
    });
    const rows = await t.run((ctx) => ctx.db.query("teamSettings").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].editors).toEqual(["resolve"]);
  });

  test("the files follow the editors the team picked", async () => {
    const { t, teamId, member, owner } = await team();
    const runId = await clipsRun(t, teamId);

    await owner.as.mutation(api.teamSettings.setEditors, {
      organizationId: teamId,
      editors: ["finalcut", "capcut"],
    });
    const some = await member.as.query(api.runs.editorFiles, { runId });
    expect(some?.editors).toEqual(["Final Cut Pro", "CapCut"]);
    expect(some?.usesCapCut).toBe(true);
    expect(some?.files.map((file) => file.name)).toEqual([
      "Podcast to TikTok clips.fcpxml",
      "How to open.txt",
    ]);

    // CapCut opens no timeline, so a CapCut-only team gets the finished clips alone.
    await owner.as.mutation(api.teamSettings.setEditors, {
      organizationId: teamId,
      editors: ["capcut"],
    });
    const capcut = await member.as.query(api.runs.editorFiles, { runId });
    expect(capcut?.files).toEqual([]);
    expect(capcut?.clips).toHaveLength(2);
  });
});

describe("the Export for editors step in a run", () => {
  test("with no cuts before it, the step fails and says where to put it", async () => {
    const { t, teamId } = await team();
    const automation = await addAutomation(t, teamId, "Only an export", [
      { id: "export", kind: "export", input: {} },
    ]);
    const { run, step } = await t.run(async (ctx) => {
      const started = await startRun(ctx, automation, "manual", { file_url: RECORDING }, null);
      if (!started.ok) throw new Error(started.message);
      return {
        run: await ctx.db.get(started.runId),
        step: await ctx.db
          .query("runSteps")
          .withIndex("by_run", (q) => q.eq("runId", started.runId))
          .unique(),
      };
    });
    expect(step?.status).toBe("failed");
    expect(step?.error).toMatch(/No cuts reached this step/);
    expect(run?.status).toBe("failed");
  });
});
