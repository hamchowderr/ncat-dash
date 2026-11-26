"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/catalog";

/** The longest brief kept, in letters (MAX_BRIEF in convex/lib/library.ts). */
export const MAX_BRIEF = 2000;

/**
 * A video's own brief: how it should be paced and cut. The AI planning steps follow it on
 * top of the team's house rules. Saved when the box is left.
 */
export function VideoBrief({
  itemId,
  brief,
  briefFrom,
}: {
  itemId: Id<"libraryItems">;
  brief: string;
  briefFrom: { _id: Id<"libraryItems">; shortId: string; title: string } | null;
}) {
  const setBrief = useMutation(api.library.setBrief);
  const [text, setText] = useState(brief);
  const [saved, setSaved] = useState(false);
  // A change made elsewhere shows here: when the saved brief changes, the box follows it.
  const [shown, setShown] = useState(brief);
  if (shown !== brief) {
    setShown(brief);
    setText(brief);
  }

  async function save() {
    const next = text.trim();
    if (next === brief.trim()) return;
    try {
      await setBrief({ itemId, brief: next });
      setSaved(true);
    } catch (caught) {
      toast.error(errorMessage(caught, "The brief could not be saved."));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium" id="video-brief-label">
        Brief
      </h2>
      <Textarea
        aria-labelledby="video-brief-label"
        aria-describedby="video-brief-help"
        value={text}
        maxLength={MAX_BRIEF}
        rows={4}
        placeholder="Fast cuts for TikTok. Keep the pricing story whole. Mostly screen, little face."
        onChange={(event) => {
          setText(event.target.value);
          setSaved(false);
        }}
        onBlur={() => void save()}
      />
      <p className="text-muted-foreground text-xs" id="video-brief-help">
        {saved ? (
          "Saved. "
        ) : briefFrom && !text.trim() ? (
          <>
            Follows the brief of{" "}
            <Link className="text-foreground underline" href={`/library/${briefFrom._id}`}>
              {briefFrom.shortId} {briefFrom.title}
            </Link>{" "}
            until you write one here.{" "}
          </>
        ) : null}
        Pacing and direction for this video. Best Moments, Chapters, Plan B-Roll, Plan Motion
        Graphics and Suggest Scenes follow it, on top of your house rules.
      </p>
    </div>
  );
}
