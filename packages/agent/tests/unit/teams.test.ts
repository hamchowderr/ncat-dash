import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  CONVEX_URL: undefined as string | undefined,
  CONVEX_SITE_URL: undefined as string | undefined,
  MASTRA_JWT_SECRET: undefined as string | undefined,
  SLACK_API_URL: undefined as string | undefined,
  DISCORD_BOT_TOKEN: undefined as string | undefined,
  DISCORD_APPLICATION_ID: undefined as string | undefined,
  DISCORD_PUBLIC_KEY: undefined as string | undefined,
  DISCORD_API_URL: undefined as string | undefined,
  TEAMS_APP_ID: undefined as string | undefined,
  TEAMS_APP_PASSWORD: undefined as string | undefined,
  TEAMS_APP_TENANT_ID: undefined as string | undefined,
  TEAMS_APP_NAME: undefined as string | undefined,
}));
vi.mock("../../src/lib/env", () => ({ env }));

import { TURN_USER_KEY } from "../../src/mastra/lib/turn-user";
import {
  byPlatform,
  chatChannels,
  onChatAlertButton,
  onReviewMessage,
} from "../../src/mastra/ncat/channels";
import { forgetSessions, sessionOf } from "../../src/mastra/ncat/session-store";
import {
  asTheTeamsWriter,
  onTeamsAlertButton,
  questionFor,
  refusalText,
  reviewQuestionFor,
  type TeamsPerson,
  teamsReady,
  teamsReviewRepliesOnly,
  useDashboardForTests,
  usePressDashboardForTests,
  useReviewDashboardForTests,
} from "../../src/mastra/ncat/teams";

// The agent in Microsoft Teams, on the dashboard's one bot: who wrote (their Microsoft
// account and organization), which Teams team it was in, and that the agent acts as them.

afterEach(() => {
  useDashboardForTests();
  usePressDashboardForTests();
  useReviewDashboardForTests();
  forgetSessions();
  for (const key of Object.keys(env) as (keyof typeof env)[]) env[key] = undefined;
});

const IN_A_CHANNEL = {
  serviceUrl: "https://smba.trafficmanager.net/amer/",
  from: { id: "29:abc", aadObjectId: "aad-ada" },
  conversation: { id: "19:edits@thread.tacv2", tenantId: "tenant-1" },
  channelData: {
    tenant: { id: "tenant-1" },
    team: { id: "19:team@thread.tacv2", name: "Video team" },
  },
};

function message(raw: object = IN_A_CHANNEL, isBot = false) {
  return { raw, author: { userId: "29:abc", isBot, isMe: false } } as never;
}
function thread(id = "teams:abc:def") {
  return { id, post: vi.fn(async () => undefined) };
}
function context() {
  const values = new Map<string, unknown>();
  return { requestContext: { set: (k: string, v: unknown) => values.set(k, v) }, values };
}
const ADA: TeamsPerson = {
  ok: true,
  userId: "u1",
  name: "Ada",
  organizationId: "team_1",
  convexToken: "jwt-ada",
};

describe("what the dashboard is asked about a Teams message", () => {
  it("names the Microsoft account, organization and the Teams team it was in", () => {
    expect(questionFor(IN_A_CHANNEL)).toEqual({
      tenantId: "tenant-1",
      aadObjectId: "aad-ada",
      teamId: "19:team@thread.tacv2",
      teamName: "Video team",
      serviceUrl: "https://smba.trafficmanager.net/amer/",
    });
  });

  it("leaves the team out of a direct message, and gives up without an account", () => {
    expect(
      questionFor({
        from: { aadObjectId: "aad-ada" },
        channelData: { tenant: { id: "tenant-1" } },
      }),
    ).toEqual({ tenantId: "tenant-1", aadObjectId: "aad-ada" });
    expect(questionFor({ from: {} })).toBeNull();
    expect(questionFor(undefined)).toBeNull();
  });
});

