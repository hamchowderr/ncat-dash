"use client";

import { KINDS, STATUSES } from "@convex/lib/packages";
import { Check, Copy, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hookUrl, type Trigger, TRIGGER_LABELS, type TriggerKind } from "@/lib/automations";

import { AutomationPicker } from "./automation-picker";
import { RunsAtOnce } from "./runs-at-once";
import { TRIGGER_ICONS, TRIGGER_TINT } from "./flow-nodes";
import { TimeZonePicker, zoneCity } from "./time-zone-picker";
import { LocalFolder } from "./local-folder";
import { WatchedFolder } from "./watched-folder";

const UNITS = { minutes: 1, hours: 60, days: 1440 } as const;

/** One line under each choice in the What starts it list. */
const TRIGGER_HINTS: Record<TriggerKind, string> = {
  manual: "Only when someone presses Run now",
  webhook: "When another app sends it a message",
  schedule: "Every so often, or each day at a set time",
  upload: "When a file is added on the Uploads page",
  folder: "When a file lands in one of your folders",
  finished: "Right after another automation runs",
  slot: "When a project slot moves to a new status",
};
type Unit = keyof typeof UNITS;

function unitOf(minutes: number): Unit {
  return minutes % 1440 === 0 ? "days" : minutes % 60 === 0 ? "hours" : "minutes";
}

/**
 * What a newly added trigger starts as: the first of the usual ones the automation does not
 * have yet. Its kind can be changed straight after.
 */
export function newTriggerKind(existing: { trigger: Trigger }[]): Trigger {
  const used = new Set(existing.map((each) => each.trigger.kind));
  const kind =
    (["upload", "folder", "schedule", "webhook"] as const).find((each) => !used.has(each)) ??
    "schedule";
  return defaultFor(kind);
}

