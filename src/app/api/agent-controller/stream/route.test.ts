import { afterEach, describe, expect, test, vi } from "vitest";

import { TRIAL_ENDED_REPLY } from "@/lib/trial";

const calls = vi.hoisted(() => ({ status: vi.fn(), forward: vi.fn() }));
vi.mock("@/lib/auth-server", () => ({ fetchAuthMutation: calls.status }));
vi.mock("@/lib/mastra-proxy", () => ({ forward: calls.forward }));

import { POST } from "./route";

const withTeam = (organizationId: string | null) =>
  new Request("http://localhost/api/agent-controller/stream", {
    method: "POST",
    body: "{}",
    headers: organizationId
      ? {
          cookie: `ncat_agent_context=${encodeURIComponent(
            JSON.stringify({ organizationId, automationId: null }),
          )}`,
        }
      : {},
  });

afterEach(() => {
  calls.status.mockReset();
  calls.forward.mockReset();
});

describe("the agent during a free trial", () => {
  test("answers plainly, without the agent, once the team's trial is over", async () => {
    calls.status.mockResolvedValue({ ok: false, reason: "trial_ended", message: "over" });
    const response = await POST(withTeam("team_1"));
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: TRIAL_ENDED_REPLY });
    expect(calls.forward).not.toHaveBeenCalled();
  });

  test("goes to the agent during the trial, without one, or when the check fails", async () => {
    calls.forward.mockResolvedValue(new Response("ok"));
    calls.status.mockResolvedValueOnce({ ok: true });
    await POST(withTeam("team_1"));
    calls.status.mockResolvedValueOnce({ ok: true });
    await POST(withTeam("team_1"));
    calls.status.mockRejectedValueOnce(new Error("down"));
    await POST(withTeam("team_1"));
    await POST(withTeam(null));
    expect(calls.forward).toHaveBeenCalledTimes(4);
  });
});

describe("the agent for a blocked team, or someone sending a great many messages", () => {
  test("a blocked team or person is told why, and the agent is not asked", async () => {
    calls.status.mockResolvedValue({
      ok: false,
      reason: "team_blocked",
      message: "This team has been paused.",
    });
    const response = await POST(withTeam("team_1"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "This team has been paused." });
    expect(calls.forward).not.toHaveBeenCalled();
  });

  test("too many messages in a short time waits, with when to try again", async () => {
    calls.status.mockResolvedValue({
      ok: false,
      reason: "rate_limited",
      message: "Try again in about 3 minutes.",
    });
    const response = await POST(withTeam("team_1"));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Try again in about 3 minutes." });
    expect(calls.forward).not.toHaveBeenCalled();
  });
});
