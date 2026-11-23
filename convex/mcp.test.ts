import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { agentToken } from "./agentToken.testkit";
import { addPerson, addTeam, backend } from "./test.setup";

type Backend = ReturnType<typeof backend>;

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  const member = await addPerson(t, "Theo Banks", [team]);
  const otherTeam = await addTeam(t, "Other Team");
  const other = await addPerson(t, "Someone Else", [otherTeam], "owner");
  const automationId = await t.run(async (ctx) => {
    await ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: "https://toolkit.example",
      apiKeyCipher: "x",
      apiKeyHint: "abcd",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: 0,
      lastError: null,
      createdBy: owner.id,
    });
    return ctx.db.insert("automations", {
      organizationId: team,
      name: "Weekly clips",
      enabled: false,
      trigger: { kind: "upload", fileType: "video" },
      nodes: [
        { id: "trim", kind: "step", stepId: "video-trim", input: {}, position: { x: 0, y: 0 } },
        {
          id: "caption",
          kind: "step",
          stepId: "video-caption",
          input: {},
          position: { x: 300, y: 0 },
        },
      ],
      edges: [{ id: "e1", source: "trim", target: "caption" }],
      hookToken: "token",
      nextRunAt: null,
      createdBy: owner.id,
      updatedAt: Date.now(),
    });
  });
  const uploadId = await t.run((ctx) =>
    ctx.db.insert("uploads", {
      organizationId: team,
      key: "teams/x/uploads/episode.mp4",
      fileName: "episode 12.mp4",
      contentType: "video/mp4",
      size: 1000,
      status: "ready",
      createdBy: owner.id,
    }),
  );
  const key = await agentToken(t, owner, team);
  return { t, team, owner, member, otherTeam, other, automationId, uploadId, key };
}

let next = 1;
async function rpc(t: Backend, key: string | null, method: string, params?: unknown) {
  const response = await t.fetch("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: next++, method, params }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {
    extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } },
  },
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
};

/** A 2026-07-28 request: no handshake, the version and capabilities on every request. */
async function modern(
  t: Backend,
  key: string,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const response = await t.fetch("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${key}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: next++,
      method,
      params: { ...params, _meta: MODERN_META },
    }),
  });
  return { status: response.status, body: await response.json() };
}

async function call(t: Backend, key: string, name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc(t, key, "tools/call", { name, arguments: args });
  const result = body.result as { isError: boolean; content: { text: string }[] };
  return {
    isError: result.isError,
    text: result.content[0].text,
    data: JSON.parse(result.isError ? "null" : result.content[0].text),
  };
}

