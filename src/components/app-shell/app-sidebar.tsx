"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import * as React from "react";
import {
  Clapperboard,
  FolderOutput,
  FolderTree,
  Gauge,
  History,
  Home,
  Inbox,
  ListChecks,
  MessagesSquare,
  Settings,
  type LucideIcon,
  SquareFunction,
  UploadCloud,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useActiveTeam } from "@/lib/team-context";
import { useFileLink } from "@/lib/use-brand-upload";

import { useUnseenAlerts } from "@/components/inbox/alert-notices";

import { NavUser, type ShellUser } from "./nav-user";

// The agent joins this list when its phase lands.
type NavItem = { title: string; url: string; icon: LucideIcon };

const navEveryday: NavItem[] = [
  { title: "Home", url: "/", icon: Home },
  { title: "Inbox", url: "/inbox", icon: Inbox },
  { title: "Automations", url: "/automations", icon: Workflow },
  { title: "Runs", url: "/runs", icon: History },
  { title: "Review", url: "/review", icon: MessagesSquare },
  { title: "Outputs", url: "/outputs", icon: FolderOutput },
  { title: "Uploads", url: "/uploads", icon: UploadCloud },
  { title: "Files", url: "/files", icon: FolderTree },
  { title: "Settings", url: "/settings", icon: Settings },
];

// For building and testing automations: single steps run by hand, and every job sent.
const navBuilder: NavItem[] = [
  { title: "Steps", url: "/steps", icon: SquareFunction },
  { title: "Jobs", url: "/jobs", icon: ListChecks },
  { title: "Toolkit", url: "/toolkit", icon: Gauge },
];

export const navMain: NavItem[] = [...navEveryday, ...navBuilder];

/** The nav entry a path belongs to: "/steps/video-trim" belongs to Steps. */
export function navItemFor(pathname: string) {
  return navMain.find((item) => item.url !== "/" && pathname.startsWith(item.url)) ?? navMain[0];
}

/** How many alerts are new, beside Inbox in the menu; nothing when all are seen. */
function InboxCount() {
  const unseen = useUnseenAlerts();
  if (unseen === 0) return null;
  return (
    <>
      <span
        data-alerts-count
        aria-hidden="true"
        className="bg-destructive ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs leading-none font-medium text-white tabular-nums"
      >
        {unseen > 99 ? "99+" : unseen}
      </span>
      <span className="sr-only">{`, ${unseen} new`}</span>
    </>
  );
}

/** The team's logo once it has one in Settings, and a plain mark until then. */
function TeamMark() {
  const team = useActiveTeam();
  const logo = useQuery(api.teamSettings.get, { organizationId: team.id })?.brand.logo;
  const link = useFileLink(logo);
  if (link) {
    return (
      <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg">
        {/* The file sits in the team's own storage, so there is nothing for Next to resize. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={link} alt="" className="size-full object-contain" />
      </div>
    );
  }
  return (
    <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
      <Clapperboard className="size-4" aria-hidden="true" />
    </div>
  );
}

export function AppSidebar({
  teamName,
  edition,
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  teamName: string;
  edition: string;
  user: ShellUser;
}) {
  const pathname = usePathname();

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <TeamMark />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{teamName}</span>
                  <span className="truncate text-xs">{edition}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {[
          { label: null, items: navEveryday },
          { label: "Builder", items: navBuilder },
        ].map((group) => (
          <SidebarGroup key={group.label ?? "everyday"}>
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      isActive={navItemFor(pathname).url === item.url}
                    >
                      <Link
                        href={item.url}
                        {...(item.url === "/inbox" ? { "data-alerts-bell": true } : {})}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                        {item.url === "/inbox" && <InboxCount />}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
