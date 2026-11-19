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

export { Segmented };
