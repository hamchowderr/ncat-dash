"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState, ViewTransition } from "react";

import { useAgentContext } from "@/components/agent/agent-context";
import { AgentTrigger, useAgentShortcut } from "@/components/agent/agent-rail";
import { FullPageLoader } from "@/components/full-page-loader";
import { AlertNotices, useUnseenAlerts } from "@/components/inbox/alert-notices";
import {
  AgentResting,
  TeamPaused,
  TrialDays,
  TrialEnded,
  useAccessRefusal,
} from "@/components/trial/trial-notice";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { showAgent, useAgentOpen } from "@/lib/agent-open";
import { TeamContext } from "@/lib/team-context";
import { TeamStepsSync } from "@/lib/team-steps-sync";
import { TimeZoneSync } from "@/lib/time-zone";
import { TranscriptCatchUp } from "@/lib/transcript-catch-up";
import { useGuardRedirect } from "@/lib/use-guard-redirect";
import { useTeam } from "@/lib/use-team";
import { cn } from "@/lib/utils";

import { adminRouteFor } from "@/components/admin/admin-routes";

import { AppSidebar, isSettingsPath, navItemFor } from "./app-sidebar";

import { DashboardTour } from "./dashboard-tour";
import { LocalFolders } from "./local-folders";
import { WatchHowButton, WatchHowPanel } from "./watch-how";

/** The page's name in the bar along the top: an Admin page or a menu entry. */
export function barTitle(pathname: string): string {
  return adminRouteFor(pathname)?.title ?? navItemFor(pathname).title;
}

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
        <TranscriptCatchUp organizationId={state.team.id} />
        <TimeZoneSync />
        <TeamStepsSync organizationId={state.team.id}>{children}</TeamStepsSync>
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
  const refusal = useAccessRefusal(state.team.id);
  useAgentShortcut(agentOpen);
  // The video belongs to the page it was opened on: moving to another page closes it.
  const [watch, setWatch] = useState<{ pathname: string; playing: string | null } | null>(null);
  const watching = watch?.pathname === pathname;

  return (
    <SidebarProvider className="md:h-svh md:overflow-hidden">
      <DashboardTour>
        <RoomForAgent agentOpen={agentOpen} />
        <CloseMenuOnNavigate pathname={pathname} />
        <AlertNotices />
        <LocalFolders />
        <AppSidebar teamName={state.team.name} edition={edition} user={state.user} />
        {/* The page scrolls inside its own frame, so the bar along the top always stays put
          and a page can fill exactly the height that is left. */}
        <SidebarInset className={cn("min-w-0 md:overflow-hidden", agentOpen && "max-lg:hidden")}>
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <MenuButton />
            {/* Settings name their page in the menu and the page itself, so the bar says nothing. */}
            {!isSettingsPath(pathname) && (
              <span className="truncate text-sm font-medium">{barTitle(pathname)}</span>
            )}
            <div className="ml-auto flex items-center gap-3">
              <WatchHowButton
                pathname={pathname}
                open={watching}
                onToggle={() => setWatch(watching ? null : { pathname, playing: null })}
              />
              <TrialDays organizationId={state.team.id} />
              {/* The agent's button, the mirror of the menu's on the left. */}
              {!agentOpen && <AgentTrigger className="-mr-1" />}
            </div>
          </header>
          <div data-page-frame className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <PageTransition key={pathname}>
              <div className="flex flex-1 flex-col gap-4 p-4 pt-0 md:gap-6">
                <TeamPaused organizationId={state.team.id} />
                <TrialEnded organizationId={state.team.id} />
                {watching && (
                  <WatchHowPanel
                    pathname={pathname}
                    playing={watch.playing}
                    onPlay={(playing) => setWatch({ pathname, playing })}
                    onClose={() => setWatch(null)}
                  />
                )}
                {children}
              </div>
            </PageTransition>
          </div>
        </SidebarInset>
        {/* The agent is a sidebar of its own on the right, opened from the robot in the bar
          along the top. Open, it sits beside the page, which makes room for it instead of
          being covered, and it opens by growing, so nothing jumps. Closed, it takes no room
          at all. On a screen too narrow for both, the open agent takes the page's place
          until it is closed. */}
        <aside
          aria-label="Agent"
          aria-hidden={!agentOpen}
          data-state={agentOpen ? "open" : "closed"}
          className={cn(
            "bg-sidebar text-sidebar-foreground h-svh flex-col overflow-hidden md:flex md:shrink-0 md:py-2",
            "motion-safe:md:transition-[width] motion-safe:md:duration-300 motion-safe:md:ease-[cubic-bezier(0.16,1,0.3,1)]",
            agentOpen ? "flex min-w-0 flex-1 lg:w-[26rem] lg:flex-none" : "hidden md:w-0 md:py-0",
          )}
        >
          {agentOpen && (
            <div className="flex h-full min-h-0 flex-col lg:w-[26rem] lg:min-w-[26rem]">
              {refusal ? (
                <AgentResting
                  message={refusal.reason === "trial_ended" ? undefined : refusal.message}
                  onClose={() => showAgent(false)}
                />
              ) : (
                <AgentPanel onAutomation={onAutomation} onClose={() => showAgent(false)} />
              )}
            </div>
          )}
        </aside>
      </DashboardTour>
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

/**
 * On a phone the menu slides over the page, so picking a page in it must also put it away;
 * otherwise the page opens underneath and the menu stays in front of it.
 */
function CloseMenuOnNavigate({ pathname }: { pathname: string }) {
  const { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);
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
