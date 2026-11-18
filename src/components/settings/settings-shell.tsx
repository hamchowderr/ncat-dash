"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { SETTINGS_PAGES } from "./settings-pages";

export function useTeamSettings() {
  const team = useActiveTeam();
  return useQuery(api.teamSettings.get, { organizationId: team.id });
}

export function SettingsLoading() {
  return <Skeleton className="h-64 rounded-xl" />;
}

/** Settings as a set of pages: the menu on the left, one page of settings beside it. */
export function SettingsShell({ children }: { children: ReactNode }) {
  const team = useActiveTeam();
  const pathname = usePathname();
  const current = SETTINGS_PAGES.find((page) => pathname === `/settings/${page.slug}`);

  return (
    <div data-settings className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Settings for {team.name}.</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Settings" className="lg:sticky lg:top-0 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {SETTINGS_PAGES.map((page) => {
              const active = current?.slug === page.slug;
              return (
                <li key={page.slug} className="shrink-0">
                  <Link
                    href={`/settings/${page.slug}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "hover:bg-muted/60 flex flex-col rounded-lg px-3 py-2 transition-colors",
                      active && "bg-muted",
                    )}
                  >
                    <span className={cn("text-sm", active ? "font-medium" : "text-foreground/80")}>
                      {page.title}
                    </span>
                    <span className="text-muted-foreground hidden text-xs lg:block">
                      {page.description}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-6 [&_button[type=submit]]:w-auto [&_button[type=submit]]:self-start [&_input[type=number]]:w-28">
          {children}
        </div>
      </div>
    </div>
  );
}
