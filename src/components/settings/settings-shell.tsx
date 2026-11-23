"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useSyncExternalStore } from "react";

import { AppTile, type ConnectedApp, EditorTiles } from "@/components/brand-logos";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageTourButton } from "@/components/tours/page-tour";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { settingsLocation } from "./settings-pages";

export function useTeamSettings() {
  const team = useActiveTeam();
  return useQuery(api.teamSettings.get, { organizationId: team.id });
}

export function SettingsLoading() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <Skeleton className="h-12 rounded-lg" />
      <Skeleton className="h-12 rounded-lg" />
      <Skeleton className="h-12 rounded-lg" />
    </div>
  );
}

/**
 * One settings page: its title and one short line, then its settings in a single calm
 * column. The menu of settings pages is the sidebar itself while settings are open.
 */
const APP_PAGES = new Set<string>([
  "slack",
  "discord",
  "telegram",
  "teams",
  "zoom",
  "google-meet",
  "microsoft",
  "dropbox",
]);

export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const where = settingsLocation(pathname);
  const page = where?.page;
  const slug: string = page?.slug ?? "";

  return (
    <div data-settings className="mx-auto flex w-full max-w-2xl flex-col gap-10 pt-6 pb-16">
      {where?.app && (
        // An app's page sits under Integrations, and says so, the way Linear's do.
        <Link
          href="/settings/integrations"
          className="text-muted-foreground hover:text-foreground -mb-6 flex w-fit items-center gap-1 text-sm transition-colors"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Integrations
        </Link>
      )}
      {page && (
        <header
          className={cn(
            "flex gap-4",
            slug === "editors" ? "flex-col items-start" : "flex-row items-center",
          )}
        >
          {/* A page about other apps leads with their own logos, as Linear's do. */}
          {APP_PAGES.has(slug) && <AppTile app={slug as ConnectedApp} />}
          {slug === "editors" && <EditorTiles />}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
            <p className="text-muted-foreground text-sm text-pretty">{page.description}</p>
          </div>
          {/* Pages with a tour of their own can take it again from here. */}
          {slug === "brand" && <PageTourButton tourId="brand" className="self-start" />}
        </header>
      )}
      {children}
    </div>
  );
}

/**
 * A group of settings on a page. Space sets groups apart, not boxes or lines. A page with
 * one group leaves out its title, since the page title already says it.
 */
export function SettingsSection({
  title,
  description,
  children,
  className,
  ...props
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
} & Omit<React.ComponentProps<"section">, "title">) {
  return (
    <section className={cn("flex flex-col gap-4", className)} {...props}>
      {(title || description) && (
        <div className="flex flex-col gap-1">
          {title && <h2 className="text-base font-medium">{title}</h2>}
          {description && (
            <p className="text-muted-foreground text-sm text-pretty">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * One setting as a row: its name and a short line on the left, the control on the right.
 * On a narrow screen the control drops below.
 */
export function SettingRow({
  label,
  htmlFor,
  description,
  children,
  className,
  ...props
}: {
  label: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
} & React.ComponentProps<"div">) {
  return (
    <div
      data-setting-row
      className={cn(
        "flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between sm:gap-8",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </label>
        ) : (
          <span className="text-sm font-medium">{label}</span>
        )}
        {description && (
          <span className="text-muted-foreground text-sm text-pretty">{description}</span>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** Told whenever a settings tab changes the address, so every reader of it looks again. */
const TAB_CHANGED = "ncat:settings-tab";

function watchAddress(onChange: () => void) {
  window.addEventListener(TAB_CHANGED, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(TAB_CHANGED, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** The tab the address names (`?tab=…`), or none. The server has no address to read. */
const tabInAddress = () => new URLSearchParams(window.location.search).get("tab");

/**
 * Tabs across the top of a settings page that holds more than one job, so each shows on
 * its own. The open tab is kept in the address (`?tab=styles`), so a link or a reload
 * lands on it; the first tab leaves the address alone. Underlined, not boxed. A tab the
 * address names that is not there (yet) opens the first one.
 */
export function SettingsTabs({
  tabs,
  children,
  label,
}: {
  tabs: readonly { id: string; label: string }[];
  children: ReactNode;
  label: string;
}) {
  const named = useSyncExternalStore(watchAddress, tabInAddress, () => null);
  const open = tabs.find((tab) => tab.id === named)?.id ?? tabs[0].id;

  function choose(id: string) {
    const url = new URL(window.location.href);
    if (id === tabs[0].id) url.searchParams.delete("tab");
    else url.searchParams.set("tab", id);
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event(TAB_CHANGED));
  }

  return (
    <Tabs value={open} onValueChange={choose} className="gap-8">
      {/* One tab has nothing to switch to, so it shows no tabs at all. */}
      {tabs.length > 1 && (
        <TabsList variant="line" aria-label={label} className="-ml-3">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              // No box around a focused tab: the underline and darker text show it instead.
              className="focus-visible:text-foreground flex-none focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none focus-visible:after:opacity-100"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      )}
      {children}
    </Tabs>
  );
}
