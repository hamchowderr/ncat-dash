"use client";

import { ExternalLink } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext } from "react";

import { PlatformTag } from "@/components/platform-tag";
import { cn } from "@/lib/utils";

const VIDEO = /\.(mp4|mov|webm|mkv|m4v)(\?|$)/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif)(\?|$)/i;

/** Whether a link is to a video a player can show, judged by its file name. */
export function isVideoUrl(url: string): boolean {
  try {
    return VIDEO.test(new URL(url).pathname);
  } catch {
    return VIDEO.test(url);
  }
}

export function fileNameOf(url: string): string {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : url;
  } catch {
    return url;
  }
}

const OutputNames = createContext<Record<string, string>>({});
const OutputPlatforms = createContext<Record<string, string>>({});

/**
 * Readable names for the files below, by link, such as "Space interviews clip 1" for a file
 * the toolkit named after its job id. Files it does not name keep their own names.
 * `platforms` holds the platform each clip was made for, such as "TikTok".
 */
export function OutputNamesProvider({
  names,
  platforms,
  children,
}: {
  names: Record<string, string> | undefined;
  platforms?: Record<string, string> | undefined;
  children: ReactNode;
}) {
  const outer = useContext(OutputNames);
  const outerPlatforms = useContext(OutputPlatforms);
  return (
    <OutputNames.Provider value={names ? { ...outer, ...names } : outer}>
      <OutputPlatforms.Provider
        value={platforms ? { ...outerPlatforms, ...platforms } : outerPlatforms}
      >
        {children}
      </OutputPlatforms.Provider>
    </OutputNames.Provider>
  );
}

/** The platform a file was made for, when one is known. */
export function useFilePlatform(): (url: string) => string | null {
  const platforms = useContext(OutputPlatforms);
  return useCallback((url: string) => platforms[url] ?? null, [platforms]);
}

/** How to show a file's name: its readable name when one is known, else its own. */
export function useFileName(): (url: string) => string {
  const names = useContext(OutputNames);
  return useCallback((url: string) => names[url] ?? fileNameOf(url), [names]);
}

/** Plays or shows a result file where the browser can, with a link to open it either way. */
/**
 * A finished file, playable where it can be. `compact` sizes a video or picture to its own
 * shape at a set height, so a tall phone clip is not boxed in a wide black frame.
 */
export function MediaPreview({ url, compact = false }: { url: string; compact?: boolean }) {
  const nameOf = useFileName();
  const platform = useFilePlatform()(url);
  return (
    <figure
      data-compact={compact || undefined}
      className={cn(
        "bg-surface flex flex-col overflow-hidden rounded-lg",
        compact && "w-fit max-w-full",
      )}
    >
      {VIDEO.test(url) ? (
        <video
          src={url}
          controls
          preload="metadata"
          className={cn(
            "bg-black",
            compact ? "h-56 w-auto max-w-full rounded-t-lg" : "aspect-video w-full",
          )}
        />
      ) : AUDIO.test(url) ? (
        <div className="p-3">
          <audio src={url} controls preload="metadata" className="w-full" />
        </div>
      ) : IMAGE.test(url) ? (
        // Result files live on the customer's own storage, so the domain is not known ahead of time.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          loading="lazy"
          className={cn(
            compact ? "h-56 w-auto max-w-full" : "aspect-video w-full",
            "object-contain",
          )}
        />
      ) : null}
      <figcaption
        className={cn("flex items-center gap-2 px-3 py-2 text-sm", compact && "max-w-80")}
      >
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-center gap-1.5 font-medium hover:underline"
        >
          <span className="truncate">{nameOf(url)}</span>
          <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        {platform && <PlatformTag platform={platform} className="ml-auto" />}
      </figcaption>
    </figure>
  );
}
