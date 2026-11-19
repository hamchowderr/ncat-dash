import type { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  callStep,
  getStep,
  RUNNER_FIELDS,
  steps,
  testConnection,
  jobStatus,
  ToolkitError,
  userInputJsonSchema,
  userInputSchema,
} from "../src";

const connection = { baseUrl: "https://toolkit.example.com/", apiKey: "k" };

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("catalog", () => {
  it("has 21 steps with unique ids and endpoints under /v1", () => {
    expect(steps).toHaveLength(21);
    expect(new Set(steps.map((s) => s.id)).size).toBe(21);
    for (const step of steps) expect(step.endpoint).toMatch(/^\/v1\//);
  });

  it("names a primary input that exists and is required", () => {
    for (const step of steps) {
      if (!step.primaryInput) continue;
      const shape: Record<string, z.ZodType> = step.input.shape;
      const field = shape[step.primaryInput];
      expect(field, `${step.id}.${step.primaryInput}`).toBeDefined();
      expect(field.safeParse(undefined).success, step.id).toBe(false);
    }
  });

  it("hides the runner fields from the user schema and its JSON Schema", () => {
    for (const step of steps) {
      const shape = userInputSchema(step).shape;
      const json = userInputJsonSchema(step) as { properties?: Record<string, unknown> };
      for (const field of RUNNER_FIELDS) {
        expect(shape[field], `${step.id}.${field}`).toBeUndefined();
        expect(json.properties?.[field]).toBeUndefined();
      }
    }
  });
});

describe("follow the speaker", () => {
  it("uses the toolkit's own camera defaults", () => {
    const reframe = getStep("video-reframe")!;
    expect(reframe.input.parse({ video_url: "https://x.test/a.mp4" })).toMatchObject({
      aspect: "9:16",
      follow: "speaker",
      switch_after: 1,
      min_hold: 1.5,
      smoothing: 1.5,
      output_width: 1080,
    });
  });
});

describe("callStep", () => {
  const trim = getStep("video-trim")!;

  it("posts the validated body with the key and the runner fields", async () => {
    const { fn, calls } = fakeFetch(202, { code: 202, job_id: "j1" });
    const result = await callStep(
      connection,
      trim,
      { video_url: "https://x.test/a.mp4", start: "00:00:05", end: undefined },
      { webhookUrl: "https://app.test/hook", id: "step-1", fetch: fn },
    );
    expect(result).toEqual({ code: 202, job_id: "j1" });
    expect(calls[0].url).toBe("https://toolkit.example.com/v1/video/trim");
    expect((calls[0].init.headers as Record<string, string>)["X-API-Key"]).toBe("k");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      video_url: "https://x.test/a.mp4",
      start: "00:00:05",
      webhook_url: "https://app.test/hook",
      id: "step-1",
    });
  });

  it("rejects invalid input before any request", async () => {
    const { fn, calls } = fakeFetch(200, {});
    await expect(
      callStep(connection, trim, { video_url: "not a url" }, { fetch: fn }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("ignores runner fields a caller tries to pass as input", async () => {
    const { fn, calls } = fakeFetch(200, {});
    await callStep(
      connection,
      trim,
      { video_url: "https://x.test/a.mp4", webhook_url: "https://evil.test" },
      { fetch: fn },
    );
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ video_url: "https://x.test/a.mp4" });
  });

  it("throws ToolkitError with status and body on a failure", async () => {
    const { fn } = fakeFetch(500, "boom");
    const error = (await callStep(
      connection,
      trim,
      { video_url: "https://x.test/a.mp4" },
      { fetch: fn },
    ).catch((e: unknown) => e)) as ToolkitError;
    expect(error).toBeInstanceOf(ToolkitError);
    expect(error.status).toBe(500);
    expect(error.body).toBe("boom");
  });
});

describe("testConnection", () => {
  it("passes on 200 JSON and reports the build number", async () => {
    const { fn, calls } = fakeFetch(200, { code: 200, response: "Authorized", build_number: 204 });
    expect(await testConnection(connection, { fetch: fn })).toEqual({
      ok: true,
      buildNumber: "204",
    });
    expect(calls[0].url).toBe("https://toolkit.example.com/v1/toolkit/authenticate");
  });

  it("reports a wrong key", async () => {
    const { fn } = fakeFetch(401, { message: "Unauthorized" });
    expect(await testConnection(connection, { fetch: fn })).toMatchObject({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("reports a URL that is not a toolkit", async () => {
    const html = fakeFetch(200, "<html>hello</html>");
    expect(await testConnection(connection, { fetch: html.fn })).toMatchObject({
      ok: false,
      reason: "not_a_toolkit",
    });
    const otherApi = fakeFetch(200, { status: "ok" });
    expect(await testConnection(connection, { fetch: otherApi.fn })).toMatchObject({
      ok: false,
      reason: "not_a_toolkit",
    });
    const missing = fakeFetch(404, "nope");
    expect(await testConnection(connection, { fetch: missing.fn })).toMatchObject({
      ok: false,
      reason: "not_a_toolkit",
    });
  });

  it("reports an unreachable host without throwing", async () => {
    const fn = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await testConnection(connection, { fetch: fn })).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
  });
});

describe("jobStatus", () => {
  // The shape the toolkit fork answers with: its own envelope around the job's record.
  const record = (job_status: string, response: unknown = null) => ({
    code: 200,
    response: { job_id: "tk-1", job_status, process_id: 10, response },
  });

  it("hands back the result envelope of a job the toolkit finished", async () => {
    const envelope = { code: 200, response: [{ file_url: "https://x.test/1.mp4" }] };
    const { fn, calls } = fakeFetch(200, record("done", envelope));
    expect(await jobStatus(connection, "tk-1", { fetch: fn })).toEqual({
      state: "finished",
      envelope,
    });
    expect(calls[0].url).toBe("https://toolkit.example.com/v1/toolkit/job/status");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ job_id: "tk-1" });
  });

  it("says a queued or running job is still being worked on", async () => {
    for (const status of ["queued", "running"]) {
      const { fn } = fakeFetch(200, record(status));
      expect(await jobStatus(connection, "tk-1", { fetch: fn })).toEqual({ state: "working" });
    }
  });

  it("says the job is unknown when the toolkit has no record of it", async () => {
    const { fn } = fakeFetch(404, { code: 404, response: { error: "Job not found" } });
    expect(await jobStatus(connection, "tk-1", { fetch: fn })).toEqual({ state: "unknown" });
  });

  it("says the job is unknown when the toolkit marked it failed without a result", async () => {
    const { fn } = fakeFetch(200, record("failed"));
    expect(await jobStatus(connection, "tk-1", { fetch: fn })).toEqual({ state: "unknown" });
  });

  it("throws on a toolkit error so the caller asks again later", async () => {
    const { fn } = fakeFetch(502, "bad gateway");
    await expect(jobStatus(connection, "tk-1", { fetch: fn })).rejects.toBeInstanceOf(ToolkitError);
  });
});
