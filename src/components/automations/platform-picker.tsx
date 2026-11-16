"use client";

import { formatLimit, PLATFORMS, type PlatformName } from "@ncat-dash/automation-core";
import { RectangleHorizontal, Smartphone } from "lucide-react";

import { cn } from "@/lib/utils";

/** Platform tiles: each shows the frame it needs and how long a clip may be. */
export function PlatformPicker({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: PlatformName | undefined;
  onChange: (platform: PlatformName) => void;
  disabled?: boolean;
  /** Two columns, for narrow side panels. */
  compact?: boolean;
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
              disabled={disabled}
              onClick={() => onChange(platform.name)}
              className={cn(
                "bg-background hover:border-muted-foreground/60 focus-visible:ring-ring/50 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-lg border p-2.5 text-left outline-none transition-[border-color,background-color,transform] duration-150 hover:-translate-y-px focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                on && "border-primary bg-primary/5 hover:border-primary",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "row-span-2 rounded-[3px] border-2 transition-colors",
                  platform.frame === "9:16" ? "h-6.5 w-4.5" : "h-4 w-6.5",
                  on ? "border-primary" : "border-muted-foreground/70",
                )}
              />
              <span className="truncate text-sm leading-tight font-medium">{platform.name}</span>
              <span className="text-muted-foreground font-mono text-[11px]">
                up to {formatLimit(platform.maxSeconds)}
              </span>
            </button>
          );
        })}
      </div>
      {selected && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          {selected.frame === "9:16" ? (
            <Smartphone className="text-foreground size-4" aria-hidden="true" />
          ) : (
            <RectangleHorizontal className="text-foreground size-4" aria-hidden="true" />
          )}
          {selected.frame === "9:16"
            ? "Vertical 9:16. The whole picture is kept, on a blurred background."
            : "Keeps the video's own shape."}
        </p>
      )}
    </div>
  );
}
