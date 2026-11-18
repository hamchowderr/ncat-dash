"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { AudioLines, FileIcon, ImageIcon, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type UploadKind = "video" | "audio" | "image" | "other";

// The backend signs up to this many links per call.
const BATCH = 25;
// Previews are signed for six hours; ask again a little before that.
const FRESH_FOR_MS = 5 * 60 * 60 * 1000;

/**
 * Links to show the given uploads from, asked for in batches as uploads appear. A link is kept
 * while it is fresh, so scrolling and re-renders do not sign the same file again.
 */
export function usePreviewLinks(
  organizationId: string,
  uploads: { _id: Id<"uploads">; kind: UploadKind }[] | undefined,
): Map<Id<"uploads">, string> {
  const previewLinks = useAction(api.storage.previewLinks);
  const [links, setLinks] = useState<Map<Id<"uploads">, { url: string; at: number }>>(new Map());
  const asked = useRef(new Map<Id<"uploads">, number>());

  const wanted = (uploads ?? [])
    .filter((upload) => upload.kind !== "other")
    .map((upload) => upload._id);
  const wantedKey = wanted.join(",");

  useEffect(() => {
    const now = Date.now();
    const missing = wantedKey
      .split(",")
      .filter(Boolean)
      .map((id) => id as Id<"uploads">)
      .filter((id) => {
        const at = asked.current.get(id);
        return at === undefined || now - at > FRESH_FOR_MS;
      });
    if (missing.length === 0) return;
    for (const id of missing) asked.current.set(id, now);
    for (let start = 0; start < missing.length; start += BATCH) {
      const uploadIds = missing.slice(start, start + BATCH);
      previewLinks({ organizationId, uploadIds })
        .then((answer) =>
          setLinks((current) => {
            const next = new Map(current);
            for (const link of answer) next.set(link.uploadId, { url: link.url, at: now });
            return next;
          }),
        )
        .catch(() => {
          // Ask again next time: the frame stays a plain tile meanwhile.
          for (const id of uploadIds) asked.current.delete(id);
        });
    }
  }, [organizationId, previewLinks, wantedKey]);

  return useMemo(() => new Map([...links].map(([id, link]) => [id, link.url])), [links]);
}

const KIND_ICONS = { video: Video, audio: AudioLines, image: ImageIcon, other: FileIcon };

/**
 * One upload as a picture: a video shows its opening frame and plays without sound while the
 * pointer is on it, a picture shows itself, a sound or other file shows what it is.
 */
export function UploadFrame({
  kind,
  url,
  hovering = false,
  className,
}: {
  kind: UploadKind;
  url: string | undefined;
  hovering?: boolean;
  className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (hovering) {
      // A browser may refuse to play (data saver, no autoplay): the frame stays as it is.
      Promise.resolve()
        .then(() => element.play())
        .catch(() => {});
    } else {
      element.pause();
      if (element.readyState > 0) element.currentTime = 0.1;
    }
  }, [hovering]);

  const Icon = KIND_ICONS[kind];
  const showsMedia = url && !failed && (kind === "video" || kind === "image");

  return (
    <div
      className={cn(
        "bg-muted relative flex aspect-video items-center justify-center overflow-hidden",
        kind === "video" && showsMedia && "bg-black",
        className,
      )}
    >
      {showsMedia && kind === "video" ? (
        <video
          ref={video}
          // The first frame, not a black one: browsers show the frame at this time.
          src={`${url}#t=0.1`}
          muted
          loop
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
          className="size-full object-cover"
          data-testid="upload-frame-video"
        />
      ) : showsMedia && kind === "image" ? (
        // The file sits in the team's own storage, so there is nothing for Next to resize.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          onError={() => setFailed(true)}
          className="size-full object-cover"
          data-testid="upload-frame-image"
        />
      ) : (
        <Icon className="text-muted-foreground size-8" aria-hidden="true" />
      )}
    </div>
  );
}

/** The upload played or shown at full size, for the details view. */
export function UploadPlayer({ kind, url }: { kind: UploadKind; url: string | undefined }) {
  if (kind === "other") return null;
  if (!url) return <div className="bg-muted aspect-video w-full animate-pulse rounded-lg" />;
  if (kind === "video") {
    return (
      <video
        src={url}
        controls
        autoPlay
        playsInline
        preload="metadata"
        className="max-h-[70vh] w-full rounded-lg bg-black"
        data-testid="upload-player"
      />
    );
  }
  if (kind === "audio") {
    return (
      <div className="bg-muted flex aspect-video w-full flex-col items-center justify-center gap-6 rounded-lg p-6">
        <AudioLines className="text-muted-foreground size-12" aria-hidden="true" />
        <audio
          src={url}
          controls
          preload="metadata"
          className="w-full max-w-md"
          data-testid="upload-player"
        />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="bg-muted max-h-[70vh] w-full rounded-lg object-contain"
      data-testid="upload-player"
    />
  );
}
