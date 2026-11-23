import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { wordAlert } from "./lib/chatAlerts";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { signAgentToken } from "./reviewAgent";
import { addPerson, addTeam, backend } from "./test.setup";

// Someone writes "@Agent" in a review comment. Convex asks the agent server (stood in for
// here by a stubbed fetch) and writes its answer in the thread.

const CLIP = "https://files.example/opening_hello.mp4";
const AGENT_URL = "http://agent.example.test";
const SECRET = "review-agent-test-secret";

function headersOf(given: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(given).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function agentServer(reply: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const entry = {
        url: String(input),
        headers: headersOf(init?.headers),
        body: JSON.parse(String(init?.body ?? "{}")),
      };
      sent.push(entry);
      return await reply(entry);
    }),
  );
  return sent;
}

async function room() {
  process.env.AGENT_URL = AGENT_URL;
  process.env.MASTRA_JWT_SECRET = SECRET;
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const dev = await addPerson(t, "Dev Patel", [team]);
  const reviewId = await maya.as.mutation(api.reviews.create, {
    organizationId: team,
    title: "Weekly clips",
    urls: [CLIP],
  });
  const review = await maya.as.query(api.reviews.get, { reviewId });
  const clipId = review!.clips[0]._id;
  const ask = (as: typeof maya, body: string, parentId?: string) =>
    as.as.mutation(api.reviews.comment, {
      clipId,
      body,
      time: 2,
      version: 1,
      parentId: parentId as never,
    });
  const notes = () => maya.as.query(api.reviews.comments, { clipId });
  return { t, team, maya, dev, clipId, ask, notes };
}

async function settled(t: ReturnType<typeof backend>) {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENT_URL;
  delete process.env.MASTRA_JWT_SECRET;
});

