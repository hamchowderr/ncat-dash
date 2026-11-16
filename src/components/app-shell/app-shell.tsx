"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { FullPageLoader } from "@/components/full-page-loader";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TeamContext } from "@/lib/team-context";
import { useGuardRedirect } from "@/lib/use-guard-redirect";
import { useTeam } from "@/lib/use-team";

import { AppSidebar, navItemFor } from "./app-sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const state = useTeam();
  const settings = useQuery(api.settings.get);
  const pathname = usePathname();

  // This only decides what to show. Every Convex function checks membership itself.
  useGuardRedirect(
    state.status === "signed-out" ? "/sign-in" : state.status === "no-team" ? "/onboarding" : null,
  );

  if (state.status !== "ready") return <FullPageLoader />;

  return (
    <TeamContext.Provider value={state.team}>
      <SidebarProvider>
        <AppSidebar
          teamName={state.team.name}
          edition={settings?.edition === "hosted" ? "Hosted" : "Self-hosted"}
          user={state.user}
        />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-center"
            />
            <span className="text-sm font-medium">{navItemFor(pathname).title}</span>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0 md:gap-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TeamContext.Provider>
  );
}
