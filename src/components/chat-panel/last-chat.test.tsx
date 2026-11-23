import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UseAgentControllerChat } from "@/lib/agent-controller/use-agent-controller-chat";
import type { ThreadItem } from "@/lib/agent-controller/use-threads";

import { forgetLastChat, LAST_CHAT_KEY, useReopenLastChat } from "./last-chat";

const thread = (id: string): ThreadItem => ({
  id,
  title: id,
  archived: false,
  createdAt: "2026-11-23T00:00:00Z",
  updatedAt: "2026-11-23T00:00:00Z",
});

function controller(over: Partial<{ activeThreadId: string | null; messages: unknown[] }> = {}) {
  return {
    activeThreadId: over.activeThreadId ?? null,
    openThread: vi.fn(async () => ({ running: false, stale: false })),
    transcript: { messages: over.messages ?? [] },
  } as unknown as UseAgentControllerChat;
}

/** Closing the agent or reloading brings back the chat that was open. */
describe("reopening the last chat", () => {
  beforeEach(() => window.localStorage.clear());

  it("opens the chat that was open last once the list has it", () => {
    window.localStorage.setItem(LAST_CHAT_KEY, "t-2");
    const c = controller();
    const { rerender } = renderHook(({ threads }) => useReopenLastChat(c, threads), {
      initialProps: { threads: [] as ThreadItem[] },
    });
    expect(c.openThread).not.toHaveBeenCalled();
    rerender({ threads: [thread("t-1"), thread("t-2")] });
    expect(c.openThread).toHaveBeenCalledWith("t-2");
    rerender({ threads: [thread("t-1"), thread("t-2"), thread("t-3")] });
    expect(c.openThread).toHaveBeenCalledTimes(1);
  });

  it("never opens a chat that is not in this person's list (another team's)", () => {
    window.localStorage.setItem(LAST_CHAT_KEY, "other-team");
    const c = controller();
    renderHook(() => useReopenLastChat(c, [thread("t-1")]));
    expect(c.openThread).not.toHaveBeenCalled();
  });

  it("leaves a chat the person already started alone", () => {
    window.localStorage.setItem(LAST_CHAT_KEY, "t-1");
    const c = controller({ messages: [{ id: "local" }] });
    const { rerender } = renderHook(({ threads }) => useReopenLastChat(c, threads), {
      initialProps: { threads: [] as ThreadItem[] },
    });
    rerender({ threads: [thread("t-1")] });
    expect(c.openThread).not.toHaveBeenCalled();
  });

  it("remembers each chat as it opens, and New chat forgets it", () => {
    renderHook(() => useReopenLastChat(controller({ activeThreadId: "t-9", messages: [{}] }), []));
    expect(window.localStorage.getItem(LAST_CHAT_KEY)).toBe("t-9");
    forgetLastChat();
    expect(window.localStorage.getItem(LAST_CHAT_KEY)).toBeNull();
  });
});
