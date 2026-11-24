"use client";

import { type AutomationDraft, draftChanges } from "@takewon/automation-core";
import { ChevronDown, PencilLine, Upload } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Shown above the canvas while it holds changes the live automation does not have yet:
 * says so, lists what changed, and offers to publish them or throw them away.
 */
export function DraftBar({
  enabled,
  live,
  draft,
  busy,
  restoredFrom,
  onPublish,
  onDiscard,
}: {
  /** The automation is on, so the live version is running by itself right now. */
  enabled: boolean;
  live: AutomationDraft;
  draft: AutomationDraft;
  busy: boolean;
  /** The version this draft was brought back from, if it was. */
  restoredFrom?: number | null;
  onPublish: () => void;
  onDiscard: () => void;
}) {
  const changes = useMemo(() => draftChanges(live, draft), [live, draft]);
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-amber-500/10 px-3 py-2"
    >
      <PencilLine
        className="size-4 shrink-0 text-amber-700 dark:text-amber-400"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">
          {restoredFrom ? `Draft from version ${restoredFrom}.` : "Draft."}
        </span>{" "}
        {enabled
          ? "The live version keeps running by itself until you publish."
          : "Publish to make this the version that runs."}
      </p>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm">
            {changes.length === 0
              ? "Layout only"
              : `${changes.length} ${changes.length === 1 ? "change" : "changes"}`}
            <ChevronDown />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <h3 className="font-medium">What publishing changes</h3>
          {changes.length === 0 ? (
            <p className="text-muted-foreground">
              Steps were moved on the canvas. It runs the same as the live version.
            </p>
          ) : (
            <ul className="text-muted-foreground flex max-h-60 list-disc flex-col gap-1 overflow-y-auto pl-4">
              {changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="sm" disabled={busy} onClick={onDiscard}>
        Discard draft
      </Button>
      <Button size="sm" disabled={busy} onClick={onPublish}>
        <Upload />
        Publish
      </Button>
    </div>
  );
}
