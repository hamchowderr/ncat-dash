"use client";

import * as React from "react";
import {
  Clapperboard,
  FolderOutput,
  Home,
  ListChecks,
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

import { NavUser, type ShellUser } from "./nav-user";

// The agent joins this list when its phase lands.
type NavItem = { title: string; url: string; icon: LucideIcon };

const navEveryday: NavItem[] = [
  { title: "Home", url: "/", icon: Home },
  { title: "Automations", url: "/automations", icon: Workflow },
  { title: "Outputs", url: "/outputs", icon: FolderOutput },
  { title: "Uploads", url: "/uploads", icon: UploadCloud },
  { title: "Settings", url: "/settings", icon: Settings },
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
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Clapperboard className="size-4" aria-hidden="true" />
                </div>
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
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
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
