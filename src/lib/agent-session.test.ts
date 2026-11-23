// @vitest-environment node
import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getToken = vi.fn<() => Promise<string | undefined>>();
vi.mock("@/lib/auth-server", () => ({ getToken: () => getToken() }));

const { agentUserFor, chatOwnerId, readAgentContext } = await import("./agent-session");

const SECRET = "a-test-secret-a-test-secret-a-test-secret";
const jwt = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.signature-signature`;
const cookie = (value: unknown) =>
  `theme=dark; ncat_agent_context=${encodeURIComponent(JSON.stringify(value))}`;
const request = (cookieHeader?: string) =>
  new Request("http://localhost:3000/api/agent-controller/stream", {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });

let posts: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  posts = [];
  vi.stubEnv("MASTRA_JWT_SECRET", SECRET);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      posts.push({
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body)),
      });
      return new Response("{}", { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  getToken.mockReset();
});

describe("reading what is on screen from the cookie", () => {
  test("takes the team and the automation", () => {
    expect(readAgentContext(cookie({ organizationId: "team_1", automationId: "a1" }))).toEqual({
      organizationId: "team_1",
      automationId: "a1",
      screen: null,
    });
  });

  test("takes the one thing on screen, when it is a kind the agent knows", () => {
    const read = (screen: unknown) =>
      readAgentContext(cookie({ organizationId: "team_1", automationId: null, screen })).screen;
    expect(read({ kind: "library", id: "item7" })).toEqual({ kind: "library", id: "item7" });
    expect(read({ kind: "settings", id: "agent" })).toBeNull();
    expect(read({ kind: "run", id: "x".repeat(300) })).toBeNull();
    expect(read("run")).toBeNull();
  });

  test("is empty for a missing, broken or oversized cookie", () => {
    const empty = { organizationId: null, automationId: null, screen: null };
    expect(readAgentContext(null)).toEqual(empty);
    expect(readAgentContext("ncat_agent_context=not-json")).toEqual(empty);
    expect(readAgentContext(cookie({ organizationId: 7, automationId: "x".repeat(300) }))).toEqual(
      empty,
    );
  });
});

describe("who a chat request is for", () => {
  test("nobody, when no one is signed in", async () => {
    getToken.mockResolvedValue(undefined);
    expect(await agentUserFor(request())).toBeNull();
    expect(posts).toEqual([]);
  });

  test("nobody, when the shared secret is not set, and nothing is handed over", async () => {
    vi.stubEnv("MASTRA_JWT_SECRET", "");
    getToken.mockResolvedValue(jwt("user_1"));
    expect(await agentUserFor(request())).toBeNull();
    expect(posts).toEqual([]);
  });

  test("the signed-in person, whose token and screen are handed to the agent, signed", async () => {
    const token = jwt("user_2");
    getToken.mockResolvedValue(token);
    const who = await agentUserFor(
      request(cookie({ organizationId: "team_1", automationId: "a1" })),
    );
    expect(who).toBe("user_2~team_1");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe("http://localhost:4111/ncat/session");
    expect(posts[0]?.body).toEqual({
      convexToken: token,
      organizationId: "team_1",
      automationId: "a1",
      screen: null,
    });
    // Signed for that person with the shared secret, so the agent server can trust it.
    const [head, payload, signature] = (posts[0]?.headers.get("authorization") ?? "")
      .replace("Bearer ", "")
      .split(".");
    expect(JSON.parse(Buffer.from(payload ?? "", "base64url").toString()).sub).toBe(
      "user_2~team_1",
    );
    expect(signature).toBe(
      createHmac("sha256", SECRET).update(`${head}.${payload}`).digest("base64url"),
    );
  });

  test("hands over again only when something changed", async () => {
    getToken.mockResolvedValue(jwt("user_3"));
    const open = (automationId: string | null) =>
      agentUserFor(request(cookie({ organizationId: "team_1", automationId })));
    await open("a1");
    await open("a1");
    expect(posts).toHaveLength(1);
    await open("a2");
    expect(posts).toHaveLength(2);
    expect(posts[1]?.body.automationId).toBe("a2");
  });

  test("keeps one person's chats on different teams apart", async () => {
    getToken.mockResolvedValue(jwt("user_5"));
    const onTeam = (organizationId: string | null) =>
      agentUserFor(request(cookie({ organizationId, automationId: null })));
    expect(await onTeam("team_1")).toBe("user_5~team_1");
    expect(await onTeam("team_2")).toBe("user_5~team_2");
    // No team open: the person alone.
    expect(await onTeam(null)).toBe("user_5");
    // Each is handed over on its own, so the agent knows which team each one acts in.
    expect(posts.map((post) => post.body.organizationId)).toEqual(["team_1", "team_2", null]);
  });

  test("the chat owner is the person and the team", () => {
    expect(chatOwnerId("user_1", "team_1")).toBe("user_1~team_1");
    expect(chatOwnerId("user_1", null)).toBe("user_1");
  });

  test("still answers when the agent server is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    getToken.mockResolvedValue(jwt("user_4"));
    expect(await agentUserFor(request())).toBe("user_4");
  });
});
