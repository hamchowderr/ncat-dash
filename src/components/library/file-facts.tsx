"use client";

import { detailsKind, formatDuration, type FileDetails } from "@takewon/automation-core";
import { Clock, FileVideo, Film, HardDrive, Scan, Volume2, VolumeX } from "lucide-react";
import type { ComponentType } from "react";

import { formatBytes } from "@/lib/catalog";
import { cn } from "@/lib/utils";

type Fact = { name: string; value: string; icon: ComponentType<{ className?: string }> };

/** A file's numbers, each with what it is: length, picture size, frame rate, format, sound, size. */
export function fileFacts(details: FileDetails, size?: number | null): Fact[] {
  const kind = detailsKind(details);
  const facts: Fact[] = [];
  if (details.duration !== undefined && kind !== "image") {
    facts.push({ name: "Length", value: formatDuration(details.duration), icon: Clock });
  }
  if (details.width !== undefined && details.height !== undefined) {
    facts.push({ name: "Picture size", value: `${details.width}×${details.height}`, icon: Scan });
  }
  if (details.fps !== undefined && kind === "video") {
    const fps = Math.round(details.fps * 100) / 100;
    facts.push({ name: "Frame rate", value: `${fps} fps`, icon: Film });
  }
  const format = kind === "image" ? details.format : details.videoCodec;
  if (format) facts.push({ name: "Format", value: format, icon: FileVideo });
  if (kind === "video" && details.hasAudio === false) {
    facts.push({ name: "Sound", value: "No sound", icon: VolumeX });
  } else if ((kind === "video" || kind === "audio") && details.audioCodec) {
    facts.push({ name: "Sound", value: details.audioCodec, icon: Volume2 });
  }
  const bytes = size ?? details.filesize;
  if (bytes) facts.push({ name: "File size", value: formatBytes(bytes), icon: HardDrive });
  return facts;
}

/** The numbers as small labels, each with its own icon and its name on hover. */
export function FileFacts({
  details,
  size,
  className,
}: {
  details: FileDetails;
  size?: number | null;
  className?: string;
}) {
  const facts = fileFacts(details, size);
  if (facts.length === 0) return null;
  return (
    <ul aria-label="About the file" className={cn("flex flex-wrap gap-1.5", className)}>
      {facts.map(({ name, value, icon: Icon }) => (
        <li
          key={name}
          title={name}
          aria-label={`${name}: ${value}`}
          className="bg-surface text-foreground inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs tabular-nums"
        >
          <Icon className="text-muted-foreground size-3.5" aria-hidden="true" />
          {value}
        </li>
      ))}
    </ul>
  );
}
