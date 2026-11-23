"use client";

import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { DeliverableStatus } from "@convex/lib/packages";
import type { PostingAppId } from "@takewon/automation-core";
import { isCalendarPlatform, platformLabel } from "@takewon/automation-core";
import type { useQuery } from "convex/react";
import { Check, Plus, Repeat, Workflow } from "lucide-react";
import type { DragEvent, ReactNode } from "react";

import { PostingAppLogo } from "@/components/onboarding/posting-app-logo";
import { StatusIcon } from "@/components/projects/slot-status";
import { cn } from "@/lib/utils";

import { dayKey, everyLabel, timeLabel } from "./dates";

export type Range = NonNullable<ReturnType<typeof useQuery<typeof api.calendar.range>>>;
export type Waiting = NonNullable<ReturnType<typeof useQuery<typeof api.calendar.waiting>>>;
export type Post = Range["posts"][number];
export type Due = Range["due"][number];

/** One thing shown on a day. Posts and due slots can be dragged; the rest are shown only. */
export type Entry =
  | { type: "post"; key: string; at: number; post: Post }
  | { type: "due"; key: string; at: number; due: Due }
  | { type: "run"; key: string; at: number; name: string; automationId: Id<"automations"> }
  | { type: "open"; key: string; at: number; platform: string }
  | {
      type: "repeat";
      key: string;
      at: number;
      name: string;
      minutes: number;
      automationId: Id<"automations">;
    };

/** What is being dragged: a post or a project slot, and the time it has now. */
export type Dragged =
  | { type: "post"; id: Id<"calendarPosts">; at: number | null }
  | {
      type: "due";
      id: Id<"deliverables">;
      at: number | null;
    };

/** Every entry in the range, by local day, in time order. Repeating runs show on each day. */
export function entriesByDay(range: Range, days: Date[], now: number): Map<string, Entry[]> {
  const byDay = new Map<string, Entry[]>(days.map((day) => [dayKey(day), []]));
  const put = (entry: Entry) => byDay.get(dayKey(entry.at))?.push(entry);
  for (const post of range.posts) {
    if (post.at !== null) put({ type: "post", key: `post-${post._id}`, at: post.at, post });
  }
  for (const due of range.due) {
    if (due.dueAt !== null) put({ type: "due", key: `due-${due._id}`, at: due.dueAt, due });
  }
  for (const run of range.runs) {
    put({
      type: "run",
      key: `run-${run.automationId}-${run.at}`,
      at: run.at,
      name: run.name,
      automationId: run.automationId,
    });
  }
  for (const open of range.openSlots) {
    put({
      type: "open",
      key: `open-${open.slotId}-${open.at}`,
      at: open.at,
      platform: open.platform,
    });
  }
  const today = dayKey(now);
  for (const day of days) {
    if (dayKey(day) < today) continue;
    for (const run of range.repeating) {
      put({
        type: "repeat",
        key: `repeat-${run.automationId}-${dayKey(day)}`,
        // First on the day, before anything with a time.
        at: day.getTime(),
        name: run.name,
        minutes: run.minutes,
        automationId: run.automationId,
      });
    }
  }
  // Due slots and repeating runs lead the day; the rest follow in time order.
  const rank = (entry: Entry) => (entry.type === "repeat" ? 0 : entry.type === "due" ? 1 : 2);
  for (const list of byDay.values()) list.sort((a, b) => rank(a) - rank(b) || a.at - b.at);
  return byDay;
}

export function PlatformMark({ platform, className }: { platform: string; className?: string }) {
  if (!isCalendarPlatform(platform)) return null;
  return (
    <PostingAppLogo app={platform as PostingAppId} className={cn("size-3.5 shrink-0", className)} />
  );
}