describe("tagging the agent", () => {
  test("shows it thinking in the thread at once, then its answer", async () => {
    const { t, maya, ask, notes } = await room();
    const sent = agentServer(() => Response.json({ answer: "The logo is too small at 0:02." }));
    const rootId = await ask(maya, "@Agent is the logo too small here?");

    const thinking = (await notes()).find((note) => note.authorId === "agent");
    expect(thinking).toMatchObject({
      parentId: rootId,
      authorName: "Agent",
      body: "",
      agent: { askedBy: maya.id, state: "thinking" },
      mine: true,
    });

    await settled(t);
    const answer = (await notes()).find((note) => note.authorId === "agent");
    expect(answer).toMatchObject({
      body: "The logo is too small at 0:02.",
      agent: { state: "answered" },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`${AGENT_URL}/ncat/review-reply`);
    const question = sent[0].body.question as Record<string, unknown>;
    expect(question).toMatchObject({
      review: { title: "Weekly clips", status: "open" },
      clip: { title: "Opening hello", version: 1, versions: 1, url: CLIP, isVideo: true },
      moment: { seconds: 2, label: "0:02" },
      thread: [
        { author: "Maya Ortiz", body: "@Agent is the logo too small here?", isAgent: false },
      ],
      automation: null,
      askedBy: "Maya Ortiz",
    });
    // No toolkit is connected, so there is no still of the moment.
    expect(sent[0].body.still).toBeNull();
  });

  test("signs the request as the person who asked, with the shared secret", async () => {
    const { t, maya, ask } = await room();
    const sent = agentServer(() => Response.json({ answer: "Yes." }));
    await ask(maya, "@Agent quick one");
    await settled(t);
    const token = sent[0].headers.authorization.replace("Bearer ", "");
    const [head, payload, signature] = token.split(".");
    expect(JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))).toMatchObject({
      sub: maya.id,
    });
    const again = await signAgentToken(
      SECRET,
      maya.id,
      JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).iat * 1000,
    );
    expect(again).toBe(`${head}.${payload}.${signature}`);
  });

  test("a reply in a thread that tags the agent is answered in that thread, with the thread", async () => {
    const { t, maya, dev, ask, notes } = await room();
    const sent = agentServer(() => Response.json({ answer: "Answer" }));
    const rootId = await ask(maya, "The cut at 0:02 feels late");
    await ask(dev, "@Agent do you agree?", rootId);
    await settled(t);
    const answer = (await notes()).find((note) => note.authorId === "agent");
    expect(answer?.parentId).toBe(rootId);
    expect((sent[0].body.question as { thread: unknown[] }).thread).toEqual([
      { author: "Maya Ortiz", body: "The cut at 0:02 feels late", isAgent: false },
      { author: "Dev Patel", body: "@Agent do you agree?", isAgent: false },
    ]);
    expect((sent[0].body.question as { askedBy: string }).askedBy).toBe("Dev Patel");
    // The answer belongs to Dev, who asked: Maya cannot delete it.
    expect(answer?.mine).toBe(false);
  });

  test("a comment that does not tag the agent asks nothing", async () => {
    const { t, maya, ask, notes } = await room();
    const sent = agentServer(() => Response.json({ answer: "x" }));
    await ask(maya, "Mail agent@example.com about this");
    await settled(t);
    expect(sent).toHaveLength(0);
    expect(await notes()).toHaveLength(1);
  });

  test("says plainly when the agent is not set up, and the asker can ask again", async () => {
    const { t, maya, dev, ask, notes } = await room();
    delete process.env.AGENT_URL;
    await ask(maya, "@Agent hello?");
    await settled(t);
    const failed = (await notes()).find((note) => note.authorId === "agent")!;
    expect(failed.agent?.state).toBe("failed");
    expect(failed.body).toMatch(/not set up/);

    await expect(
      dev.as.mutation(api.reviews.askAgentAgain, { commentId: failed.id }),
    ).rejects.toThrow(/Only the person who asked/);
    process.env.AGENT_URL = AGENT_URL;
    agentServer(() => Response.json({ answer: "Here now." }));
    await maya.as.mutation(api.reviews.askAgentAgain, { commentId: failed.id });
    expect((await notes()).find((note) => note.id === failed.id)?.agent?.state).toBe("thinking");
    await settled(t);
    expect((await notes()).find((note) => note.id === failed.id)).toMatchObject({
      body: "Here now.",
      agent: { state: "answered" },
    });
  });

  test("an agent server that fails or is out of reach leaves a failed answer, not a hang", async () => {
    const { t, maya, ask, notes } = await room();
    agentServer(() => new Response("boom", { status: 502 }));
    await ask(maya, "@Agent one");
    await settled(t);
    expect((await notes()).find((note) => note.authorId === "agent")).toMatchObject({
      agent: { state: "failed" },
      body: expect.stringMatching(/could not answer/),
    });

    const second = await room();
    agentServer(() => {
      throw new TypeError("fetch failed");
    });
    await second.ask(second.maya, "@Agent two");
    await settled(second.t);
    expect((await second.notes()).find((note) => note.authorId === "agent")).toMatchObject({
      agent: { state: "failed" },
      body: expect.stringMatching(/could not be reached/),
    });
  });

  test("asks once per thread while it is still thinking", async () => {
    const { t, maya, ask, notes } = await room();
    const sent = agentServer(() => Response.json({ answer: "One answer" }));
    const rootId = await ask(maya, "@Agent first");
    await ask(maya, "@Agent hello?", rootId);
    expect((await notes()).filter((note) => note.authorId === "agent")).toHaveLength(1);
    await settled(t);
    expect(sent).toHaveLength(1);
  });

  test("the asker can delete the answer, and a deleted question takes it along", async () => {
    const { t, maya, ask, notes } = await room();
    agentServer(() => Response.json({ answer: "Gone soon" }));
    const rootId = await ask(maya, "@Agent tell me");
    await settled(t);
    const answer = (await notes()).find((note) => note.authorId === "agent")!;
    await maya.as.mutation(api.reviews.removeComment, { commentId: answer.id });
    expect(await notes()).toHaveLength(1);

    await ask(maya, "@Agent again", rootId);
    await maya.as.mutation(api.reviews.removeComment, { commentId: rootId });
    await settled(t);
    expect(await notes()).toEqual([]);
  });

  test("lets the agent see and hear the clip through the team's toolkit, and how the automation is built", async () => {
    process.env.AGENT_URL = AGENT_URL;
    process.env.MASTRA_JWT_SECRET = SECRET;
    process.env.CONNECTIONS_SECRET = "a-connections-secret-of-at-least-32-chars";
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team]);
    await t.run(async (ctx) => {
      await ctx.db.insert("toolkitConnections", {
        organizationId: team,
        baseUrl: "http://toolkit.example.test",
        apiKeyCipher: await encryptSecret("toolkit-key"),
        apiKeyHint: "-key",
        status: "ok",
        buildNumber: null,
        lastCheckedAt: Date.now(),
        lastError: null,
        createdBy: maya.id,
      });
      const automationId = await ctx.db.insert("automations", {
        organizationId: team,
        name: "Weekly clips",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [{ id: "approval", kind: "approval", input: {}, position: { x: 0, y: 0 } }],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      });
      const automation = await ctx.db.get(automationId);
      const started = await startRun(ctx, automation!, "webhook", { file_url: CLIP }, null);
      if (!started.ok) throw new Error(started.message);
    });
    const [listed] = await maya.as.query(api.reviews.list, { organizationId: team });
    const review = await maya.as.query(api.reviews.get, { reviewId: listed._id });
    const clipId = review!.clips[0]._id;

    const sent = agentServer(({ url }) => {
      const path = url.replace("http://toolkit.example.test", "");
      if (path === "/v1/video/thumbnail") {
        return Response.json({ code: 200, response: "https://files.example/still-0002.png" });
      }
      if (path === "/v1/code/execute/python") {
        return Response.json({
          code: 200,
          response: {
            result: {
              duration: 40,
              cuts: [1.5, 9, 30],
              loudness: -23.5,
              loudnessAtMoment: -31,
              silences: [{ start: 2, end: 3.2 }],
              hasAudio: true,
            },
          },
        });
      }
      if (path === "/v1/ffmpeg/compose") {
        return Response.json({
          code: 200,
          response: [
            { file_url: "https://files.example/frames.png" },
            { file_url: "https://files.example/near.mp3" },
          ],
        });
      }
      if (path === "/v1/media/transcribe") {
        return Response.json({
          code: 200,
          response: { segments: [{ start: 1.5, end: 3, text: " Welcome back to the station. " }] },
        });
      }
      return Response.json({ answer: "Seen it." });
    });
    await maya.as.mutation(api.reviews.comment, {
      clipId,
      body: "@Agent what is on screen?",
      time: 2.5,
      version: 1,
    });
    await settled(t);

    const toolkit = sent.filter((entry) => entry.url.startsWith("http://toolkit.example.test"));
    const byPath = (path: string) => toolkit.find((entry) => entry.url.endsWith(path))!;
    for (const entry of toolkit) expect(entry.headers["x-api-key"]).toBe("toolkit-key");
    expect(byPath("/v1/video/thumbnail").body).toMatchObject({ video_url: CLIP, second: 2.5 });
    // The clip's address goes into the measuring script as a JSON string.
    expect(byPath("/v1/code/execute/python").body.code).toContain(
      JSON.stringify(JSON.stringify(CLIP)),
    );
    // Frames from 0:00 to 0:06 around 0:02.5, and 30 seconds of sound for the transcript.
    const compose = byPath("/v1/ffmpeg/compose").body as {
      inputs: { file_url: string; options: { option: string; argument: unknown }[] }[];
      outputs: unknown[];
    };
    expect(compose.inputs.map((input) => input.options.map((o) => o.argument))).toEqual([
      [0, 6],
      [0, 30],
    ]);
    expect(compose.outputs).toHaveLength(2);
    expect(byPath("/v1/media/transcribe").body).toMatchObject({
      media_url: "https://files.example/near.mp3",
      include_segments: true,
    });

    const agent = sent.find((entry) => entry.url.startsWith(AGENT_URL))!;
    expect(agent.body.still).toBe("https://files.example/still-0002.png");
    expect(agent.body.frames).toBe("https://files.example/frames.png");
    expect(agent.body.sense).toEqual({
      frames: { from: 0, every: 0.5, count: 12 },
      pacing: { cuts: 3, averageShot: 10, shot: { start: 1.5, end: 9 }, cutsNear: [1.5, 9] },
      sound: {
        hasAudio: true,
        loudness: -23.5,
        loudnessAtMoment: -31,
        quietNear: [{ start: 2, end: 3.2 }],
      },
      transcript: [{ at: 1.5, text: "Welcome back to the station." }],
    });
    expect((agent.body.question as { automation: unknown }).automation).toMatchObject({
      name: "Weekly clips",
      runStatus: "waiting",
      outline: expect.stringContaining("approval [approval]"),
    });
    delete process.env.CONNECTIONS_SECRET;
  });

  test("a clip with no sound, too long to look through for cuts, gets the rest", async () => {
    process.env.CONNECTIONS_SECRET = "a-connections-secret-of-at-least-32-chars";
    const { t, team, maya, ask } = await room();
    await t.run(async (ctx) => {
      await ctx.db.insert("toolkitConnections", {
        organizationId: team,
        baseUrl: "http://toolkit.example.test",
        apiKeyCipher: await encryptSecret("toolkit-key"),
        apiKeyHint: "-key",
        status: "ok",
        buildNumber: null,
        lastCheckedAt: Date.now(),
        lastError: null,
        createdBy: maya.id,
      });
    });
    const sent = agentServer(({ url }) => {
      if (url.endsWith("/v1/video/thumbnail")) return new Response("busy", { status: 503 });
      if (url.endsWith("/v1/code/execute/python")) {
        return Response.json({
          response: {
            result: {
              duration: 3600,
              cuts: null,
              loudness: null,
              loudnessAtMoment: null,
              silences: [],
              hasAudio: false,
            },
          },
        });
      }
      if (url.endsWith("/v1/ffmpeg/compose")) {
        return Response.json({ response: [{ file_url: "https://files.example/frames.png" }] });
      }
      return Response.json({ answer: "Seen it." });
    });
    await ask(maya, "@Agent does this move too fast?");
    await settled(t);

    const compose = sent.find((entry) => entry.url.endsWith("/v1/ffmpeg/compose"))!.body as {
      inputs: unknown[];
      outputs: unknown[];
    };
    expect(compose.inputs).toHaveLength(1);
    expect(compose.outputs).toHaveLength(1);
    expect(sent.some((entry) => entry.url.endsWith("/v1/media/transcribe"))).toBe(false);
    const agent = sent.find((entry) => entry.url.startsWith(AGENT_URL))!;
    expect(agent.body.still).toBeNull();
    expect(agent.body.frames).toBe("https://files.example/frames.png");
    expect(agent.body.sense).toEqual({
      frames: { from: 0, every: 0.5, count: 12 },
      pacing: null,
      sound: { hasAudio: false, loudness: null, loudnessAtMoment: null, quietNear: [] },
      transcript: null,
    });
    delete process.env.CONNECTIONS_SECRET;
  });
});

