"use client";

import * as React from "react";
import {
  Clapperboard,
  FolderOutput,
  Home,
  ListChecks,
  type LucideIcon,
  SquareFunction,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import { NavUser, type ShellUser } from "./nav-user";

// Automations, the agent and settings join this list as each phase lands.
export const navMain: { title: string; url: string; icon: LucideIcon }[] = [
  { title: "Home", url: "/", icon: Home },
  { title: "Steps", url: "/steps", icon: SquareFunction },
  { title: "Jobs", url: "/jobs", icon: ListChecks },
  { title: "Outputs", url: "/outputs", icon: FolderOutput },
  { title: "Uploads", url: "/uploads", icon: UploadCloud },
];

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
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navMain.map((item) => (
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
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
