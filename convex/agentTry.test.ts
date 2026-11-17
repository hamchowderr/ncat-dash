import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { encryptSecret } from "./lib/crypto";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * Trying an automation on an upload, which the agent does before it offers to switch one
 * on. Same checks as the browser: only the team's own people, only the team's own files.
 */
async function studio({ storage = true } = {}) {
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  const automationId = await maya.as.mutation(api.automations.create, {
    organizationId: team,
    name: "Clips from new recordings",
  });
  await maya.as.mutation(api.automations.change, {
    automationId,
    operations: [
      { op: "trigger", trigger: { kind: "upload", fileType: "video" } },
      { op: "add", type: "clips", id: "clips", settings: { platform: "Instagram Reels" } },
    ],
  });
  const secretCipher = await encryptSecret("secret-secret");
  const upload = (fileName: string, contentType: string, extra: Record<string, unknown> = {}) =>
    t.run((ctx) =>
      ctx.db.insert("uploads", {
        organizationId: team,
        key: `uploads/${fileName}`,
        fileName,
        contentType,
        size: 1000,
        status: "ready",
        createdBy: maya.id,
        ...extra,
      }),
    );
  if (storage) {
    await t.run((ctx) =>
      ctx.db.insert("storageConnections", {
        organizationId: team,
        endpoint: "http://127.0.0.1:8098",
        region: "auto",
        bucket: "test-bucket",
        accessKeyId: "AKIATEST",
        secretCipher,
        createdBy: maya.id,
      }),
    );
  }
  return { t, team, maya, outsider, automationId, upload };
}

describe("trying an automation on an upload", () => {
  test("takes the newest upload the trigger wants, and starts a run on a link to it", async () => {
    const { t, maya, automationId, upload } = await studio();
    await upload("older.mp4", "video/mp4");
    await upload("newest.mp4", "video/mp4");
    // Not a video, and a brand file: neither starts this automation.
    await upload("song.mp3", "audio/mpeg");
    await upload("logo.png", "image/png", { purpose: "brand" });

    const { runId, fileName } = await maya.as.action(api.automations.tryOnUpload, {
      automationId,
    });
    expect(fileName).toBe("newest.mp4");
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.triggerKind).toBe("manual");
    expect(run?.startedBy).toBe(maya.id);
    const trigger = run?.trigger as { file_url: string; file_name: string };
    expect(trigger.file_name).toBe("newest.mp4");
    expect(trigger.file_url).toMatch(
      /^http:\/\/127\.0\.0\.1:8098\/test-bucket\/uploads\/newest\.mp4\?/,
    );
  });

  test("runs while the automation is still switched off", async () => {
    const { t, maya, automationId, upload } = await studio();
    await upload("talk.mp4", "video/mp4");
    const automation = await t.run((ctx) => ctx.db.get(automationId));
    expect(automation?.enabled).toBe(false);
    await expect(
      maya.as.action(api.automations.tryOnUpload, { automationId }),
    ).resolves.toHaveProperty("runId");
  });

  test("uses the upload asked for", async () => {
    const { maya, automationId, upload } = await studio();
    const asked = await upload("first.mp4", "video/mp4");
    await upload("second.mp4", "video/mp4");
    const { fileName } = await maya.as.action(api.automations.tryOnUpload, {
      automationId,
      uploadId: asked,
    });
    expect(fileName).toBe("first.mp4");
  });

  test("says what to do when there is nothing to try it on", async () => {
    const { maya, automationId, upload } = await studio();
    await expect(maya.as.action(api.automations.tryOnUpload, { automationId })).rejects.toThrow(
      /no uploads to try it on/,
    );
    await upload("song.mp3", "audio/mpeg");
    await expect(maya.as.action(api.automations.tryOnUpload, { automationId })).rejects.toThrow(
      /None of your uploads is the kind of file/,
    );
  });

  test("needs the team's storage connected", async () => {
    const { maya, automationId, upload } = await studio({ storage: false });
    await upload("talk.mp4", "video/mp4");
    await expect(maya.as.action(api.automations.tryOnUpload, { automationId })).rejects.toThrow(
      /Connect your storage/,
    );
  });

  test("is closed to people outside the team, and to other teams' files", async () => {
    const { t, outsider, maya, automationId, upload } = await studio();
    await upload("talk.mp4", "video/mp4");
    await expect(
      outsider.as.action(api.automations.tryOnUpload, { automationId }),
    ).rejects.toThrow();
    await expect(t.action(api.automations.tryOnUpload, { automationId })).rejects.toThrow();
    // Maya cannot name another team's upload either.
    const elsewhere = await t.run((ctx) =>
      ctx.db.insert("uploads", {
        organizationId: "another-team",
        key: "uploads/theirs.mp4",
        fileName: "theirs.mp4",
        contentType: "video/mp4",
        size: 1000,
        status: "ready",
        createdBy: outsider.id,
      }),
    );
    await expect(
      maya.as.action(api.automations.tryOnUpload, { automationId, uploadId: elsewhere }),
    ).rejects.toThrow(/not in your team's uploads/);
  });
});
