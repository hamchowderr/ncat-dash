"use client";

import {
  LANGUAGES,
  MAX_SUBTITLE_LANGUAGES,
  languageOf,
  subtitleLanguagesOf,
} from "@ncat-dash/automation-core";
import { Check, Plus, X } from "lucide-react";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The languages a Translate Subtitles step writes: picked from the full list by typing,
 * shown as a row of names that can each be taken off.
 */
export function SubtitleLanguagesPicker({
  nodeId,
  input,
  onChange,
}: {
  nodeId: string;
  input: Record<string, unknown>;
  onChange: (input: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const picked = subtitleLanguagesOf(input);
  const full = picked.length >= MAX_SUBTITLE_LANGUAGES;
  const id = `node-${nodeId}-subtitle-languages`;
  const save = (codes: string[]) => onChange({ ...input, languages: codes });
  const toggle = (code: string) => {
    if (picked.includes(code)) save(picked.filter((one) => one !== code));
    else if (!full) save([...picked, code]);
  };

  return (
    <Field>
      <FieldLabel id={`${id}-label`}>Languages</FieldLabel>
      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Languages picked">
          {picked.map((code) => {
            const name = languageOf(code)?.name ?? code;
            return (
              <li
                key={code}
                className="bg-muted text-foreground flex items-center gap-1 rounded-md py-0.5 ps-2 pe-0.5 text-sm"
              >
                {name}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={`Take off ${name}`}
                  onClick={() => toggle(code)}
                >
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-describedby={`${id}-label`}
            className="w-full justify-start font-normal"
            aria-expanded={open}
            disabled={full}
          >
            <Plus className="text-muted-foreground" />
            {full ? `${MAX_SUBTITLE_LANGUAGES} languages at most` : "Add a language"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
          <Command>
            <CommandInput placeholder="Find a language" aria-label="Find a language" />
            <CommandList>
              <CommandEmpty>No language by that name.</CommandEmpty>
              <CommandGroup>
                {LANGUAGES.map((language) => {
                  const on = picked.includes(language.code);
                  return (
                    <CommandItem
                      key={language.code}
                      value={language.name}
                      disabled={!on && full}
                      onSelect={() => toggle(language.code)}
                    >
                      <Check className={cn(on ? "opacity-100" : "opacity-0")} />
                      {language.name}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <FieldDescription className="text-pretty">
        {picked.length === 0
          ? "Pick each language to write subtitles in."
          : "One SRT file per video in each language, kept in Files under Subtitles. Each video is translated into a language once."}
      </FieldDescription>
    </Field>
  );
}
