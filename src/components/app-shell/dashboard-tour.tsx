"use client";

import { api } from "@convex/_generated/api";
import { PRODUCT_NAME } from "@takewon/automation-core";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { EDITOR_TOUR } from "@/components/automations/editor-tour";
import { NEW_AUTOMATION_TOUR } from "@/components/automations/new-automation-tour";
import { CALENDAR_TOUR } from "@/components/calendar/calendar-tour";
import { LIBRARY_TOUR } from "@/components/library/library-tour";
import { PROJECT_TOUR } from "@/components/projects/project-tour";
import { REVIEW_TOUR } from "@/components/review/review-tour";
import { BRAND_TOUR } from "@/components/settings/brand-tour";
import type { TourId } from "@/components/tours/page-tour";
import { useSidebar } from "@/components/ui/sidebar";
import { type Tour, type TourEnd, TourProvider, useTour } from "@/components/ui/tour";

export const DASHBOARD_TOUR_ID = "dashboard" as const;

/** The search that asks Home to start the tour: where setting up sends a new team. */
export const START_TOUR_SEARCH = "?tour=start";

/**
 * A walk around the dashboard for someone new: one card per part, pointing at its place
 * in the menu. Each `id` is the `data-tour-step-id` of what it points at; a step whose
 * target is not on the screen shows in the middle.
 */
export const DASHBOARD_TOUR: Tour = {
  id: DASHBOARD_TOUR_ID,
  steps: [
    {
      id: "tour-welcome",
      title: `Welcome to ${PRODUCT_NAME}`,
      content:
        "A quick look around: where your automations live, where your files go, and where finished clips wait for you. It takes about a minute.",
      nextLabel: "Show me",
    },
    {
      id: "tour-home",
      title: "Home",
      content:
        "What ran this week, what is left to set up, and the ready-made automations that fit what you make.",
      side: "right",
    },
    {
      id: "tour-automations",
      title: "Automations",
      content:
        "Each one runs by itself when new content comes in: an upload, a watched folder or a schedule. Open one to see its steps laid out on the canvas.",
      side: "right",
    },
    {
      id: "tour-uploads",
      title: "Uploads",
      content: "Drop a recording here and every automation that watches your uploads starts on it.",
      side: "right",
    },
    {
      id: "tour-runs",
      title: "Runs",
      content:
        "Every time an automation runs, step by step, as it happens. When something fails, this is where you see why.",
      side: "right",
    },
    {
      id: "tour-review",
      title: "Review",
      content:
        "Finished clips wait here for your team or your client to approve, with comments pinned to the exact moment.",
      side: "right",
    },
    {
      id: "tour-library",
      title: "Library",
      content:
        "Every video, transcript and caption file you have made, searchable and tagged with the client it is for.",
      side: "right",
    },
    {
      id: "tour-inbox",
      title: "Inbox",
      content: "Failed runs, approvals waiting on you and mentions from your team, in one place.",
      side: "right",
    },
    {
      id: "tour-builder",
      title: "Builder",
      content:
        "For building and testing: try one step on a file by hand, and see every job sent to your toolkit.",
      side: "right",
    },
    {
      id: "tour-agent",
      title: "Agent",
      content:
        "Tell the agent what you want in plain words. It builds the automation and tests it for you, and you can change anything after.",
      side: "bottom",
      align: "end",
    },
    {
      id: "tour-team",
      title: "Your Team Menu",
      content:
        "Settings live here: your brand, set once for every automation, plus your team, notifications, Slack, Discord and Telegram. You can take this tour again from your own menu at the bottom.",
      side: "right",
      align: "start",
    },
  ],
};

const TOURS = [
  DASHBOARD_TOUR,
  CALENDAR_TOUR,
  EDITOR_TOUR,
  REVIEW_TOUR,
  PROJECT_TOUR,
  LIBRARY_TOUR,
  BRAND_TOUR,
  NEW_AUTOMATION_TOUR,
];
const TOUR_IDS = new Set<string>(TOURS.map((tour) => tour.id));

/** What a tour says once finished, about where to take it again. */
function again(tourId: string) {
  return tourId === DASHBOARD_TOUR_ID
    ? "You can take the tour again from your menu."
    : "You can take this tour again from the top of the page.";
}

/**
 * Holds the guided tours for the signed-in pages (the dashboard's and each page's own):
 * opens the menu so the dashboard tour can point into it, remembers each once it is
 * finished or closed, and starts the dashboard tour by itself the first time someone
 * lands with `?tour=start`, which is where setting up sends them.
 */
export function DashboardTour({ children }: { children: ReactNode }) {
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
  const end = useMutation(api.tours.end);

  const onStart = useCallback(
    (tourId: string) => {
      // The menu folded away hides what the dashboard tour points at, so it opens. A
      // phone's menu is a sheet over the page that would hold the tour's buttons behind
      // it, so it closes and the cards show in the middle instead.
      if (isMobile) setOpenMobile(false);
      else if (tourId === DASHBOARD_TOUR_ID) setOpen(true);
    },
    [isMobile, setOpen, setOpenMobile],
  );

  const onEnd = useCallback(
    (tourId: string, how: TourEnd) => {
      if (!TOUR_IDS.has(tourId)) return;
      void end({ tourId: tourId as TourId, how }).then(() => {
        // One note at a time: finishing a second tour while the first one's note is still up
        // replaces it rather than stacking the same words twice.
        if (how === "finished") toast.success(again(tourId), { id: "tour-again" });
      });
    },
    [end],
  );

  return (
    <TourProvider tours={TOURS} onStart={onStart} onEnd={onEnd}>
      <StartWhenAsked />
      {children}
    </TourProvider>
  );
}

function StartWhenAsked() {
  const tour = useTour();
  // Read once, on arrival: the address is tidied straight after.
  const [asked] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("tour") === "start",
  );
  const ended = useQuery(api.tours.ended, asked ? { tourId: DASHBOARD_TOUR_ID } : "skip");
  const handled = useRef(false);

  useEffect(() => {
    if (!asked || handled.current || ended === undefined) return;
    handled.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("tour");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    if (!ended) tour?.start(DASHBOARD_TOUR_ID);
  }, [asked, ended, tour]);

  return null;
}