describe("when the agent's answer lands", () => {
  const alertsOf = (t: ReturnType<typeof backend>) =>
    t.run((ctx) => ctx.db.query("alerts").collect());

  test("tells only the person who asked, in the Inbox, linked to the thread", async () => {
    const { t, team, maya, dev, clipId, ask } = await room();
    agentServer(() => Response.json({ answer: "  The logo is too small at 0:02.  " }));
    const rootId = await ask(maya, "@Agent is the logo too small here?");
    // Nothing yet while it is thinking.
    expect(await alertsOf(t)).toEqual([]);

    await settled(t);
    const [alert, ...others] = await alertsOf(t);
    expect(others).toEqual([]);
    expect(alert).toMatchObject({
      kind: "agent_answer",
      recipients: [maya.id],
      from: "Agent",
      automationName: "Weekly clips",
      message: "The logo is too small at 0:02.",
      commentId: rootId,
      clipId,
    });
    const mayas = await maya.as.query(api.alerts.list, { organizationId: team });
    expect(mayas.alerts[0].href).toBe(`/review/${alert.reviewId}?clip=${clipId}&comment=${rootId}`);
    expect((await dev.as.query(api.alerts.list, { organizationId: team })).alerts).toEqual([]);
  });

  test("a question asked in a reply is answered to whoever asked it, linked to the thread", async () => {
    const { t, maya, dev, ask } = await room();
    agentServer(() => Response.json({ answer: "Yes, trim a second." }));
    const rootId = await ask(maya, "Opening feels slow.");
    await ask(dev, "@Agent should we trim it?", rootId);
    await settled(t);
    const answers = (await alertsOf(t)).filter((alert) => alert.kind === "agent_answer");
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ recipients: [dev.id], commentId: rootId });
  });

  test("is emailed unless the person switched those emails off", async () => {
    const { t, team, maya, dev, ask } = await room();
    agentServer(() => Response.json({ answer: "Looks fine." }));
    await ask(maya, "@Agent ok?");
    await ask(dev, "@Agent and this?");
    await dev.as.mutation(api.notifications.set, {
      organizationId: team,
      kind: "agent_answer",
      channel: "email",
      enabled: false,
    });
    await settled(t);
    const alerts = await alertsOf(t);
    const forMaya = alerts.find((alert) => alert.recipients?.includes(maya.id))!;
    const forDev = alerts.find((alert) => alert.recipients?.includes(dev.id))!;
    expect(
      (await t.query(internal.email.alertRecipients, { alertId: forMaya._id }))?.recipients,
    ).toEqual(["maya.ortiz@example.test"]);
    expect(
      (await t.query(internal.email.alertRecipients, { alertId: forDev._id }))?.recipients ?? [],
    ).toEqual([]);
  });

  test("switched off for the Inbox is not shown there", async () => {
    const { t, team, maya, ask } = await room();
    await maya.as.mutation(api.notifications.set, {
      organizationId: team,
      kind: "agent_answer",
      channel: "bell",
      enabled: false,
    });
    agentServer(() => Response.json({ answer: "Fine." }));
    await ask(maya, "@Agent ok?");
    await settled(t);
    expect(await alertsOf(t)).toHaveLength(1);
    expect((await maya.as.query(api.alerts.list, { organizationId: team })).alerts).toEqual([]);
  });

  test("a failed try tells nobody; the thread already says so", async () => {
    const { t, maya, ask } = await room();
    agentServer(() => new Response("boom", { status: 502 }));
    await ask(maya, "@Agent one");
    await settled(t);
    expect(await alertsOf(t)).toEqual([]);
  });

  test("reads the same in the chat apps", async () => {
    const { t, maya, ask } = await room();
    agentServer(() => Response.json({ answer: "Cut at 0:03." }));
    await ask(maya, "@Agent where should I cut?");
    await settled(t);
    const [alert] = await alertsOf(t);
    expect(wordAlert(alert, "https://dash.example/review")).toMatchObject({
      title: "The agent answered you in Weekly clips",
      lines: ["Cut at 0:03."],
      linkLabel: "Open the review",
    });
  });
});
