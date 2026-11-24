"use client";

import { type ReactNode, useCallback, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Example clips shown beside a style picker, rendered by the toolkit itself from a short
 * NASA interview (public domain): the motion pieces with its /v1/video/motion, the caption
 * styles with its captions. They live in public/examples and are made by
 * scripts/settings-examples (see its README).
 */
export const EXAMPLES = "/examples";

export const motionExample = (name: string) => `${EXAMPLES}/motion/${name}.mp4`;

/**
 * A clip's sources: WebM first, MP4 (H.264) for browsers without it. Every clip is kept in
 * both, under the same name.
 */
export function ExampleSources({ src }: { src: string }) {
  return (
    <>
      <source src={src.replace(/\.mp4$/, ".webm")} type="video/webm" />
      <source src={src} type="video/mp4" />
    </>
  );
}

/**
 * What an option shows while the pointer is on it or it has focus, the way caption and
 * motion pickers in video editors play a style before it is picked. `example` is the
 * option under the pointer, or null; `hover(key)` gives an option the handlers.
 */
export function useExample<K extends string>() {
  const [example, setExample] = useState<K | null>(null);
  const hover = useCallback(
    (key: K | null) => ({
      onPointerEnter: () => setExample(key),
      onPointerLeave: () => setExample(null),
      onFocus: () => setExample(key),
      onBlur: () => setExample(null),
    }),
    [],
  );
  return { example, setExample, hover };
}

/** Someone who asked for less motion gets the clip's first frame, still. */
export function stillWhenReduced(video: HTMLVideoElement | null) {
  if (video && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    video.autoplay = false;
    video.pause();
  }
}

/**
 * The example beside the options: a short vertical clip that plays on a loop, muted, with
 * a line under it naming what it shows. It sits in its own column, never over the options,
 * and stays in view while the list scrolls. Nothing to show leaves the frame empty.
 */
export function ExamplePane({
  src,
  label,
  children,
  className,
}: {
  /** The clip; or `children` draws its own (a live caption preview). */
  src?: string | null;
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <figure
      data-example={src ?? (children ? "live" : "none")}
      className={cn("flex w-36 shrink-0 flex-col gap-2 md:w-44", className)}
    >
      <div className="bg-muted relative aspect-[9/16] w-full overflow-hidden rounded-xl">
        {children ??
          (src && (
            <video
              // A new clip starts from its beginning.
              key={src}
              className="size-full object-cover"
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              aria-hidden="true"
              ref={stillWhenReduced}
            >
              <ExampleSources src={src} />
            </video>
          ))}
      </div>
      <figcaption className="text-muted-foreground text-xs text-pretty">{label}</figcaption>
    </figure>
  );
}

/**
 * Options beside their example: the example in a column on the right that stays in view
 * while the options scroll; on a phone it sits above them instead.
 */
export function WithExample({ example, children }: { example: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <div className="min-w-0 flex-1">{children}</div>
      <div className="order-first self-center md:sticky md:top-6 md:order-none md:self-start">
        {example}
      </div>
    </div>
  );
}
