import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock("../../src/lib/env", () => ({ env }));

import { chatChannels, onReviewMessage } from "../../src/mastra/ncat/channels";
import {
  discordThreadOf,
  onReviewReply,
  type ReplyAnswer,
  useDashboardForTests,
} from "../../src/mastra/ncat/review-replies";

// Replies in a review's Discord thread: each plain message in a Discord thread is handed
// to the dashboard, which keeps the ones in its review threads. The agent never answers.

afterEach(() => {
  useDashboardForTests();
  for (const key of Object.keys(env)) delete env[key];
});

function message(text = "Two more seconds, done.", isBot = false) {
  return {
    id: "m1",
    text,
    raw: {},
    author: { userId: "200", isBot, isMe: false },
  } as never;
}
function thread(id = "discord:300:400:500") {
  return { id, post: vi.fn(async () => undefined) };
}

describe("review replies from Discord", () => {
  it("reads the server and thread out of the Chat SDK id", () => {
    expect(discordThreadOf("discord:300:400:500")).toEqual({ guildId: "300", threadId: "500" });
    expect(discordThreadOf("discord:300:400")).toBeNull();
    expect(discordThreadOf("discord:@me:400:500")).toBeNull();
    expect(discordThreadOf("slack:T1:C1:1.2")).toBeNull();
  });

  it("hands a teammate reply in a thread to the dashboard, and says nothing", async () => {
    const asked: Record<string, string>[] = [];
    useDashboardForTests(async (body) => {
      asked.push(body);
      return { kind: "added" } satisfies ReplyAnswer;
    });
    const where = thread();
    const next = vi.fn();
    await onReviewReply(where as never, message(), next, {} as never);
    expect(asked).toEqual([
      {
        guildId: "300",
        threadId: "500",
        messageId: "m1",
        discordUserId: "200",
        text: "Two more seconds, done.",
      },
    ]);
    expect(where.post).not.toHaveBeenCalled();
    // The agent is never run for these.
    expect(next).not.toHaveBeenCalled();
  });

  it("tells someone who has not linked their Discord that their reply stays there", async () => {
    useDashboardForTests(async () => ({ kind: "not_linked", message: "Link your Discord." }));
    const where = thread();
    await onReviewReply(where as never, message(), vi.fn(), {} as never);
    expect(where.post).toHaveBeenCalledWith("Link your Discord.");
  });

  it("leaves bots, channel messages outside a thread, and other apps alone", async () => {
    const asked = vi.fn();
    useDashboardForTests(asked);
    await onReviewReply(thread() as never, message("hi", true), vi.fn(), {} as never);
    await onReviewReply(thread("discord:300:400") as never, message(), vi.fn(), {} as never);
    await onReviewReply(thread("slack:T1:C1:1.2") as never, message(), vi.fn(), {} as never);
    expect(asked).not.toHaveBeenCalled();
  });

  it("is what the chat channels use for plain messages once Discord is set up", () => {
    Object.assign(env, {
      DISCORD_BOT_TOKEN: "bot",
      DISCORD_APPLICATION_ID: "1",
      DISCORD_PUBLIC_KEY: "a".repeat(64),
      MASTRA_JWT_SECRET: "secret",
      CONVEX_SITE_URL: "https://convex.test",
    });
    expect(chatChannels()?.handlers?.onMessage).toBe(onReviewMessage);
  });
});
