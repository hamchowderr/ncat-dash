"use client";

import { useEffect, useRef } from "react";

import type { UseAgentControllerChat } from "@/lib/agent-controller/use-agent-controller-chat";
import type { ThreadItem } from "@/lib/agent-controller/use-threads";

/** Where the panel remembers the chat it last had open (this browser only). */
export const LAST_CHAT_KEY = "takewon.agent.last-chat";

function read(): string | null {
  try {
    return window.localStorage.getItem(LAST_CHAT_KEY);
  } catch {
    return null;
  }
}

function write(id: string | null) {
  try {
    if (id) window.localStorage.setItem(LAST_CHAT_KEY, id);
    else window.localStorage.removeItem(LAST_CHAT_KEY);
  } catch {
    // Private windows and blocked storage: the panel just opens on a new chat.
  }
}

/**
 * Closing the agent, moving to another page or reloading brings back the chat that was open,
 * as other chat apps do, instead of a blank one. "New chat" starts fresh and is remembered
 * as such. The chat is reopened only if it is in this person's list for the team they have
 * open, so switching teams never opens another team's chat.
 */
export function useReopenLastChat(controller: UseAgentControllerChat, threads: ThreadItem[]) {
  const tried = useRef(false);
  const { activeThreadId, openThread, transcript } = controller;
  const untouched = transcript.messages.length === 0 && !activeThreadId;

  // Remember each chat as it opens or starts (a new chat gets its id from its first turn).
  useEffect(() => {
    if (activeThreadId) write(activeThreadId);
  }, [activeThreadId]);

  useEffect(() => {
    if (tried.current) return;
    if (!untouched) {
      tried.current = true;
      return;
    }
    if (threads.length === 0) return;
    tried.current = true;
    const last = read();
    if (last && threads.some((t) => t.id === last)) void openThread(last);
  }, [threads, untouched, openThread]);
}

/** Forget the remembered chat (New chat). */
export function forgetLastChat() {
  write(null);
}
