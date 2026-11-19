"use client";

import { formatMoment, momentPercent } from "@ncat-dash/review-core";
import { Pause, Play } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import { DrawingLayer, DrawingTools, type StageDrawing } from "./frame-drawing";
import { Face } from "./person";

const IMAGE = /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i;

/** A still picture has no timeline; everything else is played. */
export function isStill(url: string): boolean {
  return IMAGE.test(url);
}

export type Mark = {
  id: string;
  time: number;
  authorId: string;
  authorName: string;
  resolved: boolean;
};

/** Width over height of a loaded picture or video, or undefined while it is unknown. */
export function shapeOf(media: HTMLVideoElement | HTMLImageElement): number | undefined {
  const width = "videoWidth" in media ? media.videoWidth : media.naturalWidth;
  const height = "videoHeight" in media ? media.videoHeight : media.naturalHeight;
  return width > 0 && height > 0 ? width / height : undefined;
}

/**
 * The clip itself with its own play button and timeline. Faces on the timeline are
 * comments: pressing one jumps there and opens its thread.
 *
 * Inside a `stage-row` on a wide screen the stage is as wide as the clip needs to fill the
 * full height, so a tall clip leaves the rest of the row to the comments instead of
 * sitting in a wide black box (see globals.css).
 */
export function ClipStage({
  url,
  video,
  time,
  duration,
  playing,
  marks,
  activeMark,
  header,
  onTime,
  onDuration,
  onPlaying,
  onSeek,
  onMark,
  drawing = null,
}: {
  url: string;
  video: RefObject<HTMLVideoElement | null>;
  time: number;
  duration: number;
  playing: boolean;
  marks: Mark[];
  activeMark: string | null;
  header: ReactNode;
  onTime: (seconds: number) => void;
  onDuration: (seconds: number) => void;
  onPlaying: (playing: boolean) => void;
  onSeek: (seconds: number) => void;
  onMark: (mark: Mark) => void;
  /** Marks over the picture: a saved drawing, or one being made. */
  drawing?: StageDrawing | null;
}) {
  const still = isStill(url);
  const picture = useRef<HTMLImageElement>(null);
  const area = useRef<HTMLDivElement>(null);
  // Where the picture sits inside its area, so a drawing lines up with it exactly.
  const [frame, setFrame] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>();

  useEffect(() => {
    const media = still ? picture.current : video.current;
    if (!media || !area.current || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setFrame(
        media.offsetWidth > 0
          ? {
              left: media.offsetLeft,
              top: media.offsetTop,
              width: media.offsetWidth,
              height: media.offsetHeight,
            }
          : undefined,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(media);
    observer.observe(area.current);
    media.addEventListener("loadedmetadata", measure);
    media.addEventListener("load", measure);
    return () => {
      observer.disconnect();
      media.removeEventListener("loadedmetadata", measure);
      media.removeEventListener("load", measure);
    };
  }, [still, url, video]);

  // The clip's own shape, which sets how wide the stage is.
  const [shape, setShape] = useState<number>();
  useEffect(() => {
    const media = still ? picture.current : video.current;
    if (!media) return;
    const read = () => setShape(shapeOf(media));
    read();
    media.addEventListener("loadedmetadata", read);
    media.addEventListener("load", read);
    return () => {
      media.removeEventListener("loadedmetadata", read);
      media.removeEventListener("load", read);
    };
  }, [still, url, video]);

  const editing = drawing?.editing ?? null;

  function toggle() {
    const player = video.current;
    if (!player) return;
    if (player.paused) void player.play().catch(() => {});
    else player.pause();
  }

  return (
    <section
      aria-label="Clip"
      data-tour-step-id="tour-review-clip"
      data-stage=""
      data-shape={shape === undefined ? undefined : shape.toFixed(3)}
      style={shape === undefined ? undefined : ({ "--clip-ratio": shape } as CSSProperties)}
      className="dark flex min-h-80 min-w-0 flex-col overflow-hidden rounded-xl bg-zinc-950 text-zinc-50"
    >
      <div className="flex min-h-12 flex-wrap items-center gap-2 px-4 py-2">{header}</div>

      <div ref={area} className="relative flex min-h-0 flex-1 items-center justify-center px-4">
        {still ? (
          // The file sits in the team's own storage, so there is nothing for Next to resize.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={picture}
            src={url}
            alt=""
            className="max-h-full max-w-full rounded-md object-contain lg:h-full lg:w-auto"
          />
        ) : (
          <video
            ref={video}
            src={url}
            playsInline
            preload="metadata"
            onClick={toggle}
            onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)}
            onSeeked={(event) => onTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => onDuration(event.currentTarget.duration)}
            onDurationChange={(event) => onDuration(event.currentTarget.duration)}
            onPlay={() => onPlaying(true)}
            onPause={() => onPlaying(false)}
            className="max-h-full max-w-full cursor-pointer rounded-md bg-black object-contain lg:h-full lg:w-auto"
          />
        )}
        {drawing && (
          <div
            className={cn("absolute", !frame && "inset-0")}
            style={frame ? { ...frame } : undefined}
          >
            <DrawingLayer
              shapes={drawing.shapes}
              tool={editing?.tool}
              color={editing?.color}
              onAdd={editing?.onAdd}
            />
          </div>
        )}
      </div>

      {editing ? (
        <DrawingTools
          tool={editing.tool}
          color={editing.color}
          count={drawing?.shapes.length ?? 0}
          onTool={editing.onTool}
          onColor={editing.onColor}
          onUndo={editing.onUndo}
          onClear={editing.onClear}
          onDone={editing.onDone}
        />
      ) : (
        !still && (
          <div className="flex items-center gap-3 px-4 pt-7 pb-4">
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-zinc-950 outline-none transition-transform hover:scale-105 focus-visible:ring-3 focus-visible:ring-white/50 active:scale-95"
            >
              {playing ? (
                <Pause className="size-4 fill-current" />
              ) : (
                <Play className="size-4 translate-x-px fill-current" />
              )}
            </button>

            <div className="relative h-5 min-w-0 flex-1">
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-white"
                  style={{ width: `${momentPercent(time, duration)}%` }}
                />
              </div>
              <input
                type="range"
                aria-label="Position in the clip"
                aria-valuetext={`${formatMoment(time)} of ${formatMoment(duration)}`}
                min={0}
                max={duration > 0 ? duration : 0}
                step={0.05}
                value={Math.min(time, duration > 0 ? duration : 0)}
                onChange={(event) => onSeek(Number(event.target.value))}
                className="absolute inset-0 w-full cursor-pointer opacity-0"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                style={{ left: `${momentPercent(time, duration)}%` }}
              />
              {duration > 0 &&
                marks.map((mark) => (
                  <button
                    key={mark.id}
                    type="button"
                    onClick={() => onMark(mark)}
                    aria-label={`${mark.authorName}'s comment at ${formatMoment(mark.time)}`}
                    className={cn(
                      "absolute -top-6 -translate-x-1/2 rounded-full outline-none transition-transform hover:z-10 hover:scale-110 focus-visible:ring-3 focus-visible:ring-white/60",
                      mark.resolved && "opacity-45",
                      activeMark === mark.id && "z-10 scale-110 ring-2 ring-white",
                    )}
                    style={{ left: `${momentPercent(mark.time, duration)}%` }}
                  >
                    <Face
                      id={mark.authorId}
                      name={mark.authorName}
                      className="size-5 text-[0.5rem]"
                    />
                  </button>
                ))}
            </div>

            <span className="shrink-0 font-mono text-xs text-zinc-300 tabular-nums">
              {formatMoment(time)} / {formatMoment(duration)}
            </span>
          </div>
        )
      )}
      {still && !editing && <div className="h-4" />}
    </section>
  );
}
