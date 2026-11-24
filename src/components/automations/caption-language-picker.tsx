"use client";

import { CAPTION_LANGUAGE_SETTING, LANGUAGES, languageOf } from "@takewon/automation-core";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Field, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const SPOKEN = "The language spoken";

/**
 * The language "Caption video" captions in. Left on the language spoken, the toolkit
 * captions as it always has; another language is translated once per video, and its words
 * still light up as they are said (convex/captionTranslation.ts).
 */
export function CaptionLanguagePicker({
  nodeId,
  input,
  onChange,
}: {
  nodeId: string;
  input: Record<string, unknown>;
  onChange: (input: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const code = input[CAPTION_LANGUAGE_SETTING];
  const picked = typeof code === "string" ? languageOf(code) : null;
  const id = `node-${nodeId}-caption-language`;
  const pick = (next: string | null) => {
    const rest = Object.fromEntries(
      Object.entries(input).filter(([name]) => name !== CAPTION_LANGUAGE_SETTING),
    );
    onChange(next ? { ...rest, [CAPTION_LANGUAGE_SETTING]: next } : rest);
    setOpen(false);
  };

  return (
    <Field>
      <FieldLabel htmlFor={id}>Caption language</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className="truncate">{picked?.name ?? SPOKEN}</span>
            <ChevronsUpDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
          <Command>
            <CommandInput placeholder="Find a language" aria-label="Find a language" />
            <CommandList>
              <CommandEmpty>No language by that name.</CommandEmpty>
              <CommandGroup>
                <CommandItem value={SPOKEN} onSelect={() => pick(null)}>
                  <Check className={cn(picked ? "opacity-0" : "opacity-100")} />
                  {SPOKEN}
                </CommandItem>
                {LANGUAGES.map((language) => (
                  <CommandItem
                    key={language.code}
                    value={language.name}
                    onSelect={() => pick(language.code)}
                  >
                    <Check
                      className={cn(picked?.code === language.code ? "opacity-100" : "opacity-0")}
                    />
                    {language.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <p className="text-muted-foreground text-xs text-pretty">
        {picked
          ? `Translated into ${picked.name} once per video. Each word still lights up as it is said.`
          : "Captions are in the language spoken in the video."}
      </p>
    </Field>
  );
}
