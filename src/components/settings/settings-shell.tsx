"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { settingsPage } from "./settings-pages";

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
export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const page = settingsPage(pathname.split("/")[2] ?? "");

  return (
    <div data-settings className="mx-auto flex w-full max-w-2xl flex-col gap-10 pt-6 pb-16">
      {page && (
        <header className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
          <p className="text-muted-foreground text-sm text-pretty">{page.description}</p>
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