describe("who the agent works for in Teams", () => {
  it("acts as the linked teammate who wrote", async () => {
    const asked: Record<string, string>[] = [];
    useDashboardForTests(async (body) => {
      asked.push(body);
      return ADA;
    });
    const t = thread();
    const ctx = context();
    const next = vi.fn(async () => undefined);
    await asTheTeamsWriter(t as never, message(), next, ctx as never);
    expect(asked[0]).toMatchObject({ tenantId: "tenant-1", aadObjectId: "aad-ada" });
    expect(next).toHaveBeenCalledOnce();
    const resource = `channel:${t.id}`;
    expect(ctx.values.get(TURN_USER_KEY)).toBe(resource);
    expect(sessionOf(resource)).toMatchObject({ convexToken: "jwt-ada", organizationId: "team_1" });
  });

  it("tells someone who has not linked their Microsoft account how to, and does nothing else", async () => {
    useDashboardForTests(async () => ({ ok: false, reason: "not_linked" }));
    const t = thread();
    const next = vi.fn();
    await asTheTeamsWriter(t as never, message(), next, context() as never);
    expect(next).not.toHaveBeenCalled();
    expect(t.post).toHaveBeenCalledWith(expect.stringContaining("Link my Microsoft account"));
  });

  it("passes on the dashboard's own words when it says no", async () => {
    const said = "Your free trial has ended, so nothing new starts.";
    useDashboardForTests(async () => ({ ok: false, reason: "refused", message: said }));
    const t = thread();
    await asTheTeamsWriter(t as never, message(), vi.fn(), context() as never);
    expect(t.post).toHaveBeenCalledWith(said);
  });

  it("ignores bots, and says so plainly when it cannot tell who wrote", async () => {
    const asked = vi.fn(async () => ADA);
    useDashboardForTests(asked);
    const t = thread();
    await asTheTeamsWriter(t as never, message(IN_A_CHANNEL, true), vi.fn(), context() as never);
    expect(t.post).not.toHaveBeenCalled();
    await asTheTeamsWriter(t as never, message({}), vi.fn(), context() as never);
    expect(asked).not.toHaveBeenCalled();
    expect(t.post).toHaveBeenCalledWith(expect.stringContaining("can't reach the dashboard"));
  });

  it("every refusal is in plain words", () => {
    expect(refusalText({ ok: false, reason: "not_connected" })).toMatch(/not linked to a team/);
    expect(refusalText(ADA)).toBe("");
  });
});

describe("which chat app a message goes through", () => {
  it("sends a Teams thread to the Teams writer check", async () => {
    useDashboardForTests(async () => ({ ok: false, reason: "not_connected" }));
    const t = thread("teams:abc:def");
    await byPlatform(t as never, message(), vi.fn(), context() as never);
    expect(t.post).toHaveBeenCalledWith(expect.stringContaining("not linked to a team"));
  });

  usePressDashboardForTests();
  useReviewDashboardForTests();
    expect(teamsReady()).toBe(false);
    expect(chatChannels()).toBeUndefined();
    env.TEAMS_APP_ID = "c4d4ec4e-0000-0000-0000-000000000001";
    env.TEAMS_APP_PASSWORD = "a-bot-password";
    env.MASTRA_JWT_SECRET = "the-agent-shared-secret-of-at-least-32-chars";
    env.CONVEX_SITE_URL = "https://site.test";
    expect(teamsReady()).toBe(true);
    env.TEAMS_APP_TENANT_ID = "11111111-2222-3333-4444-555555555555";
    expect(Object.keys(chatChannels()?.adapters ?? {})).toContain("teams");
  });
});

