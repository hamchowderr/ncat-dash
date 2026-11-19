import { afterEach, describe, expect, test, vi } from "vitest";

import { TRIAL_ENDED_REPLY } from "@/lib/trial";

const calls = vi.hoisted(() => ({ status: vi.fn(), forward: vi.fn() }));
vi.mock("@/lib/auth-server", () => ({ fetchAuthQuery: calls.status }));
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
    calls.status.mockResolvedValue({ kind: "ended", endsAt: 1, daysLeft: 0, buyUrl: null });
    const response = await POST(withTeam("team_1"));
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: TRIAL_ENDED_REPLY });
    expect(calls.forward).not.toHaveBeenCalled();
  });

  test("goes to the agent during the trial, without one, or when the check fails", async () => {
    calls.forward.mockResolvedValue(new Response("ok"));
    calls.status.mockResolvedValueOnce({ kind: "trial", endsAt: 1, daysLeft: 2, buyUrl: null });
    await POST(withTeam("team_1"));
    calls.status.mockResolvedValueOnce({ kind: "none" });
    await POST(withTeam("team_1"));
    calls.status.mockRejectedValueOnce(new Error("down"));
    await POST(withTeam("team_1"));
    await POST(withTeam(null));
    expect(calls.forward).toHaveBeenCalledTimes(4);
  });
});