function defaultFor(kind: TriggerKind): Trigger {
  if (kind === "schedule") return { kind, schedule: { mode: "interval", minutes: 60 } };
  if (kind === "upload") return { kind, fileType: "video" };
  if (kind === "folder") return { kind, prefix: "incoming/", fileType: "video" };
  if (kind === "finished") return { kind, automationId: "", when: "done" };
  if (kind === "slot") return { kind, status: "approved", slotKind: "any" };
  return { kind: kind as "manual" | "webhook" };
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function TriggerName({ kind }: { kind: TriggerKind }) {
  const Icon = TRIGGER_ICONS[kind];
  return (
    <>
      <Icon className={TRIGGER_TINT} aria-hidden="true" />
      {TRIGGER_LABELS[kind]}
    </>
  );
}

/** Settings for what starts the automation. */
export function TriggerPanel({
  trigger,
  onChange,
  automationId,
  automationName = "",
  hookToken,
  taken = [],
  starts,
  onStopStarting,
  onAddStep,
  onRemove,
  runsAtOnce,
}: {
  trigger: Trigger;
  onChange: (trigger: Trigger) => void;
  automationId: string;
  /** The automation's name, for the desktop app's list of watched folders. */
  automationName?: string;
  hookToken: string;
  /** Kinds the automation's other triggers are; a webhook or Run now can only be there once. */
  taken?: TriggerKind[];
  /** With several triggers: the steps this one starts, by id and name. */
  starts?: { id: string; title: string }[];
  onStopStarting?: (stepId: string) => void;
  onAddStep?: () => void;
  onRemove?: () => void;
  /** How many of the automation's runs go at once (null: no limit); left out to hide it. */
  runsAtOnce?: number | null;
}) {
  const address = hookUrl(automationId, hookToken);

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="trigger-kind">What starts it</FieldLabel>
        <Select
          value={trigger.kind}
          onValueChange={(kind) => onChange(defaultFor(kind as TriggerKind))}
        >
          <SelectTrigger id="trigger-kind" className="w-full">
            <SelectValue>
              <TriggerName kind={trigger.kind} />
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TRIGGER_LABELS) as TriggerKind[])
              .filter(
                (kind) => !((kind === "webhook" || kind === "manual") && taken.includes(kind)),
              )
              .map((kind) => {
                const Icon = TRIGGER_ICONS[kind];
                return (
                  <SelectItem
                    key={kind}
                    value={kind}
                    description={TRIGGER_HINTS[kind]}
                    icon={<Icon className={TRIGGER_TINT} aria-hidden="true" />}
                  >
                    {TRIGGER_LABELS[kind]}
                  </SelectItem>
                );
              })}
          </SelectContent>
        </Select>
        {trigger.kind === "manual" && (
          <FieldDescription>
            It runs only when someone presses Run now. Good for building and testing.
          </FieldDescription>
        )}
      </Field>

      {trigger.kind === "webhook" && (
        <Field>
          <FieldLabel htmlFor="trigger-address">Address</FieldLabel>
          <Input id="trigger-address" readOnly value={address} className="font-mono text-xs" />
          <div>
            <CopyButton text={address} label="Copy address" />
          </div>
          <FieldDescription>
            Send a POST here to start a run once the automation is switched on. To hand it a file,
            send JSON with the file&apos;s link as <code>file_url</code>, or several links as{" "}
            <code>files</code>. Anything else you send is kept with the run. Treat the address like
            a password.
          </FieldDescription>
          <FieldDescription>
            The answer says where to read how the run went. Add <code>callback_url</code> to be sent
            its end when it finishes, signed with the token. Send the same{" "}
            <code>Idempotency-Key</code> header again and no second run starts. The token can go in
            an <code>X-Takewon-Token</code> header instead of the address.
          </FieldDescription>
        </Field>
      )}

      {trigger.kind === "finished" && (
        <>
          <Field>
            <FieldLabel htmlFor="trigger-follows">Which automation</FieldLabel>
            <AutomationPicker
              id="trigger-follows"
              value={trigger.automationId}
              exclude={automationId}
              onChange={(followed) => onChange({ ...trigger, automationId: followed })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="trigger-when">Start after it</FieldLabel>
            <Select
              value={trigger.when}
              onValueChange={(when) => onChange({ ...trigger, when: when as typeof trigger.when })}
            >
              <SelectTrigger id="trigger-when" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="done">Works</SelectItem>
                <SelectItem value="failed">Fails</SelectItem>
                <SelectItem value="either">Works or fails</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              {trigger.when === "failed"
                ? "It gets the files that run started with, so it can try something else with them."
                : trigger.when === "either"
                  ? "It gets the files that run finished with. After a failure, the files it started with."
                  : "It gets the files that run finished with."}{" "}
              Only runs of its published version count, and this automation has to be switched on.
            </FieldDescription>
          </Field>
        </>
      )}

      {trigger.kind === "slot" && (
        <>
          <Field>
            <FieldLabel htmlFor="trigger-slot-kind">Which slots</FieldLabel>
            <Select
              value={trigger.slotKind}
              onValueChange={(slotKind) =>
                onChange({ ...trigger, slotKind: slotKind as typeof trigger.slotKind })
              }
            >
              <SelectTrigger id="trigger-slot-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any slot</SelectItem>
                {KINDS.map(({ kind, label }) => (
                  <SelectItem key={kind} value={kind}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="trigger-slot-status">When it moves to</FieldLabel>
            <Select
              value={trigger.status}
              onValueChange={(status) =>
                onChange({ ...trigger, status: status as typeof trigger.status })
              }
            >
              <SelectTrigger id="trigger-slot-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map(({ status, label }) => (
                  <SelectItem key={status} value={status}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              It gets the slot&apos;s newest file, and works for the project&apos;s client. Its
              finished files fill the project&apos;s empty slots. The automation has to be switched
              on.
            </FieldDescription>
          </Field>
        </>
      )}

      {trigger.kind === "folder" && (
        <Field>
          <FieldLabel htmlFor="trigger-folder">Folder</FieldLabel>
          <WatchedFolder
            id="trigger-folder"
            prefix={trigger.prefix}
            onChange={(prefix) => onChange({ ...trigger, prefix })}
          />
          <FieldDescription>
            It is checked every minute. Files already there when you switch the automation on are
            left alone.
          </FieldDescription>
          <LocalFolder
            automationId={automationId}
            automationName={automationName}
            prefix={trigger.prefix}
          />
        </Field>
      )}

      {trigger.kind === "folder" && (
        <Field>
          <FieldLabel htmlFor="trigger-folder-layout">What lands there</FieldLabel>
          <Select
            value={trigger.layout ?? "files"}
            onValueChange={(layout) => {
              const next = { ...trigger };
              if (layout === "creators") {
                next.layout = "creators";
                next.fileType = "video";
              } else delete next.layout;
              onChange(next);
            }}
          >
            <SelectTrigger id="trigger-folder-layout" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="files">Single files</SelectItem>
              <SelectItem value="creators">A folder for each creator</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>
            {trigger.layout === "creators"
              ? "Inside it, each creator has a folder with hooks, body and, if you like, endings in it, like Maya/hooks/. Once a creator has a body and a hook take, and nothing new has landed for 3 minutes, one run starts with all their takes: up to 5 hooks and 3 endings. A new take later makes the set again."
              : "Each file that lands starts a run of its own."}
          </FieldDescription>
        </Field>
      )}

      {(trigger.kind === "upload" || (trigger.kind === "folder" && !trigger.layout)) && (
        <Field>
          <FieldLabel htmlFor="trigger-file-type">Which files</FieldLabel>
          <Select
            value={trigger.fileType}
            onValueChange={(fileType) =>
              onChange({ ...trigger, fileType: fileType as typeof trigger.fileType })
            }
          >
            <SelectTrigger id="trigger-file-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="video">Video files</SelectItem>
              <SelectItem value="audio">Audio files</SelectItem>
              <SelectItem value="image">Image files</SelectItem>
              <SelectItem value="any">Any file</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>
            {trigger.kind === "upload"
              ? "Each matching file added on the Uploads page starts a run on that file."
              : "Each matching file that lands in the folder starts a run on that file."}
          </FieldDescription>
        </Field>
      )}

      {trigger.kind === "upload" && trigger.fileType !== "image" && (
        <Field>
          <FieldLabel>Only files of this length</FieldLabel>
          <div className="flex items-center gap-2">
            {(["minSeconds", "maxSeconds"] as const).map((key) => (
              <Input
                key={key}
                type="number"
                inputMode="decimal"
                min={0}
                aria-label={key === "minSeconds" ? "Shortest, in seconds" : "Longest, in seconds"}
                placeholder={key === "minSeconds" ? "Shortest" : "Longest"}
                value={trigger[key] ?? ""}
                onChange={(event) => {
                  const typed = event.target.value === "" ? undefined : Number(event.target.value);
                  const next = { ...trigger };
                  if (typed !== undefined && Number.isFinite(typed) && typed >= 0) {
                    next[key] = typed;
                  } else delete next[key];
                  onChange(next);
                }}
              />
            ))}
            <span className="text-muted-foreground shrink-0 text-sm">seconds</span>
          </div>
          <FieldDescription>
            Optional. Each upload&apos;s length is read from the file, so a short-clip automation
            can skip long recordings. Leave both empty for any length.
          </FieldDescription>
        </Field>
      )}

      {trigger.kind === "schedule" && (
        <ScheduleFields
          schedule={trigger.schedule}
          onChange={(schedule) => onChange({ kind: "schedule", schedule })}
        />
      )}
      {starts && (
        <Field>
          <FieldLabel>What it starts</FieldLabel>
          {starts.length === 0 ? (
            <FieldDescription>
              Nothing yet. Add a step after it, or drag from its dot to a first step.
            </FieldDescription>
          ) : (
            <ul className="grid gap-1">
              {starts.map((step) => (
                <li
                  key={step.id}
                  className="bg-background flex items-center gap-2 rounded-md py-1 pr-1 pl-3 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{step.title}</span>
                  {onStopStarting && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onStopStarting(step.id)}
                    >
                      <X />
                      <span className="sr-only">Stop starting {step.title}</span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <FieldDescription>
            Each trigger runs only the steps it starts and what comes after them.
          </FieldDescription>
          <div className="flex flex-wrap gap-2">
            {onAddStep && (
              <Button type="button" variant="outline" size="sm" onClick={onAddStep}>
                <Plus />
                Add a step after it
              </Button>
            )}
            {onRemove && (
              <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
                <Trash2 />
                Remove trigger
              </Button>
            )}
          </div>
        </Field>
      )}
      {runsAtOnce !== undefined && (
        <RunsAtOnce automationId={automationId} runsAtOnce={runsAtOnce} />
      )}
    </FieldGroup>
  );
}

type Schedule = Extract<Trigger, { kind: "schedule" }>["schedule"];

function localZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** "09:00" → "9:00 AM", in the reader's own way of writing times. */
function clockTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The schedule in one plain sentence, shown under the choices. */
export function scheduleSentence(schedule: Schedule) {
  if (schedule.mode === "daily") {
    return `Runs every day at ${clockTime(schedule.time)}, ${zoneCity(schedule.timeZone)} time.`;
  }
  const unit = unitOf(schedule.minutes);
  const count = schedule.minutes / UNITS[unit];
  const word = count === 1 ? unit.slice(0, -1) : `${count} ${unit}`;
  return `Runs every ${word}.`;
}

/**
 * How often a Schedule trigger runs. The two ways are side by side as a segmented
 * control, so both are visible at once and nothing opens over the fields below;
 * each way's settings sit together in one row.
 */
function ScheduleFields({
  schedule,
  onChange,
}: {
  schedule: Schedule;
  onChange: (schedule: Schedule) => void;
}) {
  const unit = schedule.mode === "interval" ? unitOf(schedule.minutes) : "hours";
  const count = schedule.mode === "interval" ? schedule.minutes / UNITS[unit] : 1;
  return (
    <>
      <Field>
        <FieldLabel id="trigger-mode-label">How often</FieldLabel>
        <Segmented
          aria-labelledby="trigger-mode-label"
          value={schedule.mode}
          onValueChange={(mode) =>
            onChange(
              mode === "daily"
                ? { mode: "daily", time: "09:00", timeZone: localZone() }
                : { mode: "interval", minutes: 60 },
            )
          }
          options={[
            { value: "interval", label: "On repeat" },
            { value: "daily", label: "Every day" },
          ]}
        />
      </Field>
      {schedule.mode === "interval" ? (
        <Field>
          <FieldLabel htmlFor="trigger-every">Every</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="trigger-every"
              type="number"
              min={1}
              step={1}
              className="h-9 w-20 shrink-0 tabular-nums"
              value={count}
              onChange={(event) => {
                const typed = Math.max(1, Math.round(Number(event.target.value) || 1));
                onChange({ mode: "interval", minutes: typed * UNITS[unit] });
              }}
            />
            <Segmented
              aria-label="Unit"
              value={unit}
              onValueChange={(next) =>
                onChange({ mode: "interval", minutes: count * UNITS[next as Unit] })
              }
              options={[
                { value: "minutes", label: "Minutes" },
                { value: "hours", label: "Hours" },
                { value: "days", label: "Days" },
              ]}
            />
          </div>
          <FieldDescription>
            The shortest gap is 5 minutes. If a run is still going when the next is due, that turn
            is skipped.
          </FieldDescription>
        </Field>
      ) : (
        <Field>
          <div className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-2">
            <FieldLabel htmlFor="trigger-time">At</FieldLabel>
            <FieldLabel htmlFor="trigger-zone">Time zone</FieldLabel>
            <Input
              id="trigger-time"
              aria-label="Time"
              type="time"
              className="h-9 tabular-nums"
              value={schedule.time}
              onChange={(event) => {
                if (!event.target.value) return;
                onChange({ ...schedule, time: event.target.value.slice(0, 5) });
              }}
            />
            <TimeZonePicker
              id="trigger-zone"
              value={schedule.timeZone}
              onChange={(timeZone) => onChange({ ...schedule, timeZone })}
            />
          </div>
        </Field>
      )}
      <p className="bg-background text-foreground/80 rounded-lg px-3 py-2.5 text-sm">
        {scheduleSentence(schedule)}
      </p>
    </>
  );
}
