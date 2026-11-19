"use client";

import { api } from "@convex/_generated/api";
import type { TourId } from "@convex/lib/tours";
import { useQuery } from "convex/react";
import { Compass } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useTour } from "@/components/ui/tour";

export type { TourId };

/**
 * Starts a page's tour the first time someone opens the page, once what it points at has
 * loaded. A tour already showing (the dashboard's, taken from the menu) goes first, and
 * someone who has already opened a dialog (sharing, say) is left to it: the tour waits for
 * their next visit rather than sitting on top.
 */
export function StartPageTour({ tourId, ready = true }: { tourId: TourId; ready?: boolean }) {
  const tour = useTour();
  const ended = useQuery(api.tours.ended, tour ? { tourId } : "skip");
  const handled = useRef(false);

  useEffect(() => {
    if (!ready || handled.current || ended === undefined || !tour) return;
    handled.current = true;
    if (!ended && tour.activeTourId === null && !dialogOpen()) tour.start(tourId);
  }, [ready, ended, tour, tourId]);

  return null;
}

function dialogOpen() {
  return (
    document.querySelector("[role='dialog'][data-state='open'], [role='alertdialog']") !== null
  );
}

/** Takes a page's tour again, from the top of the page. */
export function PageTourButton({ tourId, className }: { tourId: TourId; className?: string }) {
  const tour = useTour();
  if (!tour) return null;
  return (
    <Button size="sm" variant="ghost" className={className} onClick={() => tour.start(tourId)}>
      <Compass />
      Take the Tour
    </Button>
  );
}