describe("the MCP server", () => {
  test("answers only agents that signed in: no token, a made-up one or an old-style key is turned away", async () => {
    const { t, key } = await setUp();
    for (const sent of [null, "madeup", "ncat_0123456789abcdefghijklmnopqrstuvwxyzABCDEF"]) {
      const turned = await rpc(t, sent, "tools/list");
      expect(turned.status).toBe(401);
      expect(JSON.stringify(turned.body)).not.toMatch(/key/i);
    }
    expect((await rpc(t, key, "tools/list")).status).toBe(200);
  });

  test("says hello in the protocol version the client asks for, and lists its tools", async () => {
    const { t, key } = await setUp();
    const hello = await rpc(t, key, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(hello.body.result).toMatchObject({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "takewon", title: "Takewon" },
    });
    const notified = await t.fetch("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(notified.status).toBe(202);
    const listed = await rpc(t, key, "tools/list");
    const names = (
      listed.body.result.tools as { name: string; annotations: { readOnlyHint: boolean } }[]
    ).map((tool) => [tool.name, tool.annotations.readOnlyHint]);
    expect(names).toEqual([
      ["list_automations", true],
      ["describe_automation", true],
      ["list_step_types", true],
      ["create_automation", false],
      ["set_up_follow_on", false],
      ["change_automation", false],
      ["publish_automation", false],
      ["switch_automation", false],
      ["list_uploads", true],
      ["start_automation", false],
      ["check_run", true],
      ["list_runs", true],
      ["list_approvals", true],
      ["decide_approval", false],
      ["list_workflows", true],
      ["set_up_workflow", false],
      ["switch_workflow", false],
    ]);
    // Directories ask for explicit hints: anything that changes, stops or sends counts as
    // destructive; only adding a new draft is not.
    const hints = (
      listed.body.result.tools as {
        name: string;
        annotations: Record<string, boolean>;
      }[]
    ).map(({ name, annotations }) => [
      name,
      annotations.readOnlyHint,
      annotations.destructiveHint,
      annotations.openWorldHint,
    ]);
    for (const [, readOnly, destructive, openWorld] of hints) {
      expect(typeof destructive).toBe("boolean");
      expect(openWorld).toBe(false);
      if (readOnly) expect(destructive).toBe(false);
    }
    expect(
      hints.filter(([, readOnly, destructive]) => !readOnly && !destructive).map(([name]) => name),
    ).toEqual(["create_automation", "set_up_follow_on"]);
    expect(hello.body.result.capabilities.extensions).toEqual({
      "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
      "io.modelcontextprotocol/skills": {},
    });
  });

  test("lists the team's automations and uploads, and only the team's", async () => {
    const { t, other, otherTeam, automationId, uploadId, key } = await setUp();
    const automations = await call(t, key, "list_automations");
    expect(automations.data).toEqual([
      expect.objectContaining({
        automation_id: automationId,
        name: "Weekly clips",
        on: false,
        starts_with: "A new upload",
        latest_run: null,
      }),
    ]);
    const uploads = await call(t, key, "list_uploads");
    expect(uploads.data).toEqual([
      expect.objectContaining({ upload_id: uploadId, name: "episode 12.mp4" }),
    ]);
    const otherKey = await agentToken(t, other, otherTeam);
    expect((await call(t, otherKey, "list_automations")).data).toEqual([]);
    const reach = await call(t, otherKey, "start_automation", { automation_id: automationId });
    expect(reach).toMatchObject({
      isError: true,
      text: expect.stringMatching(/no automation with that id/),
    });
  });

  test("starts an automation on an upload, and check_run follows it to its finished files", async () => {
    const { t, automationId, uploadId, key } = await setUp();
    const started = await call(t, key, "start_automation", {
      automation_id: automationId,
      upload_id: uploadId,
    });
    expect(started.isError).toBe(false);
    const runId = started.data.run_id as Id<"runs">;
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({
      triggerKind: "manual",
      trigger: { file_url: `upload:${uploadId}` },
    });

    let checked = await call(t, key, "check_run", { run_id: runId });
    expect(checked.data).toMatchObject({ status: "running", automation: "Weekly clips" });
    expect(checked.data.steps.map((step: { step: string }) => step.step)).toEqual([
      "Trim video",
      "Caption video",
    ]);

    await t.run(async (ctx) => {
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
      for (const step of steps) {
        await ctx.db.patch(step._id, {
          status: "done",
          outputs: [`https://files.example/${step.nodeId}.mp4`],
        });
      }
      await ctx.db.patch(runId, { status: "done", finishedAt: Date.now() });
    });
    checked = await call(t, key, "check_run", { run_id: runId });
    expect(checked.data).toMatchObject({
      status: "done",
      files: ["https://files.example/caption.mp4"],
    });

    const runs = await call(t, key, "list_runs", { automation_id: automationId });
    expect(runs.data).toEqual([expect.objectContaining({ run_id: runId, status: "done" })]);
  });

  test("says in plain words when a file link or upload is not right", async () => {
    const { t, automationId, key } = await setUp();
    expect(
      await call(t, key, "start_automation", { automation_id: automationId, file_url: "ftp://x" }),
    ).toMatchObject({ isError: true, text: expect.stringMatching(/https:\/\//) });
    expect(
      await call(t, key, "start_automation", { automation_id: automationId, upload_id: "nope" }),
    ).toMatchObject({ isError: true, text: expect.stringMatching(/no upload/) });
    expect(await call(t, key, "check_run", { run_id: "nope" })).toMatchObject({ isError: true });
  });

  test("answers an unknown method with a protocol error, and GET with 405", async () => {
    const { t, key } = await setUp();
    expect((await rpc(t, key, "sampling/createMessage")).body.error.code).toBe(-32601);
    const unknown = await modern(t, key, "sampling/createMessage");
    expect(unknown).toMatchObject({ status: 404, body: { error: { code: -32601 } } });
    const got = await t.fetch("/mcp", {
      method: "GET",
      headers: { authorization: `Bearer ${key}` },
    });
    expect(got.status).toBe(405);
  });
});

describe("the 2026-07-28 protocol", () => {
  test("discover names the version, capabilities and both extensions, with server info", async () => {
    const { t, key } = await setUp();
    const found = await modern(t, key, "server/discover");
    expect(found.status).toBe(200);
    expect(found.body.result).toMatchObject({
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: {
        tools: {},
        resources: {},
        extensions: {
          "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
          "io.modelcontextprotocol/skills": {},
        },
      },
      instructions: expect.stringContaining("content-automations skill"),
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "takewon" } },
    });
  });

  test("refuses an unknown version with the versions it has, and headers that disagree", async () => {
    const { t, key } = await setUp();
    const response = await t.fetch("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: { ...MODERN_META, "io.modelcontextprotocol/protocolVersion": "1900-01-01" },
        },
      }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({
      code: -32022,
      data: {
        requested: "1900-01-01",
        supported: expect.arrayContaining(["2026-07-28", "2025-11-25"]),
      },
    });
    const mismatched = await modern(t, key, "tools/list", {}, { "mcp-method": "tools/call" });
    expect(mismatched).toMatchObject({ status: 400, body: { error: { code: -32020 } } });
  });

  test("links the run tools to the run page for clients with MCP Apps, and serves the page", async () => {
    const { t, key } = await setUp();
    const listed = await modern(t, key, "tools/list");
    const tools = listed.body.result.tools as {
      name: string;
      _meta?: { ui?: { resourceUri: string } };
    }[];
    const withPage = tools.filter((tool) => tool._meta?.ui).map((tool) => tool.name);
    expect(withPage).toEqual(["start_automation", "check_run", "list_approvals"]);
    expect(listed.body.result).toMatchObject({ ttlMs: expect.any(Number), resultType: "complete" });

    const page = await modern(t, key, "resources/read", { uri: "ui://ncat-dash/run.html" });
    expect(page.body.result.contents[0]).toMatchObject({
      uri: "ui://ncat-dash/run.html",
      mimeType: "text/html;profile=mcp-app",
      text: expect.stringContaining("ui/initialize"),
    });
  });

  test("hands out the content-automations skill, with digests that match its files", async () => {
    const { t, key } = await setUp();
    const listed = await modern(t, key, "skills/list");
    const [skill] = listed.body.result.skills;
    expect(skill).toMatchObject({
      uri: "skill://content-automations/SKILL.md",
      frontmatter: { name: "content-automations" },
    });
    const read = await modern(t, key, "resources/read", { uri: skill.uri });
    const text = read.body.result.contents[0].text as string;
    expect(text.startsWith("---\nname: content-automations\n")).toBe(true);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(skill.resources).toEqual([
      { uri: skill.uri, digest: `sha256:${hex}`, size: new TextEncoder().encode(text).length },
    ]);
    const got = await modern(t, key, "skills/get", { uri: skill.uri });
    expect(got.body.result.skill.uri).toBe(skill.uri);
    const missing = await modern(t, key, "skills/get", { uri: "skill://nope/SKILL.md" });
    expect(missing.body.error.code).toBe(-32602);
  });
});

describe("building automations through MCP", () => {
  test("suggests follow-ons when describing one, and builds one wired after it", async () => {
    const { t, team, owner, key } = await setUp();
    const lyric = await owner.as.mutation(api.automations.create, {
      organizationId: team,
      name: "",
      starterId: "lyric-video",
    });
    const described = await call(t, key, "describe_automation", { automation_id: lyric });
    expect(described.data.followOns).toEqual([
      expect.objectContaining({ id: "lyric-video-vertical" }),
    ]);
    const made = await call(t, key, "set_up_follow_on", {
      automation_id: lyric,
      follow_on: "lyric-video-vertical",
    });
    expect(made.data).toMatchObject({ on: true, problem: null });
    const follower = await t.run((ctx) => ctx.db.get(made.data.automation_id as Id<"automations">));
    expect(follower?.trigger).toMatchObject({ kind: "finished", automationId: lyric });
    const missing = await call(t, key, "set_up_follow_on", { automation_id: lyric });
    expect(missing.isError).toBe(true);
  });

  test("creates one and builds it, always as a draft, and describes it back", async () => {
    const { t, team, owner, key } = await setUp();
    const made = await call(t, key, "create_automation", { name: "From Claude" });
    expect(made.data).toMatchObject({
      automation_id: expect.any(String),
      address: expect.stringContaining(`/automations/${made.data.automation_id}`),
    });
    const changed = await call(t, key, "change_automation", {
      automation_id: made.data.automation_id,
      operations: [
        { op: "trigger", trigger: { kind: "trigger:upload", fileType: "video" } },
        { op: "add", type: "step:video-trim", id: "trim" },
      ],
    });
    expect(changed.isError).toBe(false);
    expect(changed.data).toMatchObject({
      draft: true,
      outline: expect.stringContaining("step:video-trim"),
    });
    const stored = await t.run((ctx) => ctx.db.get(made.data.automation_id as Id<"automations">));
    // The published version is untouched until someone publishes the draft.
    expect(stored).toMatchObject({ organizationId: team, createdBy: owner.id, nodes: [] });
    expect(stored?.draft?.nodes.map((node) => node.id)).toEqual(["trim"]);

    const described = await call(t, key, "describe_automation", {
      automation_id: made.data.automation_id,
    });
    expect(described.data).toMatchObject({ name: "From Claude", draft: true });
  });

  test("keeps changes to an existing automation as a draft too, and runs the draft when asked", async () => {
    const { t, automationId, uploadId, key } = await setUp();
    await call(t, key, "change_automation", {
      automation_id: automationId,
      operations: [{ op: "rename", id: "trim", label: "Shorten" }],
    });
    const stored = await t.run((ctx) => ctx.db.get(automationId));
    expect(stored?.nodes[0].label).toBeUndefined();
    expect(stored?.draft?.nodes[0].label).toBe("Shorten");

    const started = await call(t, key, "start_automation", {
      automation_id: automationId,
      upload_id: uploadId,
      version: "draft",
    });
    const checked = await call(t, key, "check_run", { run_id: started.data.run_id });
    expect(checked.data.steps[0].step).toBe("Shorten");
  });

  test("chooses how files meet where two lines join", async () => {
    const { t, key } = await setUp();
    const made = await call(t, key, "create_automation", { name: "Paired" });
    const changed = await call(t, key, "change_automation", {
      automation_id: made.data.automation_id,
      operations: [
        { op: "trigger", trigger: { kind: "trigger:upload", fileType: "video" } },
        { op: "add", type: "step:video-trim", id: "a" },
        { op: "add", type: "step:video-trim", id: "b" },
        { op: "add", type: "step:video-trim", id: "both", after: "a", join: ["b"] },
        { op: "meet", id: "both", mode: "first" },
      ],
    });
    expect(changed.isError).toBe(false);
    const stored = await t.run((ctx) => ctx.db.get(made.data.automation_id as Id<"automations">));
    expect(stored?.draft?.nodes.find((node) => node.id === "both")?.join).toBe("first");
  });

  test("says plainly when a change cannot be made, and keeps to the team", async () => {
    const { t, other, otherTeam, automationId, key } = await setUp();
    const wrong = await call(t, key, "change_automation", {
      automation_id: automationId,
      operations: [{ op: "remove", ids: ["no-such-step"] }],
    });
    expect(wrong.isError).toBe(true);
    const badShape = await call(t, key, "change_automation", {
      automation_id: automationId,
      operations: [{ op: "add" }],
    });
    expect(badShape).toMatchObject({ isError: true });
    const otherKey = await agentToken(t, other, otherTeam);
    const reach = await call(t, otherKey, "change_automation", {
      automation_id: automationId,
      operations: [{ op: "name", name: "Mine now" }],
    });
    expect(reach).toMatchObject({
      isError: true,
      text: expect.stringMatching(/no automation with that id/),
    });
  });

  test("lists step types, and one type's settings", async () => {
    const { t, key } = await setUp();
    const index = await call(t, key, "list_step_types");
    expect(index.data.index).toContain("step:video-caption");
    const one = await call(t, key, "list_step_types", { type: "step:video-caption" });
    expect(one.data.type).toBeTruthy();
  });
});

describe("the MCP server once nothing new can start", () => {
  test("a blocked team, or one whose trial is over, is told why and nothing runs", async () => {
    const { t, team, key } = await setUp();
    expect((await rpc(t, key, "tools/list")).status).toBe(200);
    await t.mutation(internal.blocks.blockTeam, { organizationId: team });
    const blocked = await rpc(t, key, "tools/list");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/paused/);
    expect(typeof blocked.body.id).toBe("number");

    await t.mutation(internal.blocks.unblockTeam, { organizationId: team });
    await t.run((ctx) =>
      ctx.db.insert("teamTrials", { organizationId: team, startedAt: 0, endsAt: 1 }),
    );
    const ended = await rpc(t, key, "tools/list");
    expect(ended.status).toBe(403);
    expect(ended.body.error.message).toMatch(/trial has ended/);
  });

  test("an AI client stuck in a loop is slowed down", async () => {
    const { t, key } = await setUp();
    // The clock stands still, so the allowance does not refill while signed-in calls,
    // which take longer to check than the old keys did, are made.
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      let last = 0;
      for (let i = 0; i < 61; i++) last = (await rpc(t, key, "tools/list")).status;
      expect(last).toBe(429);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("workflows over the MCP server", () => {
  test("sets one up from an automation, lists it and switches it, only for the team", async () => {
    const { t, member, other, otherTeam, automationId, key } = await setUp();
    const made = await call(t, key, "set_up_workflow", {
      automation_id: automationId,
      name: "Weekly drop",
      kind: "quick",
      review: { on: true, reviewers: [member.id], time_limit: 2, time_limit_unit: "days" },
    });
    expect(made.isError).toBe(false);
    expect(made.data).toMatchObject({
      made: true,
      name: "Weekly drop",
      kind: "Quick personal job",
      review: { reviewers: [member.id], time_limit: "2 days, then reject" },
      automations: [{ automation_id: automationId, reviewed_here: true }],
    });
    const listed = await call(t, key, "list_workflows");
    expect(listed.data).toEqual([expect.objectContaining({ workflow_id: made.data.workflow_id })]);

    const turnedOff = await call(t, key, "set_up_workflow", {
      automation_id: automationId,
      review: { on: false },
    });
    expect(turnedOff.data).toMatchObject({ made: false, review: null });

    const switched = await call(t, key, "switch_workflow", {
      workflow_id: made.data.workflow_id,
      on: false,
    });
    expect(switched.data).toEqual({ workflow_id: made.data.workflow_id, on: false });

    const otherKey = await agentToken(t, other, otherTeam);
    expect((await call(t, otherKey, "list_workflows")).data).toEqual([]);
    expect(
      await call(t, otherKey, "switch_workflow", { workflow_id: made.data.workflow_id, on: true }),
    ).toMatchObject({ isError: true, text: expect.stringMatching(/no workflow with that id/) });
    expect(
      await call(t, key, "set_up_workflow", { automation_id: automationId, kind: "film" }),
    ).toMatchObject({
      isError: true,
    });
  });
});

describe("publishing and switching on over MCP", () => {
  test("publishes the draft, then switches the automation on and off", async () => {
    const { t, automationId, key } = await setUp();
    const none = await call(t, key, "publish_automation", { automation_id: automationId });
    expect(none).toMatchObject({ isError: true, text: expect.stringMatching(/no draft/) });

    await call(t, key, "change_automation", {
      automation_id: automationId,
      operations: [
        { op: "rename", id: "trim", label: "Shorten" },
        { op: "trigger", trigger: { kind: "trigger:webhook" } },
      ],
    });
    const published = await call(t, key, "publish_automation", { automation_id: automationId });
    expect(published.data).toMatchObject({ published: true, on: false });
    const stored = await t.run((ctx) => ctx.db.get(automationId));
    expect(stored?.draft).toBeUndefined();
    expect(stored?.nodes[0].label).toBe("Shorten");

    const on = await call(t, key, "switch_automation", { automation_id: automationId, on: true });
    expect(on.data).toMatchObject({ on: true });
    expect((await t.run((ctx) => ctx.db.get(automationId)))?.enabled).toBe(true);
    await call(t, key, "switch_automation", { automation_id: automationId, on: false });
    expect((await t.run((ctx) => ctx.db.get(automationId)))?.enabled).toBe(false);
    const missing = await call(t, key, "switch_automation", { automation_id: automationId });
    expect(missing.isError).toBe(true);
  });

  test("refuses to switch on an automation that cannot run, saying why", async () => {
    const { t, automationId, key } = await setUp();
    // It starts on a new upload, and the team has no storage for uploads yet.
    const on = await call(t, key, "switch_automation", { automation_id: automationId, on: true });
    expect(on).toMatchObject({ isError: true, text: "Connect a toolkit in Settings, under Toolkit, first." });
    expect((await t.run((ctx) => ctx.db.get(automationId)))?.enabled).toBe(false);
  });
});

describe("approvals over MCP", () => {
  const FILE = "https://files.example/station_interview.mp4";

  async function waiting(reviewers?: string[]) {
    const setup = await setUp();
    const runId = await setup.t.run(async (ctx) => {
      const id = await ctx.db.insert("automations", {
        organizationId: setup.team,
        name: "Client ads",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [
          {
            id: "approval",
            kind: "approval",
            input: reviewers ? { reviewers } : {},
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
        hookToken: "token-2",
        nextRunAt: null,
        createdBy: setup.owner.id,
        updatedAt: Date.now(),
      });
      const automation = await ctx.db.get(id);
      const started = await startRun(ctx, automation!, "webhook", { file_url: FILE }, null);
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
    return { ...setup, runId };
  }

  test("lists what is waiting with the files to look at, and approves it", async () => {
    const { t, key, runId } = await waiting();
    const listed = await call(t, key, "list_approvals");
    expect(listed.data.approvals).toEqual([
      expect.objectContaining({
        run_id: runId,
        automation: "Client ads",
        asked: "anyone on the team",
        you_may_decide: true,
        files: [FILE],
        address: expect.stringContaining(`/runs/${runId}`),
      }),
    ]);
    const checked = await call(t, key, "check_run", { run_id: runId });
    expect(checked.data.approval).toMatchObject({
      approval_id: listed.data.approvals[0].approval_id,
      you_may_decide: true,
    });

    const decided = await call(t, key, "decide_approval", {
      approval_id: listed.data.approvals[0].approval_id,
      decision: "approve",
    });
    expect(decided.data).toMatchObject({ decided: "approved", run_id: runId });
    const run = await t.run((ctx) => ctx.db.get(runId as Id<"runs">));
    expect(run?.status).toBe("done");
    expect((await call(t, key, "list_approvals")).data.approvals).toEqual([]);
    const again = await call(t, key, "decide_approval", {
      approval_id: listed.data.approvals[0].approval_id,
      decision: "send_back",
    });
    expect(again).toMatchObject({ isError: true, text: "Someone has already decided this." });
  });

  test("sends one back, which stops the run", async () => {
    const { t, key, runId } = await waiting();
    const [approval] = (await call(t, key, "list_approvals")).data.approvals;
    await call(t, key, "decide_approval", {
      approval_id: approval.approval_id,
      decision: "send_back",
    });
    const run = await t.run((ctx) => ctx.db.get(runId as Id<"runs">));
    expect(run?.status).toBe("failed");
  });

  test("keeps to the reviewers it names, and to the team", async () => {
    const setup = await setUp();
    const ana = await addPerson(setup.t, "Ana Reyes", [setup.team]);
    const { t, team, member, other, otherTeam } = setup;
    const runId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("automations", {
        organizationId: team,
        name: "Client ads",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [
          {
            id: "approval",
            kind: "approval",
            input: { reviewers: [ana.id] },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
        hookToken: "token-3",
        nextRunAt: null,
        createdBy: setup.owner.id,
        updatedAt: Date.now(),
      });
      const started = await startRun(
        ctx,
        (await ctx.db.get(id))!,
        "webhook",
        { file_url: FILE },
        null,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
    // Theo is on the team but not named, so his agent sees it and cannot decide.
    const { approvals } = await t.query(internal.mcp.approvals, {
      organizationId: team,
      userId: member.id,
    });
    expect(approvals[0]).toMatchObject({
      run_id: runId,
      you_may_decide: false,
      asked: ["Ana Reyes"],
    });
    await expect(
      t.mutation(internal.mcp.decide, {
        organizationId: team,
        userId: member.id,
        approvalId: approvals[0].approval_id,
        approve: true,
      }),
    ).rejects.toThrow(/Ana Reyes/);

    const otherKey = await agentToken(t, other, otherTeam);
    const reach = await call(t, otherKey, "decide_approval", {
      approval_id: approvals[0].approval_id,
      decision: "approve",
    });
    expect(reach).toMatchObject({ isError: true, text: expect.stringMatching(/no approval/) });

    await t.mutation(internal.mcp.decide, {
      organizationId: team,
      userId: ana.id,
      approvalId: approvals[0].approval_id,
      approve: true,
    });
    expect((await t.run((ctx) => ctx.db.get(runId as Id<"runs">)))?.status).toBe("done");
  });
});

describe("clips playing in the chat", () => {
  test("lets the run page load media from the team's storage, and nothing else", async () => {
    const { t, team, key } = await setUp();
    const before = await modern(t, key, "resources/read", { uri: "ui://ncat-dash/run.html" });
    expect(before.body.result.contents[0]._meta.ui.csp.resourceDomains).toBeUndefined();

    await t.run(async (ctx) => {
      const connection = await ctx.db
        .query("toolkitConnections")
        .withIndex("by_organization", (q) => q.eq("organizationId", team))
        .first();
      await ctx.db.patch(connection!._id, {
        storage: {
          bucket: "media",
          endpoint: "https://abc.r2.cloudflarestorage.com/media",
          publicUrl: "https://media.saltho.use/files",
        },
      });
    });
    const page = await modern(t, key, "resources/read", { uri: "ui://ncat-dash/run.html" });
    expect(page.body.result.contents[0]._meta.ui.csp.resourceDomains).toEqual([
      "https://media.saltho.use",
      "https://abc.r2.cloudflarestorage.com",
    ]);
    // Only the team's own storage: another team's is not added.
    expect(JSON.stringify(page.body.result)).not.toContain("toolkit.example");
  });
});

/** A 2026-07-28 request from a client that says what it can do (forms, tasks, the run page). */
async function asClient(
  t: Backend,
  key: string,
  can: { forms?: boolean; tasks?: boolean; apps?: boolean },
  method: string,
  params: Record<string, unknown> = {},
) {
  const capabilities = {
    ...(can.forms ? { elicitation: { form: {} } } : {}),
    extensions: {
      ...(can.apps
        ? { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } }
        : {}),
      ...(can.tasks ? { "io.modelcontextprotocol/tasks": {} } : {}),
    },
  };
  const response = await t.fetch("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${key}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: next++,
      method,
      params: {
        ...params,
        _meta: {
          ...MODERN_META,
          "io.modelcontextprotocol/clientCapabilities": capabilities,
        },
      },
    }),
  });
  return { status: response.status, body: await response.json() };
}

describe("prompts, file links, result shapes and icons", () => {
  test("offers slash prompts, and fills one in from what the person gave", async () => {
    const { t, key } = await setUp();
    const discovered = await asClient(t, key, {}, "server/discover");
    expect(discovered.body.result.capabilities.prompts).toEqual({ listChanged: false });
    const listed = await asClient(t, key, {}, "prompts/list");
    expect(listed.body.result.prompts.map((prompt: { name: string }) => prompt.name)).toEqual([
      "whats_waiting",
      "run_automation",
      "build_automation",
      "how_runs_went",
    ]);
    expect(listed.body.result).toMatchObject({ ttlMs: expect.any(Number), cacheScope: "private" });
    expect(listed.body.result.prompts[0].icons[0].mimeType).toBe("image/svg+xml");

    const got = await asClient(t, key, {}, "prompts/get", {
      name: "run_automation",
      arguments: { automation: "Weekly clips" },
    });
    expect(got.body.result.messages).toEqual([
      {
        role: "user",
        content: {
          type: "text",
          text: expect.stringContaining('"Weekly clips" on a file: ask me which one'),
        },
      },
    ]);
    const missing = await asClient(t, key, {}, "prompts/get", { name: "build_automation" });
    expect(missing.body.error).toMatchObject({
      code: -32602,
      message: "goal is needed for build_automation.",
    });
    const unknown = await asClient(t, key, {}, "prompts/get", { name: "nope" });
    expect(unknown.body.error.code).toBe(-32602);
  });

  test("every tool has an icon, and the main ones say the shape of what they return", async () => {
    const { t, key } = await setUp();
    const { body } = await asClient(t, key, {}, "tools/list");
    const tools = body.result.tools as {
      name: string;
      icons: { src: string; theme: string }[];
      outputSchema?: { properties: Record<string, unknown> };
    }[];
    for (const tool of tools) {
      expect(tool.icons.map((each) => each.theme)).toEqual(["light", "dark"]);
      expect(atob(tool.icons[0].src.split(",")[1])).toMatch(/^<svg /);
    }
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(Object.keys(byName.get("check_run")!.outputSchema!.properties)).toEqual(
      expect.arrayContaining(["run_id", "status", "steps", "files", "approval"]),
    );
    expect(byName.get("list_runs")!.outputSchema!.properties.items).toBeDefined();
  });

  test("a finished run's files come back as file links too", async () => {
    const { t, automationId, uploadId, key } = await setUp();
    const started = await call(t, key, "start_automation", {
      automation_id: automationId,
      upload_id: uploadId,
    });
    const runId = started.data.run_id as Id<"runs">;
    await t.run(async (ctx) => {
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
      for (const step of steps) {
        await ctx.db.patch(step._id, {
          status: "done",
          outputs: [`https://files.example/clips/episode%2012-${step.nodeId}.mp4`],
        });
      }
      await ctx.db.patch(runId, { status: "done", finishedAt: Date.now() });
    });
    const { body } = await asClient(t, key, {}, "tools/call", {
      name: "check_run",
      arguments: { run_id: runId },
    });
    expect(body.result.content.slice(1)).toEqual([
      {
        type: "resource_link",
        uri: "https://files.example/clips/episode%2012-caption.mp4",
        name: "episode 12-caption.mp4",
        mimeType: "video/mp4",
      },
    ]);
    expect(body.result.structuredContent.files).toEqual([
      "https://files.example/clips/episode%2012-caption.mp4",
    ]);
  });
});

describe("asking the person in the chat", () => {
  test("asks which file to run on, and runs on the one picked", async () => {
    const { t, automationId, uploadId, key } = await setUp();
    const asked = await asClient(t, key, { forms: true }, "tools/call", {
      name: "start_automation",
      arguments: { automation_id: automationId },
    });
    expect(asked.body.result).toMatchObject({
      resultType: "input_required",
      inputRequests: {
        file: {
          method: "elicitation/create",
          params: {
            mode: "form",
            message: expect.stringContaining('"Weekly clips"'),
            requestedSchema: {
              type: "object",
              properties: {
                upload_id: { oneOf: [{ const: uploadId, title: "episode 12.mp4" }] },
                file_url: { type: "string", format: "uri" },
              },
            },
          },
        },
      },
    });
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toHaveLength(0);

    const picked = await asClient(t, key, { forms: true }, "tools/call", {
      name: "start_automation",
      arguments: { automation_id: automationId },
      inputResponses: { file: { action: "accept", content: { upload_id: uploadId } } },
    });
    expect(picked.body.result.resultType).toBe("complete");
    const run = await t.run((ctx) =>
      ctx.db.get(picked.body.result.structuredContent.run_id as Id<"runs">),
    );
    expect(run?.trigger).toEqual({ file_url: `upload:${uploadId}` });
  });

  test("starts nothing when the person closes the form, and older clients get no form", async () => {
    const { t, automationId, key } = await setUp();
    const closed = await asClient(t, key, { forms: true }, "tools/call", {
      name: "start_automation",
      arguments: { automation_id: automationId },
      inputResponses: { file: { action: "cancel" } },
    });
    expect(closed.body.result).toMatchObject({
      isError: true,
      content: [{ text: "The person closed the form without choosing, so nothing was started." }],
    });
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toHaveLength(0);
    // A client that cannot show forms runs it without a file, as before.
    const plain = await call(t, key, "start_automation", { automation_id: automationId });
    expect(plain.isError).toBe(false);
  });

  test("asks before switching an automation on, and leaves it off when told no", async () => {
    const { t, automationId, key } = await setUp();
    await call(t, key, "change_automation", {
      automation_id: automationId,
      operations: [{ op: "trigger", trigger: { kind: "trigger:webhook" } }],
    });
    await call(t, key, "publish_automation", { automation_id: automationId });
    const args = { automation_id: automationId, on: true };
    const asked = await asClient(t, key, { forms: true }, "tools/call", {
      name: "switch_automation",
      arguments: args,
    });
    expect(asked.body.result.inputRequests.switch_on.params.message).toBe(
      'Switch on "Weekly clips"? From then on it runs by itself on: its webhook address.',
    );
    const no = await asClient(t, key, { forms: true }, "tools/call", {
      name: "switch_automation",
      arguments: args,
      inputResponses: { switch_on: { action: "decline" } },
    });
    expect(no.body.result.isError).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(automationId)))?.enabled).toBe(false);
    const yes = await asClient(t, key, { forms: true }, "tools/call", {
      name: "switch_automation",
      arguments: args,
      inputResponses: { switch_on: { action: "accept", content: {} } },
    });
    expect(yes.body.result.structuredContent).toMatchObject({ on: true });
    expect((await t.run((ctx) => ctx.db.get(automationId)))?.enabled).toBe(true);
    // Switching off needs no question.
    const off = await asClient(t, key, { forms: true }, "tools/call", {
      name: "switch_automation",
      arguments: { automation_id: automationId, on: false },
    });
    expect(off.body.result.structuredContent).toMatchObject({ on: false });
  });
});

describe("approvals asked in the chat, and runs as tasks", () => {
  const FILE = "https://files.example/station_interview.mp4";

  async function waiting() {
    const setup = await setUp();
    const runId = await setup.t.run(async (ctx) => {
      const id = await ctx.db.insert("automations", {
        organizationId: setup.team,
        name: "Client ads",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [{ id: "approval", kind: "approval", input: {}, position: { x: 0, y: 0 } }],
        edges: [],
        hookToken: "token-2",
        nextRunAt: null,
        createdBy: setup.owner.id,
        updatedAt: Date.now(),
      });
      const automation = await ctx.db.get(id);
      const started = await startRun(ctx, automation!, "webhook", { file_url: FILE }, null);
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
    const [approval] = (await call(setup.t, setup.key, "list_approvals")).data.approvals;
    return { ...setup, runId, approvalId: approval.approval_id as string };
  }

  const stepError = (t: Backend, runId: string) =>
    t.run(async (ctx) => {
      const [step] = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId as Id<"runs">))
        .collect();
      return step.error;
    });

  test("asks what should change when sending back, and shows it on the run", async () => {
    const { t, key, runId, approvalId } = await waiting();
    const args = { approval_id: approvalId, decision: "send_back" };
    const asked = await asClient(t, key, { forms: true }, "tools/call", {
      name: "decide_approval",
      arguments: args,
    });
    expect(asked.body.result.inputRequests.send_back.params).toMatchObject({
      message: 'Send back "Client ads" at Approval? The run stops there.',
      requestedSchema: { properties: { reason: { type: "string" } } },
    });
    const sent = await asClient(t, key, { forms: true }, "tools/call", {
      name: "decide_approval",
      arguments: args,
      inputResponses: { send_back: { action: "accept", content: { reason: "Louder music" } } },
    });
    expect(sent.body.result.structuredContent).toMatchObject({ decided: "sent back" });
    expect(await stepError(t, runId)).toBe("Sent back: Louder music");
  });

  test("takes a reason given straight away, and the run page's button asks nothing", async () => {
    const first = await waiting();
    await asClient(first.t, first.key, { forms: true }, "tools/call", {
      name: "decide_approval",
      arguments: { approval_id: first.approvalId, decision: "send_back", reason: "Wrong logo" },
    });
    expect(await stepError(first.t, first.runId)).toBe("Sent back: Wrong logo");

    const second = await waiting();
    const pressed = await asClient(second.t, second.key, { forms: true }, "tools/call", {
      name: "decide_approval",
      arguments: { approval_id: second.approvalId, decision: "send_back", reason: "" },
    });
    expect(pressed.body.result.resultType).toBe("complete");
    expect(await stepError(second.t, second.runId)).toBe("Rejected at the approval step.");
  });

  test("a chat app that follows tasks gets the run as one, and decides its review in a form", async () => {
    const { t, key, automationId, uploadId, runId, approvalId } = await waiting();
    const can = { forms: true, tasks: true };
    const discovered = await asClient(t, key, can, "server/discover");
    expect(discovered.body.result.capabilities.extensions["io.modelcontextprotocol/tasks"]).toEqual(
      {},
    );

    const started = await asClient(t, key, can, "tools/call", {
      name: "start_automation",
      arguments: { automation_id: automationId, upload_id: uploadId },
    });
    expect(started.body.result).toMatchObject({
      resultType: "task",
      status: "working",
      statusMessage: 'Running "Weekly clips".',
      pollIntervalMs: 5000,
      ttlMs: null,
    });
    const working = await asClient(t, key, can, "tasks/get", {
      taskId: started.body.result.taskId,
    });
    expect(working.body.result).toMatchObject({
      resultType: "complete",
      status: "working",
      statusMessage: "Step 1 of 2: Trim video.",
    });
    expect(
      (await asClient(t, key, can, "tasks/cancel", { taskId: started.body.result.taskId })).body
        .result,
    ).toEqual(expect.objectContaining({ resultType: "complete" }));
    const cancelled = await asClient(t, key, can, "tasks/get", {
      taskId: started.body.result.taskId,
    });
    expect(cancelled.body.result.status).toBe("cancelled");

    // The waiting run, as a task: its review is asked as a form, and answered by update.
    const review = await asClient(t, key, can, "tasks/get", { taskId: runId });
    expect(review.body.result).toMatchObject({
      status: "input_required",
      inputRequests: {
        [`review:${approvalId}`]: {
          method: "elicitation/create",
          params: { message: expect.stringContaining(FILE) },
        },
      },
    });
    await asClient(t, key, can, "tasks/update", {
      taskId: runId,
      inputResponses: {
        [`review:${approvalId}`]: { action: "accept", content: { decision: "approve" } },
      },
    });
    const done = await asClient(t, key, can, "tasks/get", { taskId: runId });
    expect(done.body.result).toMatchObject({
      status: "completed",
      result: {
        isError: false,
        structuredContent: { status: "done", files: [FILE] },
        content: expect.arrayContaining([
          expect.objectContaining({ type: "resource_link", uri: FILE }),
        ]),
      },
    });
  });

  test("tasks keep to the team and to clients that follow them; the run page gets a plain result", async () => {
    const { t, key, other, otherTeam, runId, automationId, uploadId } = await waiting();
    const theirs = { key: await agentToken(t, other, otherTeam) };
    const can = { tasks: true };
    expect(
      (await asClient(t, theirs.key, can, "tasks/get", { taskId: runId })).body.error.code,
    ).toBe(-32602);
    expect((await asClient(t, key, can, "tasks/get", { taskId: "nope" })).body.error.code).toBe(
      -32602,
    );
    expect((await asClient(t, key, {}, "tasks/get", { taskId: runId })).body.error.code).toBe(
      -32021,
    );
    // Someone not asked to decide, or an app without forms, just sees it waiting.
    const plain = await asClient(t, key, can, "tasks/get", { taskId: runId });
    expect(plain.body.result).toMatchObject({
      status: "working",
      statusMessage: "Waiting at Approval for someone on the team to decide.",
    });
    const withPage = await asClient(t, key, { tasks: true, apps: true }, "tools/call", {
      name: "start_automation",
      arguments: { automation_id: automationId, upload_id: uploadId },
    });
    expect(withPage.body.result).toMatchObject({ resultType: "complete", isError: false });
  });
});

describe("autocomplete, attachable automations and runs, events and the server card", () => {
  test("suggests the team's automation names and uploads as a prompt is filled in", async () => {
    const { t, key } = await setUp();
    const discovered = await asClient(t, key, {}, "server/discover");
    expect(discovered.body.result.capabilities.completions).toEqual({});
    const named = await asClient(t, key, {}, "completion/complete", {
      ref: { type: "ref/prompt", name: "run_automation" },
      argument: { name: "automation", value: "week" },
    });
    expect(named.body.result.completion).toEqual({
      values: ["Weekly clips"],
      total: 1,
      hasMore: false,
    });
    const file = await asClient(t, key, {}, "completion/complete", {
      ref: { type: "ref/prompt", name: "run_automation" },
      argument: { name: "file", value: "12" },
    });
    expect(file.body.result.completion.values).toEqual(["episode 12.mp4"]);
    const none = await asClient(t, key, {}, "completion/complete", {
      ref: { type: "ref/prompt", name: "whats_waiting" },
      argument: { name: "anything", value: "" },
    });
    expect(none.body.result.completion.values).toEqual([]);
  });

  test("lists the team's automations to attach, and reads an automation or a run", async () => {
    const { t, key, automationId, uploadId, other, otherTeam } = await setUp();
    const listed = await asClient(t, key, {}, "resources/list");
    expect(listed.body.result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uri: `takewon://automations/${automationId}`,
          name: "Weekly clips",
          description: "Automation. Starts with: a new upload.",
        }),
      ]),
    );
    expect(listed.body.result.ttlMs).toBe(0);
    const templates = await asClient(t, key, {}, "resources/templates/list");
    expect(
      templates.body.result.resourceTemplates.map(
        (each: { uriTemplate: string }) => each.uriTemplate,
      ),
    ).toEqual(["takewon://automations/{automation_id}", "takewon://runs/{run_id}"]);

    const read = await asClient(t, key, {}, "resources/read", {
      uri: `takewon://automations/${automationId}`,
    });
    expect(JSON.parse(read.body.result.contents[0].text)).toMatchObject({
      automation_id: automationId,
      name: "Weekly clips",
    });
    const started = await call(t, key, "start_automation", {
      automation_id: automationId,
      upload_id: uploadId,
    });
    const run = await asClient(t, key, {}, "resources/read", {
      uri: `takewon://runs/${started.data.run_id}`,
    });
    expect(JSON.parse(run.body.result.contents[0].text)).toMatchObject({ status: "running" });
    const ids = await asClient(t, key, {}, "completion/complete", {
      ref: { type: "ref/resource", uri: "takewon://automations/{automation_id}" },
      argument: { name: "automation_id", value: "weekly" },
    });
    expect(ids.body.result.completion.values).toEqual([automationId]);

    // Another team's key reads nothing of this team's.
    const theirs = { key: await agentToken(t, other, otherTeam) };
    const refused = await asClient(t, theirs.key, {}, "resources/read", {
      uri: `takewon://automations/${automationId}`,
    });
    expect(refused.body.error).toMatchObject({ code: -32602 });
  });

  test("polls for finished runs and waiting approvals from a cursor, for the team only", async () => {
    const { t, key, automationId, uploadId, other, otherTeam } = await setUp();
    const discovered = await asClient(t, key, {}, "server/discover");
    expect(
      discovered.body.result.capabilities.extensions["io.modelcontextprotocol/events"],
    ).toEqual({});
    const types = await asClient(t, key, {}, "events/list");
    expect(types.body.result.events).toEqual([
      expect.objectContaining({ name: "run.finished", delivery: ["poll"] }),
      expect.objectContaining({ name: "approval.waiting", delivery: ["poll"] }),
    ]);

    const start = await asClient(t, key, {}, "events/poll", { name: "run.finished", cursor: null });
    expect(start.body.result).toMatchObject({
      events: [],
      cursor: expect.stringMatching(/^t:\d+$/),
      hasMore: false,
      truncated: false,
      nextPollMs: 30000,
    });
    const started = await call(t, key, "start_automation", {
      automation_id: automationId,
      upload_id: uploadId,
    });
    const runId = started.data.run_id as Id<"runs">;
    await t.run(async (ctx) => {
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
      for (const step of steps) {
        await ctx.db.patch(step._id, {
          status: "done",
          outputs: [`https://files.example/${step.nodeId}.mp4`],
        });
      }
      await ctx.db.patch(runId, { status: "done", finishedAt: Date.now() + 5 });
    });
    const polled = await asClient(t, key, {}, "events/poll", {
      name: "run.finished",
      cursor: start.body.result.cursor,
    });
    expect(polled.body.result.events).toEqual([
      expect.objectContaining({
        eventId: `${runId}:done`,
        name: "run.finished",
        data: expect.objectContaining({
          run_id: runId,
          status: "done",
          files: ["https://files.example/caption.mp4"],
        }),
      }),
    ]);
    const again = await asClient(t, key, {}, "events/poll", {
      name: "run.finished",
      cursor: polled.body.result.cursor,
    });
    expect(again.body.result.events).toEqual([]);

    // Another team polling from the same moment sees none of it.
    const theirs = { key: await agentToken(t, other, otherTeam) };
    const elsewhere = await asClient(t, theirs.key, {}, "events/poll", {
      name: "run.finished",
      cursor: start.body.result.cursor,
    });
    expect(elsewhere.body.result.events).toEqual([]);

    const unknown = await asClient(t, key, {}, "events/poll", { name: "nope", cursor: null });
    expect(unknown.body.error.code).toBe(-32023);
    const webhook = await asClient(t, key, {}, "events/subscribe", { name: "run.finished" });
    expect(webhook.body.error.code).toBe(-32026);
    const forged = await asClient(t, key, {}, "events/poll", {
      name: "run.finished",
      cursor: "anything",
    });
    expect(forged.body.error.code).toBe(-32602);
  });

  test("tells who should decide when a run starts waiting for an approval", async () => {
    const { t, key, owner, team } = await setUp();
    const start = await asClient(t, key, {}, "events/poll", {
      name: "approval.waiting",
      cursor: null,
    });
    await t.run(async (ctx) => {
      const id = await ctx.db.insert("automations", {
        organizationId: team,
        name: "Client ads",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [{ id: "approval", kind: "approval", input: {}, position: { x: 0, y: 0 } }],
        edges: [],
        hookToken: "token-3",
        nextRunAt: null,
        createdBy: owner.id,
        updatedAt: Date.now(),
      });
      const automation = await ctx.db.get(id);
      const started = await startRun(
        ctx,
        automation!,
        "webhook",
        { file_url: "https://files.example/ad.mp4" },
        null,
      );
      if (!started.ok) throw new Error(started.message);
      const [step] = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", started.runId))
        .collect();
      await ctx.db.patch(step._id, { startedAt: Date.now() + 5 });
    });
    const polled = await asClient(t, key, {}, "events/poll", {
      name: "approval.waiting",
      cursor: start.body.result.cursor,
    });
    expect(polled.body.result.events).toEqual([
      expect.objectContaining({
        name: "approval.waiting",
        data: expect.objectContaining({
          automation: "Client ads",
          you_may_decide: true,
          files: ["https://files.example/ad.mp4"],
        }),
      }),
    ]);
  });

  test("serves a public server card that names the server and where to reach it", async () => {
    const { t } = await setUp();
    const response = await t.fetch("/mcp/server-card", { method: "GET" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/mcp-server-card+json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const card = await response.json();
    expect(card).toMatchObject({
      $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
      name: "com.takewon/takewon",
      title: "Takewon",
      version: expect.any(String),
      description: expect.stringContaining("Your content, social media ready."),
      remotes: [
        {
          type: "streamable-http",
          url: expect.stringMatching(/\/mcp$/),
          supportedProtocolVersions: expect.arrayContaining(["2026-07-28"]),
        },
      ],
    });
    expect(card.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  });

  test("serves ChatGPT's domain challenge only once its token is set", async () => {
    const { t } = await setUp();
    const before = await t.fetch("/.well-known/openai-apps-challenge", { method: "GET" });
    expect(before.status).toBe(404);
    vi.stubEnv("OPENAI_APPS_CHALLENGE", " token-123\n");
    try {
      const after = await t.fetch("/.well-known/openai-apps-challenge", { method: "GET" });
      expect(after.status).toBe(200);
      expect(after.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(await after.text()).toBe("token-123");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
