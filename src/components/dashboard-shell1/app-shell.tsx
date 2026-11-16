"use client";

import type { ReactNode } from "react";

import { AppSidebar } from "@/components/dashboard-shell1/components/app-sidebar";
import { SiteHeader } from "@/components/dashboard-shell1/components/site-header";
import { FullPageLoader } from "@/components/full-page-loader";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TeamContext } from "@/lib/team-context";
import { useGuardRedirect } from "@/lib/use-guard-redirect";
import { useTeam } from "@/lib/use-team";

export function AppShell({ children }: { children: ReactNode }) {
  const state = useTeam();

  // This only decides what to show. Every Convex function checks membership itself.
  const redirectTo =
    state.status === "signed-out" ? "/sign-in" : state.status === "no-team" ? "/onboarding" : null;
  useGuardRedirect(redirectTo);

  if (state.status !== "ready") return <FullPageLoader />;

  return (
    <TeamContext.Provider value={state.team}>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        <AppSidebar variant="sidebar" teamName={state.team.name} />
        <SidebarInset>
          <SiteHeader title="Home" user={state.user} />
          <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TeamContext.Provider>
  );
}
