"use client";

import { type CaptionLook, type CaptionShape, SHAPE_HEIGHT } from "@takewon/automation-core";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { ExampleSources, stillWhenReduced } from "./example-pane";

const SAMPLE = "This is how your captions read on every video";

/** The frame each shape is drawn in, in pixels on screen. */
const FRAMES: Record<CaptionShape, { width: number; height: number }> = {
  vertical: { width: 108, height: 192 },
  wide: { width: 192, height: 108 },
  square: { width: 144, height: 144 },
};

/** The line shown: the first `max_words_per_line` words of the sample. */
function sampleLine(look: CaptionLook): string[] {
  const words = SAMPLE.split(" ");
  if (look.style === "word_by_word") return [words[3]];
  return words.slice(0, Math.max(1, Math.min(look.max_words_per_line ?? 6, 8)));
}

/**
 * A still of a caption look on a video of one shape, drawn the way the toolkit lays it out:
 * text size relative to the picture's height, the outline round each letter, and the word
 * being said picked out by the look's effect.
 */
export function CaptionPreview({
  look,
  shape = "vertical",
  className,
  font,
  zoom = 1,
}: {
  look: CaptionLook;
  shape?: CaptionShape;
  className?: string;
  /** How big to draw it: 1 is a 192 pixel tall vertical frame. */
  zoom?: number;
  /** The team's font, used when the look names none. */
  font?: string;
}) {
  const frame = { width: FRAMES[shape].width * zoom, height: FRAMES[shape].height * zoom };
  const { text, size, place } = captionText(look, frame.height / SHAPE_HEIGHT[shape], shape, font);
  const words = sampleLine(look);
  const said = look.style === "word_by_word" ? 0 : Math.min(1, words.length - 1);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 flex-col items-center overflow-hidden rounded-md px-[6%] text-center",
        "bg-[radial-gradient(120%_90%_at_50%_30%,#5b6b7a_0%,#26313b_55%,#151b21_100%)]",
        place,
        className,
      )}
      style={{ width: frame.width, height: frame.height }}
    >
      <CaptionLine look={look} words={words} said={said} text={text} size={size} />
    </div>
  );
}

/**
 * How a look's text is drawn at a scale (screen pixels per video pixel): the toolkit's own
 * size when the look sets none (5% of the picture's height), the outline round each
 * letter, and where the line sits.
 */
function captionText(look: CaptionLook, scale: number, shape: CaptionShape, font?: string) {
  const size = (look.font_size ?? SHAPE_HEIGHT[shape] * 0.05) * scale;
  const outline = (look.outline_width ?? 1) * scale * 2;
  const shadow = (look.shadow_offset ?? 0) * scale * 2;
  const text: CSSProperties = {
    fontFamily: look.font_family ?? font ?? "Arial, sans-serif",
    fontSize: `${size}px`,
    lineHeight: 1.15,
    fontWeight: look.bold ? 800 : 500,
    textTransform: look.all_caps ? "uppercase" : undefined,
    color: look.line_color ?? "#FFFFFF",
    WebkitTextStroke: outline > 0 ? `${outline}px ${look.outline_color ?? "#000000"}` : undefined,
    paintOrder: "stroke fill",
    textShadow: shadow > 0 ? `${shadow}px ${shadow}px 0 rgb(0 0 0 / 0.6)` : undefined,
  };
  const place =
    look.position === "top_center"
      ? "justify-start pt-[12%]"
      : look.position === "middle_center"
        ? "justify-center"
        : "justify-end pb-[12%]";
  return { text, size, place };
}

/** One caption line, the word being said (`said`) picked out by the look's effect. */
function CaptionLine({
  look,
  words,
  said,
  text,
  size,
}: {
  look: CaptionLook;
  words: string[];
  said: number;
  text: CSSProperties;
  size: number;
}) {
  const accent = look.word_color ?? "#FFFF00";
  return (
    <p className="max-w-full text-balance break-words" style={text}>
      {words.map((word, index) => {
        const style: CSSProperties = {};
        if (index === said) {
          if (look.style === "highlight") style.color = accent;
          if (look.style === "underline") {
            style.textDecoration = "underline";
            style.textDecorationThickness = `${Math.max(1, size / 10)}px`;
            style.textUnderlineOffset = `${size / 8}px`;
          }
        }
        // Karaoke has filled in every word up to the one being said.
        if (look.style === "karaoke" && index <= said) style.color = accent;
        return (
          <span key={index} style={style}>
            {index > 0 ? " " : ""}
            {word}
          </span>
        );
      })}
    </p>
  );
}

