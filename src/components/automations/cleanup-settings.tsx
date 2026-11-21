"use client";

import {
  type AutomationNode,
  cleanupSettings,
  type HookMode,
  MAX_HOOKS,
} from "@ncat-dash/automation-core";
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

import { NumberBox, setOrClear } from "./moments-settings";

type NodeContent = Omit<AutomationNode, "position">;
type Settings = Record<string, unknown>;

const HOOK_CHOICES: { value: HookMode; label: string; help: string }[] = [
  {
    value: "said",
    label: "When the creator says them",
    help: "Say “hook one”, “hook two”… before each opening and “body” before the main part. Each hook comes back as its own file, and the body as another. Without them you get one cleaned video.",
  },
  {
    value: "count",
    label: "The first takes are hooks",
    help: "The first takes, each ending in a pause of a second or more, are the hooks. The rest is the body.",
  },
  {
    value: "none",
    label: "No hooks, one video",
    help: "Always one cleaned video.",
  },
];

/**
 * Clean Up Pauses And Retakes: how long a pause may be, whether retakes go, and how hook
 * takes are found. Everything has a usual value, so the step works as it is dropped in.
 */
export function CleanupMain({
  node,
  onChange,
}: {
  node: NodeContent;
  onChange: (input: Settings) => void;
}) {
  const set = (name: string, value: unknown) => onChange(setOrClear(node.input, name, value));
  const used = cleanupSettings(node.input);
  const [creator, setCreator] = useState(used.creator);
  const hooks = HOOK_CHOICES.find((choice) => choice.value === used.hooks)!;
  return (
    <FieldGroup>
      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4">
        <Field>
          <FieldLabel htmlFor={`node-${node.id}-over`}>Take down pauses over</FieldLabel>
          <NumberBox
            id={`node-${node.id}-over`}
            value={node.input.cutPausesOver ?? used.cutPausesOver}
            min={0.3}
            max={5}
            step={0.1}
            onSave={(value) => set("cutPausesOver", value)}
            suffix="seconds"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`node-${node.id}-leave`}>Leave a breath of</FieldLabel>
          <NumberBox
            id={`node-${node.id}-leave`}
            value={node.input.leavePause ?? used.leavePause}
            min={0}
            max={1}
            step={0.05}
            onSave={(value) => set("leavePause", value)}
            suffix="seconds"
          />
        </Field>
      </div>
      <FieldDescription>
        Pauses are where the toolkit hears silence. A cut never reaches into a word.
      </FieldDescription>
      <Field orientation="horizontal">
        <Switch
          id={`node-${node.id}-retakes`}
          checked={used.retakes}
          onCheckedChange={(on) => set("retakes", on ? undefined : false)}
        />
        <FieldLabel htmlFor={`node-${node.id}-retakes`}>
          Keep only the last take of a line said again
        </FieldLabel>
      </Field>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-hooks`}>Hook takes</FieldLabel>
        <Select
          value={used.hooks}
          onValueChange={(value) => set("hooks", value === "said" ? undefined : value)}
        >
          <SelectTrigger id={`node-${node.id}-hooks`} className="w-full">
            <SelectValue>{hooks.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {HOOK_CHOICES.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{hooks.help}</FieldDescription>
      </Field>
      {used.hooks === "count" && (
        <Field>
          <FieldLabel htmlFor={`node-${node.id}-count`}>How many hooks</FieldLabel>
          <NumberBox
            id={`node-${node.id}-count`}
            value={node.input.hookCount ?? used.hookCount}
            min={1}
            max={MAX_HOOKS}
            onSave={(value) => set("hookCount", value)}
          />
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-creator`}>Creator</FieldLabel>
        <Input
          id={`node-${node.id}-creator`}
          value={creator}
          maxLength={80}
          placeholder="Optional, such as Jane Doe"
          autoComplete="off"
          onChange={(event) => {
            setCreator(event.target.value);
            set("creator", event.target.value.trim() || undefined);
          }}
        />
        <FieldDescription>
          Their files are kept in a folder of their own, as hooks and body, ready for UGC Ad
          Variants.
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}
