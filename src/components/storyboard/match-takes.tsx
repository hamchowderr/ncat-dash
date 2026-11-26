"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { count } from "@convex/lib/storyboard";
import { useAction, useQuery } from "convex/react";
import { ListChecks } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { errorMessage } from "@/lib/catalog";

import { takeList } from "./make-video";
import type { Board } from "./types";

/** At most this many recordings are matched at once (storyboardMatch.ts). */
const MOST = 20;

type Matched = { matched: number; picked: number[]; missing: number[]; notReady: string[] };

/** What a match did, in a sentence or two. */
export function matchSummary(result: Matched): string {
  const parts = [
    result.matched === 0
      ? "No new takes were found for the lines."
      : `Put in ${count(result.matched, "take")}.`,
  ];
  if (result.picked.length > 0) {
    parts.push(`Picked the best of several for ${takeList(result.picked)}.`);
  }
  if (result.missing.length > 0) parts.push(`Not found yet: ${takeList(result.missing)}.`);
  if (result.notReady.length > 0) {
    parts.push(`Still being transcribed: ${result.notReady.join(", ")}.`);
  }
  return parts.join(" ");
}

/**
 * Matches recordings to the storyboard's lines by what was said in them: pick the
 * recordings, and the best take of each line goes in as its take of you. Gives the button
 * for the storyboard's bar and the panel it opens in place under the bar, so nothing covers
 * the takes.
 */
export function useMatchTakes(board: Board) {
  const recordings = useQuery(api.storyboards.uploadDrafts, {
    organizationId: board.organizationId,
  });
  const match = useAction(api.storyboardMatch.match);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<Id<"libraryItems">>>(new Set());
  const [replace, setReplace] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // An upload's own storyboard already has its takes in.
  const choices = (recordings ?? []).filter((one) => one.libraryItemId !== board.libraryItemId);

  async function go() {
    setPending(true);
    try {
      const done = await match({
        storyboardId: board._id,
        libraryItemIds: [...picked],
        ...(replace ? { replace: true } : {}),
      });
      const summary = matchSummary(done);
      setResult(summary);
      toast.success(summary);
    } catch (caught) {
      toast.error(errorMessage(caught, "The takes could not be matched."));
    } finally {
      setPending(false);
    }
  }

  const toggle = (id: Id<"libraryItems">, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on && next.size < MOST) next.add(id);
      else next.delete(id);
      return next;
    });

  return {
    button: (
      <Button
        size="sm"
        variant={open ? "secondary" : "ghost"}
        aria-expanded={open}
        disabled={board.takeCount === 0}
        onClick={() => setOpen((now) => !now)}
        title="Find each line in your recordings by what was said, and use the best take."
      >
        <ListChecks />
        Match takes
      </Button>
    ),
    panel: open ? (
      <section
        aria-label="Match takes"
        className="flex flex-col gap-3 rounded-xl bg-surface px-4 py-3"
      >
        <p className="text-muted-foreground text-sm">
          Pick the recordings your takes are in. Each line is found by what was said, and when a
          line was said more than once, the best take is used.
        </p>
        {choices.length === 0 ? (
          <p className="text-sm">
            No recordings with their words in yet. Upload your takes, and they can be matched once
            they are transcribed.
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto" aria-label="Recordings">
            {choices.map((one) => (
              <li key={one.libraryItemId}>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={picked.has(one.libraryItemId)}
                    onCheckedChange={(on) => toggle(one.libraryItemId, on === true)}
                  />
                  <span className="text-muted-foreground font-mono text-xs">{one.shortId}</span>
                  <span className="min-w-0 truncate">{one.title}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={replace} onCheckedChange={(on) => setReplace(on === true)} />
          Pick again for lines that already have a take
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending || picked.size === 0} onClick={() => void go()}>
            {pending ? "Matching…" : `Match ${count(picked.size, "recording")}`}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
        {result && (
          <p className="text-sm" aria-live="polite">
            {result}
          </p>
        )}
      </section>
    ) : null,
  };
}
