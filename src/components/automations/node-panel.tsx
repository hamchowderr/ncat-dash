"use client";

import type {
  AutomationNode,
  Brand,
  CaptionSetup,
  CaptionShape,
  CaptionStyle,
} from "@ncat-dash/automation-core";
import {
  BRAND_WORDS,
  CAPTION_SHAPES,
  CAPTION_STYLE_SETTING,
  isCaptionStep,
  getPlatform,
  KIND_WORDS,
  nodeTypeOf,
  waitsForRun,
  wantedKind,
  writeSource,
} from "@ncat-dash/automation-core";
import { getStep } from "@ncat-dash/step-catalog";
import { ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  FilePicture,
  StepFields,
  fromInput,
  toInput,
  useStepFields,
} from "@/components/steps/step-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { nodeTitle } from "@/lib/automations";
import { fieldLabel } from "@/lib/catalog";

import { TeamApprovalSettings } from "./approval-panel";
import { AutomationPicker } from "./automation-picker";
import { nodeLook } from "./flow-nodes";
import { LogicSettings } from "./logic-panel";
import { ChaptersMain, MomentsMain, MomentsMore } from "./moments-settings";
import { BrollMain, BrollMore, BrollPlanMain } from "./broll-settings";
import { MotionMain, MotionPlanMain, SoundEffectsMain } from "./motion-settings";
import { PlatformPicker } from "./platform-picker";
import { useTeamStepsVersion } from "@/lib/team-steps-sync";

type NodeContent = Omit<AutomationNode, "position">;

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Settings for the step selected on the canvas. Mount with key={node.id}.
 *
 * Only what the step cannot work out is asked for up front. What it takes care of by
 * itself is listed in one short block, and everything else sits under "More options".
 */
