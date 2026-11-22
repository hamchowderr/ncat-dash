import { afterEach, describe, expect, test, vi } from "vitest";
import type { Doc } from "./_generated/dataModel";
import { signCallback } from "./lib/hooks";
import { addPerson, addTeam, backend } from "./test.setup";

type Node = Doc<"automations">["nodes"][number];

const TOKEN = "a-long-secret-hook-token";
const FILE = "https://files.example/in/interview.mp4";
const ADDRESS = "https://n8n.example/webhook/clips";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** An automation started by its webhook: Send to a URL, then a step that does nothing. */
async function setUp(url: string = ADDRESS) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const send: Node = { id: "send", kind: "send", input: { url }, position: { x: 0, y: 0 } };
  const after: Node = {
    id: "after",
    kind: "step",
    stepId: "video-trim",
    input: {},
    position: { x: 220, y: 0 },
    off: true,
  };
  const automationId = await t.run((ctx) =>
    ctx.db.insert("automations", {
      organizationId: team,
      name: "Hand to n8n",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [send, after],
      edges: [{ id: "e1", source: "send", target: "after" }],
      hookToken: TOKEN,
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    }),
  );
  const start = () =>
    t.fetch(`/automations/hook?id=${automationId}&token=${TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_url: FILE, title: "Episode 4" }),
    });
  const state = () =>
    t.run(async (ctx) => {
      const run = (await ctx.db.query("runs").first())!;
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .collect();
      return { run, send: steps.find((step) => step.nodeId === "send")! };
    });
  return { t, automationId, start, state };
}

describe("Send to a URL", () => {
  test("posts the files it is given, signed, and hands them on", async () => {
    vi.useFakeTimers();
    const posted: { url: string; body: string; signature: string | null }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      posted.push({
        url: String(input),
        body: String(init?.body),
        signature: new Headers(init?.headers).get("x-takewon-signature"),
      });
      return new Response(null, { status: 200 });
    });
    const { t, automationId, start, state } = await setUp();
    await start();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe(ADDRESS);
    const { run, send } = await state();
    expect(JSON.parse(posted[0].body)).toEqual({
      run_id: run._id,
      automation_id: automationId,
      automation: "Hand to n8n",
      step: "Send to a URL",
      files: [FILE],
      trigger: { file_url: FILE, body: { file_url: FILE, title: "Episode 4" } },
    });
    expect(posted[0].signature).toBe(`sha256=${await signCallback(posted[0].body, TOKEN)}`);
    expect(send.status).toBe("done");
    expect(send.outputs).toEqual([FILE]);
    expect(run.status).toBe("done");
  });

  test("an address that does not answer is tried again, then the step fails", async () => {
    vi.useFakeTimers();
    let tries = 0;
    vi.stubGlobal("fetch", async () => {
      tries++;
      return new Response("down", { status: 503 });
    });
    const { t, start, state } = await setUp();
    await start();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(tries).toBe(4);
    const { run, send } = await state();
    expect(send.status).toBe("failed");
    expect(send.error).toBe("The address answered 503. It was tried 4 times.");
    expect(run.status).toBe("failed");
  });

  test("an address that answers on a later try carries on", async () => {
    vi.useFakeTimers();
    let tries = 0;
    vi.stubGlobal("fetch", async () => {
      tries++;
      if (tries === 1) throw new Error("connection refused");
      return new Response(null, { status: 204 });
    });
    const { t, start, state } = await setUp();
    await start();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(tries).toBe(2);
    expect((await state()).run.status).toBe("done");
  });

  test("a step whose address is not a link fails without posting", async () => {
    vi.useFakeTimers();
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const { t, start, state } = await setUp("ftp://files.example");
    await start();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetched).not.toHaveBeenCalled();
    expect((await state()).send.error).toBe("The address must start with http:// or https://.");
  });
});

describe("Send to a URL on a copy strangers sign up to", () => {
  test("never posts inside the server's own network", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OUTBOUND_PRIVATE", "block");
    const posted: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      posted.push(String(input));
      return new Response(null, { status: 200 });
    });
    const { t, start, state } = await setUp("http://convex:3210/api/run");
    await start();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(posted).toEqual([]);
    const { send } = await state();
    expect(send.status).toBe("failed");
    expect(send.error).toMatch(/private network/);
    vi.unstubAllEnvs();
  });
});
