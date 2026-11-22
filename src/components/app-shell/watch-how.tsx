"use client";

import { CirclePlay, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Explainer, lengthOf, videosFor, videoUrl } from "@/lib/watch-how";

/** "Watch how" in the bar along the top. Left out on a page no video explains. */
export function WatchHowButton({
  pathname,
  open,
  onToggle,
}: {
  pathname: string;
  open: boolean;
  onToggle: () => void;
}) {
  if (videosFor(pathname).length === 0) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-expanded={open}
      aria-controls="watch-how"
      onClick={onToggle}
      className={cn(open && "bg-accent")}
    >
      <CirclePlay aria-hidden="true" />
      Watch how
    </Button>
  );
}

/**
 * The page's video, at the top of the page. It sits in the page and pushes it down rather
 * than covering it, so the page stays usable while it plays. A page with more than one
 * video lists the others underneath.
 */
export function WatchHowPanel({
  pathname,
  playing,
  onPlay,
  onClose,
}: {
  pathname: string;
  playing: string | null;
  onPlay: (slug: string) => void;
  onClose: () => void;
}) {
  const videos = videosFor(pathname);
  if (videos.length === 0) return null;
  const current = videos.find((video) => video.slug === playing) ?? videos[0];

  return (
    <section
      id="watch-how"
      aria-label="Watch how"
      className="bg-surface flex flex-col gap-3 rounded-xl p-4"
    >
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium">{current.title}</h2>
        <span className="text-muted-foreground text-sm">{lengthOf(current.seconds)}</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-8"
          aria-label="Close the video"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {/* The videos' captions are drawn into the picture, so they need no captions track. */}
      <video
        key={current.slug}
        src={videoUrl(current.slug)}
        controls
        autoPlay
        playsInline
        preload="metadata"
        className="aspect-video w-full max-w-3xl rounded-lg bg-black"
      />
      {videos.length > 1 && <OtherVideos videos={videos} current={current} onPlay={onPlay} />}
    </section>
  );
}

function OtherVideos({
  videos,
  current,
  onPlay,
}: {
  videos: Explainer[];
  current: Explainer;
  onPlay: (slug: string) => void;
}) {
  return (
    <ul aria-label="More videos for this page" className="flex flex-wrap gap-2">
      {videos.map((video) => (
        <li key={video.slug}>
          <Button
            variant={video.slug === current.slug ? "secondary" : "ghost"}
            size="sm"
            aria-current={video.slug === current.slug ? "true" : undefined}
            onClick={() => onPlay(video.slug)}
          >
            {video.title}
            <span className="text-muted-foreground">{lengthOf(video.seconds)}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
