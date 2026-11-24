"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type LibraryKind = "video" | "audio" | "image" | "other";

// The backend signs up to this many links per call.
const BATCH = 25;
// Links are signed for six hours; ask again a little before that.
const FRESH_FOR_MS = 5 * 60 * 60 * 1000;

/** Links to show and play library files, asked for in batches as files appear on screen. */
export function useLibraryLinks(
  organizationId: string,
  items: { _id: Id<"libraryItems">; kind: LibraryKind }[] | undefined,
): Map<Id<"libraryItems">, string> {
  const previewLinks = useAction(api.library.previewLinks);
  const [links, setLinks] = useState<Map<Id<"libraryItems">, { url: string; at: number }>>(
    new Map(),
  );
  const asked = useRef(new Map<Id<"libraryItems">, number>());
  const wantedKey = (items ?? [])
    .filter((item) => item.kind !== "other")
    .map((item) => item._id)
    .join(",");

  useEffect(() => {
    const now = Date.now();
    const missing = wantedKey
      .split(",")
      .filter(Boolean)
      .map((id) => id as Id<"libraryItems">)
      .filter((id) => {
        const at = asked.current.get(id);
        return at === undefined || now - at > FRESH_FOR_MS;
      });
    if (missing.length === 0) return;
    for (const id of missing) asked.current.set(id, now);
    for (let start = 0; start < missing.length; start += BATCH) {
      const itemIds = missing.slice(start, start + BATCH);
      previewLinks({ organizationId, itemIds })
        .then((answer) =>
          setLinks((current) => {
            const next = new Map(current);
            for (const link of answer) next.set(link.itemId, { url: link.url, at: now });
            return next;
          }),
        )
        .catch(() => {
          for (const id of itemIds) asked.current.delete(id);
        });
    }
  }, [organizationId, previewLinks, wantedKey]);

  return useMemo(() => new Map([...links].map(([id, link]) => [id, link.url])), [links]);
}

export const KIND_LABELS: Record<LibraryKind, string> = {
  video: "Video",
  audio: "Sound",
  image: "Picture",
  other: "File",
};

export type LibraryFrom = "computer" | "zoom" | "google_meet" | "microsoft" | "dropbox" | "link";

/** Each place an upload can come from, as the From filter and the files name it. */
export const FROM_LABELS: Record<LibraryFrom, string> = {
  computer: "Uploaded",
  zoom: "Zoom",
  google_meet: "Google Meet",
  microsoft: "Microsoft Teams",
  dropbox: "Dropbox",
  link: "Pasted link",
};

/** Where a file came from, in a few words. */
export function sourceLabel(item: {
  source: "upload" | "automation";
  kind: LibraryKind;
  automationName: string | null;
  from?: LibraryFrom | null;
}): string {
  if (item.source === "upload") {
    return !item.from || item.from === "computer" ? "Uploaded" : `From ${FROM_LABELS[item.from]}`;
  }
  return item.automationName ? `Made by ${item.automationName}` : "Made by an automation";
}

/** The short ID, as a quiet label people can read out: "C99". */
export function ShortId({ id, className }: { id: string; className?: string }) {
  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground inline-flex h-5 items-center rounded-md px-1.5 font-mono text-[11px] font-medium tabular-nums",
        className,
      )}
    >
      {id}
    </span>
  );
}

/**
 * Stars from one to five. Pressing the star already given takes the rating away. Shown
 * read-only when there is nothing to change it with.
 */
export function StarRating({
  value,
  onChange,
  label,
  size = "sm",
}: {
  value: number | null;
  onChange?: (next: number | null) => void;
  label: string;
  size?: "sm" | "md";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const icon = size === "md" ? "size-5" : "size-4";
  if (!onChange) {
    if (!value) return null;
    return (
      <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
        {Array.from({ length: value }, (_, index) => (
          <Star key={index} className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
        ))}
      </span>
    );
  }
  return (
    <div
      className="inline-flex items-center"
      role="radiogroup"
      aria-label={label}
      onPointerLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={star === 1 ? "1 star" : `${star} stars`}
          className="focus-visible:ring-ring/50 rounded p-0.5 outline-none focus-visible:ring-2"
          onPointerEnter={() => setHover(star)}
          onClick={() => onChange(value === star ? null : star)}
        >
          <Star
            className={cn(
              icon,
              "transition-colors",
              star <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
            )}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}
