"use client";

import { type CaptionLook, type CaptionShape, SHAPE_HEIGHT } from "@ncat-dash/automation-core";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

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
  const scale = frame.height / SHAPE_HEIGHT[shape];
  // The toolkit's own size when a look sets none: 5% of the picture's height.
  const size = (look.font_size ?? SHAPE_HEIGHT[shape] * 0.05) * scale;
  const outline = (look.outline_width ?? 1) * scale * 2;
  const shadow = (look.shadow_offset ?? 0) * scale * 2;
  const words = sampleLine(look);
  const said = look.style === "word_by_word" ? 0 : Math.min(1, words.length - 1);
  const line = look.line_color ?? "#FFFFFF";
  const accent = look.word_color ?? "#FFFF00";

  const text: CSSProperties = {
    fontFamily: look.font_family ?? font ?? "Arial, sans-serif",
    fontSize: `${size}px`,
    lineHeight: 1.15,
    fontWeight: look.bold ? 800 : 500,
    textTransform: look.all_caps ? "uppercase" : undefined,
    color: line,
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
    </div>
  );
}
