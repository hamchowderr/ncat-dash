"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useActiveTeam } from "@/lib/team-context";

// The same name the server reads in src/lib/agent-session.ts.
const CONTEXT_COOKIE = "ncat_agent_context";

/** The automation on screen, read from the address. */
function openAutomationId(pathname: string): string | null {
  const match = /^\/automations\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

/** What kind of thing a page shows, as the agent server names it (convex/agentScreen.ts). */
export type ScreenKind =
  "automation" | "run" | "library" | "project" | "client" | "review" | "creator";

export type Screen = { kind: ScreenKind; id: string };

const PAGES: [RegExp, ScreenKind][] = [
  // A run before its automation, since a run's address starts with the automation's.
  [/^\/automations\/[^/]+\/runs\/([^/]+)/, "run"],
  [/^\/automations\/([^/]+)/, "automation"],
  [/^\/library\/([^/]+)/, "library"],
  [/^\/projects\/([^/]+)/, "project"],
  [/^\/clients\/([^/]+)/, "client"],
  [/^\/review\/([^/]+)/, "review"],
  [/^\/creators\/([^/]+)/, "creator"],
];

/** The one thing a page is about, read from the address, or null for a list or a settings page. */
export function screenOf(pathname: string): Screen | null {
  for (const [pattern, kind] of PAGES) {
    const match = pattern.exec(pathname);
    if (match?.[1]) return { kind, id: decodeURIComponent(match[1]) };
  }
  return null;
}

/**
 * Keeps the agent told which team and automation are on screen, and the one thing the
 * page is about (an automation, a run, a file in the Library, a project and so on), so the
 * agent can be told about it. It rides along with
 * every chat request as a cookie, so "this automation" means the one being looked at.
 */
export function useAgentContext() {
  const team = useActiveTeam();
  const pathname = usePathname();
  const automationId = openAutomationId(pathname);
  const page = screenOf(pathname);
  const screenKind = page?.kind ?? null;
  const screenId = page?.id ?? null;
  useEffect(() => {
    const screen = screenKind && screenId ? { kind: screenKind, id: screenId } : null;
    const value = encodeURIComponent(
      JSON.stringify({ organizationId: team.id, automationId, screen }),
    );
    document.cookie = `${CONTEXT_COOKIE}=${value}; path=/api; SameSite=Lax`;
  }, [team.id, automationId, screenKind, screenId]);
  return { onAutomation: automationId !== null };
}
