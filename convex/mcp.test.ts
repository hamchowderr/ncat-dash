import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
  const { key } = await owner.as.mutation(api.mcpKeys.create, {
    organizationId: team,
    name: "Claude on my laptop",
  });
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

describe("team keys for other AI agents", () => {
  test("an owner makes one, sees only its hint, and can remove it", async () => {
    const { team, owner, key } = await setUp();
    expect(key).toMatch(/^ncat_[A-Za-z0-9_-]{40,}$/);
    const { keys, canEdit } = await owner.as.query(api.mcpKeys.list, { organizationId: team });
    expect(canEdit).toBe(true);
    expect(keys).toEqual([
      expect.objectContaining({
        name: "Claude on my laptop",
        hint: key.slice(-4),
        lastUsedAt: null,
      }),
    ]);
    expect(JSON.stringify(keys)).not.toContain(key);
    await owner.as.mutation(api.mcpKeys.remove, { organizationId: team, keyId: keys[0].keyId });
    expect((await owner.as.query(api.mcpKeys.list, { organizationId: team })).keys).toEqual([]);
  });

  test("a member who is not an owner or admin cannot make or see keys", async () => {
    const { team, member } = await setUp();
    await expect(
      member.as.mutation(api.mcpKeys.create, { organizationId: team, name: "Mine" }),
    ).rejects.toThrow(/owner or admin/);
    expect(await member.as.query(api.mcpKeys.list, { organizationId: team })).toEqual({
      canEdit: false,
      keys: [],
    });
  });

  test("another team cannot remove a team's key", async () => {
    const { team, owner, other, otherTeam } = await setUp();
    const { keys } = await owner.as.query(api.mcpKeys.list, { organizationId: team });
    await other.as.mutation(api.mcpKeys.remove, {
      organizationId: otherTeam,
      keyId: keys[0].keyId as Id<"mcpKeys">,
    });
    expect((await owner.as.query(api.mcpKeys.list, { organizationId: team })).keys).toHaveLength(1);
  });
});

describe("the MCP server", () => {
  test("turns away a request without a key, or with a wrong or removed one", async () => {
    const { t, team, owner, key } = await setUp();
    expect((await rpc(t, null, "tools/list")).status).toBe(401);
    expect((await rpc(t, "ncat_madeup", "tools/list")).status).toBe(401);
    const { keys } = await owner.as.query(api.mcpKeys.list, { organizationId: team });
    await owner.as.mutation(api.mcpKeys.remove, { organizationId: team, keyId: keys[0].keyId });
    expect((await rpc(t, key, "tools/list")).status).toBe(401);
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
      serverInfo: { name: "kontifi", title: "Kontifi" },
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
      ["list_uploads", true],
      ["start_automation", false],
      ["check_run", true],
      ["list_runs", true],
    ]);
    expect(hello.body.result.capabilities.extensions).toEqual({
      "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
      "io.modelcontextprotocol/skills": {},
    });
  });

  test("notes when a key was last used", async () => {
    const { t, team, owner, key } = await setUp();
    await rpc(t, key, "ping");
    const { keys } = await owner.as.query(api.mcpKeys.list, { organizationId: team });
    expect(keys[0].lastUsedAt).toEqual(expect.any(Number));
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
    const { key: otherKey } = await other.as.mutation(api.mcpKeys.create, {
      organizationId: otherTeam,
      name: "Theirs",
    });
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
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "kontifi" } },
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
    expect(withPage).toEqual(["start_automation", "check_run"]);
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
    const { key: otherKey } = await other.as.mutation(api.mcpKeys.create, {
      organizationId: otherTeam,
      name: "Theirs",
    });
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
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await rpc(t, key, "tools/list")).status;
    expect(last).toBe(429);
  });
});
