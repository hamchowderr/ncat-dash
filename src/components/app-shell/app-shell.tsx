"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { MessagesSquare } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, ViewTransition } from "react";

import { useAgentContext } from "@/components/agent/agent-context";
import { FullPageLoader } from "@/components/full-page-loader";
import { AlertNotices, useUnseenAlerts } from "@/components/inbox/alert-notices";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { showAgent, useAgentOpen } from "@/lib/agent-open";
import { TeamContext } from "@/lib/team-context";
import { useGuardRedirect } from "@/lib/use-guard-redirect";
import { useTeam } from "@/lib/use-team";
import { cn } from "@/lib/utils";

import { AppSidebar, isSettingsPath, navItemFor } from "./app-sidebar";

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
  const agentOpen = useAgentOpen();

  return (
    <SidebarProvider className="md:h-svh md:overflow-hidden">
      <RoomForAgent agentOpen={agentOpen} />
      <AlertNotices />
      <AppSidebar teamName={state.team.name} edition={edition} user={state.user} />
      {/* The page scrolls inside its own frame, so the bar along the top always stays put
          and a page can fill exactly the height that is left. */}
      <SidebarInset className={cn("min-w-0 md:overflow-hidden", agentOpen && "max-lg:hidden")}>
        <header className="flex h-16 shrink-0 items-center gap-2 px-4">
          <MenuButton />
          {/* Settings name their page in the menu and the page itself, so the bar says nothing. */}
          {!isSettingsPath(pathname) && (
            <span className="truncate text-sm font-medium">{navItemFor(pathname).title}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {!agentOpen && (
              <Button variant="outline" size="sm" onClick={() => showAgent(true)}>
                <MessagesSquare />
                Agent
              </Button>
            )}
          </div>
        </header>
        <div
          data-page-frame
          className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]"
        >
          <PageTransition key={pathname}>
            <div className="flex flex-1 flex-col gap-4 p-4 pt-0 md:gap-6">{children}</div>
          </PageTransition>
        </div>
      </SidebarInset>
      {/* Always in place on a wide screen and opened by growing, so the page makes room
          for the chat instead of jumping. On a narrow screen there is no room beside the
          page, so the agent takes the page's place until it is closed: nothing lies over
          anything. */}
      <aside
        aria-label="Agent"
        aria-hidden={!agentOpen}
        inert={!agentOpen}
        className={cn(
          "bg-background h-svh flex-col overflow-hidden lg:flex lg:shrink-0",
          "motion-safe:lg:transition-[width] motion-safe:lg:duration-300 motion-safe:lg:ease-[cubic-bezier(0.16,1,0.3,1)]",
          agentOpen ? "flex min-w-0 flex-1 lg:w-[26rem] lg:flex-none" : "hidden lg:w-0",
        )}
      >
        {agentOpen && (
          <div className="flex h-full min-h-0 flex-col lg:w-[26rem] lg:min-w-[26rem]">
            <AgentPanel onAutomation={onAutomation} onClose={() => showAgent(false)} />
          </div>
        )}
      </aside>
    </SidebarProvider>
  );
}

/**
 * Pages fade in as they open. Keyed by the address, so each page is its own element that
 * leaves and arrives; the bars around it stay still.
 */
function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition
      enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page-enter" }}
      exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page-exit" }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}

/**
 * On a screen too narrow for the menu, the page and the chat side by side, opening the
 * chat folds the menu away, and closing it brings the menu back if it was folded for it.
 * The edges of the window also tell the pop-up notices where the page is.
 */
function RoomForAgent({ agentOpen }: { agentOpen: boolean }) {
  const { open, setOpen, isMobile } = useSidebar();
  const folded = useRef(false);
  useEffect(() => {
    if (isMobile) return;
    if (agentOpen && open && window.innerWidth < ROOM_FOR_ALL) {
      folded.current = true;
      setOpen(false);
    } else if (!agentOpen && folded.current) {
      folded.current = false;
      setOpen(true);
    }
    // Only a change to the chat folds or unfolds the menu, never the menu itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentOpen]);
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-agent-open", agentOpen);
    root.toggleAttribute("data-sidebar-open", open && !isMobile);
    return () => {
      root.removeAttribute("data-agent-open");
      root.removeAttribute("data-sidebar-open");
    };
  }, [agentOpen, open, isMobile]);
  return null;
}

/** Below this width the menu, a page worth working in and the chat do not all fit. */
const ROOM_FOR_ALL = 1600;

/**
 * The button that folds the menu away and back. While the menu is folded away, a dot on
 * it says there is news in the Inbox, so nothing is missed with the menu out of sight.
 */
function MenuButton() {
  const { open, openMobile, isMobile } = useSidebar();
  const unseen = useUnseenAlerts();
  const hidden = isMobile ? !openMobile : !open;
  return (
    <span className="relative -ml-1 inline-flex">
      <SidebarTrigger />
      {hidden && unseen > 0 && (
        <span
          data-inbox-dot
          aria-hidden="true"
          className="bg-destructive pointer-events-none absolute top-1 right-1 size-2 rounded-full"
        />
      )}
      {hidden && unseen > 0 && <span className="sr-only">{`${unseen} new in your Inbox`}</span>}
    </span>
  );
}