/** A word of the example clip's transcript: its text and when it is said, in seconds. */
export interface ExampleWord {
  w: string;
  s: number;
  e: number;
}

/**
 * What a look shows at a moment of the example clip, laid out the way the toolkit's
 * captions are: plain lines and karaoke show a whole stretch of speech at once (split into
 * lines of `max_words_per_line`), highlight and underline show one line at a time, and one
 * word at a time shows only the word being said. Null between stretches of speech.
 */
export function captionAt(
  look: CaptionLook,
  segments: ExampleWord[][],
  time: number,
): { lines: string[][]; said: number[] } | null {
  const perLine = Math.max(0, look.max_words_per_line ?? 0);
  const split = (words: ExampleWord[]) => {
    if (perLine === 0) return [words];
    const lines: ExampleWord[][] = [];
    for (let at = 0; at < words.length; at += perLine) lines.push(words.slice(at, at + perLine));
    return lines;
  };
  // The word being said: the last one started (words in between keep the one before lit).
  const current = (words: ExampleWord[]) => words.filter((word) => word.s <= time).length - 1;
  for (const segment of segments) {
    if (segment.length === 0) continue;
    if (time < segment[0].s || time > segment[segment.length - 1].e) continue;
    const kind = look.style ?? "classic";
    if (kind === "word_by_word") {
      const word = segment.find((each) => each.s <= time && time <= each.e);
      return word ? { lines: [[word.w]], said: [0] } : null;
    }
    if (kind === "highlight" || kind === "underline") {
      const line = split(segment).find((words) => time <= words[words.length - 1].e);
      if (!line) return null;
      return { lines: [line.map((word) => word.w)], said: [Math.max(0, current(line))] };
    }
    const lines = split(segment);
    // Karaoke fills every word said so far, across the lines; plain lines pick out none.
    const upTo = kind === "karaoke" ? current(segment) : -1;
    let before = 0;
    const said = lines.map((line) => {
      const inLine = upTo < 0 ? -1 : upTo - before;
      before += line.length;
      return inLine;
    });
    return { lines: lines.map((line) => line.map((word) => word.w)), said };
  }
  return null;
}

/**
 * A caption look drawn live over the example clip, in time with what is said, so a style
 * of your own (or one you are changing) plays the way it will look on a video. The clip and
 * its words are the same ones the built-in examples were rendered from.
 */
export function CaptionLivePreview({
  look,
  font,
  video,
  segments,
}: {
  look: CaptionLook;
  font?: string;
  video: string;
  segments: ExampleWord[][];
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [height, setHeight] = useState(SHAPE_HEIGHT.vertical / 10);

  useEffect(() => {
    stillWhenReduced(ref.current);
    let frame = 0;
    const tick = () => {
      if (ref.current) setTime(ref.current.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    watch.observe(element);
    return () => watch.disconnect();
  }, []);

  const { text, size, place } = captionText(look, height / SHAPE_HEIGHT.vertical, "vertical", font);
  const shown = captionAt(look, segments, time);

  return (
    <div ref={box} className="relative size-full">
      <video
        ref={ref}
        className="size-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
      >
        <ExampleSources src={video} />
      </video>
      <div
        aria-hidden="true"
        data-caption-live=""
        className={cn("absolute inset-0 flex flex-col items-center px-[6%] text-center", place)}
      >
        {shown?.lines.map((line, index) => (
          <CaptionLine
            key={index}
            look={look}
            words={line}
            said={shown.said[index] ?? -1}
            text={text}
            size={size}
          />
        ))}
      </div>
    </div>
  );
}
