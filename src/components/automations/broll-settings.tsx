"use client";

import {
  type AutomationNode,
  BROLL_DEFAULTS,
  brollSettings,
  MAX_BROLL_SECONDS,
  MAX_SKIP_OPENING,
  MIN_BROLL_SECONDS,
} from "@takewon/automation-core";
import Link from "next/link";

import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { NumberBox, setOrClear } from "./moments-settings";

type NodeContent = Omit<AutomationNode, "position">;
type Settings = Record<string, unknown>;

const OFTEN = [
  { value: "light", label: "Now and then", note: "About 15 seconds on you between cutaways" },
  { value: "medium", label: "Regularly", note: "About 7 seconds on you between cutaways" },
  { value: "busy", label: "Often", note: "About 3 seconds on you between cutaways" },
];

const SOURCES = [
  { value: "library-and-stock", label: "Your library, then free stock" },
  { value: "library", label: "Your library only" },
  { value: "stock", label: "Free stock only" },
];

const LOOKS = [
  { value: "full", label: "Fills the frame" },
  { value: "window", label: "In a box over you" },
];

const MATCH = [
  { value: "close", label: "Close: fewer, surer cutaways" },
  { value: "normal", label: "Normal" },
  { value: "loose", label: "Loose: more cutaways" },
];

/** A select for one of the step's settings, saving nothing when the usual value is picked. */
function Choice({
  id,
  label,
  value,
  usual,
  options,
  onPick,
}: {
  id: string;
  label: string;
  value: string;
  usual: string;
  options: { value: string; label: string }[];
  onPick: (value: string | undefined) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value}
        onValueChange={(picked) => onPick(picked === usual ? undefined : picked)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Add B-Roll, up top: how often, how long, how it sits, and where footage comes from. */
export function BrollMain({
  node,
  planned,
  onChange,
}: {
  node: NodeContent;
  /** Whether a Plan B-Roll step comes before it, so the plan decides where cutaways go. */
  planned?: boolean;
  onChange: (input: Settings) => void;
}) {
  const set = (name: string, value: unknown) => onChange(setOrClear(node.input, name, value));
  const used = brollSettings(node.input);
  const often = OFTEN.find((one) => one.value === used.often)!;
  return (
    <FieldGroup>
      <Choice
        id={`node-${node.id}-often`}
        label="How often"
        value={used.often}
        usual={BROLL_DEFAULTS.often}
        options={OFTEN}
        onPick={(value) => set("often", value)}
      />
      <FieldDescription className="-mt-2">
        {planned ? "Plan B-Roll before this step decides where they go. " : ""}
        {often.note}.
      </FieldDescription>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field>
          <FieldLabel htmlFor={`node-${node.id}-seconds`}>Each lasts</FieldLabel>
          <NumberBox
            id={`node-${node.id}-seconds`}
            value={node.input.seconds ?? used.seconds}
            min={MIN_BROLL_SECONDS}
            max={MAX_BROLL_SECONDS}
            step={0.5}
            onSave={(value) => set("seconds", value)}
            suffix="seconds"
          />
        </Field>
        <Choice
          id={`node-${node.id}-look`}
          label="Cutaway"
          value={used.look}
          usual={BROLL_DEFAULTS.look}
          options={LOOKS}
          onPick={(value) => set("look", value)}
        />
      </div>
      <Choice
        id={`node-${node.id}-sources`}
        label="Footage from"
        value={used.sources}
        usual={BROLL_DEFAULTS.sources}
        options={SOURCES}
        onPick={(value) => set("sources", value)}
      />
      <FieldDescription className="-mt-2">
        Footage is matched to what is said by how it looks. Pick which library videos count in{" "}
        <Link href="/settings/broll" className="underline underline-offset-2">
          Settings, B-Roll
        </Link>
        .
      </FieldDescription>
    </FieldGroup>
  );
}

/** Add B-Roll, under More options: the opening kept on the speaker, and how close a match. */
export function BrollMore({
  node,
  onChange,
}: {
  node: NodeContent;
  onChange: (input: Settings) => void;
}) {
  const set = (name: string, value: unknown) => onChange(setOrClear(node.input, name, value));
  const used = brollSettings(node.input);
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-opening`}>Keep the opening on you for</FieldLabel>
        <NumberBox
          id={`node-${node.id}-opening`}
          value={node.input.skipOpening ?? used.skipOpening}
          min={0}
          max={MAX_SKIP_OPENING}
          onSave={(value) => set("skipOpening", value)}
          suffix="seconds"
        />
        <FieldDescription>So the hook stays on your face.</FieldDescription>
      </Field>
      <Choice
        id={`node-${node.id}-match`}
        label="How close a match"
        value={used.match}
        usual={BROLL_DEFAULTS.match}
        options={MATCH}
        onPick={(value) => set("match", value)}
      />
    </>
  );
}

/** Plan B-Roll: what the cutaways should favour. How many comes from Add B-Roll after it. */
export function BrollPlanMain({
  node,
  onChange,
}: {
  node: NodeContent;
  onChange: (input: Settings) => void;
}) {
  const set = (name: string, value: unknown) => onChange(setOrClear(node.input, name, value));
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-favour`}>What to show</FieldLabel>
        <Textarea
          id={`node-${node.id}-favour`}
          defaultValue={typeof node.input.lookFor === "string" ? node.input.lookFor : ""}
          placeholder="Places, things and numbers that are named"
          maxLength={1000}
          rows={2}
          onChange={(event) => set("lookFor", event.target.value)}
        />
      </Field>
      <FieldDescription>
        Uses AI once per video to pick the moments. How often and how long come from the Add B-Roll
        step after it, which lays the footage.
      </FieldDescription>
    </FieldGroup>
  );
}
