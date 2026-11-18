import { api } from "@convex/_generated/api";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TeamContext } from "@/lib/team-context";
import { answerQuery } from "@/test/convex";
import { TEAM } from "@/test/render";

import { AppSidebar } from "./app-sidebar";

function sidebar() {
  render(
    <TeamContext.Provider value={TEAM}>
      <TooltipProvider>
        <SidebarProvider>
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
