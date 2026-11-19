"use client";

import {
  type Frame,
  formatLimit,
  frameName,
  PLATFORMS,
  type PlatformName,
} from "@ncat-dash/automation-core";
import { RectangleHorizontal, RectangleVertical, Smartphone, Square } from "lucide-react";

import { cn } from "@/lib/utils";

// The outline drawn on each tile, in the shape its clips are made.
const OUTLINE: Record<Frame, string> = {
  "9:16": "h-6.5 w-4.5",
  "4:5": "h-6 w-5",
  "1:1": "h-5 w-5",
  "16:9": "h-4 w-6.5",
  original: "h-4 w-6.5 border-dashed",
};

const ICON: Record<Frame, typeof Smartphone> = {
  "9:16": Smartphone,
  "4:5": RectangleVertical,
  "1:1": Square,
  "16:9": RectangleHorizontal,
  original: RectangleHorizontal,
};

/** What the clips look like, under the tiles. */
export function frameSentence(frame: Frame, followed = false): string {
  if (frame === "original") return "Keeps the video's own shape.";
  if (followed)
    return `Cut in the video's own shape, then Follow the speaker makes them ${frameName(frame).toLowerCase()} and keeps the person talking in frame.`;
  return `${frameName(frame)}. The whole picture is kept, on a blurred background.`;
}

/** Platform tiles: each shows the frame it needs and how long a clip may be. */
export function PlatformPicker({
  value,
  onChange,
  disabled,
  compact,
  followed,
}: {
  value: PlatformName | undefined;
  onChange: (platform: PlatformName) => void;
  disabled?: boolean;
  /** Two columns, for narrow side panels. */
  compact?: boolean;
  /** The clips go straight to Follow the speaker, which makes the shape instead. */
  followed?: boolean;
}) {
  const selected = PLATFORMS.find((platform) => platform.name === value);
  return (
    <div className="flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-label="Platform"
        className={cn("grid grid-cols-2 gap-2", !compact && "sm:grid-cols-3")}
      >
        {PLATFORMS.map((platform) => {
          const on = platform.name === value;
          return (
            <button
              key={platform.name}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${platform.name}, ${frameName(platform.frame).toLowerCase()}, up to ${formatLimit(platform.maxSeconds)}`}
              disabled={disabled}
              onClick={() => onChange(platform.name)}
              className={cn(
                "choice-tile focus-visible:ring-ring/50 grid grid-cols-[auto_minmax(0,1fr)] items-center rounded-lg text-left focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-60",
                // In a narrow panel the tiles are tighter, so whole names fit without scrolling.
                compact ? "gap-x-2 px-2 py-2" : "gap-x-2.5 p-2.5",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "row-span-2 rounded-[3px] border-2 transition-colors",
                  OUTLINE[platform.frame],
                  on ? "border-primary" : "border-muted-foreground/70",
                )}
              />
              <span
                data-platform-name
                className="text-sm leading-tight font-medium text-pretty break-words"
              >
                {platform.name}
              </span>
              <span className="text-muted-foreground font-mono text-[11px]">
                up to {formatLimit(platform.maxSeconds)}
              </span>
            </button>
          );
        })}
      </div>
      {selected && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          {(() => {
            const Icon = ICON[selected.frame];
            return <Icon className="text-foreground size-4" aria-hidden="true" />;
          })()}
          {frameSentence(selected.frame, followed)}
        </p>
      )}
    </div>
  );
}
