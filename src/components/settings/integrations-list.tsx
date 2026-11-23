"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { ChevronRight, Link2, Mail, Plug } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppTile, type ConnectedApp } from "@/components/brand-logos";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { INTEGRATION_GROUPS, type IntegrationSlug, settingsHref } from "./settings-pages";

/** Where an app stands for this team: connected, not yet, or not set up on this dashboard. */
export type AppState = "connected" | "off" | "unavailable";

/** How each state reads beside an app. "Off" says nothing: the row itself invites a click. */
const STATE_TEXT: Record<AppState, string | null> = {
  connected: "Connected",
  off: null,
  unavailable: "Not set up on this dashboard yet",
};

/** Apps without a logo of their own get a quiet icon on the same soft tile. */
const PLAIN_ICONS: Partial<Record<IntegrationSlug, ReactNode>> = {
  "video-links": <Link2 className="size-4" />,
  mcp: <Plug className="size-4" />,
  email: <Mail className="size-4" />,
};

function AppMark({ slug }: { slug: IntegrationSlug }) {
  const plain = PLAIN_ICONS[slug];
  if (plain) {
    return (
      <span
        aria-hidden="true"
        className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg"
      >
        {plain}
      </span>
    );
  }
  return <AppTile app={slug as ConnectedApp} small />;
}

/**
 * Each app's state, worked out from the same queries its own page reads, so the list and
 * the page never disagree. An app still loading has no state yet (undefined).
 */
export function useAppStates(): Partial<Record<IntegrationSlug, AppState>> {
  const team = useActiveTeam();
  const args = { organizationId: team.id };
  const slack = useQuery(api.slack.forTeam, args);
  const discord = useQuery(api.discord.forTeam, args);
  const telegram = useQuery(api.telegram.forTeam, args);
  const teams = useQuery(api.microsoftTeams.forTeam, args);
  const zoom = useQuery(api.zoom.forTeam, args);
  const meet = useQuery(api.googleMeet.forTeam, args);
  const microsoft = useQuery(api.microsoft.forTeam, args);
  const dropbox = useQuery(api.dropbox.forTeam, args);
  const email = useQuery(api.email.get, args);
  const mcp = useQuery(api.oauth.connections, args);

  const state = (ready: boolean, connected: boolean): AppState =>
    !ready ? "unavailable" : connected ? "connected" : "off";

  return {
    slack: slack ? state(true, slack.connected) : undefined,
    discord: discord ? state(discord.ready, discord.servers.length > 0) : undefined,
    telegram: telegram
      ? state(telegram.ready, telegram.groups.length > 0 || telegram.me !== null)
      : undefined,
    teams: teams ? state(teams.ready, teams.organization !== null) : undefined,
    zoom: zoom ? state(zoom.ready, zoom.wholeAccount !== null || zoom.me !== null) : undefined,
    "google-meet": meet ? state(meet.ready, meet.me !== null) : undefined,
    microsoft: microsoft ? state(microsoft.ready, microsoft.me !== null) : undefined,
    dropbox: dropbox ? state(dropbox.ready, dropbox.me !== null) : undefined,
    email: email ? state(true, email.configured) : undefined,
    mcp: mcp ? state(true, mcp.length > 0) : undefined,
  };
}

/**
 * The Integrations page: every app the team can connect, in groups, each opening a page of
 * its own. Modelled on Linear's Integrations settings.
 */
export function IntegrationsList() {
  const states = useAppStates();
  return (
    <div className="flex flex-col gap-10">
      {INTEGRATION_GROUPS.map((group) => (
        <section key={group.label} className="flex flex-col gap-2" aria-label={group.label}>
          <h2 className="text-muted-foreground px-3 text-xs font-medium">{group.label}</h2>
          <ul className="flex flex-col">
            {group.apps.map((app) => {
              const state = states[app.slug];
              const text = state ? STATE_TEXT[state] : null;
              return (
                <li key={app.slug}>
                  <Link
                    href={settingsHref(app.slug)}
                    data-integration={app.slug}
                    className="hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-3 rounded-lg px-3 py-2.5 outline-none transition-colors focus-visible:ring-3"
                  >
                    <AppMark slug={app.slug} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium">{app.title}</span>
                      <span className="text-muted-foreground truncate text-sm">
                        {app.description}
                      </span>
                    </span>
                    {text && (
                      <span
                        data-state={state}
                        className={cn(
                          "shrink-0 text-xs",
                          state === "connected"
                            ? "text-foreground flex items-center gap-1.5"
                            : "text-muted-foreground",
                        )}
                      >
                        {state === "connected" && (
                          <span
                            aria-hidden="true"
                            className="size-1.5 rounded-full bg-emerald-500"
                          />
                        )}
                        {text}
                      </span>
                    )}
                    <ChevronRight
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
