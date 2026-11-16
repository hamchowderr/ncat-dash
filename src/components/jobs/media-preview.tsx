import { ExternalLink } from "lucide-react";

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

/** Plays or shows a result file where the browser can, with a link to open it either way. */
export function MediaPreview({ url }: { url: string }) {
  return (
    <figure className="bg-muted/40 flex flex-col overflow-hidden rounded-lg border">
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
          <span className="truncate">{fileNameOf(url)}</span>
          <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </figcaption>
    </figure>
  );
}
