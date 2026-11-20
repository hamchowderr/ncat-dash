import { api } from "@convex/_generated/api";
import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { DashboardTour } from "@/components/app-shell/dashboard-tour";
import { SidebarProvider } from "@/components/ui/sidebar";
import { answerQuery, mutationOf, toastSuccess } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { CALENDAR_TOUR } from "./calendar-tour";
import { CalendarView } from "./calendar-view";

const NOW = new Date(2026, 10, 19, 9, 0).getTime();

function answer({ ended = false, clients = [] as unknown[] } = {}) {
  const range = { posts: [], due: [], openSlots: [], runs: [], repeating: [] };
  answerQuery(api.calendar.range, range);
  answerQuery(api.calendar.waiting, { posts: [], deliverables: [] });
  answerQuery(api.calendar.slots, []);
  answerQuery(api.clients.list, clients);
  answerQuery(api.tours.ended, ended);
}

async function renderCalendar() {
  renderInApp(
    <SidebarProvider>
      <DashboardTour>
        <CalendarView now={NOW} />
      </DashboardTour>
    </SidebarProvider>,
  );
  await act(async () => {});
}

const card = () => screen.queryByRole("dialog");
const total = (count: number) => `of ${count}`;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(null, "", "/calendar");
  window.localStorage.clear();
});

describe("the tour of the calendar", () => {
  test("starts by itself on the first visit, walks every part, and notes when it is finished", async () => {
    answer();
    await renderCalendar();
    expect(card()).toHaveTextContent("Your Content Calendar");
    // No clients yet, so the client filter is not on the page and its card is left out.
    const shown = CALENDAR_TOUR.steps.filter((step) => !step.optional).length;
    expect(card()).toHaveTextContent(`Step 1 ${total(shown)}`);

    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    for (const title of [
      "Posts, Due Dates and Runs",
      "Move Through Time",
      "Month or Week",
      "Add a Post",
      "Not Scheduled",
    ]) {
      expect(card()).toHaveTextContent(title);
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(card()).toHaveTextContent("Repeating Slots");
    expect(mutationOf(api.tours.end)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(card()).toBeNull();
    expect(mutationOf(api.tours.end)).toHaveBeenCalledWith({ tourId: "calendar", how: "finished" });
    await act(async () => {});
    expect(toastSuccess).toHaveBeenCalledWith(
      "You can take this tour again from the top of the page.",
      { id: "tour-again" },
    );
  });

  test("shows the client filter when there are clients", async () => {
    answer({ clients: [{ _id: "c1", name: "Ridge Coffee" }] });
    await renderCalendar();
    expect(card()).toHaveTextContent(`Step 1 ${total(CALENDAR_TOUR.steps.length)}`);
    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(card()).toHaveTextContent("One Client at a Time");
  });

  test("does not start by itself once it has been had, and can be taken again from the page", async () => {
    answer({ ended: true });
    await renderCalendar();
    expect(card()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Take the Tour" }));
    expect(card()).toHaveTextContent("Your Content Calendar");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(card()).toBeNull();
    expect(mutationOf(api.tours.end)).toHaveBeenCalledWith({ tourId: "calendar", how: "closed" });
  });

  test("has a place on the page for every part it points at", async () => {
    answer({ ended: true, clients: [{ _id: "c1", name: "Ridge Coffee" }] });
    await renderCalendar();
    for (const step of CALENDAR_TOUR.steps.slice(1)) {
      expect(
        document.querySelector(`[data-tour-step-id~='${step.id}']`),
        `nothing on the page for ${step.id}`,
      ).not.toBeNull();
    }
  });

  test("names every card in Title Case", () => {
    const small = new Set(["a", "an", "the", "to", "of", "and", "or", "in", "on", "for", "at"]);
    for (const step of CALENDAR_TOUR.steps) {
      String(step.title)
        .split(" ")
        .forEach((word, i) => {
          if (i > 0 && small.has(word)) return;
          expect(word[0], `"${step.title}"`).toBe(word[0]!.toUpperCase());
        });
    }
  });
});
