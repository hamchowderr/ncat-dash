"use client";

import {
  type AutomationNode,
  getPlatform,
  MAX_CHAPTERS,
  MAX_MOMENTS,
  MAX_PADDING,
  momentSettings,
} from "@takewon/automation-core";
import { useState } from "react";

import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { PlatformPicker } from "./platform-picker";

type NodeContent = Omit<AutomationNode, "position">;
type Settings = Record<string, unknown>;

/**
 * A number box that keeps what is typed while it is being typed, and saves it once it is
 * a number. Emptying it puts the step back on its usual value.
 */
export function NumberBox({
  id,
  value,
  onSave,
  min,
  max,
  step = 1,
  suffix,
}: {
  id: string;
  value: unknown;
  onSave: (value: number | undefined) => void;
  min: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const [typed, setTyped] = useState(value === undefined || value === null ? "" : String(value));
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        inputMode="decimal"
        className="w-20 tabular-nums"
        value={typed}
        onChange={(event) => {
          const text = event.target.value;
          setTyped(text);
          if (text.trim() === "") return onSave(undefined);
          const number = Number(text);
          if (Number.isFinite(number) && number >= min && (max === undefined || number <= max)) {
            onSave(step === 1 && !text.includes(".") ? Math.round(number) : number);
          }
        }}
        autoComplete="off"
      />
      {suffix && <span className="text-muted-foreground text-sm">{suffix}</span>}
    </div>
  );
}

export function setOrClear(input: Settings, name: string, value: unknown): Settings {
  const next = { ...input };
  if (value === undefined || value === "") delete next[name];
  else next[name] = value;
  return next;
}

/**
 * Best moments, up top: where the clips go, how many, and how long. Everything here has a
 * usual value, so only the platform must be picked.
 */
export function MomentsMain({
  node,
  feedsFollow,
  onChange,
}: {
  node: NodeContent;
  feedsFollow?: boolean;
  onChange: (input: Settings) => void;
}) {
  const set = (name: string, value: unknown) => onChange(setOrClear(node.input, name, value));
  const used = momentSettings(node.input);
  const platform = getPlatform(node.input.platform);
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Platform</FieldLabel>
        <PlatformPicker
          compact
          followed={feedsFollow}
          value={platform?.name}
          onChange={(name) => onChange({ ...node.input, platform: name })}
        />
      </Field>
      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4">
        <Field>
          <FieldLabel htmlFor={`node-${node.id}-count`}>Clips per video</FieldLabel>
          <NumberBox
            id={`node-${node.id}-count`}
            value={node.input.count ?? used.count}
            min={1}
            max={MAX_MOMENTS}
            onSave={(value) => set("count", value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`node-${node.id}-min`}>Length</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <NumberBox
              id={`node-${node.id}-min`}
              value={node.input.minSeconds ?? used.minSeconds}
              min={1}
              onSave={(value) => set("minSeconds", value)}
            />
            <span className="text-muted-foreground text-sm">to</span>
            <NumberBox
              id={`node-${node.id}-max`}
              value={node.input.maxSeconds ?? used.maxSeconds}
              min={1}
              onSave={(value) => set("maxSeconds", value)}
              suffix="seconds"
            />
          </div>
        </Field>
      </div>
      {platform && (
        <FieldDescription>
          {platform.name} takes clips up to {platform.maxSeconds} seconds
          {used.maxSeconds < Number(node.input.maxSeconds ?? 0)
            ? `, so the longest is ${used.maxSeconds}`
            : ""}
          .
        </FieldDescription>
      )}
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-topics`}>Topics to favour</FieldLabel>
        <Input
          id={`node-${node.id}-topics`}
          defaultValue={typeof node.input.topics === "string" ? node.input.topics : ""}
          placeholder="Any topic"
          maxLength={500}
          onChange={(event) => set("topics", event.target.value)}
          autoComplete="off"
        />
      </Field>
    </FieldGroup>
  );
}

/** Best moments, under More options: what counts as good, and how the edges are cut. */
export function MomentsMore({
  node,
  onChange,
}: {
  node: NodeContent;
  onChange: (input: Settings) => void;
}) {
  const set = (name: string, value: unknown) => onChange(setOrClear(node.input, name, value));
  const used = momentSettings(node.input);
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-look`}>What makes a good moment</FieldLabel>
        <Textarea
          id={`node-${node.id}-look`}
          defaultValue={typeof node.input.lookFor === "string" ? node.input.lookFor : ""}
          placeholder="A strong opinion, a story or a tip that stands on its own"
          maxLength={1000}
          rows={2}
          onChange={(event) => set("lookFor", event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-edges`}>Each clip starts and ends on</FieldLabel>
        <Select value={used.edges} onValueChange={(value) => set("edges", value)}>
          <SelectTrigger id={`node-${node.id}-edges`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sentence">Whole sentences</SelectItem>
            <SelectItem value="word">The exact words picked</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-padding`}>Room before and after</FieldLabel>
        <NumberBox
          id={`node-${node.id}-padding`}
          value={node.input.padding ?? used.padding}
          min={0}
          max={MAX_PADDING}
          step={0.05}
          onSave={(value) => set("padding", value)}
          suffix="seconds"
        />
        <FieldDescription>Never reaches into the word before or after.</FieldDescription>
      </Field>
      <Field orientation="horizontal">
        <Switch
          id={`node-${node.id}-skip`}
          checked={used.skipPicked}
          onCheckedChange={(on) => set("skipPicked", on ? undefined : false)}
        />
        <FieldLabel htmlFor={`node-${node.id}-skip`}>
          Skip moments already picked from the same video
        </FieldLabel>
      </Field>
    </>
  );
}

/** Chapters: how many and how many bullets. Both have usual values. */
export function ChaptersMain({
  node,
  onChange,
}: {
  node: NodeContent;
  onChange: (input: Settings) => void;
}) {
  const set = (name: string, value: unknown) => onChange(setOrClear(node.input, name, value));
  return (
    <FieldGroup>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field>
          <FieldLabel htmlFor={`node-${node.id}-chapters`}>Chapters, at most</FieldLabel>
          <NumberBox
            id={`node-${node.id}-chapters`}
            value={node.input.count || ""}
            min={1}
            max={MAX_CHAPTERS}
            onSave={(value) => set("count", value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`node-${node.id}-bullets`}>Bullets each</FieldLabel>
          <NumberBox
            id={`node-${node.id}-bullets`}
            value={node.input.bullets ?? 3}
            min={0}
            max={6}
            onSave={(value) => set("bullets", value)}
          />
        </Field>
      </div>
      <FieldDescription>
        Leave chapters empty to let it decide from the video. The first chapter starts at 0:00, and
        each one on a whole sentence.
      </FieldDescription>
    </FieldGroup>
  );
}
