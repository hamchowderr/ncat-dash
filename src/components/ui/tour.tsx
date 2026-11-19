"use client";

// Adapted from Tour by Hin Tong (https://github.com/tonghohin/tour), MIT License,
// Copyright (c) 2025 Hin Tong. Changes for this app: a step whose target is not on the
// screen (a phone's closed menu, the agent already open) shows in the middle instead of
// not at all; Escape closes; the tour says how it ended, so it can be remembered; targets
// match a whole word of `data-tour-step-id`, not part of one; a step marked `optional` is
// left out when what it points at is not on the page as the tour starts; on a phone the
// card keeps to the top or bottom edge, away from what it points at, since there is no
// room beside it.

import { XIcon } from "lucide-react";
import Link from "next/link";
import { Popover as PopoverPrimitive } from "radix-ui";
import * as React from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Side = React.ComponentProps<typeof PopoverPrimitive.Content>["side"];
type Align = React.ComponentProps<typeof PopoverPrimitive.Content>["align"];

interface Step {
  id: string;
  title: React.ReactNode;
  content: React.ReactNode;
  nextRoute?: string;
  previousRoute?: string;
  nextLabel?: React.ReactNode;
  previousLabel?: React.ReactNode;
  side?: Side;
  sideOffset?: number;
  align?: Align;
  alignOffset?: number;
  className?: string;
  /** Left out when nothing on the page has this id as the tour starts (a filter that
   * only shows once there are clients). */
  optional?: boolean;
}

interface Tour {
  id: string;
  steps: Step[];
}

type TourEnd = "finished" | "closed";

type TourControls = {
  start: (tourId: string) => void;
  close: () => void;
  /** The tour showing now, if any. */
  activeTourId: string | null;
};

const TourContext = React.createContext<TourControls | null>(null);

/** Starts and closes tours. Null outside a TourProvider, where there is nothing to start. */
function useTour() {
  return React.useContext(TourContext);
}

function TourProvider({
  tours,
  onStart,
  onEnd,
  children,
}: {
  tours: Tour[];
  /** Called as a tour starts, to make room for what it points at (an open menu). */
  onStart?: (tourId: string) => void;
  /** Called once a tour is finished or closed part way. */
  onEnd?: (tourId: string, how: TourEnd) => void;
  children: React.ReactNode;
}) {
  const [activeTourId, setActiveTourId] = React.useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = React.useState(0);
  // The steps of the tour showing, fixed as it starts.
  const [steps, setSteps] = React.useState<Step[]>([]);

  const end = React.useCallback(
    (how: TourEnd) => {
      if (activeTourId) onEnd?.(activeTourId, how);
      setActiveTourId(null);
      setCurrentStepIndex(0);
    },
    [activeTourId, onEnd],
  );

  function next() {
    if (currentStepIndex < steps.length - 1) setCurrentStepIndex((index) => index + 1);
    else end("finished");
  }

  function previous() {
    if (currentStepIndex > 0) setCurrentStepIndex((index) => index - 1);
  }

  const start = React.useCallback(
    (tourId: string) => {
      const tour = tours.find((candidate) => candidate.id === tourId);
      if (!tour || tour.steps.length === 0) return;
      const shown = tour.steps.filter(
        (step) =>
          !step.optional || document.querySelector(`[data-tour-step-id~='${step.id}']`) !== null,
      );
      onStart?.(tourId);
      setSteps(shown);
      setActiveTourId(tourId);
      setCurrentStepIndex(0);
    },
    [tours, onStart],
  );

  const close = React.useCallback(() => end("closed"), [end]);

  const controls = React.useMemo(
    () => ({ start, close, activeTourId }),
    [start, close, activeTourId],
  );

  return (
    <TourContext.Provider value={controls}>
      {children}
      {activeTourId && steps[currentStepIndex] && (
        <TourOverlay
          step={steps[currentStepIndex]}
          currentStepIndex={currentStepIndex}
          totalSteps={steps.length}
          onNext={next}
          onPrevious={previous}
          onClose={close}
        />
      )}
    </TourContext.Provider>
  );
}

type Target = { rect: DOMRect; radius: number };

/** Below this width there is no room beside a target, so the card keeps to an edge. */
const NARROW = 640;

/** The elements a step points at that are on the screen now. */
function findTargets(stepId: string) {
  const found: { target: Target; element: Element }[] = [];
  document.querySelectorAll(`[data-tour-step-id~='${stepId}']`).forEach((element) => {
    // Inside something on its way out, as a phone's menu sliding away is.
    if (element.closest("[role='dialog'][data-state='closed']")) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    // Off to the side, as a closed menu slid aside is: nothing to point at. Above or below
    // the screen is fine: the page scrolls to it.
    if (rect.right <= 0 || rect.left >= innerWidth) return;
    const radius = Number.parseFloat(getComputedStyle(element).borderRadius) || 6;
    found.push({ target: { rect, radius }, element });
  });
  return found;
}

