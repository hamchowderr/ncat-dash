import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { addPerson, addTeam, backend } from "./test.setup";

// A long video transcribed on a team's own, slow server: the server keeps saying the job
// is running. Past three times the video's length the transcript is stopped and the file
// says why, instead of waiting the six hours every job gets.

const MIN = 60_000;
const TOOLKIT = "https://toolkit.example";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function setUp(duration: number | undefined, runningFor: number) {
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  // The server is asked about the job and says it is still running.
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          code: 200,
          response: { job_id: "tk-1", job_status: "running", response: null },
        }),
        { status: 200 },
      ),
  );
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const connectionId = await ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: TOOLKIT,
      apiKeyCipher,
      apiKeyHint: "abcd",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: 0,
      lastError: null,
      createdBy: maya.id,
    });
    const itemId = await ctx.db.insert("libraryItems", {
      organizationId: team,
      shortId: "V2",
      kind: "video",
      source: "upload",
      title: "Branches and PRs",
      key: "Branches and PRs.mp4",
      tags: [],
      searchText: "V2 Branches and PRs",
      createdBy: maya.id,
      ...(duration ? { details: { duration } } : {}),
    });
    const jobId = await ctx.db.insert("jobs", {
      organizationId: team,
      connectionId,
      stepId: "media-transcribe",
      input: { media_url: "https://files.example/Branches and PRs.mp4" },
      status: "running",
      toolkitJobId: "tk-1",
      startedAt: now - runningFor,
      dispatchedAt: now - runningFor,
      finishedAt: null,
      webhookToken: "token",
      outputs: [],
      error: null,
      libraryItemId: itemId,
      createdBy: "library",
    });
    await ctx.db.patch(itemId, {
      transcript: { status: "working", jobId, at: now - runningFor },
    });
    return { itemId, jobId };
  });
  return { t, ...ids };
}

async function check(t: ReturnType<typeof backend>) {
  await t.mutation(internal.jobs.checkLate, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

test("a 64-minute video still transcribing after 3 h 13 min is stopped, and the file says why", async () => {
  vi.useFakeTimers();
  const { t, itemId, jobId } = await setUp(64 * 60, 193 * MIN);
  await check(t);
  const { job, item } = await t.run(async (ctx) => ({
    job: await ctx.db.get(jobId as Id<"jobs">),
    item: await ctx.db.get(itemId as Id<"libraryItems">),
  }));
  expect(job?.status).toBe("failed");
  expect(item?.transcript?.status).toBe("failed");
  expect(item?.transcript?.error).toBe(
    "Transcribing took over 3 h 13 min for a 1 h 4 min video, so it was stopped. The server doing it may be busy or too slow for long videos. Try again when it is less busy.",
  );
});

test("the same video two hours in is left running", async () => {
  vi.useFakeTimers();
  const { t, jobId } = await setUp(64 * 60, 120 * MIN);
  await check(t);
  const job = await t.run((ctx) => ctx.db.get(jobId as Id<"jobs">));
  expect(job?.status).toBe("running");
});

test("a video of unknown length gets the six hours every job gets", async () => {
  vi.useFakeTimers();
  const { t, jobId } = await setUp(undefined, 200 * MIN);
  await check(t);
  const job = await t.run((ctx) => ctx.db.get(jobId as Id<"jobs">));
  expect(job?.status).toBe("running");
});
