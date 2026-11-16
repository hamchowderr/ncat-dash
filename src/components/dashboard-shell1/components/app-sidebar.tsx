"use client";

import * as React from "react";
import { ClapperboardIcon, HomeIcon } from "lucide-react";
import Link from "next/link";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import { NavMain } from "./nav-main";

// Media, automations, the agent and settings join this list as each phase lands.
const navMain = [{ title: "Home", url: "/", icon: HomeIcon }];

export function AppSidebar({
  teamName,
  ...props
}: React.ComponentProps<typeof Sidebar> & { teamName: string }) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:p-1.5!">
              <Link href="/">
                <ClapperboardIcon className="size-5!" aria-hidden="true" />
                <span className="truncate text-base font-semibold">{teamName}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
    </Sidebar>
  );
}
