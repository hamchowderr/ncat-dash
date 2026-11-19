import { RequestContext } from "@mastra/core/request-context";
import { afterEach, describe, expect, it } from "vitest";
import { TURN_USER_KEY } from "../../src/mastra/lib/turn-user";
import { forgetSessions, rememberSession } from "../../src/mastra/ncat/session-store";
import {
  onTeamKey,
  teamKey,
  teamKeyForTurn,
  useTeamKeysForTests,
} from "../../src/mastra/ncat/team-key";

/** A team's own Anthropic key, read from the dashboard (ncat/team-key.ts). */

afterEach(() => {
  useTeamKeysForTests();
  forgetSessions();
});

describe("team keys", () => {
  it("reads a team key once a minute, and has none for a team without one", async () => {
    const asked: string[] = [];
    useTeamKeysForTests(async (team) => {
      asked.push(team);
      return team === "team_1" ? "sk-ant-team-one" : null;
    });
    expect(await teamKey("team_1")).toBe("sk-ant-team-one");
    expect(await teamKey("team_1")).toBe("sk-ant-team-one");
    expect(await teamKey("team_2")).toBeNull();
    expect(await teamKey(undefined)).toBeNull();
    expect(asked).toEqual(["team_1", "team_2"]);
  });

  it("keeps using the server key when the dashboard cannot be read", async () => {
    useTeamKeysForTests(async () => undefined);
    expect(await teamKey("team_1")).toBeNull();
  });

  it("finds the key of the team the turn's person is working in", async () => {
    useTeamKeysForTests(async (team) => (team === "team_1" ? "sk-ant-team-one" : null));
    rememberSession("user_1", {
      convexToken: "token",
      organizationId: "team_1",
      automationId: null,
    });
    const requestContext = new RequestContext();
    requestContext.set(TURN_USER_KEY, "user_1");
    expect(await teamKeyForTurn(requestContext)).toBe("sk-ant-team-one");
    expect(await teamKeyForTurn(new RequestContext())).toBeNull();
  });

  it("puts only Anthropic models on the team key", () => {
    expect(onTeamKey("anthropic/claude-sonnet-5-5", "sk-ant-x")).toEqual({
      id: "anthropic/claude-sonnet-5-5",
      apiKey: "sk-ant-x",
    });
    expect(onTeamKey("anthropic/claude-sonnet-5-5", null)).toBe("anthropic/claude-sonnet-5-5");
    expect(onTeamKey("openai/gpt-4.1-mini", "sk-ant-x")).toBe("openai/gpt-4.1-mini");
  });
});
