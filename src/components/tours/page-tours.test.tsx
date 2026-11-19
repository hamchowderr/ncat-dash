import { api } from "@convex/_generated/api";
import { TOUR_IDS } from "@convex/lib/tours";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { DashboardTour } from "@/components/app-shell/dashboard-tour";
import { EDITOR_TOUR } from "@/components/automations/editor-tour";
import { NEW_AUTOMATION_TOUR } from "@/components/automations/new-automation-tour";
import { CALENDAR_TOUR } from "@/components/calendar/calendar-tour";
import { LIBRARY_TOUR } from "@/components/library/library-tour";
import { PROJECT_TOUR } from "@/components/projects/project-tour";
import { REVIEW_TOUR } from "@/components/review/review-tour";
import { BRAND_TOUR } from "@/components/settings/brand-tour";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTour } from "@/components/ui/tour";
import { answerQuery, mutationOf, toastSuccess } from "@/test/convex";

import { PageTourButton, StartPageTour } from "./page-tour";

const PAGE_TOURS = [
  CALENDAR_TOUR,
  EDITOR_TOUR,
  REVIEW_TOUR,
  PROJECT_TOUR,
  LIBRARY_TOUR,
  BRAND_TOUR,
  NEW_AUTOMATION_TOUR,
];

function StartDashboard() {
  const tour = useTour();
  return <button onClick={() => tour?.start("dashboard")}>Dashboard tour</button>;
}

/** A stand-in page with the project tour's parts on it. */
function renderPage({ ready = true } = {}) {
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <DashboardTour>
          <StartDashboard />
          <StartPageTour tourId="project" ready={ready} />
          <PageTourButton tourId="project" />
          {PROJECT_TOUR.steps.map((step) => (
            <div key={step.id} data-tour-step-id={step.id}>
              {step.id}
            </div>
          ))}
        </DashboardTour>
      </SidebarProvider>
    </TooltipProvider>,
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
  window.history.replaceState(null, "", "/projects/p1");
  answerQuery(api.tours.ended, false);
});

describe("a page's tour", () => {
  test("starts by itself on the first visit, and notes once it is finished", async () => {
    const view = renderPage();
    await act(async () => {});
    expect(card()).toHaveTextContent(PROJECT_TOUR.steps[0]!.title as string);
    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    for (let step = 2; step < PROJECT_TOUR.steps.length; step++) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(card()).toBeNull();
    expect(mutationOf(api.tours.end)).toHaveBeenCalledWith({ tourId: "project", how: "finished" });
    await act(async () => {});
    expect(toastSuccess).toHaveBeenCalledWith(
      "You can take this tour again from the top of the page.",
    );
    view.unmount();
  });

  test("waits until the page has loaded", async () => {
    renderPage({ ready: false });
    await act(async () => {});
    expect(card()).toBeNull();
  });

  test("does not start again once had, and Take the Tour starts it when asked", async () => {
    answerQuery(api.tours.ended, true);
    renderPage();
    await act(async () => {});
    expect(card()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Take the Tour" }));
    expect(card()).toHaveTextContent(PROJECT_TOUR.steps[0]!.title as string);
  });

  test("leaves a tour already showing alone", async () => {
    answerQuery(api.tours.ended, true);
    const view = renderPage({ ready: false });
    fireEvent.click(screen.getByRole("button", { name: "Dashboard tour" }));
    expect(card()).toHaveTextContent("Welcome to Your Dashboard");
    answerQuery(api.tours.ended, false);
    view.rerender(
      <TooltipProvider>
        <SidebarProvider>
          <DashboardTour>
            <StartPageTour tourId="project" ready />
          </DashboardTour>
        </SidebarProvider>
      </TooltipProvider>,
    );
    await act(async () => {});
    expect(card()).toHaveTextContent("Welcome to Your Dashboard");
  });
});

describe("every page's tour", () => {
  test("is one the backend can remember", () => {
    for (const tour of PAGE_TOURS) expect(TOUR_IDS).toContain(tour.id);
  });

  test("points at a different part with each card", () => {
    const all = PAGE_TOURS.flatMap((tour) => tour.steps.map((step) => step.id));
    expect(new Set(all).size).toBe(all.length);
  });

  test("names every card in Title Case", () => {
    const small = new Set([
      "a",
      "an",
      "the",
      "to",
      "of",
      "and",
      "or",
      "in",
      "on",
      "for",
      "at",
      "by",
    ]);
    for (const tour of PAGE_TOURS) {
      for (const step of tour.steps) {
        String(step.title)
          .split(/[ -]/)
          .forEach((word, i) => {
            if (i > 0 && small.has(word)) return;
            expect(word[0], `"${step.title}"`).toBe(word[0]!.toUpperCase());
          });
      }
    }
  });
});
