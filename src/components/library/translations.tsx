"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatMoment, LANGUAGES } from "@takewon/automation-core";
import { useMutation } from "convex/react";
import { Check, Languages, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/catalog";
import { cn } from "@/lib/utils";

import { SubtitleText } from "./transcript-files";

export type Translation = {
  _id: Id<"translations">;
  language: string;
  name: string;
  status: "working" | "ready" | "failed";
  error: string | null;
  done: number;
  total: number;
  cues: { start: number; end: number; text: string }[];
};

export const ORIGINAL = "original";

/**
 * Which language the words show in: the original, or a translation the file has. Picking a
 * new language translates it once; after that it is kept and costs nothing to show again.
 */
export function LanguagePicker({
  itemId,
  translations,
  value,
  onValueChange,
}: {
  itemId: Id<"libraryItems">;
  translations: Translation[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const start = useMutation(api.translations.start);
  const [open, setOpen] = useState(false);
  const have = new Set(translations.map((one) => one.language));

  async function translate(code: string) {
    setOpen(false);
    try {
      await start({ itemId, language: code });
      onValueChange(code);
    } catch (caught) {
      toast.error(errorMessage(caught, "The translation could not be started."));
    }
  }

  return (
    <div className="flex items-center gap-2">
      {translations.length > 0 && (
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger size="sm" className="w-auto min-w-32" aria-label="Language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ORIGINAL}>Original</SelectItem>
            {translations.map((one) => (
              <SelectItem key={one.language} value={one.language}>
                {one.name}
                {one.status === "working" ? " (translating)" : ""}
                {one.status === "failed" ? " (did not finish)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm">
            <Languages />
            Translate
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-0">
          <Command>
            <CommandInput placeholder="Find a language" aria-label="Find a language" />
            <CommandList>
              <CommandEmpty>No language by that name.</CommandEmpty>
              <CommandGroup>
                {LANGUAGES.filter((language) => !have.has(language.code)).map((language) => (
                  <CommandItem
                    key={language.code}
                    value={language.name}
                    onSelect={() => void translate(language.code)}
                  >
                    {language.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** One translated line: its moment, its words, and a way to correct them. */
function TranslatedLine({
  translationId,
  index,
  cue,
  playing,
  onSeek,
}: {
  translationId: Id<"translations">;
  index: number;
  cue: Translation["cues"][number];
  playing: boolean;
  onSeek?: (seconds: number) => void;
}) {
  const fixLine = useMutation(api.translations.fixLine);
  const [editing, setEditing] = useState<string | null>(null);
  const flat = cue.text.replace(/\n/g, " ");

  async function save() {
    if (editing === null) return;
    const text = editing.trim();
    setEditing(null);
    if (!text || text === flat) return;
    try {
      await fixLine({ translationId, index, text });
    } catch (caught) {
      toast.error(errorMessage(caught, "The line could not be saved."));
    }
  }

  if (editing !== null) {
    return (
      <form
        className="flex items-center gap-3 px-3 py-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <span className="text-primary w-14 shrink-0 text-sm font-medium tabular-nums">
          {formatMoment(cue.start)}
        </span>
        <Input
          autoFocus
          value={editing}
          onChange={(event) => setEditing(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(null);
          }}
          aria-label={`Line at ${formatMoment(cue.start)}`}
          className="h-8"
        />
        <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save the line">
          <Check />
        </Button>
      </form>
    );
  }

  return (
    <div
      className={cn(
        "group flex w-full items-start gap-4 rounded-lg px-3 py-2 text-sm hover:bg-surface",
        playing && "bg-surface",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 gap-4 text-left"
        onClick={() => onSeek?.(cue.start)}
      >
        <span className="text-primary w-14 shrink-0 font-medium tabular-nums">
          {formatMoment(cue.start)}
        </span>
        <span>{flat}</span>
      </button>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Correct the line at ${formatMoment(cue.start)}`}
        onClick={() => setEditing(flat)}
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}

/** A translation's words: line by line to read and correct, or as its SRT or WebVTT. */
export function TranslatedWords({
  itemId,
  translation,
  shown,
  now,
  onSeek,
  onRemoved,
}: {
  itemId: Id<"libraryItems">;
  translation: Translation;
  shown: "read" | "srt" | "vtt";
  now: number;
  onSeek?: (seconds: number) => void;
  onRemoved: () => void;
}) {
  const start = useMutation(api.translations.start);
  const remove = useMutation(api.translations.remove);

  async function removeIt() {
    try {
      await remove({ translationId: translation._id });
      onRemoved();
    } catch (caught) {
      toast.error(errorMessage(caught, "The translation could not be removed."));
    }
  }

  if (translation.status === "working") {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
        <Spinner />
        Translating into {translation.name}: {translation.done} of {translation.total} lines. It is
        kept once done, so it is never paid for twice.
      </p>
    );
  }
  if (translation.status === "failed") {
    return (
      <div className="bg-surface flex flex-col items-start gap-3 rounded-xl p-5">
        <p className="text-sm">
          The translation into {translation.name} stopped after {translation.done} of{" "}
          {translation.total} lines{translation.error ? `: ${translation.error}` : "."}
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            void start({ itemId, language: translation.language }).catch((caught: unknown) =>
              toast.error(errorMessage(caught, "The translation could not be started.")),
            )
          }
        >
          Carry on
        </Button>
      </div>
    );
  }
  if (shown !== "read") {
    return <SubtitleText pieces={translation.cues} format={shown} cued />;
  }
  const playing = translation.cues.findLast((cue) => cue.start <= now)?.start;
  return (
    <div className="flex flex-col gap-2">
      <ol
        className="flex max-h-[32rem] flex-col gap-0.5 overflow-y-auto"
        data-testid="translation"
        aria-label={`What was said, in ${translation.name}`}
      >
        {translation.cues.map((cue, index) => (
          <li key={`${cue.start}-${index}`}>
            <TranslatedLine
              translationId={translation._id}
              index={index}
              cue={cue}
              playing={playing === cue.start}
              onSeek={onSeek}
            />
          </li>
        ))}
      </ol>
      <div>
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => void removeIt()}>
          <Trash2 />
          Remove {translation.name}
        </Button>
      </div>
    </div>
  );
}