describe("Approve and Send back pressed on a Teams alert card", () => {
  function pressed(actionId: string, threadId = "teams:abc:def", raw: object = IN_A_CHANNEL) {
    const post = vi.fn(async () => undefined);
    return {
      event: {
        actionId,
        value: "step-1",
        threadId,
        user: { userId: "29:abc", isBot: false },
        raw,
        thread: { post },
      } as never,
      post,
    };
  }

  it("hands the press to the dashboard with who pressed it, and says nothing when it worked", async () => {
    const asked: Record<string, string>[] = [];
    usePressDashboardForTests(async (body) => {
      asked.push(body);
      return { ok: true, message: "Approved." };
    });
    const { event, post } = pressed("ncat_alert_approve");
    const next = vi.fn(async () => undefined);
    await onTeamsAlertButton(event, next, {} as never);
    expect(asked).toEqual([
      { tenantId: "tenant-1", aadObjectId: "aad-ada", runStepId: "step-1", decision: "approve" },
    ]);
    expect(next).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("tells the presser the dashboard's answer when it did not work", async () => {
    usePressDashboardForTests(async () => ({
      ok: false,
      message: "Someone has already decided this.",
    }));
    const { event, post } = pressed("ncat_alert_send_back");
    await onTeamsAlertButton(event, vi.fn(), {} as never);
    expect(post).toHaveBeenCalledWith("Someone has already decided this.");
  });

  it("leaves other buttons, and other apps' presses, to the default handler", async () => {
    const asked = vi.fn(async () => ({ ok: true, message: "" }));
    usePressDashboardForTests(asked);
    for (const [actionId, threadId] of [
      ["tool_approve", "teams:abc:def"],
      ["ncat_alert_approve", "discord:1:2"],
    ]) {
      const next = vi.fn(async () => undefined);
      await onTeamsAlertButton(pressed(actionId, threadId).event, next, {} as never);
      expect(next).toHaveBeenCalledOnce();
    }
    expect(asked).not.toHaveBeenCalled();
  });

  it("is wired in only when Teams is set up", () => {
    env.TEAMS_APP_ID = "c4d4ec4e-0000-0000-0000-000000000001";
    env.TEAMS_APP_PASSWORD = "a-bot-password";
    env.MASTRA_JWT_SECRET = "the-agent-shared-secret-of-at-least-32-chars";
    env.CONVEX_SITE_URL = "https://site.test";
    expect(chatChannels()?.handlers?.onAction).toBe(onChatAlertButton);
  });

  it('a Teams press goes through the shared button handler to the dashboard', async () => {
    const asked = vi.fn(async () => ({ ok: true, message: 'Approved.' }));
    usePressDashboardForTests(asked);
    const next = vi.fn(async () => undefined);
    await onChatAlertButton(pressed('ncat_alert_approve').event, next, {} as never);
    expect(asked).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });
});

const IN_A_THREAD = {
  ...IN_A_CHANNEL,
  id: 'activity-7',
  text: '<at>Kontifi</at> looks good',
  conversation: { id: '19:edits@thread.tacv2;messageid=root-1', tenantId: 'tenant-1' },
};

function said(raw: object, text: string, isBot = false) {
  return { raw, text, author: { userId: '29:abc', isBot, isMe: false } } as never;
}

describe('replies in a Teams review thread', () => {
  it('names the channel, the thread, the message and the words', () => {
    expect(reviewQuestionFor(IN_A_THREAD, 'looks good')).toEqual({
      tenantId: 'tenant-1',
      aadObjectId: 'aad-ada',
      conversationId: '19:edits@thread.tacv2',
      rootActivityId: 'root-1',
      activityId: 'activity-7',
      text: 'looks good',
      botName: 'Kontifi',
    });
    // A message straight in the channel, not in a thread, is no reply.
    expect(reviewQuestionFor(IN_A_CHANNEL, 'hi')).toBeNull();
  });

  it('goes into the review and the agent does not answer', async () => {
    const asked: Record<string, string>[] = [];
    useReviewDashboardForTests(async (body) => {
      asked.push(body);
      return { handled: true, added: true, message: null };
    });
    const person = vi.fn(async () => ADA);
    useDashboardForTests(person);
    const t = thread();
    const next = vi.fn();
    await asTheTeamsWriter(t as never, said(IN_A_THREAD, 'looks good'), next, context() as never);
    expect(asked[0]).toMatchObject({ rootActivityId: 'root-1', activityId: 'activity-7' });
    expect(next).not.toHaveBeenCalled();
    expect(person).not.toHaveBeenCalled();
    expect(t.post).not.toHaveBeenCalled();
  });

  it('passes on what to tell someone whose reply stays in Teams', async () => {
    useReviewDashboardForTests(async () => ({
      handled: true,
      added: false,
      message: 'Your reply stays in Teams: link your Microsoft account.',
    }));
    const t = thread();
    await teamsReviewRepliesOnly(t as never, said(IN_A_THREAD, 'hi'), vi.fn(), context() as never);
    expect(t.post).toHaveBeenCalledWith(expect.stringContaining('stays in Teams'));
  });

  it('a thread that is not a review is left alone untagged, and answered when tagged', async () => {
    useReviewDashboardForTests(async () => ({ handled: false }));
    useDashboardForTests(async () => ADA);
    const t = thread();
    const next = vi.fn(async () => undefined);
    await teamsReviewRepliesOnly(t as never, said(IN_A_THREAD, 'hi'), next, context() as never);
    expect(next).not.toHaveBeenCalled();
    expect(t.post).not.toHaveBeenCalled();
    await asTheTeamsWriter(t as never, said(IN_A_THREAD, 'hi'), next, context() as never);
    expect(next).toHaveBeenCalledOnce();
  });

  it('untagged messages in other apps, and from bots, are never read', async () => {
    const asked = vi.fn(async () => ({ handled: true as const, added: true, message: null }));
    useReviewDashboardForTests(asked);
    await teamsReviewRepliesOnly(
      thread('slack:C1:1') as never,
      said(IN_A_THREAD, 'hi'),
      vi.fn(),
      context() as never,
    );
    await teamsReviewRepliesOnly(
      thread() as never,
      said(IN_A_THREAD, 'hi', true),
      vi.fn(),
      context() as never,
    );
    expect(asked).not.toHaveBeenCalled();
  });
});
