"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { selectClass } from "@/components/projects/slot-status";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import {
  dayKey,
  DEFAULT_HOUR,
  DUE_HOUR,
  landing,
  step,
  type View,
  viewTitle,
  visibleDays,
} from "./dates";
import { type Dragged, type Entry, entriesByDay } from "./entries";
import { MonthGrid, WeekGrid } from "./grids";
import { type Panel, SidePanel } from "./side-panel";

const VIEW_KEY = "ncat-dash:calendar-view";

function savedView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "week" ? "week" : "month";
  } catch {
    return "month";
  }
}

function keepView(view: View) {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Remembering the view is a convenience; the calendar works without it.
  }
}

/**
 * The content calendar, modeled on Vidflow's: what is planned to go out by month or week,
 * project slots due, and when scheduled automations run, with a side list of what has no
 * time yet. Drag posts and slots onto a day, between days, or back to the side list.
 */
export function CalendarView({ now: givenNow }: { now?: number } = {}) {
  const team = useActiveTeam();
  const router = useRouter();
  const [now] = useState(() => givenNow ?? Date.now());
  const [view, setView] = useState<View>(savedView);
  const [anchor, setAnchor] = useState(() => new Date(now));
  const [panel, setPanel] = useState<Panel>({ mode: "waiting" });
  const [clientId, setClientId] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragged = useRef<Dragged | null>(null);

  const { days, from, to } = useMemo(() => visibleDays(view, anchor), [view, anchor]);
  const client = clientId ? { clientId: clientId as Id<"clients"> } : {};
  const range = useQuery(api.calendar.range, {
    organizationId: team.id,
    from: from.getTime(),
    to: to.getTime(),
    ...client,
  });
  const waiting = useQuery(api.calendar.waiting, { organizationId: team.id, ...client });
  const slots = useQuery(api.calendar.slots, { organizationId: team.id });
  const clients = useQuery(api.clients.list, { organizationId: team.id }) ?? [];
  const movePost = useMutation(api.calendar.movePost);
  const setDue = useMutation(api.calendar.setDue);

  // Kept from the last answer while the next range loads, so moving between months does
  // not flash empty cells.
  const [shown, setShown] = useState(range);
  if (range !== undefined && range !== shown) setShown(range);

  const byDay = useMemo(() => (shown ? entriesByDay(shown, days, now) : null), [shown, days, now]);

  function changeView(next: View) {
    setView(next);
    keepView(next);
  }

  function onDragStart(item: Dragged) {
    dragged.current = item;
    setDragging(true);
  }
  function onDragEnd() {
    setDragging(false);
  }

  async function run(work: () => Promise<unknown>, failure: string) {
    try {
      await work();
    } catch (caught) {
      toast.error(errorMessage(caught, failure));
    }
  }

  function onDrop(day: Date, hour: number | null) {
    const item = dragged.current;
    dragged.current = null;
    setDragging(false);
    if (!item) return;
    if (item.type === "post") {
      const at = landing(day, item.at, hour, DEFAULT_HOUR);
      if (at !== item.at)
        void run(() => movePost({ postId: item.id, at }), "The post could not be moved.");
    } else {
      // A due date is a day; the week view's hour does not change it.
      const dueAt = landing(day, item.at, null, DUE_HOUR);
      if (item.at === null || dayKey(item.at) !== dayKey(dueAt)) {
        void run(
          () => setDue({ deliverableId: item.id, dueAt }),
          "The due date could not be saved.",
        );
      }
    }
  }

  function onUnschedule() {
    const item = dragged.current;
    dragged.current = null;
    setDragging(false);
    if (!item || item.at === null) return;
    if (item.type === "post")
      void run(() => movePost({ postId: item.id, at: null }), "The post could not be moved.");
    else
      void run(
        () => setDue({ deliverableId: item.id, dueAt: null }),
        "The due date could not be cleared.",
      );
  }

  function onOpen(entry: Entry) {
    if (entry.type === "post") setPanel({ mode: "post", id: entry.post._id });
    else if (entry.type === "due") setPanel({ mode: "due", id: entry.due._id });
    else if (entry.type === "open")
      setPanel({ mode: "add", at: entry.at, platform: entry.platform });
    else router.push(`/automations/${entry.automationId}`);
  }

  const selectedKey =
    panel.mode === "post" ? `post-${panel.id}` : panel.mode === "due" ? `due-${panel.id}` : null;
  const posts = [...(shown?.posts ?? []), ...(waiting?.posts ?? [])];
  const dues = [...(shown?.due ?? []), ...(waiting?.deliverables ?? [])];
  const shared = {
    byDay: byDay ?? new Map(),
    selectedKey,
    today: dayKey(now),
    onOpen,
    onDragStart,
    onDragEnd,
    onDrop,
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <p className="text-muted-foreground max-w-prose text-sm">
          What goes out when, what is due, and when your automations run. Drag to plan.
        </p>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setAnchor(new Date(now))}>
              Today
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={view === "month" ? "Previous Month" : "Previous Week"}
              onClick={() => setAnchor((current) => step(view, current, -1))}
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={view === "month" ? "Next Month" : "Next Week"}
              onClick={() => setAnchor((current) => step(view, current, 1))}
            >
              <ChevronRight />
            </Button>
            <h2
              className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight"
              aria-live="polite"
            >
              {viewTitle(view, anchor)}
            </h2>
            {clients.length > 0 && (
              <select
                aria-label="Client"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                className={cn(selectClass, "h-8")}
              >
                <option value="">Everyone</option>
                {clients.map((entry) => (
                  <option key={entry._id} value={entry._id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            )}
            <div
              role="group"
              aria-label="Calendar view"
              className="bg-muted flex rounded-lg p-[3px]"
            >
              {(
                [
                  ["month", "Month"],
                  ["week", "Week"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={view === value}
                  onClick={() => changeView(value)}
                  className={cn(
                    "focus-visible:ring-ring/50 rounded-md px-3 py-0.5 text-sm outline-none transition-[background-color,color,box-shadow] focus-visible:ring-3",
                    view === value
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto pb-1">
            {byDay === null ? (
              <Skeleton className="h-[36rem] min-w-[44rem] rounded-xl" />
            ) : view === "month" ? (
              <MonthGrid
                days={days}
                month={anchor.getMonth()}
                onMore={(day) => {
                  setAnchor(day);
                  changeView("week");
                }}
                {...shared}
              />
            ) : (
              <WeekGrid days={days} {...shared} />
            )}
          </div>
        </div>
        <SidePanel
          panel={panel}
          setPanel={setPanel}
          waiting={waiting}
          posts={posts}
          dues={dues}
          clients={clients}
          hasSlots={(slots?.length ?? 0) > 0}
          dragging={dragging}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onUnschedule={onUnschedule}
        />
      </div>
    </>
  );
}
