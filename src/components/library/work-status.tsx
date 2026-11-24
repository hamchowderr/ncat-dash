"use client";

import { cn } from "@/lib/utils";

/**
 * Where a piece of background work on a file stands, in four colours: amber while it is
 * being done, green once it is in, red when it did not work, and grey while it waits on
 * something else (or has nothing to do). Modelled on the per-quality "Processing SD / HD"
 * checks a video shows after upload on YouTube Studio, and on the status dots Linear uses.
 */
export type WorkState = "working" | "ready" | "failed" | "waiting";

const LOOK: Record<WorkState, { dot: string; chip: string; word: string }> = {
  working: {
    dot: "bg-amber-500 motion-safe:animate-pulse",
    chip: "bg-amber-50 text-amber-900",
    word: "In progress",
  },
  ready: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-900", word: "Ready" },
  failed: { dot: "bg-destructive", chip: "bg-red-50 text-red-900", word: "Did not work" },
  waiting: {
    dot: "bg-muted-foreground/50",
    chip: "bg-muted text-muted-foreground",
    word: "Waiting",
  },
};

export type Work = {
  /** What the work makes, such as "Transcript" or "Spanish subtitles". */
  label: string;
  state: WorkState;
  /** Said in place of the state's own word, such as "Nothing was said". */
  note?: string;
  /** Opens the place on the page where the work shows. */
  onOpen?: () => void;
};

/** One piece of work as a small coloured chip: a dot, what it is, and where it stands. */
export function WorkChip({ work, className }: { work: Work; className?: string }) {
  const look = LOOK[work.state];
  const body = (
    <>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", look.dot)} />
      <span className="font-medium">{work.label}</span>
      <span className="opacity-75">{work.note ?? look.word}</span>
    </>
  );
  const shared = cn(
    "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs whitespace-nowrap",
    look.chip,
    className,
  );
  const name = `${work.label}: ${work.note ?? look.word}`;
  return work.onOpen ? (
    <button
      type="button"
      onClick={work.onOpen}
      aria-label={name}
      data-state={work.state}
      className={cn(
        shared,
        "hover:brightness-95 focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
      )}
    >
      {body}
    </button>
  ) : (
    <span role="status" aria-label={name} data-state={work.state} className={shared}>
      {body}
    </span>
  );
}

/** Every piece of work on a file, in a row that wraps. Nothing shows when there is none. */
export function WorkRow({ works, className }: { works: Work[]; className?: string }) {
  if (works.length === 0) return null;
  return (
    <ul
      aria-label="What is being done with this file"
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {works.map((work) => (
        <li key={work.label}>
          <WorkChip work={work} />
        </li>
      ))}
    </ul>
  );
}

/** A transcript's state from the file's own: an upload with none yet is being caught up. */
export function transcriptState(
  searchable: "no" | "working" | "ready" | "failed",
  source: "upload" | "automation",
): WorkState {
  if (searchable === "ready") return "ready";
  if (searchable === "failed") return "failed";
  if (searchable === "working") return "working";
  // Everything brought in is transcribed by itself; a file an automation made waits for a
  // person to ask.
  return source === "upload" ? "working" : "waiting";
}
