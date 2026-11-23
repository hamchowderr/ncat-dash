import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

// Found while recording the explainer videos (2026-11-22): "Caption every new upload" run by
// hand on a PNG tried three times over 2.5 minutes, then failed in the toolkit's words.
const PICTURE = "https://files.example/uploads/Harbor-Lane-logo.png";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function runOn(stepId: string, file: string) {
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.CONVEX_SITE_URL = "https://dash.example";
  const sent: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      sent.push(String(input));
      return new Response(JSON.stringify({ code: 202, job_id: "tk" }), { status: 202 });
    }),
  );
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const runId = await t.run(async (ctx) => {
    await ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: "https://toolkit.example",
      apiKeyCipher,
      apiKeyHint: "abcd",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: 0,
      lastError: null,
      createdBy: maya.id,
    });
    const automationId = await ctx.db.insert("automations", {
      organizationId: team,
      name: "Caption every new upload",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [{ id: "step", kind: "step", stepId, input: {}, position: { x: 0, y: 0 } }] as never,
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    });
    const automation = (await ctx.db.get(automationId))!;
    const started = await startRun(ctx, automation, "manual", { file_url: file }, maya.id);
    if (!started.ok) throw new Error(started.message);
    return started.runId;
  });
  for (let second = 0; second < 30; second++) {
    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();
  }
  const run = (await maya.as.query(api.runs.get, { runId }))!;
  return { run, step: run.steps[0], sent };
}

describe("A video step given a picture", () => {
  test("Caption video stops at once, in plain words, and is not tried again", async () => {
    const { run, step, sent } = await runOn("video-caption", PICTURE);
    expect(run.status).toBe("failed");
    expect(step.status).toBe("failed");
    expect(step.error).toBe("Captions need a video, and Harbor-Lane-logo.png is a picture.");
    expect(step.retries).toBe(0);
    expect(step.jobs).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("other video steps say the same", async () => {
    const { step } = await runOn("video-trim", PICTURE);
    expect(step.error).toBe("This step needs a video, and Harbor-Lane-logo.png is a picture.");
  });

  test("a video still goes to the toolkit", async () => {
    const { step } = await runOn("video-trim", "https://files.example/uploads/talk.mp4");
    expect(step.error ?? null).toBeNull();
    expect(step.jobs.length).toBe(1);
  });
});
