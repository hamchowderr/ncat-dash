import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

// Found while recording the explainer videos (2026-11-22).
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
afterEach(() => {
  toolkit?.restore();
  toolkit = null;
  vi.unstubAllGlobals();
});

async function studio() {
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  toolkit = fakeToolkitStorage();
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  await connectToolkit(t, team, owner.id);
  return { t, team, owner };
}

describe("Caption video given a picture", () => {
  async function failedCaption(stepId: string, error: string) {
    const { t, team, owner } = await studio();
    const jobId = await t.run(async (ctx) => {
      const connection = await ctx.db
        .query("toolkitConnections")
        .withIndex("by_organization", (q) => q.eq("organizationId", team))
        .first();
      return await ctx.db.insert("jobs", {
        organizationId: team,
        connectionId: connection!._id,
        stepId,
        input: { video_url: "https://files.example/uploads/poster" },
        status: "running",
        webhookToken: "token",
        toolkitJobId: "tk",
        outputs: [],
        error: null,
        createdBy: owner.id,
        startedAt: 1,
        finishedAt: null,
      });
    });
    await t.mutation(internal.jobs.finish, { jobId, token: "token", ok: false, error });
    return (await t.run((ctx) => ctx.db.get(jobId as Id<"jobs">)))!;
  }

  test("fails for good, saying captions need a video, with the toolkit's words kept", async () => {
    const job = await failedCaption("video-caption", "tuple index out of range");
    expect(job.status).toBe("failed");
    expect(job.permanent).toBe(true);
    expect(job.error).toBe(
      "Captions need a video. This file is a picture, or a video with no sound to caption.\n\ntuple index out of range",
    );
  });

  test("the same words from another step are not taken as a wrong file", async () => {
    const job = await failedCaption("video-trim", "tuple index out of range");
    expect(job.permanent).toBeUndefined();
    expect(job.error).toBe("tuple index out of range");
  });
});

describe("Run now with an uploaded file while the toolkit is down", () => {
  test("says the toolkit can't be reached, not that the run could not start", async () => {
    const { team, owner } = await studio();
    const started = await owner.as.action(api.storage.startUpload, {
      organizationId: team,
      fileName: "clip.mp4",
      contentType: "video/mp4",
      size: 5000,
    });
    // The proxy in front of a stopped toolkit answers 502 with a page of its own.
    vi.stubGlobal(
      "fetch",
      async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    );
    await expect(
      owner.as.action(api.storage.linkFor, { uploadId: started.uploadId }),
    ).rejects.toMatchObject({
      data: {
        message:
          "Your toolkit can't be reached right now. Check that it is running, then try again.",
      },
    });
  });
});