/** The words a screen reader hears for an entry, and its tooltip. */
export function entryLabel(entry: Entry): string {
  switch (entry.type) {
    case "post":
      return `${entry.post.title}, ${platformLabel(entry.post.platform)} at ${timeLabel(entry.at)}${
        entry.post.status === "posted" ? ", posted" : ""
      }`;
    case "due":
      return `${entry.due.label} for ${entry.due.project.name}, due`;
    case "run":
      return `${entry.name} runs at ${timeLabel(entry.at)}`;
    case "open":
      return `Open slot for ${platformLabel(entry.platform)} at ${timeLabel(entry.at)}`;
    case "repeat":
      return `${entry.name} runs ${everyLabel(entry.minutes).toLowerCase()}`;
  }
}

/**
 * One entry as a single line, like an event on Google Calendar: posts lead with their
 * platform's logo, due slots with their kind, runs with the automation icon; open slots
 * are quiet until hovered.
 */
export function EntryChip({
  entry,
  selected,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  entry: Entry;
  selected: boolean;
  onOpen: (entry: Entry) => void;
  onDragStart: (dragged: Dragged) => void;
  onDragEnd: () => void;
}) {
  const draggable = entry.type === "post" || entry.type === "due";
  function start(event: DragEvent) {
    if (entry.type === "post") onDragStart({ type: "post", id: entry.post._id, at: entry.at });
    else if (entry.type === "due") onDragStart({ type: "due", id: entry.due._id, at: entry.at });
    event.dataTransfer?.setData("text/plain", entry.key);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }
  const label = entryLabel(entry);
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={draggable ? start : undefined}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(entry)}
      aria-label={label}
      aria-pressed={draggable ? selected : undefined}
      title={label}
      data-entry={entry.type}
      className={cn(
        "focus-visible:ring-ring/50 flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs outline-none transition-[background-color,box-shadow] focus-visible:ring-3",
        entry.type === "post" && "bg-background shadow-xs hover:shadow-sm",
        entry.type === "post" && entry.post.status === "posted" && "text-muted-foreground",
        entry.type === "due" && "bg-amber-50 text-amber-950 hover:bg-amber-100",
        (entry.type === "run" || entry.type === "repeat") &&
          "text-muted-foreground hover:bg-background/70",
        entry.type === "open" &&
          "text-muted-foreground/80 hover:bg-background/70 hover:text-foreground",
        selected && "picked-ring",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <EntryBody entry={entry} />
    </button>
  );
}

/** A line under an entry's name, quieter, for its time or project. */
function Under({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "text-muted-foreground block truncate text-[0.6875rem] tabular-nums",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Named({ name, under, posted }: { name: string; under: ReactNode; posted?: boolean }) {
  return (
    <span className="min-w-0 flex-1">
      <span
        className={cn(
          "line-clamp-2 font-medium break-words",
          posted && "line-through decoration-1",
        )}
      >
        {name}
      </span>
      {under}
    </span>
  );
}

function EntryBody({ entry }: { entry: Entry }) {
  switch (entry.type) {
    case "post":
      return (
        <>
          <PlatformMark platform={entry.post.platform} className="self-start mt-px" />
          <Named
            name={entry.post.title}
            posted={entry.post.status === "posted"}
            under={<Under>{timeLabel(entry.at)}</Under>}
          />
          {entry.post.status === "posted" && (
            <Check aria-hidden="true" className="size-3 shrink-0 self-start text-emerald-600" />
          )}
        </>
      );
    case "due":
      return (
        <>
          <StatusIcon
            status={entry.due.status as DeliverableStatus}
            className="mt-px size-3.5 self-start"
          />
          <Named
            name={entry.due.label}
            under={<Under className="text-amber-900/70">Due · {entry.due.project.name}</Under>}
          />
        </>
      );
    case "run":
      return (
        <>
          <Workflow aria-hidden="true" className="mt-px size-3.5 shrink-0 self-start" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{entry.name}</span>
            <Under>{timeLabel(entry.at)}</Under>
          </span>
        </>
      );
    case "repeat":
      return (
        <>
          <Repeat aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        </>
      );
    case "open":
      return (
        <>
          <Plus aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate tabular-nums">{timeLabel(entry.at)}</span>
          <PlatformMark platform={entry.platform} className="opacity-60" />
        </>
      );
  }
}
