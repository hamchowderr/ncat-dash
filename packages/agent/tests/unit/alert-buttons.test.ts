import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock("../../src/lib/env", () => ({ env }));

import {
  onAlertButton,
  type PressAnswer,
  useDashboardForTests,
} from "../../src/mastra/ncat/alert-buttons";
import { chatChannels, onChatAlertButton } from "../../src/mastra/ncat/channels";

// Approve and Send back on the dashboard's alerts in Discord: the press goes to the
// dashboard as the Discord user who pressed it, and every other button is left alone.

afterEach(() => {
  useDashboardForTests();
  for (const key of Object.keys(env)) delete env[key];
});

function press(actionId: string, threadId = "discord:@me:500", value = "step1") {
  const post = vi.fn(async () => undefined);
  return {
    event: {
      actionId,
      value,
      threadId,
      messageId: "m1",
      user: { userId: "200", userName: "ada", fullName: "Ada", isBot: false, isMe: false },
      thread: { post },
    } as never,
    post,
  };
}

describe("alert buttons in Discord", () => {
  it("hands an Approve press to the dashboard as the person who pressed it", async () => {
    const asked: Record<string, string>[] = [];
    useDashboardForTests(async (body) => {
      asked.push(body);
      return { ok: true, message: "Approved." } satisfies PressAnswer;
    });
    const fallback = vi.fn(async () => undefined);
    const { event, post } = press("ncat_alert_approve");
    await onAlertButton(event, fallback, {} as never);
    expect(asked).toEqual([{ runStepId: "step1", discordUserId: "200", decision: "approve" }]);
    expect(fallback).not.toHaveBeenCalled();
    // The dashboard edits the message itself when it worked.
    expect(post).not.toHaveBeenCalled();
  });

  it("says why when nothing was decided", async () => {
    useDashboardForTests(async () => ({ ok: false, message: "Someone already decided this." }));
    const { event, post } = press("ncat_alert_send_back");
    await onAlertButton(event, vi.fn(), {} as never);
    expect(post).toHaveBeenCalledWith("Someone already decided this.");
  });

  it("says so when the dashboard cannot be reached", async () => {
    useDashboardForTests(async () => null);
    const { event, post } = press("ncat_alert_approve");
    await onAlertButton(event, vi.fn(), {} as never);
    expect(post).toHaveBeenCalledWith(expect.stringContaining("can't reach the dashboard"));
  });

  it("leaves the agent's own buttons, and other apps, to the default handler", async () => {
    const asked = vi.fn();
    useDashboardForTests(asked);
    for (const [actionId, threadId] of [
      ["tool_approve:call_1", "discord:@me:500"],
      ["ncat_alert_approve", "slack:T1:C1:1.2"],
    ]) {
      const fallback = vi.fn(async () => undefined);
      await onAlertButton(press(actionId, threadId).event, fallback, {} as never);
      expect(fallback).toHaveBeenCalledOnce();
    }
    expect(asked).not.toHaveBeenCalled();
  });

  it("is what the chat channels use for button presses", () => {
    Object.assign(env, {
      DISCORD_BOT_TOKEN: "bot",
      DISCORD_APPLICATION_ID: "1",
      DISCORD_PUBLIC_KEY: "a".repeat(64),
      MASTRA_JWT_SECRET: "secret",
      CONVEX_SITE_URL: "https://convex.test",
    });
    expect(chatChannels()?.handlers?.onAction).toBe(onChatAlertButton);
  });
});
