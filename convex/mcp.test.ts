import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
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
  return { status: response.status, body: response.status === 200 ? await response.json() : null };
}

async function call(t: Backend, key: string, name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc(t, key, "tools/call", { name, arguments: args });
  const result = body.result as { isError: boolean; content: { text: string }[] };
  return { isError: result.isError, text: result.content[0].text, data: JSON.parse(result.isError ? "null" : result.content[0].text) };
}

describe("team keys for other AI agents", () => {
  test("an owner makes one, sees only its hint, and can remove it", async () => {
    const { team, owner, key } = await setUp();
    expect(key).toMatch(/^ncat_[A-Za-z0-9_-]{40,}$/);
    const { keys, canEdit } = await owner.as.query(api.mcpKeys.list, { organizationId: team });
    expect(canEdit).toBe(true);
    expect(keys).toEqual([
      expect.objectContaining({ name: "Claude on my laptop", hint: key.slice(-4), lastUsedAt: null }),
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
      serverInfo: { name: "ncat-dash" },
    });
    const notified = await t.fetch("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(notified.status).toBe(202);
    const listed = await rpc(t, key, "tools/list");
    const names = (listed.body.result.tools as { name: string; annotations: { readOnlyHint: boolean } }[]).map(
      (tool) => [tool.name, tool.annotations.readOnlyHint],
    );
    expect(names).toEqual([
      ["list_automations", true],
      ["list_uploads", true],
      ["start_automation", false],
      ["check_run", true],
      ["list_runs", true],
    ]);
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
    expect(reach).toMatchObject({ isError: true, text: expect.stringMatching(/no automation with that id/) });
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
    expect(run).toMatchObject({ triggerKind: "manual", trigger: { file_url: `upload:${uploadId}` } });

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
    expect(checked.data).toMatchObject({ status: "done", files: ["https://files.example/caption.mp4"] });

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
    const got = await t.fetch("/mcp", { method: "GET", headers: { authorization: `Bearer ${key}` } });
    expect(got.status).toBe(405);
  });
});
