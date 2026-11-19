"use client";

import { PageTourButton, StartPageTour } from "@/components/tours/page-tour";
import type { Tour } from "@/components/ui/tour";

export const CALENDAR_TOUR_ID = "calendar" as const;

/**
 * A walk around the content calendar, the first time someone opens it. Each `id` is the
 * `data-tour-step-id` of what it points at on the page.
 */
export const CALENDAR_TOUR: Tour = {
  id: CALENDAR_TOUR_ID,
  steps: [
    {
      id: "tour-calendar-welcome",
      title: "Your Content Calendar",
      content:
        "Everything going out and everything due, on one calendar. Here is how to plan with it.",
      nextLabel: "Show me",
    },
    {
      id: "tour-calendar-grid",
      title: "Posts, Due Dates and Runs",
      content:
        "Each day shows the posts planned for it, the project slots due to your clients, and when your scheduled automations run. Click one to open it, or drag a post to another day.",
      side: "right",
      align: "start",
    },
    {
      id: "tour-calendar-move",
      title: "Move Through Time",
      content: "Today brings you back to now. The arrows step a month or a week at a time.",
      side: "bottom",
      align: "start",
    },
    {
      id: "tour-calendar-client",
      title: "One Client at a Time",
      content: "Show only what is planned for one client, or everyone at once.",
      side: "bottom",
      align: "end",
      optional: true,
    },
    {
      id: "tour-calendar-views",
      title: "Month or Week",
      content:
        "Month shows the big picture. Week lays each day out by the hour, so you can drop a post at the exact time it should go out.",
      side: "bottom",
      align: "end",
    },
    {
      id: "tour-calendar-add",
      title: "Add a Post",
      content:
        "Say what it is, where it goes and who it is for. Then pick a time, send it to the next free slot, or leave it for later.",
      side: "left",
      align: "start",
    },
    {
      id: "tour-calendar-waiting",
      title: "Not Scheduled",
      content:
        "Posts with no time yet, the queue first, and project slots with no due date. Drag one onto a day to schedule it, or drag something from the calendar back here to take its time off.",
      side: "left",
      align: "start",
    },
    {
      id: "tour-calendar-slots",
      title: "Repeating Slots",
      content:
        "Set the times you post every week, like TikTok on Tuesdays at 6 PM. Fill Slots puts queued posts into the next free ones, in order.",
      side: "left",
      align: "start",
    },
  ],
};

/** Starts the calendar tour the first time someone opens the calendar, once it has loaded. */
export function StartCalendarTour({ ready }: { ready: boolean }) {
  return <StartPageTour tourId={CALENDAR_TOUR_ID} ready={ready} />;
}

/** Takes the calendar tour again. */
export function CalendarTourButton() {
  return <PageTourButton tourId={CALENDAR_TOUR_ID} />;
}
