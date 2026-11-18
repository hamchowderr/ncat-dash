"use client";

import { KINDS, STATUSES } from "@convex/lib/packages";
import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hookUrl, type Trigger, TRIGGER_LABELS, type TriggerKind } from "@/lib/automations";

import { AutomationPicker } from "./automation-picker";
import { WatchedFolder } from "./watched-folder";

const UNITS = { minutes: 1, hours: 60, days: 1440 } as const;
type Unit = keyof typeof UNITS;

function unitOf(minutes: number): Unit {
  return minutes % 1440 === 0 ? "days" : minutes % 60 === 0 ? "hours" : "minutes";
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

/** Settings for what starts the automation. */
export function TriggerPanel({
  trigger,
  onChange,
  automationId,
  hookToken,
}: {
  trigger: Trigger;
  onChange: (trigger: Trigger) => void;
  automationId: string;
  hookToken: string;
}) {
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["UTC"];
    }
  }, []);
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
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TRIGGER_LABELS) as TriggerKind[]).map((kind) => (
              <SelectItem key={kind} value={kind}>
                {TRIGGER_LABELS[kind]}
              </SelectItem>
            ))}
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
            send JSON with the file&apos;s link as <code>file_url</code>. Anything else you send is
            kept with the run. Treat the address like a password.
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
        </Field>
      )}

      {(trigger.kind === "upload" || trigger.kind === "folder") && (
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
        <>
          <Field>
            <FieldLabel htmlFor="trigger-mode">How often</FieldLabel>
            <Select
              value={trigger.schedule.mode}
              onValueChange={(mode) =>
                onChange({
                  kind: "schedule",
                  schedule:
                    mode === "daily"
                      ? {
                          mode: "daily",
                          time: "09:00",
                          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                        }
                      : { mode: "interval", minutes: 60 },
                })
              }
            >
              <SelectTrigger id="trigger-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="interval">Every so often</SelectItem>
                <SelectItem value="daily">Every day at a set time</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {trigger.schedule.mode === "interval" ? (
            <Field>
              <FieldLabel htmlFor="trigger-every">Every</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="trigger-every"
                  type="number"
                  min={1}
                  step={1}
                  className="w-24"
                  value={trigger.schedule.minutes / UNITS[unitOf(trigger.schedule.minutes)]}
                  onChange={(event) => {
                    const unit = unitOf(
                      trigger.schedule.mode === "interval" ? trigger.schedule.minutes : 60,
                    );
                    const count = Math.max(1, Math.round(Number(event.target.value) || 1));
                    onChange({
                      kind: "schedule",
                      schedule: { mode: "interval", minutes: count * UNITS[unit] },
                    });
                  }}
                />
                <Select
                  value={unitOf(trigger.schedule.minutes)}
                  onValueChange={(unit) => {
                    if (trigger.schedule.mode !== "interval") return;
                    const count =
                      trigger.schedule.minutes / UNITS[unitOf(trigger.schedule.minutes)];
                    onChange({
                      kind: "schedule",
                      schedule: { mode: "interval", minutes: count * UNITS[unit as Unit] },
                    });
                  }}
                >
                  <SelectTrigger aria-label="Unit" className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">minutes</SelectItem>
                    <SelectItem value="hours">hours</SelectItem>
                    <SelectItem value="days">days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <FieldDescription>
                The shortest gap is 5 minutes. If a run is still going when the next is due, that
                turn is skipped.
              </FieldDescription>
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="trigger-time">Time</FieldLabel>
                <Input
                  id="trigger-time"
                  type="time"
                  value={trigger.schedule.time}
                  onChange={(event) => {
                    if (trigger.schedule.mode !== "daily" || !event.target.value) return;
                    onChange({
                      kind: "schedule",
                      schedule: { ...trigger.schedule, time: event.target.value.slice(0, 5) },
                    });
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="trigger-zone">Time zone</FieldLabel>
                <Input
                  id="trigger-zone"
                  list="trigger-zones"
                  value={trigger.schedule.timeZone}
                  onChange={(event) => {
                    if (trigger.schedule.mode !== "daily") return;
                    onChange({
                      kind: "schedule",
                      schedule: { ...trigger.schedule, timeZone: event.target.value },
                    });
                  }}
                  autoComplete="off"
                />
                <datalist id="trigger-zones">
                  {zones.map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
              </Field>
            </>
          )}
        </>
      )}
    </FieldGroup>
  );
}
