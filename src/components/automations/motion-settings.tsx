"use client";

import {
  type AutomationNode,
  MOTION_PRESETS,
  motionStepSettings,
  OUTLINE_STYLE_LABELS,
  OUTLINE_STYLES,
  PRESET_GROUPS,
  PUNCH_STYLE_LABELS,
  PUNCH_STYLES,
  SOUND_LEVEL_LABELS,
  SOUND_LEVELS,
  soundStepSettings,
  STYLE_SOUNDS,
  TEAM_STYLE,
} from "@takewon/automation-core";
import Link from "next/link";
import { useState } from "react";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type NodeContent = Omit<AutomationNode, "position">;
type Settings = Record<string, unknown>;

function setOrClear(input: Settings, name: string, value: unknown): Settings {
  const next = { ...input };
  if (
    value === undefined ||
    value === "" ||
    value === false ||
    value === TEAM_STYLE ||
    value === STYLE_SOUNDS
  ) {
    delete next[name];
  } else next[name] = value;
  return next;
}

const SettingsLink = () => (
  <Link href="/settings/motion" className="text-foreground underline underline-offset-4">
    Settings &gt; Motion
  </Link>
);

/** The Add Motion Graphics switches that need the speaker cut out, or punch in. */
const EFFECTS = [
  {
    name: "behind",
    label: "Behind the speaker",
    description:
      "The opening title becomes big words behind your head, and keywords sit behind you too. You are cut out once, with no green screen.",
  },
  {
    name: "outline",
    label: "Outline",
    description: "A line drawn around you while something sits behind you, or as it opens.",
  },
  {
    name: "punchIns",
    label: "Punch-ins",
    description: "The camera moves as each keyword or number lands.",
  },
] as const;

/** The look each switch can take once it is on. */
const EFFECT_STYLES = {
  outline: {
    name: "outlineStyle",
    label: "Outline look",
    options: OUTLINE_STYLES.map((value) => ({ value, label: OUTLINE_STYLE_LABELS[value] })),
  },
  punchIns: {
    name: "punchStyle",
    label: "How the camera moves",
    options: PUNCH_STYLES.map((value) => ({ value, label: PUNCH_STYLE_LABELS[value] })),
  },
} as const;

/** Add Motion Graphics: the style (the team's or a preset), the opening title, the sounds. */
export function MotionMain({
  node,
  planned,
  onChange,
}: {
  node: NodeContent;
  /** A Plan Motion Graphics step comes before it and picks the pieces between. */
  planned?: boolean;
  onChange: (input: Settings) => void;
}) {
  const settings = motionStepSettings(node.input);
  const [title, setTitle] = useState(settings.title);
  const set = (name: string, value: unknown) => onChange(setOrClear(node.input, name, value));
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-style`}>Style</FieldLabel>
        <Select value={settings.style} onValueChange={(value) => set("style", value)}>
          <SelectTrigger id={`node-${node.id}-style`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TEAM_STYLE}>Your team&apos;s style</SelectItem>
            {PRESET_GROUPS.map((group) => (
              <SelectGroup key={group}>
                <SelectLabel>{group}</SelectLabel>
                {MOTION_PRESETS.filter((preset) => preset.group === group).map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          {planned
            ? "Plan Motion Graphics before this step picks the pieces between the opening and the ending. "
            : ""}
          Your team&apos;s style, names and handle are set in <SettingsLink />.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-title`}>Opening title</FieldLabel>
        <Input
          id={`node-${node.id}-title`}
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => set("title", title.trim())}
        />
        <FieldDescription>
          Left empty, it uses the name of the file that started the run.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-sounds`}>Sounds</FieldLabel>
        <Select value={settings.sounds} onValueChange={(value) => set("sounds", value)}>
          <SelectTrigger id={`node-${node.id}-sounds`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STYLE_SOUNDS}>As the style says</SelectItem>
            {SOUND_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {SOUND_LEVEL_LABELS[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>Each piece comes in with its own sound.</FieldDescription>
      </Field>
      {EFFECTS.map((effect) => (
        <Field key={effect.name} orientation="horizontal">
          <Switch
            id={`node-${node.id}-${effect.name}`}
            checked={settings[effect.name]}
            onCheckedChange={(on) => set(effect.name, on)}
          />
          <FieldContent>
            <FieldLabel htmlFor={`node-${node.id}-${effect.name}`}>{effect.label}</FieldLabel>
            <FieldDescription>{effect.description}</FieldDescription>
            {effect.name !== "behind" && settings[effect.name] ? (
              <EffectStyle
                id={`node-${node.id}-${EFFECT_STYLES[effect.name].name}`}
                label={EFFECT_STYLES[effect.name].label}
                value={settings[EFFECT_STYLES[effect.name].name]}
                options={EFFECT_STYLES[effect.name].options}
                onChange={(value) => set(EFFECT_STYLES[effect.name].name, value)}
              />
            ) : null}
          </FieldContent>
        </Field>
      ))}
    </FieldGroup>
  );
}

function EffectStyle({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <FieldLabel htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </FieldLabel>
      <Select value={value} onValueChange={onChange}>
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
    </div>
  );
}

/**
 * Plan Motion Graphics: what the pieces should bring out. Which pieces, how often and the
 * look come from the Add Motion Graphics step after it, which draws them.
 */
export function MotionPlanMain({
  node,
  onChange,
}: {
  node: NodeContent;
  onChange: (input: Settings) => void;
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-bring-out`}>What to bring out</FieldLabel>
        <Textarea
          id={`node-${node.id}-bring-out`}
          defaultValue={typeof node.input.lookFor === "string" ? node.input.lookFor : ""}
          placeholder="Numbers, names and the main points"
          maxLength={1000}
          rows={2}
          onChange={(event) => onChange(setOrClear(node.input, "lookFor", event.target.value))}
        />
      </Field>
      <FieldDescription>
        Uses AI once per video to read the transcript and pick each piece and its sound. Which
        pieces, how often and the look come from the Add Motion Graphics step after it, and from
        your style notes in <SettingsLink />.
      </FieldDescription>
    </FieldGroup>
  );
}

/** Add Sound Effects: how many, from the team's level or chosen here. */
export function SoundEffectsMain({
  node,
  onChange,
}: {
  node: NodeContent;
  onChange: (input: Settings) => void;
}) {
  const { level } = soundStepSettings(node.input);
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`node-${node.id}-level`}>How many</FieldLabel>
        <Select
          value={level}
          onValueChange={(value) => onChange(setOrClear(node.input, "level", value))}
        >
          <SelectTrigger id={`node-${node.id}-level`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TEAM_STYLE}>As your team&apos;s setting</SelectItem>
            <SelectItem value="light">A few</SelectItem>
            <SelectItem value="heavy">One on every number</SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>
          A hit as it opens, a whoosh at each chapter, a pop on numbers that are said and a chime as
          it ends. Your team&apos;s level is in <SettingsLink />.
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}
