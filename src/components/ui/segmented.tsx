"use client";

import { cn } from "cn";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type * as React from "react";

/**
 * A few choices side by side, one picked, as in Linear's and Apple's segmented controls.
 * The picked one is a raised white piece on a quiet track; the others are plain words.
 * Use it when every choice fits on one line and there are two to four of them.
 */
function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ...props
}: Omit<React.ComponentProps<typeof RadioGroupPrimitive.Root>, "value" | "onValueChange"> & {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: React.ReactNode }[];
}) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="segmented"
      orientation="horizontal"
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      className={cn(
        "flex h-9 bg-foreground/[0.055] w-full items-stretch gap-0.5 rounded-[11px] p-[3px]",
        className,
      )}
      {...props}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          data-slot="segmented-item"
          className={cn(
            "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center justify-center gap-1.5 truncate rounded-lg px-3 text-sm font-medium transition-[color,background-color,box-shadow] outline-none focus-visible:ring-3",
            "data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-[0_1px_2px_rgb(0_0_0/0.06),0_1px_1px_rgb(0_0_0/0.04)]",
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

const track = "flex h-9 items-stretch gap-0.5 rounded-[11px] bg-foreground/[0.055] p-[3px]";
const piece =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex min-w-0 items-center justify-center gap-1.5 truncate rounded-lg px-3 text-sm font-medium transition-[color,background-color,box-shadow] outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";
const raised =
  "bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06),0_1px_1px_rgb(0_0_0/0.04)]";

/**
 * The same look as Segmented, for switches that are buttons (a view, a layout, a mode):
 * a group of SegmentedButton, each saying with aria-pressed whether it is the one shown.
 */
function SegmentedGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div role="group" data-slot="segmented" className={cn(track, className)} {...props} />;
}

function SegmentedButton({
  pressed,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "aria-pressed"> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-slot="segmented-item"
      className={cn(piece, pressed && raised, className)}
      {...props}
    />
  );
}

export { Segmented, SegmentedButton, SegmentedGroup };
