import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import { toolkitMessageText } from "./lib/toolkitMessage";
import { addPerson, addTeam, backend } from "./test.setup";

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Northlight Media");
  const maya = await addPerson(t, "Maya Torres", [team]);
  const jobId = await t.run(async (ctx) => {
    const connectionId = await ctx.db.insert("toolkitConnections", {
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
    return ctx.db.insert("jobs", {
      organizationId: team,
      connectionId,
      stepId: "video-caption",
      input: {},
      status: "running",
      webhookToken: "tok",
      toolkitJobId: null,
      outputs: [],
      error: null,
      createdBy: maya.id,
      startedAt: 0,
      finishedAt: null,
    });
  });
  const post = (body: unknown) =>
    t.fetch(`/toolkit/webhook?job=${jobId}&token=tok`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const job = () => t.run((ctx) => ctx.db.get(jobId as Id<"jobs">));
  return { post, job };
}

describe("a failed job reported by the toolkit", () => {
  test("shows the toolkit's error text when it sends an object", async () => {
    const { post, job } = await setUp();
    const answer = await post({
      code: 500,
      message: { error: "FFmpeg error: the input is a still image, not a video" },
    });
    expect(answer.status).toBe(204);
    const failed = await job();
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("FFmpeg error: the input is a still image, not a video");
    expect(failed?.error).not.toContain("[object Object]");
  });

  test("keeps a plain text message as it is", async () => {
    const { post, job } = await setUp();
    await post({ code: 500, message: "Could not download the file." });
    expect((await job())?.error).toBe("Could not download the file.");
  });

  test("says the step failed when there is no message at all", async () => {
    const { post, job } = await setUp();
    await post({ code: 500 });
    expect((await job())?.error).toBe("The step failed.");
  });
});

describe("toolkitMessageText", () => {
  test("pulls readable text out of every shape the toolkit sends", () => {
    expect(toolkitMessageText("  Bad input  ")).toBe("Bad input");
    expect(toolkitMessageText({ error: "Font not found", available_fonts: ["Arial"] })).toBe(
      "Font not found",
    );
    expect(toolkitMessageText({ message: { error: "Nested" } })).toBe("Nested");
    expect(toolkitMessageText(["One", { error: "Two" }])).toBe("One Two");
    expect(toolkitMessageText({ code: 7 })).toBe('{"code":7}');
    expect(toolkitMessageText({})).toBe("The step failed.");
    expect(toolkitMessageText("")).toBe("The step failed.");
    expect(toolkitMessageText(undefined)).toBe("The step failed.");
  });
});

describe("a very long failure from the toolkit", () => {
  test("keeps the end, where FFmpeg says what went wrong", async () => {
    const { post, job } = await setUp();
    const banner = "configuration: --enable-everything ".repeat(400);
    await post({
      code: 500,
      message: `ffmpeg version 6.1\n${banner}\nOutput file does not contain any stream`,
    });
    const error = (await job())?.error ?? "";
    expect(error.length).toBeLessThanOrEqual(6010);
    expect(error.startsWith("ffmpeg version 6.1")).toBe(true);
    expect(error.endsWith("Output file does not contain any stream")).toBe(true);
  });
});
