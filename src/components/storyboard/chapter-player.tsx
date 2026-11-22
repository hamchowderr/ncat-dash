"use client";

import { fileKindOf } from "@convex/lib/packages";
import { timeRangeOf } from "@ncat-dash/automation-core";
import { type Part, secondsFor } from "@convex/lib/storyboard";
import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useFileLink } from "@/lib/use-brand-upload";

import { SceneSketch } from "./scene-sketch";
import type { Chapter, Take } from "./types";

/** The file shown for a take while it plays: you first, then what is shown with you. */
const SHOWN_FIRST: Part[] = ["you", "recording", "screen", "graphic"];

export function shownFile(take: Take): string | null {
  for (const part of SHOWN_FIRST) {
    const file = take.files[part];
    if (file) return file;
  }
  return null;
}

/** How long a take without a video stays up: about as long as its line takes to say. */
export const holdSeconds = (take: Take) => Math.max(2, secondsFor([take.line]));

/** One take on the preview: its video or picture, or a card with its line while none is in. */
function Shown({ take, playing, onDone }: { take: Take; playing: boolean; onDone: () => void }) {
  const file = shownFile(take);
  const link = useFileLink(file ?? undefined);
  // A take cut from an upload plays only its stretch; the browser pauses at its end
  // without an "ended", so the next take starts from here.
  const range = file ? timeRangeOf(file) : null;
  const finished = useRef(false);
  const kind = link ? fileKindOf(link) : null;
  const video = kind === "video" || kind === "audio";

  const player = useRef<HTMLVideoElement>(null);
  const [stuck, setStuck] = useState(false);

  // A picture or a card stays up for the time the line takes, then the next take plays. So
  // does a video the browser will not play, so the preview never stops on it.
  useEffect(() => {
    if (!playing || (video && link && !stuck)) return;
    const timer = window.setTimeout(onDone, holdSeconds(take) * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, video, link, stuck, take, onDone]);

  useEffect(() => {
    const element = player.current;
    if (!element) return;
    if (playing) element.play().catch(() => setStuck(true));
    else element.pause();
  }, [playing, link]);

  if (link && video) {
    return (
      <video
        ref={player}
        key={link}
        src={link}
        playsInline
        preload="auto"
        controls={!playing}
        onEnded={onDone}
        onTimeUpdate={(event) => {
          if (finished.current || !playing || !range) return;
          if (event.currentTarget.currentTime >= range.end - 0.05) {
            finished.current = true;
            event.currentTarget.pause();
            onDone();
          }
        }}
        onError={() => setStuck(true)}
        className="aspect-video w-full rounded-lg bg-black object-contain"
      />
    );
  }
  if (link && kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={link} alt="" className="aspect-video w-full rounded-lg bg-black object-contain" />
    );
  }
  return (
    <div
      data-testid="take-card"
      className="flex aspect-video w-full flex-col justify-between gap-2 rounded-lg bg-zinc-900 p-3 text-zinc-100"
    >
      <span className="flex items-center justify-between gap-2 text-xs text-zinc-400">
        <span className="font-mono">Take {take.number}</span>
        <span>No file yet</span>
      </span>
      <span className="line-clamp-4 text-sm leading-snug">{take.line}</span>
      <SceneSketch scene={take.scene} className="w-14 self-end" />
    </div>
  );
}

/**
 * Plays a chapter's takes one after another from the files already in, so it can be watched
 * before anything is edited. Takes still missing a file show as a card with their line.
 */
export function ChapterPlayer({ chapter }: { chapter: Chapter }) {
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const takes = chapter.takes;
  const current = takes[Math.min(at, takes.length - 1)];
  const withFiles = takes.filter((take) => shownFile(take)).length;

  const count = takes.length;
  const next = useCallback(() => {
    setAt((index) => {
      if (index + 1 >= count) {
        setPlaying(false);
        return 0;
      }
      return index + 1;
    });
  }, [count]);

  if (!current) {
    return (
      <p className="text-muted-foreground text-sm">Add a take to this chapter to preview it.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Shown key={current._id} take={current} playing={playing} onDone={next} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setPlaying((on) => !on)}>
          {playing ? <Pause /> : <Play />}
          {playing ? "Pause" : at === 0 ? "Play chapter" : "Keep playing"}
        </Button>
        <span className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
          Take {current.number} · {at + 1} of {takes.length}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        {withFiles === 0
          ? "No files in yet, so each take shows as a card with its line."
          : `${withFiles} of ${takes.length} takes have a file. The rest show as a card with their line.`}
      </p>
    </div>
  );
}