function TourOverlay({
  step,
  currentStepIndex,
  totalSteps,
  onNext,
  onPrevious,
  onClose,
}: {
  step: Step;
  currentStepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}) {
  const [targets, setTargets] = React.useState<Target[]>([]);
  const [narrow, setNarrow] = React.useState(false);
  // Ids from useId hold colons, which a url(#...) in SVG does not take.
  const maskId = `tour-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  React.useEffect(() => {
    let needsScroll = true;
    function updatePosition() {
      const found = findTargets(step.id);
      setTargets(found.map(({ target }) => target));
      setNarrow(innerWidth < NARROW);
      if (found[0] && needsScroll) {
        found[0].element.scrollIntoView({ behavior: "smooth", block: "center" });
        needsScroll = false;
      }
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const observer = new MutationObserver(updatePosition);
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(document.body);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, [step]);

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const named = { "aria-labelledby": `${maskId}-title`, "aria-modal": true } as const;
  // Beside its target the popover is already a dialog; in the middle the card is one.
  const card = (centred: boolean) => (
    <Card
      {...(centred ? { role: "dialog", ...named } : {})}
      data-tour-card
      className="w-80 max-w-[calc(100vw-2rem)] gap-4 py-5 shadow-lg"
    >
      <CardHeader className="px-5">
        <CardTitle id={`${maskId}-title`}>{step.title}</CardTitle>
        <CardDescription>
          Step {currentStepIndex + 1} of {totalSteps}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon" aria-label="Close the tour" onClick={onClose}>
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-muted-foreground px-5 text-sm leading-relaxed">
        {step.content}
      </CardContent>
      <CardFooter className="justify-between px-5">
        {currentStepIndex > 0 &&
          (step.previousRoute ? (
            <Button variant="ghost" onClick={onPrevious} asChild>
              <Link href={step.previousRoute}>{step.previousLabel ?? "Back"}</Link>
            </Button>
          ) : (
            <Button variant="ghost" onClick={onPrevious}>
              {step.previousLabel ?? "Back"}
            </Button>
          ))}
        {step.nextRoute ? (
          <Button className="ml-auto" onClick={onNext} asChild>
            <Link href={step.nextRoute}>
              {step.nextLabel ?? (currentStepIndex === totalSteps - 1 ? "Finish" : "Next")}
            </Link>
          </Button>
        ) : (
          <Button className="ml-auto" onClick={onNext} autoFocus>
            {step.nextLabel ?? (currentStepIndex === totalSteps - 1 ? "Finish" : "Next")}
          </Button>
        )}
      </CardFooter>
    </Card>
  );

  return createPortal(
    <div className="fixed inset-0 z-50" data-tour-overlay>
      <svg className="absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targets.map((target, i) => (
              <rect
                key={i}
                x={target.rect.left - 4}
                y={target.rect.top - 4}
                width={target.rect.width + 8}
                height={target.rect.height + 8}
                rx={target.radius + 4}
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          mask={`url(#${maskId})`}
          className="fill-black opacity-25 motion-safe:transition-opacity"
        />
        {targets.map((target, i) => (
          <rect
            key={i}
            x={target.rect.left - 4}
            y={target.rect.top - 4}
            width={target.rect.width + 8}
            height={target.rect.height + 8}
            rx={target.radius + 4}
            className="stroke-primary fill-none stroke-2"
          />
        ))}
      </svg>
      {targets[0] && narrow ? (
        <div
          className={cn(
            "absolute inset-x-0 flex justify-center p-4",
            // Whichever edge is further from what it points at.
            targets[0].rect.top + targets[0].rect.height / 2 > innerHeight / 2
              ? "top-0"
              : "bottom-0",
          )}
        >
          {card(true)}
        </div>
      ) : targets[0] ? (
        <Popover key={step.id} open>
          <PopoverAnchor
            virtualRef={{ current: { getBoundingClientRect: () => targets[0]!.rect } }}
          />
          <PopoverContent
            className={cn("w-auto bg-transparent p-0 shadow-none", step.className)}
            side={step.side}
            sideOffset={step.sideOffset ?? 12}
            align={step.align}
            alignOffset={step.alignOffset}
            collisionPadding={16}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            {...named}
          >
            {card(false)}
          </PopoverContent>
        </Popover>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-4">{card(true)}</div>
      )}
    </div>,
    document.body,
  );
}

export { TourProvider, useTour, type Step, type Tour, type TourEnd };
