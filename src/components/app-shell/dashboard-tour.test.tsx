import { api } from "@convex/_generated/api";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTour } from "@/components/ui/tour";
import { TeamContext } from "@/lib/team-context";
import { answerQuery, mutationOf, toastSuccess } from "@/test/convex";
import { TEAM } from "@/test/render";

import { AppSidebar } from "./app-sidebar";
import { DASHBOARD_TOUR, DashboardTour } from "./dashboard-tour";

function StartButton() {
  const tour = useTour();
  return <button onClick={() => tour?.start("dashboard")}>Start</button>;
}

function renderTour({ withMenu = false } = {}) {
  render(
    <TeamContext.Provider value={TEAM}>
      <TooltipProvider>
        <SidebarProvider>
          <DashboardTour>
            {withMenu ? (
              <AppSidebar
                teamName={TEAM.name}
                edition="Self-hosted"
                user={{ name: "Ana Reyes", email: "ana@example.test", image: null }}
              />
            ) : (
              <nav>
                <span data-tour-step-id="tour-home">Home</span>
              </nav>
            )}
            <StartButton />
          </DashboardTour>
        </SidebarProvider>
      </TooltipProvider>
    </TeamContext.Provider>,
  );
}

const card = () => screen.queryByRole("dialog");

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(null, "", "/");
  answerQuery(api.toolkitHealth.shown, true);
  answerQuery(api.tours.ended, false);
});

describe("the tour of the dashboard", () => {
  test("walks through every part, one card at a time, and notes when it is finished", async () => {
    renderTour();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(card()).toHaveTextContent("Welcome to Takewon");
    expect(card()).toHaveTextContent(`Step 1 of ${DASHBOARD_TOUR.steps.length}`);
    // The first card has nothing to go back to.
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    expect(card()).toHaveTextContent("Home");
    expect(card()).toHaveTextContent("Step 2 of");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(card()).toHaveTextContent("Welcome to Takewon");

    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    for (let step = 2; step < DASHBOARD_TOUR.steps.length; step++) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(card()).toHaveTextContent("Your Team Menu");
    expect(mutationOf(api.tours.end)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(card()).toBeNull();
    expect(mutationOf(api.tours.end)).toHaveBeenCalledWith({
      tourId: "dashboard",
      how: "finished",
    });
    await act(async () => {});
    expect(toastSuccess).toHaveBeenCalledWith("You can take the tour again from your menu.", {
      id: "tour-again",
    });
  });

  test("closes part way with the cross or Escape, and notes that it was closed", async () => {
    renderTour();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Close the tour" }));
    expect(card()).toBeNull();
    expect(mutationOf(api.tours.end)).toHaveBeenCalledWith({ tourId: "dashboard", how: "closed" });

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(card()).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(card()).toBeNull();
    expect(mutationOf(api.tours.end)).toHaveBeenCalledTimes(2);
    await act(async () => {});
    // Only finishing says where to find it again.
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  test("starts by itself when setting up sends someone new to Home, and tidies the address", async () => {
    window.history.replaceState(null, "", "/?tour=start");
    renderTour();
    await act(async () => {});
    expect(card()).toHaveTextContent("Welcome to Takewon");
    expect(window.location.search).toBe("");
  });

  test("does not start by itself for someone who has had it already", async () => {
    window.history.replaceState(null, "", "/?tour=start");
    answerQuery(api.tours.ended, true);
    renderTour();
    await act(async () => {});
    expect(card()).toBeNull();
    expect(window.location.search).toBe("");
  });

  test("does not start by itself on an ordinary visit", async () => {
    renderTour();
    await act(async () => {});
    expect(card()).toBeNull();
  });

  test("has a place in the menu for every part it points at", () => {
    renderTour({ withMenu: true });
    const inMenu = DASHBOARD_TOUR.steps
      .map((step) => step.id)
      // The welcome card points at nothing; the Agent button sits in the bar along the top.
      .filter((id) => id !== "tour-welcome" && id !== "tour-agent");
    for (const id of inMenu) {
      expect(
        document.querySelector(`[data-tour-step-id~='${id}']`),
        `nothing in the menu for ${id}`,
      ).not.toBeNull();
    }
  });

  test("names every card in Title Case", () => {
    const small = new Set(["a", "an", "the", "to", "of", "and", "or", "in", "on", "for"]);
    for (const step of DASHBOARD_TOUR.steps) {
      const words = String(step.title).split(" ");
      words.forEach((word, i) => {
        if (i > 0 && small.has(word)) return;
        expect(word[0], `"${step.title}"`).toBe(word[0]!.toUpperCase());
      });
    }
  });
});
