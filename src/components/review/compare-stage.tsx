"use client";

import { formatMoment, momentPercent } from "@takewon/review-core";
import { Columns2, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { isStill } from "./clip-stage";

/** Two players further apart than this are pulled back together while they play. */
const DRIFT = 0.15;

/** The "Compare" button beside the version switch, shown when a clip has two versions or more. */
export function CompareButton({ onClick }: { onClick: () => void }) {
  // Only an icon, so a tall clip's narrow header still fits on one line.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Compare"
      title="Compare two versions side by side"
      className="flex size-7 items-center justify-center rounded-lg bg-white/10 text-zinc-200 outline-none transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <Columns2 className="size-3.5" aria-hidden="true" />
    </button>
  );
}

/** The version a side shows, picked from all of the clip's versions. */
function SidePicker({
  label,
  count,
  value,
  onChange,
}: {
  label: string;
  count: number;
  value: number;
  onChange: (version: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-400">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="rounded-md bg-white/10 px-2 py-1 text-xs font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        {Array.from({ length: count }, (_, at) => (
          <option key={at} value={at + 1} className="text-zinc-950">
            Version {at + 1}
            {at + 1 === count ? " (newest)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Two versions of one clip side by side, playing and seeking together, like a comparison
 * viewer in a review tool. Sound comes from one side at a time. Pictures, such as
 * thumbnails, sit side by side with nothing to play.
 */
export function CompareStage({
  title,
  versions,
  initial,
  onClose,
}: {
  title: string;
  versions: { url: string }[];
  /** The version on screen when comparing began; it goes on the right, the one before on the left. */
  initial: number;
  /** Leaves comparing, with the right side's version on screen. */
  onClose: (version: number) => void;
}) {
  const count = versions.length;
  const [right, setRight] = useState(Math.min(Math.max(initial, 2), count));
  const [left, setLeft] = useState(Math.max(1, Math.min(initial, count) - 1 || 1));
  const [sound, setSound] = useState<"left" | "right">("right");
  const [time, setTime] = useState(0);
  const [durations, setDurations] = useState<{ left: number; right: number }>({
    left: 0,
    right: 0,
  });
  const [playing, setPlaying] = useState(false);
  const leftVideo = useRef<HTMLVideoElement>(null);
  const rightVideo = useRef<HTMLVideoElement>(null);

  const urls = { left: versions[left - 1].url, right: versions[right - 1].url };
  const still = isStill(urls.left) && isStill(urls.right);
  const duration = Math.max(durations.left, durations.right);

  function players() {
    return [leftVideo.current, rightVideo.current].filter(
      (player): player is HTMLVideoElement => player !== null,
    );
  }

  function seek(seconds: number) {
    for (const player of players()) {
      player.currentTime = Math.min(
        seconds,
        Number.isFinite(player.duration) ? player.duration : seconds,
      );
    }
    setTime(seconds);
  }

  function toggle() {
    const all = players();
    if (all.length === 0) return;
    if (playing) {
      for (const player of all) player.pause();
      setPlaying(false);
      return;
    }
    // Both start from the same moment, so the two sides line up.
    const at = leftVideo.current?.currentTime ?? 0;
    for (const player of all) {
      if (Math.abs(player.currentTime - at) > DRIFT) player.currentTime = at;
      void player.play().catch(() => {});
    }
    setPlaying(true);
  }

  // A newly picked version starts from the beginning, with both sides paused.
  function pick(which: "left" | "right", version: number) {
    for (const player of players()) {
      player.pause();
      player.currentTime = 0;
    }
    setPlaying(false);
    setTime(0);
    if (which === "left") setLeft(version);
    else setRight(version);
  }

  function onTime(side: "left" | "right", player: HTMLVideoElement) {
    // The side the sound comes from keeps the time; the other follows it.
    if (side !== sound) return;
    setTime(player.currentTime);
    const other = side === "left" ? rightVideo.current : leftVideo.current;
    if (other && !other.paused && Math.abs(other.currentTime - player.currentTime) > DRIFT) {
      other.currentTime = player.currentTime;
    }
  }

  function onEnded() {
    // When both have finished, the button shows Play again.
    if (players().every((player) => player.ended || player.paused)) setPlaying(false);
  }

  const side = (which: "left" | "right") => {
    const url = urls[which];
    const version = which === "left" ? left : right;
    return (
      <figure data-compare-side={which} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <figcaption className="flex items-center justify-between gap-2">
          <SidePicker
            label={which === "left" ? "Version on the left" : "Version on the right"}
            count={count}
            value={version}
            onChange={(next) => pick(which, next)}
          />
          {!isStill(url) && (
            <button
              type="button"
              onClick={() => setSound(which)}
              aria-pressed={sound === which}
              aria-label={
                sound === which ? "Sound is from this side" : "Play the sound from this side"
              }
              className={cn(
                "flex size-7 items-center justify-center rounded-md text-zinc-400 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/60",
                sound === which && "bg-white/10 text-white",
              )}
            >
              {sound === which ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            </button>
          )}
        </figcaption>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {isStill(url) ? (
            // The file sits in the team's own storage, so there is nothing for Next to resize.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={`Version ${version}`}
              className="max-h-full max-w-full rounded-md object-contain"
            />
          ) : (
            <video
              ref={which === "left" ? leftVideo : rightVideo}
              src={url}
              playsInline
              preload="metadata"
              muted={sound !== which}
              onClick={toggle}
              onTimeUpdate={(event) => onTime(which, event.currentTarget)}
              onLoadedMetadata={(event) => {
                const seconds = event.currentTarget.duration;
                setDurations((current) => ({
                  ...current,
                  [which]: Number.isFinite(seconds) ? seconds : 0,
                }));
              }}
              onEnded={onEnded}
              className="max-h-full max-w-full cursor-pointer rounded-md bg-black object-contain"
            />
          )}
        </div>
      </figure>
    );
  };

  return (
    <section
      aria-label="Compare versions"
      data-compare=""
      className="dark flex min-h-80 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-zinc-950 text-zinc-50"
    >
      <div className="flex min-h-12 flex-wrap items-center gap-2 px-4 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          <span className="text-zinc-400">Comparing · </span>
          {title}
        </h2>
        <button
          type="button"
          onClick={() => onClose(right)}
          className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-zinc-200 outline-none transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="size-3.5" aria-hidden="true" />
          Done comparing
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 sm:flex-row">
        {side("left")}
        {side("right")}
      </div>

      {still ? (
        <div className="h-4" />
      ) : (
        <div className="flex items-center gap-3 px-4 pt-5 pb-4">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause both" : "Play both"}
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
              aria-label="Position in both versions"
              aria-valuetext={`${formatMoment(time)} of ${formatMoment(duration)}`}
              min={0}
              max={duration > 0 ? duration : 0}
              step={0.05}
              value={Math.min(time, duration > 0 ? duration : 0)}
              onChange={(event) => seek(Number(event.target.value))}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
              style={{ left: `${momentPercent(time, duration)}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-xs text-zinc-300 tabular-nums">
            {formatMoment(time)} / {formatMoment(duration)}
          </span>
        </div>
      )}
    </section>
  );
}
