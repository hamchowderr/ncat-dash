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

/**
 * Keeps the agent told which team and automation are on screen. It rides along with
 * every chat request as a cookie, so "this automation" means the one being looked at.
 */
export function useAgentContext() {
  const team = useActiveTeam();
  const automationId = openAutomationId(usePathname());
  useEffect(() => {
    const value = encodeURIComponent(JSON.stringify({ organizationId: team.id, automationId }));
    document.cookie = `${CONTEXT_COOKIE}=${value}; path=/api; SameSite=Lax`;
  }, [team.id, automationId]);
  return { onAutomation: automationId !== null };
}
