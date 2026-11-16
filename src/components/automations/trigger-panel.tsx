"use client";

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

const UNITS = { minutes: 1, hours: 60, days: 1440 } as const;
type Unit = keyof typeof UNITS;

function unitOf(minutes: number): Unit {
  return minutes % 1440 === 0 ? "days" : minutes % 60 === 0 ? "hours" : "minutes";
}

function defaultFor(kind: TriggerKind): Trigger {
  if (kind === "schedule") return { kind, schedule: { mode: "interval", minutes: 60 } };
  if (kind === "upload") return { kind, fileType: "video" };
  if (kind === "folder") return { kind, prefix: "incoming/", fileType: "video" };
  return { kind };
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
            Send a POST here to start a run once the automation is switched on. Put{" "}
            <code>file_url</code> in a JSON body to hand it a file. Anything else in the body can be
            used in a step as <code>{"{{trigger.body.name}}"}</code>. Treat the address like a
            password.
          </FieldDescription>
        </Field>
      )}

      {trigger.kind === "folder" && (
        <Field>
          <FieldLabel htmlFor="trigger-folder">Folder</FieldLabel>
          <Input
            id="trigger-folder"
            value={trigger.prefix}
            placeholder="incoming/"
            maxLength={500}
            onChange={(event) =>
              onChange({ ...trigger, prefix: event.target.value.replace(/^\/+/, "") })
            }
            autoComplete="off"
            spellCheck={false}
          />
          <FieldDescription>
            A folder in the bucket you connected on the Uploads page. It is checked every minute.
            Files already there when you switch the automation on are left alone. Leave it empty to
            watch the whole bucket.
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
