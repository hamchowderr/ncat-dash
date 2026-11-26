import { api } from "@convex/_generated/api";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TeamContext } from "@/lib/team-context";
import { answerQuery } from "@/test/convex";
import { TEAM } from "@/test/render";

import { AppSidebar } from "./app-sidebar";

function sidebar({ open = true } = {}) {
  render(
    <TeamContext.Provider value={TEAM}>
      <TooltipProvider>
        <SidebarProvider defaultOpen={open}>
          <AppSidebar
            teamName={TEAM.name}
            edition="Self-hosted"
            user={{ name: "Ana Reyes", email: "ana@example.test", image: null }}
          />
        </SidebarProvider>
      </TooltipProvider>
    </TeamContext.Provider>,
  );
}

beforeEach(() => {
  // The menu asks whether the screen is a phone's; this one is wide.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

describe("the Toolkit page in the menu", () => {
  test("is there for a team that runs its own toolkit", () => {
    answerQuery(api.toolkitHealth.shown, true);
    sidebar();
    expect(screen.getByRole("link", { name: "Toolkit" }).getAttribute("href")).toBe("/toolkit");
  });

  test("is left out for a team whose toolkit is run for it", () => {
    answerQuery(api.toolkitHealth.shown, false);
    sidebar();
    expect(screen.queryByRole("link", { name: "Toolkit" })).toBeNull();
    expect(screen.getByRole("link", { name: "Jobs" })).toBeTruthy();
  });
});

describe("the menu", () => {
  test("shows Automations with its own icon", () => {
    answerQuery(api.toolkitHealth.shown, true);
    sidebar();
    const link = screen.getByRole("link", { name: "Automations" });
    expect(link.querySelector("svg.lucide-waypoints")).not.toBeNull();
  });

  test("folds down to its icons instead of hiding", () => {
    answerQuery(api.toolkitHealth.shown, true);
    sidebar({ open: false });
    expect(document.querySelector("[data-collapsible='icon']")).not.toBeNull();
    expect(document.querySelector("[data-collapsible='offcanvas']")).toBeNull();
    // Every page is still one click away while folded.
    expect(screen.getByRole("link", { name: "Automations" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Home" })).toBeTruthy();
  });
});

describe("the Admin pages in the menu", () => {
  test("show for the operator", () => {
    answerQuery(api.toolkitHealth.shown, true);
    answerQuery(api.operator.me, true);
    sidebar();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Send An Email" }).getAttribute("href")).toBe(
      "/admin/emails/new",
    );
    expect(screen.getByRole("link", { name: "Sent Emails" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Subscribers" })).toBeTruthy();
  });

  test("stay hidden from everyone else", () => {
    answerQuery(api.toolkitHealth.shown, true);
    answerQuery(api.operator.me, false);
    sidebar();
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByRole("link", { name: "Sent Emails" })).toBeNull();
  });
});
