"use client";

import type * as React from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

/** Stands in for "" (Your team, Everyone, Pick one), which a Radix Select cannot hold. */
const NONE = "__none__";

export type PickOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

/**
 * A pick list with the app's own open list in place of the browser's: the same
 * value-and-onChange shape as a plain select, so "" can still mean "none".
 */
export function PickList({
  id,
  value,
  onChange,
  options,
  className,
  size,
  placeholder,
  ...aria
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly PickOption[];
  className?: string;
  size?: "sm" | "default";
  placeholder?: string;
  "aria-label"?: string;
  "data-tour-step-id"?: string;
}) {
  return (
    <Select
      value={value === "" ? NONE : value}
      onValueChange={(next) => onChange(next === NONE ? "" : next)}
    >
      <SelectTrigger id={id} size={size} className={className} {...aria}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value || NONE}
            value={option.value === "" ? NONE : option.value}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
