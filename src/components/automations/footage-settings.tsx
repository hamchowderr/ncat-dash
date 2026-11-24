"use client";

import {
  type AutomationNode,
  type FootageAction,
  type FootageShape,
  footageSettings,
} from "@takewon/automation-core";

import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { NumberBox, setOrClear } from "./moments-settings";

type NodeContent = Omit<AutomationNode, "position">;
type Settings = Record<string, unknown>;

const SHAPES: { value: FootageShape; label: string }[] = [
  { value: "vertical", label: "Vertical (9:16)" },
  { value: "horizontal", label: "Landscape (16:9)" },
  { value: "square", label: "Square (1:1)" },
  { value: "any", label: "Any shape" },
];

const ACTIONS: { value: FootageAction; label: string; help: string }[] = [
  {
    value: "stop",
    label: "Stop before editing",
    help: "Nothing is edited until better footage lands. The team is told, and a note is left in the creator's folder saying what to film again.",
  },
  {
    value: "tell",
    label: "Tell the team and keep going",
    help: "The team is told and a note is left in the creator's folder, but editing goes ahead with the footage as it is.",
  },
];

/**
 * Check Footage: what the footage must be, and what happens when it is not. Every setting
 * has a usual value, so the step works as it is dropped in.
 */
export function FootageMain({
  node,
  onChange,
}: {
  node: NodeContent;
  onChange: (input: Settings) => void;
}) {
  const set = (name: string, value: unknown) => onChange(setOrClear(node.input, name, value));
  const used = footageSettings(node.input);
  const action = ACTIONS.find((choice) => choice.value === used.whenFound)!;
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-shape`}>Filmed in</FieldLabel>
        <Select
          value={used.shape}
          onValueChange={(value) => set("shape", value === "vertical" ? undefined : value)}
        >
          <SelectTrigger id={`node-${node.id}-shape`} className="w-full">
            <SelectValue>{SHAPES.find((one) => one.value === used.shape)!.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SHAPES.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          As the video plays, so a phone held upright counts as vertical.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-pixels`}>Short side at least</FieldLabel>
        <NumberBox
          id={`node-${node.id}-pixels`}
          value={node.input.minShortSide ?? used.minShortSide}
          min={0}
          max={4320}
          onSave={(value) => set("minShortSide", value)}
          suffix="pixels on the short side"
        />
        <FieldDescription>
          720 is the least for a sharp ad; 1080 for 1080×1920. 0 skips it.
        </FieldDescription>
      </Field>
      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4">
        <Field>
          <FieldLabel htmlFor={`node-${node.id}-seconds`}>Videos at least</FieldLabel>
          <NumberBox
            id={`node-${node.id}-seconds`}
            value={node.input.minSeconds ?? used.minSeconds}
            min={0}
            max={600}
            step={0.5}
            onSave={(value) => set("minSeconds", value)}
            suffix="seconds"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`node-${node.id}-takes`}>Hook and ending takes at least</FieldLabel>
          <NumberBox
            id={`node-${node.id}-takes`}
            value={node.input.minTakeSeconds ?? used.minTakeSeconds}
            min={0}
            max={60}
            step={0.5}
            onSave={(value) => set("minTakeSeconds", value)}
            suffix="seconds"
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-quiet`}>Sound at least</FieldLabel>
        <NumberBox
          id={`node-${node.id}-quiet`}
          value={node.input.quietBelow ?? used.quietBelow}
          min={-70}
          max={-10}
          onSave={(value) => set("quietBelow", value)}
          suffix="LUFS"
        />
        <FieldDescription>
          Speech for social video is usually around -14 to -24. Quieter than -35 is hard to hear.
          Missing sound, clipped sound, black picture and a picture that freezes are always flagged.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-when`}>When something is wrong</FieldLabel>
        <Select
          value={used.whenFound}
          onValueChange={(value) => set("whenFound", value === "stop" ? undefined : value)}
        >
          <SelectTrigger id={`node-${node.id}-when`} className="w-full">
            <SelectValue>{action.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ACTIONS.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{action.help}</FieldDescription>
      </Field>
    </FieldGroup>
  );
}
