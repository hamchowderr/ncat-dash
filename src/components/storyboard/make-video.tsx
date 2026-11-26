"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { count } from "@convex/lib/storyboard";
import { useMutation, useQuery } from "convex/react";
import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useLibraryLinks } from "@/components/library/library-media";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { errorMessage } from "@/lib/catalog";

import type { Board, Chapter } from "./types";

type Video = NonNullable<ReturnType<typeof useVideos>>[number];

const useVideos = (storyboardId: Id<"storyboards">) =>
  useQuery(api.storyboardVideos.list, { storyboardId });

/** "takes 3 and 9", "take 4", "takes 1, 2 and 5". */
export function takeList(numbers: number[]): string {
  if (numbers.length === 1) return `take ${numbers[0]}`;
  const shown = numbers.slice(0, 8);
  const rest = numbers.length - shown.length;
  const head = shown.slice(0, -1).join(", ");
  return rest > 0
    ? `takes ${shown.join(", ")} and ${rest} more`
    : `takes ${head} and ${shown.at(-1)}`;
}

/** What happened to the takes that were not made as planned. */
export function videoNotes(video: Pick<Video, "skipped" | "plain">): string[] {
  const notes: string[] = [];
  if (video.skipped.length > 0) {
    notes.push(`Left out ${takeList(video.skipped)}: waiting for your take or its file.`);
  }
  if (video.plain.length > 0) {
    notes.push(
      `Shown Full Screen for now: ${takeList(video.plain)}, until what goes beside you is in.`,
    );
  }
  return notes;
}

function VideoRow({ video, link }: { video: Video; link: string | undefined }) {
  return (
    <li className="flex flex-col gap-2" data-testid="storyboard-video">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-medium">{video.title}</span>
        <span className="text-muted-foreground shrink-0 text-xs">{video.aspect}</span>
      </div>
      {video.status === "working" && (
        <div className="flex flex-col gap-1.5">
          <Progress value={(video.made / Math.max(1, video.total)) * 100} />
          <span className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
            {video.joining
              ? "Joining the takes into one video…"
              : `Making the takes: ${video.made} of ${video.total} done`}
          </span>
        </div>
      )}
      {video.status === "failed" && (
        <p className="text-destructive text-xs">{video.error ?? "The video could not be made."}</p>
      )}
      {video.status === "done" && video.file && (
        <>
          {link ? (
            <video
              src={link}
              controls
              playsInline
              preload="metadata"
              style={{ aspectRatio: video.aspect.replace(":", " / ") }}
              className="max-h-96 w-full rounded-lg bg-black object-contain"
            />
          ) : null}
          <Link
            href={`/library/${video.file._id}`}
            className="text-xs font-medium underline-offset-4 hover:underline"
          >
            Open {video.file.shortId} in your Library
          </Link>
        </>
      )}
      {videoNotes(video).map((note) => (
        <p key={note} className="text-muted-foreground text-xs">
          {note}
        </p>
      ))}
    </li>
  );
}

/**
 * Makes the storyboard, or the chapter on screen, into one finished video: every take in
 * its scene, joined in order, kept in the Library. Shows how far the latest ones are.
 */
export function MakeVideo({ board, chapter }: { board: Board; chapter: Chapter }) {
  const videos = useVideos(board._id);
  const start = useMutation(api.storyboardVideos.start);
  const [pending, setPending] = useState(false);
  const working = videos?.some((video) => video.status === "working") ?? false;
  const made = useMemo(
    () =>
      (videos ?? []).flatMap((video) =>
        video.status === "done" && video.file
          ? [{ _id: video.file._id, kind: "video" as const }]
          : [],
      ),
    [videos],
  );
  const links = useLibraryLinks(board.organizationId, made);

  async function go(chapterId?: Id<"storyboardChapters">) {
    setPending(true);
    try {
      const started = await start({ storyboardId: board._id, ...(chapterId ? { chapterId } : {}) });
      toast.success(`Making ${count(started.takes, "take")} into one video.`);
    } catch (caught) {
      toast.error(errorMessage(caught, "The video could not be started."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Finished video" className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Finished video</h3>
      <p className="text-muted-foreground text-xs">
        Each take is made in its scene, then joined in order. The video goes to your Library.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending || working} onClick={() => void go()}>
          <Clapperboard />
          Make the video
        </Button>
        {board.chapters.length > 1 && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || working}
            onClick={() => void go(chapter._id)}
          >
            Just this chapter
          </Button>
        )}
      </div>
      {videos && videos.length > 0 && (
        <ul className="flex flex-col gap-4" aria-label="Videos made">
          {videos.map((video) => (
            <VideoRow
              key={video._id}
              video={video}
              link={video.file ? links.get(video.file._id) : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
