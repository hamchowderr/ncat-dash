"use client";

import { ExternalLink } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext } from "react";

const VIDEO = /\.(mp4|mov|webm|mkv|m4v)(\?|$)/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif)(\?|$)/i;

export function fileNameOf(url: string): string {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : url;
  } catch {
    return url;
  }
}

const OutputNames = createContext<Record<string, string>>({});

/**
 * Readable names for the files below, by link, such as "Space interviews clip 1" for a file
 * the toolkit named after its job id. Files it does not name keep their own names.
 */
export function OutputNamesProvider({
  names,
  children,
}: {
  names: Record<string, string> | undefined;
  children: ReactNode;
}) {
  const outer = useContext(OutputNames);
  return (
    <OutputNames.Provider value={names ? { ...outer, ...names } : outer}>
      {children}
    </OutputNames.Provider>
  );
}

/** How to show a file's name: its readable name when one is known, else its own. */
export function useFileName(): (url: string) => string {
  const names = useContext(OutputNames);
  return useCallback((url: string) => names[url] ?? fileNameOf(url), [names]);
}

/** Plays or shows a result file where the browser can, with a link to open it either way. */
export function MediaPreview({ url }: { url: string }) {
  const nameOf = useFileName();
  return (
    <figure className="bg-surface flex flex-col overflow-hidden rounded-lg">
      {VIDEO.test(url) ? (
        <video src={url} controls preload="metadata" className="aspect-video w-full bg-black" />
      ) : AUDIO.test(url) ? (
        <div className="p-3">
          <audio src={url} controls preload="metadata" className="w-full" />
        </div>
      ) : IMAGE.test(url) ? (
        // Result files live on the customer's own storage, so the domain is not known ahead of time.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" className="aspect-video w-full object-contain" />
      ) : null}
      <figcaption className="flex items-center gap-2 px-3 py-2 text-sm">
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
      </figcaption>
    </figure>
  );
}
