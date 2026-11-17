"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { MessagesSquare } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { type ReactNode, useSyncExternalStore } from "react";

import { useAgentContext } from "@/components/agent/agent-context";
import { FullPageLoader } from "@/components/full-page-loader";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TeamContext } from "@/lib/team-context";
import { useGuardRedirect } from "@/lib/use-guard-redirect";
import { useTeam } from "@/lib/use-team";

import { AppSidebar, navItemFor } from "./app-sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const state = useTeam();
  const settings = useQuery(api.settings.get);
  // Kept on purpose, though nothing here uses the answer: without this call the build
  // fails to prepare /steps/[stepId] ahead of time. Found by trying; why is not understood.
  usePathname();

  // This only decides what to show. Every Convex function checks membership itself.
  useGuardRedirect(
    state.status === "signed-out" ? "/sign-in" : state.status === "no-team" ? "/onboarding" : null,
  );

  if (state.status !== "ready") return <FullPageLoader />;

  return (
    <TeamContext.Provider value={state.team}>
      <Shell state={state} edition={settings?.edition === "hosted" ? "Hosted" : "Self-hosted"}>
        {children}
      </Shell>
    </TeamContext.Provider>
  );
}

// The chat is only fetched once someone opens it: it brings its own markdown and code
// drawing, which no other page needs.
const AgentPanel = dynamic(
  () => import("@/components/agent/agent-panel").then((panel) => panel.AgentPanel),
  { ssr: false },
);

// Whether the agent was left open is remembered on this browser.
const AGENT_OPEN_KEY = "ncat-agent-open";
const AGENT_OPEN_EVENT = "ncat:agent-open";

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

function showAgent(open: boolean) {
  try {
    localStorage.setItem(AGENT_OPEN_KEY, open ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event(AGENT_OPEN_EVENT));
}

function Shell({
  state,
  edition,
  children,
}: {
  state: Extract<ReturnType<typeof useTeam>, { status: "ready" }>;
  edition: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { onAutomation } = useAgentContext();
  const agentOpen = useSyncExternalStore(watchAgentOpen, readAgentOpen, () => false);

  return (
    <>
      <SidebarProvider>
        <AppSidebar teamName={state.team.name} edition={edition} user={state.user} />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-center"
            />
            <span className="text-sm font-medium">{navItemFor(pathname).title}</span>
            {!agentOpen && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => showAgent(true)}
              >
                <MessagesSquare />
                Agent
              </Button>
            )}
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0 md:gap-6">{children}</div>
        </SidebarInset>
        {agentOpen && (
          <aside
            aria-label="Agent"
            className="bg-background fixed inset-0 z-40 flex flex-col border-l lg:sticky lg:top-0 lg:z-auto lg:h-svh lg:w-[26rem] lg:shrink-0"
          >
            <AgentPanel onAutomation={onAutomation} onClose={() => showAgent(false)} />
          </aside>
        )}
      </SidebarProvider>
    </>
  );
}
