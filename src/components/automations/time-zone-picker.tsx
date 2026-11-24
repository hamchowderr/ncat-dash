"use client";

import { ChevronDownIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { myTimeZone } from "@/lib/time-zone";

/** "America/New_York" → "New York"; "UTC" stays "UTC". */
export function zoneCity(zone: string) {
  return zone.split("/").at(-1)!.replaceAll("_", " ");
}

/** "America/New_York" → "America"; a zone with no region gives "". */
function zoneRegion(zone: string) {
  const parts = zone.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join(" / ").replaceAll("_", " ") : "";
}

/** The zone's offset from UTC right now, such as "GMT-5". */
export function zoneOffset(zone: string, at = new Date()) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((piece) => piece.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

function allZones() {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    return ["UTC"];
  }
}

/**
 * Picks a time zone by city, with a search box, the way Linear and Google Calendar do.
 * The field shows the city and its offset; nobody types a zone's code by hand.
 */
export function TimeZonePicker({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (zone: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => allZones(), []);
  const here = useMemo(() => myTimeZone(), []);
  const offset = zoneOffset(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        role="combobox"
        aria-expanded={open}
        className="border-input bg-card hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-ring/50 data-[state=open]:border-foreground/30 data-[state=open]:ring-ring/25 flex h-9 w-full items-center gap-2 rounded-lg border pr-2.5 pl-3 text-left text-sm transition-[color,border-color,box-shadow] outline-none focus-visible:ring-3 data-[state=open]:ring-3"
      >
        <span className="min-w-0 flex-1 truncate">{zoneCity(value)}</span>
        {offset && (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{offset}</span>
        )}
        <ChevronDownIcon
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 [[data-state=open]>&]:rotate-180"
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-(--radix-popover-trigger-width) min-w-64 gap-0 p-0"
      >
        <Command>
          <CommandInput placeholder="Search cities" aria-label="Search time zones" />
          <CommandList className="max-h-64">
            <CommandEmpty>No time zone by that name.</CommandEmpty>
            {[...new Set([here, ...zones])].map((zone) => (
              <CommandItem
                key={zone}
                value={zone}
                keywords={[zoneCity(zone), zoneRegion(zone)]}
                data-checked={zone === value}
                onSelect={() => {
                  onChange(zone);
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">
                    {zoneCity(zone)}
                    {zone === here && (
                      <span className="text-muted-foreground font-normal"> · Your time zone</span>
                    )}
                  </span>
                  {zoneRegion(zone) && (
                    <span className="text-muted-foreground truncate text-xs font-normal">
                      {zoneRegion(zone)}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs font-normal tabular-nums">
                  {zoneOffset(zone)}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