/** "A", "A and B", "A, B and C". */
function joinNames(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function NodePanel({
  node,
  before,
  startGivesFile,
  filled,
  brand,
  music,
  onChange,
  onRemove,
  onDuplicate,
  failSteps,
  onAddOnFailure,
  waitsFor,
  automationId,
  feedsFollow,
  captions,
}: {
  node: NodeContent;
  /** The steps that run before this one, nearest first. Their files can be used here. */
  before: NodeContent[];
  /** Whether the automation's start hands over a file. */
  startGivesFile: boolean;
  /** Settings an earlier step fills in by itself, with a line saying from where. */
  filled: Record<string, string>;
  /** The team's logo, colour, font and music from Settings. */
  brand: Brand;
  /** The team's music library, to pick a track from by name. */
  music: { name: string; file: string }[];
  onChange: (patch: Partial<NodeContent>) => void;
  onRemove: () => void;
  /** Puts a copy of the step beside it. */
  onDuplicate?: () => void;
  /** The names of the steps that run when this one fails. */
  failSteps?: string[];
  /** Adds a step that runs when this one fails. Absent for steps that cannot fail over. */
  onAddOnFailure?: () => void;
  /** The names of the steps straight before this one. With two or more, it joins them. */
  waitsFor?: string[];
  /** The automation being edited, which a Run an automation step cannot pick. */
  automationId?: string;
  /** A Clips step whose clips go straight to Follow the speaker, so they keep their shape. */
  feedsFollow?: boolean;
  /** The team's captions from Settings, for a caption step. */
  captions?: TeamCaptions;
}) {
  useTeamStepsVersion();
  const step = node.kind === "step" ? getStep(node.stepId ?? "") : undefined;
  const nodeType = nodeTypeOf(node);
  const allFields = useStepFields(node.stepId ?? "");
  // Settings taken from the file that started the run are never filled in by hand.
  const fields = allFields?.filter(({ name }) => !nodeType?.fromStart?.[name]);
  const [values, setValues] = useState(() => fromInput(node.input));
  const [problem, setProblem] = useState<string | null>(null);
  const look = nodeLook(node);

  // Where a file setting can come from, in plain words. What is saved is a reference the
  // runner fills in; nobody sees or types it.
  const sources = [
    ...(startGivesFile
      ? [{ value: writeSource({ from: "trigger" })!, label: "The file that started the run" }]
      : []),
    // A step that makes text or data, such as a transcript, has no file to offer.
    ...before
      .filter((other) => nodeTypeOf(other)?.gives !== "data")
      .map((other) => ({
        value: writeSource({ from: "step", id: other.id })!,
        label: `The file from ${nodeTitle(other)}`,
      })),
  ];

  const automaticField = step?.primaryInput ?? step?.listInput?.field ?? null;
  const brandFields = Object.fromEntries(
    Object.entries(nodeType?.brand ?? {}).map(([name, key]) => [
      name,
      {
        word: BRAND_WORDS[key],
        set: Boolean(brand[key]),
        ...(key === "music" && music.length > 0
          ? {
              usual: "First track in your library",
              choices: music.map((track) => ({ value: track.file, label: track.name })),
            }
          : {}),
      },
    ]),
  );

  // Asked for up front: what is required and nothing else supplies, and what the step
  // names as worth asking first.
  const askFirst = new Set(step?.askFirst ?? []);
  const needed = (fields ?? []).filter(
    ({ name, required }) =>
      (required || askFirst.has(name)) && name !== automaticField && !brandFields[name],
  );
  const rest = (fields ?? []).filter((field) => !needed.includes(field));

  // What the step takes care of by itself, one line each.
  const handled: {
    label: string;
    text: string;
    settings?: boolean;
    href?: string;
    picture?: string;
  }[] = [];
  const captionStep = node.kind === "step" && isCaptionStep(node.stepId) && captions;
  if (captionStep && captions.setup.fixes.length > 0) {
    const count = captions.setup.fixes.length;
    handled.push({
      label: "Word fixes",
      text: `${count} ${count === 1 ? "word" : "words"} your team fixes in every caption`,
      settings: true,
      href: "/settings/captions",
    });
  }
  if (automaticField && isBlank(node.input[automaticField])) {
    handled.push({
      label: fieldLabel(automaticField).replace(/ URLs?$/, ""),
      text: `the nearest ${KIND_WORDS[wantedKind(automaticField)]} before this step`,
    });
  }
  for (const [name, note] of Object.entries(filled)) {
    if (isBlank(node.input[name])) {
      handled.push({
        label: fieldLabel(name),
        text: note.replace(/^Automatic\. Uses /, "").replace(/\. Fill it in.*$/, ""),
      });
    }
  }
  if (
    node.kind === "moments" ||
    node.kind === "chapters" ||
    node.kind === "broll" ||
    node.kind === "broll-plan" ||
    node.kind === "motion-plan" ||
    node.kind === "motion" ||
    node.kind === "sound-effects"
  ) {
    handled.push({
      label: "Video",
      text: "the nearest video before this step, transcribed with each word's timing",
    });
  }
  for (const name of Object.keys(nodeType?.fromStart ?? {})) {
    if (isBlank(node.input[name])) {
      handled.push({ label: fieldLabel(name), text: "the name of the file that started the run" });
    }
  }
  const unset: string[] = [];
  for (const [name, { word, set }] of Object.entries(brandFields)) {
    if (!isBlank(node.input[name])) continue;
    const key = nodeType?.brand?.[name];
    if (set)
      handled.push({
        label: fieldLabel(name).replace(/ URLs?$/, ""),
        text:
          key === "music" && music[0]
            ? `${music[0].name}, the first track in your library`
            : `your team's ${word}`,
        settings: true,
        ...(key === "logo" ? { picture: brand.logo } : {}),
      });
    else if (fields?.find((field) => field.name === name)?.required) unset.push(word);
  }

  const change = (name: string, value: string) => {
    if (!fields) return;
    const next = { ...values, [name]: value };
    setValues(next);
    const parsed = toInput(fields, next);
    setProblem(parsed.ok ? null : parsed.message);
    // The caption style is not one of the toolkit's fields, so it is carried over by hand.
    const picked = node.input[CAPTION_STYLE_SETTING];
    if (parsed.ok) {
      onChange({
        input: { ...parsed.input, ...(picked ? { [CAPTION_STYLE_SETTING]: picked } : {}) },
      });
    }
  };
  const automatic = { field: automaticField, sources, filled, brand: brandFields };

  return (
    <div className="flex flex-col gap-4">
      {/* The step's name and its buttons share one line; what it does reads across the
          whole panel underneath instead of being squeezed beside the buttons. The one column
          is never wider than the panel: a long name is cut short with "…" instead of
          stretching it and pushing the buttons and text past the edge. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <div className="flex items-center gap-3">
          <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
            <look.icon className={`size-5 ${look.tint}`} aria-hidden="true" />
          </span>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={nodeTitle(node)}>
            {nodeTitle(node)}
          </h2>
          {node.kind !== "if" && (
            <Switch
              className="shrink-0"
              checked={!node.off}
              onCheckedChange={(on) => onChange({ off: on ? undefined : true })}
              aria-label={node.off ? "Turn this step on" : "Turn this step off"}
              title={node.off ? "Turned off. Turn it on" : "Turn off without removing it"}
            />
          )}
          {onDuplicate && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground shrink-0"
              title="Duplicate (Ctrl+D)"
              onClick={onDuplicate}
            >
              <Copy />
              <span className="sr-only">Duplicate step</span>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground -mr-1 shrink-0"
            title="Remove step"
            onClick={onRemove}
          >
            <Trash2 />
            <span className="sr-only">Remove step</span>
          </Button>
        </div>
        <p className="text-muted-foreground text-xs text-pretty">
          {nodeType?.description ?? "This step is no longer in the catalog."}
        </p>
      </div>

      {waitsFor && waitsFor.length > 1 && (
        <p className="text-muted-foreground bg-background rounded-lg px-3 py-2 text-xs text-pretty">
          Waits for {joinNames(waitsFor)} to finish, then runs once with the files from{" "}
          {waitsFor.length === 2 ? "both" : "all of them"}. A side an If did not send files down is
          not waited for.
        </p>
      )}

      {node.off && (
        <Alert>
          <AlertDescription>
            Turned off. Runs skip this step&apos;s work and hand its files straight to the next
            step. Its settings are kept for when you turn it back on.
          </AlertDescription>
        </Alert>
      )}

      {unset.length > 0 && (
        <Alert>
          <AlertDescription>
            This step uses your team&apos;s {unset.join(" and ")}, which is not set yet.{" "}
            <Link
              href="/settings/brand"
              className="text-foreground font-medium underline underline-offset-4"
            >
              Add it in Settings
            </Link>
            . It is set once and every automation uses it.
          </AlertDescription>
        </Alert>
      )}

      {node.kind === "export" && (
        <p className="text-muted-foreground text-sm text-pretty">
          Nothing to set up. When a run finishes, press Open in editor on the run to download the
          timeline. Your editors are picked once in{" "}
          <Link href="/settings/editors" className="text-foreground underline underline-offset-4">
            Settings
          </Link>
          .
        </p>
      )}

      {node.kind === "clips" && (
        <Field>
          <FieldLabel>Platform</FieldLabel>
          <PlatformPicker
            compact
            followed={feedsFollow}
            value={getPlatform(node.input.platform)?.name}
            onChange={(platform) => onChange({ input: { ...node.input, platform } })}
          />
        </Field>
      )}

      {node.kind === "moments" && (
        <MomentsMain
          node={node}
          feedsFollow={feedsFollow}
          onChange={(input) => onChange({ input })}
        />
      )}

      {node.kind === "chapters" && (
        <ChaptersMain node={node} onChange={(input) => onChange({ input })} />
      )}

      {node.kind === "broll" && (
        <BrollMain
          node={node}
          planned={before.some((one) => one.kind === "broll-plan")}
          onChange={(input) => onChange({ input })}
        />
      )}

      {node.kind === "broll-plan" && (
        <BrollPlanMain node={node} onChange={(input) => onChange({ input })} />
      )}

      {node.kind === "motion" && (
        <MotionMain
          key={node.id}
          node={node}
          planned={before.some((one) => one.kind === "motion-plan")}
          onChange={(input) => onChange({ input })}
        />
      )}

      {node.kind === "motion-plan" && (
        <MotionPlanMain node={node} onChange={(input) => onChange({ input })} />
      )}

      {node.kind === "sound-effects" && (
        <SoundEffectsMain node={node} onChange={(input) => onChange({ input })} />
      )}

      {captionStep && (
        <CaptionStylePicker
          node={node}
          captions={captions}
          onChange={(input) => {
            setValues(fromInput(input));
            onChange({ input });
          }}
        />
      )}

      {node.kind === "approval" && <TeamApprovalSettings node={node} onChange={onChange} />}

      {(node.kind === "if" || node.kind === "wait") && (
        <LogicSettings node={node} onChange={onChange} />
      )}

      {node.kind === "automation" && (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`node-${node.id}-automation`}>Automation to run</FieldLabel>
            <AutomationPicker
              id={`node-${node.id}-automation`}
              value={typeof node.input.automation === "string" ? node.input.automation : ""}
              exclude={automationId ?? ""}
              onChange={(automation) => onChange({ input: { ...node.input, automation } })}
            />
          </Field>
          <Field orientation="horizontal">
            <Switch
              id={`node-${node.id}-wait`}
              checked={waitsForRun(node)}
              onCheckedChange={(wait) => onChange({ input: { ...node.input, wait } })}
            />
            <FieldLabel htmlFor={`node-${node.id}-wait`}>Wait for it to finish</FieldLabel>
          </Field>
          <p className="text-muted-foreground text-xs text-pretty">
            {waitsForRun(node)
              ? "The files that reach this step go to it. When its run finishes, the files it made carry on from here. If it fails, so does this step."
              : "The files that reach this step go to it, and this run carries on with them straight away without waiting."}{" "}
            It runs the published version.
          </p>
        </FieldGroup>
      )}

      {node.kind === "step" && fields && needed.length > 0 && (
        <FieldGroup>
          <StepFields
            fields={needed}
            values={values}
            idPrefix={`node-${node.id}`}
            automatic={automatic}
            onChange={change}
          />
        </FieldGroup>
      )}
      {problem && (
        <Alert variant="destructive">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}

      {handled.length > 0 && (
        <div className="bg-background rounded-lg p-3">
          <p className="mb-1.5 text-xs font-medium">Handled for you</p>
          <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
            {handled.map((item) => (
              <li key={item.label} className={item.picture ? "flex items-center gap-2" : undefined}>
                {item.picture && (
                  <FilePicture value={item.picture} label="Your logo" className="size-8" />
                )}
                <span>
                  <span className="text-foreground">{item.label}:</span> {item.text}
                  {item.settings && (
                    <>
                      {" "}
                      (
                      <Link
                        href={item.href ?? "/settings/brand"}
                        className="underline underline-offset-2"
                      >
                        Settings
                      </Link>
                      )
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {node.kind === "step" && needed.length === 0 && unset.length === 0 && (
        <p className="text-muted-foreground text-sm">Nothing to set. This step works as it is.</p>
      )}

      <Collapsible>
        <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 rounded-md py-1 text-sm font-medium outline-none focus-visible:underline">
          <ChevronRight
            className="size-4 transition-transform group-data-[state=open]:rotate-90"
            aria-hidden="true"
          />
          More options
        </CollapsibleTrigger>
        <CollapsibleContent>
          <FieldGroup className="pt-3">
            <Field>
              <FieldLabel htmlFor="node-label">Name on the canvas</FieldLabel>
              <Input
                id="node-label"
                value={node.label ?? ""}
                placeholder={nodeTitle({ ...node, label: undefined })}
                maxLength={60}
                onChange={(event) => onChange({ label: event.target.value || undefined })}
                autoComplete="off"
              />
            </Field>
            {node.kind === "moments" && (
              <MomentsMore node={node} onChange={(input) => onChange({ input })} />
            )}
            {node.kind === "broll" && (
              <BrollMore node={node} onChange={(input) => onChange({ input })} />
            )}
            {node.kind === "step" && fields && (
              <StepFields
                fields={rest}
                values={values}
                idPrefix={`node-${node.id}`}
                automatic={automatic}
                onChange={change}
              />
            )}
          </FieldGroup>
        </CollapsibleContent>
      </Collapsible>

      {onAddOnFailure && (
        <section aria-label="If it fails" className="flex items-center justify-between gap-2 pt-2">
          <div className="grid min-w-0">
            <h3 className="text-sm font-medium">If it fails</h3>
            <p className="text-muted-foreground text-xs text-pretty">
              {failSteps && failSteps.length > 0
                ? `Its files go to ${joinNames(failSteps)} instead, and the run carries on.`
                : "The run stops here. Add a step to try something else with its files."}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={onAddOnFailure}
          >
            <Plus />
            {failSteps && failSteps.length > 0 ? "Add another" : "Add a step"}
          </Button>
        </section>
      )}
    </div>
  );
}

export type TeamCaptions = {
  setup: CaptionSetup;
  builtIn: CaptionStyle[];
  builtInByShape: Record<CaptionShape, string>;
};

const MATCH_SHAPE = "__shape__";

function without(input: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([name]) => name !== key));
}

/** Which of the team's caption styles a caption step uses. */
function CaptionStylePicker({
  node,
  captions,
  onChange,
}: {
  node: NodeContent;
  captions: TeamCaptions;
  onChange: (input: Record<string, unknown>) => void;
}) {
  const { setup, builtIn, builtInByShape } = captions;
  const all = [...setup.styles, ...builtIn];
  const pickedName = node.input[CAPTION_STYLE_SETTING];
  const picked =
    typeof pickedName === "string"
      ? all.find((style) => style.name.toLowerCase() === pickedName.toLowerCase())
      : undefined;
  const own = node.input.settings;
  const hasOwnLook =
    typeof own === "object" && own !== null && Object.values(own).some((value) => !isBlank(value));
  const forShape = (shape: CaptionShape) => {
    const name = setup.byShape[shape];
    return name && all.some((style) => style.name === name) ? name : builtInByShape[shape];
  };
  const id = `node-${node.id}-caption-style`;

  return (
    <Field>
      <FieldLabel htmlFor={id}>Caption style</FieldLabel>
      <Select
        value={picked?.name ?? MATCH_SHAPE}
        onValueChange={(value) => {
          const rest = without(node.input, CAPTION_STYLE_SETTING);
          onChange(value === MATCH_SHAPE ? rest : { ...rest, [CAPTION_STYLE_SETTING]: value });
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={MATCH_SHAPE}>Match the video&apos;s shape</SelectItem>
          {setup.styles.length > 0 && (
            <SelectGroup>
              <SelectLabel>Yours</SelectLabel>
              {setup.styles.map((style) => (
                <SelectItem key={style.name} value={style.name}>
                  {style.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          <SelectGroup>
            <SelectLabel>Built in</SelectLabel>
            {builtIn.map((style) => (
              <SelectItem key={style.name} value={style.name}>
                {style.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {hasOwnLook && !picked ? (
        <div className="text-muted-foreground flex flex-col items-start gap-1.5 text-xs text-pretty">
          <p>
            This step has its own look under More options, so your team&apos;s caption styles are
            not used.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onChange(without(node.input, "settings"));
            }}
          >
            Use the team&apos;s styles
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs text-pretty">
          {picked
            ? "Used on every video, whatever its shape."
            : CAPTION_SHAPES.map(
                ({ shape, label }) => `${label.replace(" videos", "")}: ${forShape(shape)}`,
              ).join(" · ")}{" "}
          (
          <Link href="/settings/captions" className="underline underline-offset-2">
            Settings
          </Link>
          )
        </p>
      )}
    </Field>
  );
}
