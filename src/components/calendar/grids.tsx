"use client";

import { type DragEvent, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { dayKey, WEEKDAY_FORMAT } from "./dates";
import { type Entry, EntryChip, type Dragged } from "./entries";

/** How many entries a month cell lists before "+ more". */
const SHOWN = 4;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = new Intl.DateTimeFormat(undefined, { hour: "numeric" });

type Shared = {
  byDay: Map<string, Entry[]>;
  selectedKey: string | null;
  today: string;
  onOpen: (entry: Entry) => void;
  onDragStart: (dragged: Dragged) => void;
  onDragEnd: () => void;
  /** Something was dropped on a day; `hour` is set in week view. */
  onDrop: (day: Date, hour: number | null) => void;
};

/** A day or hour cell that lights up while something is dragged over it. */
function useDropTarget(onDrop: () => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver: (event: DragEvent) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        setOver(false);
        onDrop();
      },
    },
  };
}

function Chips({ entries, shared }: { entries: Entry[]; shared: Shared }) {
  return entries.map((entry) => (
    <li key={entry.key}>
      <EntryChip
        entry={entry}
        selected={entry.key === shared.selectedKey}
        onOpen={shared.onOpen}
        onDragStart={shared.onDragStart}
        onDragEnd={shared.onDragEnd}
      />
    </li>
  ));
}

function MonthCell({
  day,
  inMonth,
  shared,
  onMore,
}: {
  day: Date;
  inMonth: boolean;
  shared: Shared;
  onMore: (day: Date) => void;
}) {
  const key = dayKey(day);
  const entries = shared.byDay.get(key) ?? [];
  const isToday = key === shared.today;
  const { over, handlers } = useDropTarget(() => shared.onDrop(day, null));
  const hidden = entries.length - SHOWN;
  return (
    <section
      aria-label={new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(day)}
      data-day={key}
      {...handlers}
      className={cn(
        "flex min-h-32 min-w-0 flex-col gap-1 rounded-lg p-1.5 transition-colors",
        over ? "bg-muted" : inMonth ? "bg-surface" : "bg-surface/50",
      )}
    >
      <span
        className={cn(
          "flex size-6 items-center justify-center self-start rounded-full text-xs tabular-nums",
          isToday && "bg-foreground text-background font-semibold",
          !isToday && !inMonth && "text-muted-foreground/70",
        )}
      >
        {day.getDate()}
      </span>
      <ul className="flex min-w-0 flex-col gap-0.5">
        <Chips entries={hidden > 0 ? entries.slice(0, SHOWN - 1) : entries} shared={shared} />
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => onMore(day)}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 self-start rounded px-1.5 text-xs outline-none focus-visible:ring-3"
        >
          {hidden + 1} more
        </button>
      )}
    </section>
  );
}

/** A month as weeks of days, Sunday first, like Google Calendar's month view. */
export function MonthGrid({
  days,
  month,
  onMore,
  ...shared
}: Shared & { days: Date[]; month: number; onMore: (day: Date) => void }) {
  return (
    <div className="flex min-w-[36rem] flex-col gap-1">
      <div className="grid grid-cols-7 gap-1" aria-hidden="true">
        {days.slice(0, 7).map((day) => (
          <span key={dayKey(day)} className="text-muted-foreground px-1.5 text-xs font-medium">
            {WEEKDAY_FORMAT.format(day)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <MonthCell
            key={dayKey(day)}
            day={day}
            inMonth={day.getMonth() === month}
            shared={shared}
            onMore={onMore}
          />
        ))}
      </div>
    </div>
  );
}

function HourCell({
  day,
  hour,
  entries,
  shared,
}: {
  day: Date;
  hour: number;
  entries: Entry[];
  shared: Shared;
}) {
  const { over, handlers } = useDropTarget(() => shared.onDrop(day, hour));
  return (
    <div
      data-hour={`${dayKey(day)}T${String(hour).padStart(2, "0")}`}
      {...handlers}
      className={cn(
        "min-h-11 min-w-0 rounded-md p-0.5 transition-colors",
        over ? "bg-muted" : "bg-surface",
      )}
    >
      {entries.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-0.5">
          <Chips entries={entries} shared={shared} />
        </ul>
      )}
    </div>
  );
}

function AllDayCell({ day, entries, shared }: { day: Date; entries: Entry[]; shared: Shared }) {
  const { over, handlers } = useDropTarget(() => shared.onDrop(day, null));
  return (
    <div
      data-day={dayKey(day)}
      {...handlers}
      className={cn(
        "min-h-9 min-w-0 rounded-md p-0.5 transition-colors",
        over ? "bg-muted" : "bg-surface",
      )}
    >
      <ul className="flex min-w-0 flex-col gap-0.5">
        <Chips entries={entries} shared={shared} />
      </ul>
    </div>
  );
}

/**
 * A week as hours down and days across. Due slots and all-day runs sit in a row above the
 * hours; dropping on an hour sets that hour. Opens scrolled to the working morning.
 */
export function WeekGrid({ days, ...shared }: Shared & { days: Date[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const morning = scroller.current?.querySelector<HTMLElement>('[data-row="7"]');
    if (scroller.current && morning) scroller.current.scrollTop = morning.offsetTop - 8;
  }, []);
  const timed = (day: Date, hour: number) =>
    (shared.byDay.get(dayKey(day)) ?? []).filter(
      (entry) =>
        entry.type !== "due" && entry.type !== "repeat" && new Date(entry.at).getHours() === hour,
    );
  const allDay = (day: Date) =>
    (shared.byDay.get(dayKey(day)) ?? []).filter(
      (entry) => entry.type === "due" || entry.type === "repeat",
    );
  const columns = "grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] gap-1";
  return (
    <div className="flex min-w-[36rem] flex-col gap-1">
      <div className={columns}>
        <span />
        {days.map((day) => {
          const isToday = dayKey(day) === shared.today;
          return (
            <span key={dayKey(day)} className="flex items-center gap-1.5 px-1.5 text-xs">
              <span className="text-muted-foreground font-medium">
                {WEEKDAY_FORMAT.format(day)}
              </span>
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full tabular-nums",
                  isToday && "bg-foreground text-background font-semibold",
                )}
              >
                {day.getDate()}
              </span>
            </span>
          );
        })}
      </div>
      <div className={columns}>
        <span className="text-muted-foreground self-center pr-1 text-right text-[0.6875rem]">
          All day
        </span>
        {days.map((day) => (
          <AllDayCell key={dayKey(day)} day={day} entries={allDay(day)} shared={shared} />
        ))}
      </div>
      <div ref={scroller} className="relative flex max-h-[34rem] flex-col gap-1 overflow-y-auto">
        {HOURS.map((hour) => (
          <div key={hour} data-row={hour} className={columns}>
            <span className="text-muted-foreground pt-1 pr-1 text-right text-[0.6875rem] tabular-nums">
              {hourLabel.format(new Date(2026, 0, 1, hour))}
            </span>
            {days.map((day) => (
              <HourCell
                key={dayKey(day)}
                day={day}
                hour={hour}
                entries={timed(day, hour)}
                shared={shared}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
