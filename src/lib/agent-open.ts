import { useSyncExternalStore } from "react";

// Whether the agent was left open is remembered on this browser. The shell reads it to
// draw the panel, and the pop-up notices read it to stay clear of the panel.
const AGENT_OPEN_KEY = "ncat-agent-open";
const AGENT_OPEN_EVENT = "ncat:agent-open";

/** How wide the agent panel is beside the page on a wide screen. */
export const AGENT_WIDTH = "26rem";

function readAgentOpen(): boolean {
  try {
    return localStorage.getItem(AGENT_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function watchAgentOpen(onChange: () => void) {
  window.addEventListener(AGENT_OPEN_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(AGENT_OPEN_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function showAgent(open: boolean) {
  try {
    localStorage.setItem(AGENT_OPEN_KEY, open ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event(AGENT_OPEN_EVENT));
}

export function useAgentOpen(): boolean {
  return useSyncExternalStore(watchAgentOpen, readAgentOpen, () => false);
}
