"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import Link from "next/link";

import { Checkbox } from "@/components/ui/checkbox";

const FILE_WORDS = { any: "any file", video: "videos", audio: "audio", image: "images" } as const;

/** The kinds of file an automation runs on, in words: "videos", "videos and audio". */
export function fileTypesLine(types: readonly (keyof typeof FILE_WORDS)[]): string {
  const words = types.map((type) => FILE_WORDS[type]);
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/**
 * What happens to the next files sent: the transcript, SRT and storyboard draft every
 * upload gets, then each automation set to run by itself, ticked, so one can sit out the
 * files sent now. Those set to ask first show on each file's page instead.
 */
export function OnThisUpload({
  organizationId,
  skipped,
  onSkippedChange,
}: {
  organizationId: string;
  skipped: Id<"automations">[];
  onSkippedChange: (skipped: Id<"automations">[]) => void;
}) {
  const automations = useQuery(api.automations.runOnUpload, { organizationId });
  return (
    <section aria-labelledby="on-this-upload" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="on-this-upload" className="text-sm font-medium">
          On this upload
        </h2>
        <p className="text-muted-foreground text-sm">
          Every upload gets its transcript, SRT and storyboard draft.
          {automations && automations.length > 0
            ? " These automations also run on it by themselves. Untick one to skip it for the files you send now."
            : " No automation runs on uploads by itself. Ones set to ask first show on each file's page."}
        </p>
      </div>
      {automations && automations.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {automations.map((automation) => {
            const on = !skipped.includes(automation._id);
            const id = `on-upload-${automation._id}`;
            return (
              <li key={automation._id} className="flex items-start gap-2.5">
                <Checkbox
                  id={id}
                  checked={on}
                  onCheckedChange={(checked) =>
                    onSkippedChange(
                      checked === true
                        ? skipped.filter((each) => each !== automation._id)
                        : [...skipped, automation._id],
                    )
                  }
                  className="mt-0.5"
                />
                <label htmlFor={id} className="grid gap-0.5 text-sm">
                  <span className="font-medium">{automation.name}</span>
                  <span className="text-muted-foreground text-xs">
                    On {fileTypesLine(automation.fileTypes)} ·{" "}
                    <Link
                      href={`/automations/${automation._id}`}
                      aria-label={`Change ${automation.name}`}
                      className="underline underline-offset-4"
                    >
                      Change
                    </Link>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
