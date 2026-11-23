"use client";

import { api } from "@convex/_generated/api";
import { type Part, PARTS, type Scene, SCENES, sceneLabel } from "@convex/lib/storyboard";
import { clock, readClipRef, readUploadRef, timeRangeOf } from "@ncat-dash/automation-core";
import { useMutation } from "convex/react";
import { ArrowDown, ArrowUp, Link2, Trash2, Upload, X } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PickList } from "@/components/ui/pick-list";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/catalog";
import { useBrandUpload } from "@/lib/use-brand-upload";
import { cn } from "@/lib/utils";

import { SceneSketch } from "./scene-sketch";
import type { Take } from "./types";

/** The soft colour each part's chip wears, so a row reads at a glance. */
export const PART_TONE: Record<Part, string> = {
  you: "bg-amber-50 text-amber-900",
  graphic: "bg-violet-50 text-violet-900",
  recording: "bg-sky-50 text-sky-900",
  screen: "bg-orange-50 text-orange-900",
};

const STATUS_TONE = {
  done: "text-emerald-700",
  waiting: "text-amber-700",
  todo: "text-muted-foreground",
} as const;

export function PartChip({ part }: { part: Part }) {
  return (
    <span className={cn("rounded-full px-2 py-px text-xs", PART_TONE[part])}>
      {PARTS.find((entry) => entry.part === part)?.label}
    </span>
  );
}

function fileName(url: string) {
  if (readUploadRef(url)) return "Uploaded file";
  const range = readClipRef(url) ?? timeRangeOf(url);
  if (range) return `From the upload, ${clock(range.start)} to ${clock(range.end)}`;
  return decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() || url);
}

/** One part of a take: its file once it is in, or a way to upload or link one. */
function PartFile({ take, part }: { take: Take; part: Part }) {
  const setFile = useMutation(api.storyboards.setTakeFile);
  const upload = useBrandUpload();
  const picker = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState("");
  const label = PARTS.find((entry) => entry.part === part)!.label;
  const file = take.files[part];

  async function put(url: string | null) {
    try {
      await setFile({ takeId: take._id, part, url });
      setLink("");
      setLinking(false);
    } catch (caught) {
      toast.error(errorMessage(caught, "That file could not be added."));
    }
  }

  async function onPicked(files: FileList | null) {
    const picked = files?.[0];
    if (!picked) return;
    const ref = await upload.send(picked);
    if (ref) await put(ref);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (link.trim()) void put(link.trim());
  }

  return (
    <li className="flex flex-col gap-1.5" aria-label={label}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <PartChip part={part} />
        {file ? (
          <>
            <span className="min-w-0 flex-1 truncate">{fileName(file)}</span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Take out the ${label.toLowerCase()} file`}
              onClick={() => void put(null)}
            >
              <X />
            </Button>
          </>
        ) : (
          <>
            <span className="text-muted-foreground min-w-0 flex-1">No file yet</span>
            <input
              ref={picker}
              type="file"
              accept="video/*,image/*,audio/*"
              className="sr-only"
              aria-label={`Upload the ${label.toLowerCase()} file`}
              onChange={(event) => void onPicked(event.target.files)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={upload.busy}
              onClick={() => picker.current?.click()}
            >
              <Upload />
              {upload.busy ? "Uploading…" : "Upload"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLinking((open) => !open)}>
              <Link2 />
              Link
            </Button>
          </>
        )}
      </div>
      {linking && !file && (
        <form onSubmit={onSubmit} className="flex gap-2">
          <Input
            aria-label={`${label} file link`}
            placeholder="https://…"
            value={link}
            autoFocus
            onChange={(event) => setLink(event.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!link.trim()}>
            Add
          </Button>
        </form>
      )}
    </li>
  );
}

/** Everything about one take that can be changed, opened in place under its row. */
function TakeEditor({ take, first, last }: { take: Take; first: boolean; last: boolean }) {
  const update = useMutation(api.storyboards.updateTake);
  const move = useMutation(api.storyboards.moveTake);
  const remove = useMutation(api.storyboards.removeTake);
  const [line, setLine] = useState(take.line);

  async function change(patch: { line?: string; scene?: Scene; parts?: Part[] }) {
    try {
      await update({ takeId: take._id, ...patch });
    } catch (caught) {
      if (patch.line !== undefined) setLine(take.line);
      toast.error(errorMessage(caught, "The take could not be changed."));
    }
  }

  function togglePart(part: Part) {
    const has = take.parts.includes(part);
    const next = has ? take.parts.filter((entry) => entry !== part) : [...take.parts, part];
    if (next.length === 0) return;
    void change({ parts: next });
  }

  return (
    <div className="flex flex-col gap-4 px-3 pb-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">What is said</span>
        <Textarea
          value={line}
          maxLength={2000}
          onChange={(event) => setLine(event.target.value)}
          onBlur={() => {
            if (line.trim() && line.trim() !== take.line) void change({ line });
            else setLine(take.line);
          }}
        />
      </label>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Scene</span>
          <PickList
            aria-label="Scene"
            size="sm"
            value={take.scene}
            onChange={(next) => void change({ scene: next as Scene })}
            options={SCENES.map((entry) => ({ value: entry.scene, label: entry.label }))}
          />
        </label>
        <div role="group" aria-label="What goes in" className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">What goes in</span>
          {PARTS.map(({ part, label }) => {
            const on = take.parts.includes(part);
            return (
              <Button
                key={part}
                size="sm"
                variant={on ? "secondary" : "ghost"}
                aria-pressed={on}
                onClick={() => togglePart(part)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>
      <ul className="flex flex-col gap-2" aria-label="Files">
        {take.parts.map((part) => (
          <PartFile key={part} take={take} part={part} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={first}
          onClick={() => void move({ takeId: take._id, direction: "up" })}
        >
          <ArrowUp />
          Move up
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={last}
          onClick={() => void move({ takeId: take._id, direction: "down" })}
        >
          <ArrowDown />
          Move down
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => void remove({ takeId: take._id })}
        >
          <Trash2 />
          Delete take
        </Button>
      </div>
    </div>
  );
}

/** A take as a row: its scene drawn, what goes in, the line, and where it stands. */
export function TakeRow({
  take,
  open,
  onToggle,
  first,
  last,
}: {
  take: Take;
  open: boolean;
  onToggle: () => void;
  first: boolean;
  last: boolean;
}) {
  return (
    <li
      data-take={take.number}
      className={cn("rounded-xl transition-colors", open ? "bg-muted/70" : "bg-surface")}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="focus-visible:ring-ring/50 hover:bg-muted/60 flex w-full flex-wrap items-start gap-3 rounded-xl p-3 text-left outline-none focus-visible:ring-3"
      >
        <SceneSketch scene={take.scene} />
        <span className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium">Take {take.number}</span>
            <span className="text-muted-foreground text-xs">{sceneLabel(take.scene)}</span>
            {take.parts.map((part) => (
              <PartChip key={part} part={part} />
            ))}
          </span>
          <span className="text-sm leading-relaxed">{take.line}</span>
        </span>
        <span className={cn("shrink-0 text-xs font-medium", STATUS_TONE[take.status.tone])}>
          {take.status.label}
        </span>
      </button>
      {open && <TakeEditor key={take._id + take.line} take={take} first={first} last={last} />}
    </li>
  );
}
