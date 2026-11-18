"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import * as React from "react";
import {
  ArrowLeft,
  Bell,
  ChevronsUpDown,
  Clapperboard,
  Film,
  FolderOutput,
  FolderTree,
  Home,
  Inbox,
  ListChecks,
  Mail,
  MessagesSquare,
  Palette,
  Captions,
  RotateCcw,
  Settings,
  type LucideIcon,
  SquareFunction,
  UserPlus,
  Users,
  UploadCloud,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { DiscordLogo, SlackLogo } from "@/components/brand-logos";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SETTINGS_GROUPS, type SettingsSlug } from "@/components/settings/settings-pages";

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
  useSidebar,
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
  { title: "Review", url: "/review", icon: MessagesSquare },
  { title: "Outputs", url: "/outputs", icon: FolderOutput },
  { title: "Uploads", url: "/uploads", icon: UploadCloud },
  { title: "Files", url: "/files", icon: FolderTree },
];

// For building and testing automations: single steps run by hand, and every job sent.
const navBuilder: NavItem[] = [
  { title: "Steps", url: "/steps", icon: SquareFunction },
  { title: "Jobs", url: "/jobs", icon: ListChecks },
];

export const navMain: NavItem[] = [...navEveryday, ...navBuilder];

/** The nav entry a path belongs to: "/steps/video-trim" belongs to Steps. */
export function navItemFor(pathname: string) {
  return navMain.find((item) => item.url !== "/" && pathname.startsWith(item.url)) ?? navMain[0];
}

export const isSettingsPath = (pathname: string) =>
  pathname === "/settings" || pathname.startsWith("/settings/");

const SETTINGS_ICONS: Record<SettingsSlug, React.ComponentType<{ className?: string }>> = {
  notifications: Bell,
  brand: Palette,
  captions: Captions,
  team: Users,
  agent: MessagesSquare,
  runs: RotateCcw,
  editors: Film,
  email: Mail,
  slack: SlackLogo,
  discord: DiscordLogo,
};

const LAST_APP_PAGE = "ncat:last-app-page";

/**
 * Remembers the last page outside settings, so "Back to app" returns there, the way
 * Linear's settings do.
 */
function useBackToApp(pathname: string) {
  React.useEffect(() => {
    try {
      if (!isSettingsPath(pathname)) sessionStorage.setItem(LAST_APP_PAGE, pathname);
    } catch {
      // Storage can be blocked; Home is a fine place to go back to.
    }
  }, [pathname]);
  return React.useSyncExternalStore(noChanges, readLastAppPage, () => "/");
}

const noChanges = () => () => {};

function readLastAppPage() {
  try {
    return sessionStorage.getItem(LAST_APP_PAGE) ?? "/";
  } catch {
    return "/";
  }
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
  const back = useBackToApp(pathname);
  const inSettings = isSettingsPath(pathname);

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <TeamMenu teamName={teamName} edition={edition} />
      </SidebarHeader>
      {inSettings ? (
        <SettingsMenu pathname={pathname} back={back} />
      ) : (
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
      )}
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * The team's name at the top of the menu. It opens the team's menu, where settings live,
 * as in Linear and Notion: settings are not an everyday page.
 */
function TeamMenu({ teamName, edition }: { teamName: string; edition: string }) {
  const { isMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label={`${teamName} menu`}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <TeamMark />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{teamName}</span>
                <span className="truncate text-xs">{edition}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuItem asChild>
              <Link href="/settings/brand">
                <Settings />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/team">
                <UserPlus />
                Invite people
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** While settings are open, the menu becomes the list of settings pages. */
function SettingsMenu({ pathname, back }: { pathname: string; back: string }) {
  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild className="text-muted-foreground">
                <Link href={back}>
                  <ArrowLeft />
                  <span>Back to app</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <nav aria-label="Settings" className="contents">
        {SETTINGS_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.pages.map((page) => {
                  const href = `/settings/${page.slug}`;
                  const Icon = SETTINGS_ICONS[page.slug];
                  const active = pathname === href;
                  return (
                    <SidebarMenuItem key={page.slug}>
                      <SidebarMenuButton asChild tooltip={page.title} isActive={active}>
                        <Link href={href} aria-current={active ? "page" : undefined}>
                          <Icon />
                          <span>{page.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </nav>
    </SidebarContent>
  );
}
