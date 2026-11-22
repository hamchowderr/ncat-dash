"use client";

import {
  type AutomationNode,
  type Check,
  CHECK_NAMES,
  CHECKS,
  conditionFor,
  PICTURE_SIZES,
  sendProblem,
  WAIT_UNITS,
  type WaitUnit,
  waitProblem,
} from "@ncat-dash/automation-core";
import { useState } from "react";

import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type NodeContent = Omit<AutomationNode, "position">;
type Settings = Record<string, unknown>;

/** A whole number or a decimal typed into a box, or null while it is not one yet. */
function readNumber(text: string): number | null {
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) && value > 0 ? value : null;
}

/** The unit as it reads after the number typed: "1 minute", "2 minutes". */
function one(typed: string, unit: string): string {
  return Number(typed) === 1 ? unit.replace(/s$/, "") : unit;
}

/**
 * The settings of an If, as a sentence made of pick lists: what to check, what it has to
 * be, and for a length or a picture size the number to compare against.
 */
function IfSettings({ input, onChange }: { input: Settings; onChange: (input: Settings) => void }) {
  const check = (CHECK_NAMES.includes(input.check as Check) ? input.check : "length") as Check;
  const description = CHECKS[check];
  const seconds = typeof input.value === "number" ? input.value : 60;
  // A length is typed in the unit that reads best and saved in seconds.
  const [unit, setUnit] = useState<"seconds" | "minutes">(
    seconds >= 60 && seconds % 60 === 0 ? "minutes" : "seconds",
  );
  const [typed, setTyped] = useState(String(unit === "minutes" ? seconds / 60 : seconds));
  const per = unit === "minutes" ? 60 : 1;

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="if-check">Check each file&apos;s</FieldLabel>
        <Select
          value={check}
          onValueChange={(next) => {
            const fresh = conditionFor(next as Check);
            onChange({ ...fresh });
            if (fresh.check === "length") {
              setUnit("seconds");
              setTyped(String(fresh.value));
            }
          }}
        >
          <SelectTrigger id="if-check" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHECK_NAMES.map((name) => (
              <SelectItem key={name} value={name}>
                {CHECKS[name].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel htmlFor="if-is">Goes out by Yes when it</FieldLabel>
        <Select
          value={typeof input.is === "string" ? input.is : ""}
          onValueChange={(is) => onChange({ ...input, is })}
        >
          <SelectTrigger id="if-is" className="w-full">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {description.choices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {description.value === "seconds" && (
          <div className="flex gap-2">
            <Input
              aria-label="Length"
              inputMode="decimal"
              value={typed}
              autoComplete="off"
              className="min-w-0 flex-1 tabular-nums"
              aria-invalid={readNumber(typed) === null}
              onChange={(event) => {
                setTyped(event.target.value);
                const amount = readNumber(event.target.value);
                if (amount !== null) onChange({ ...input, value: amount * per });
              }}
            />
            <Select
              value={unit}
              onValueChange={(next) => {
                setUnit(next as "seconds" | "minutes");
                const amount = readNumber(typed);
                if (amount !== null) {
                  onChange({ ...input, value: amount * (next === "minutes" ? 60 : 1) });
                }
              }}
            >
              <SelectTrigger aria-label="Unit" className="w-28 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="seconds">{one(typed, "seconds")}</SelectItem>
                <SelectItem value="minutes">{one(typed, "minutes")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {description.value === "pixels" && (
          <Select
            value={String(input.value ?? "")}
            onValueChange={(value) => onChange({ ...input, value: Number(value) })}
          >
            <SelectTrigger aria-label="Picture size" className="w-full">
              <SelectValue placeholder="Choose a size" />
            </SelectTrigger>
            <SelectContent>
              {PICTURE_SIZES.map((size) => (
                <SelectItem key={size.value} value={String(size.value)}>
                  {size.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {description.text && (
          <Input
            aria-label="Words to look for"
            value={typeof input.text === "string" ? input.text : ""}
            autoComplete="off"
            onChange={(event) => onChange({ ...input, text: event.target.value })}
          />
        )}
        <FieldDescription>
          {description.text
            ? "Every other file goes out by No. The words come from a Transcribe step before this one; a file nothing transcribed goes out by No."
            : "Every other file goes out by No. The step reads each file itself, so there is nothing else to set."}
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}

/** The settings of a Wait: a number and a unit. */
function WaitSettings({
  input,
  onChange,
}: {
  input: Settings;
  onChange: (input: Settings) => void;
}) {
  const [typed, setTyped] = useState(String(input.amount ?? ""));
  const unit = (WAIT_UNITS.includes(input.unit as WaitUnit) ? input.unit : "minutes") as WaitUnit;
  const problem = waitProblem({ ...input, unit });
  return (
    <Field data-invalid={problem !== null}>
      <FieldLabel htmlFor="wait-amount">Wait for</FieldLabel>
      <div className="flex gap-2">
        <Input
          id="wait-amount"
          inputMode="decimal"
          value={typed}
          autoComplete="off"
          className="min-w-0 flex-1 tabular-nums"
          aria-invalid={problem !== null}
          onChange={(event) => {
            setTyped(event.target.value);
            // A box that is empty or not a number is saved as no amount, which the step reports.
            onChange({ ...input, unit, amount: readNumber(event.target.value) ?? 0 });
          }}
        />
        <Select value={unit} onValueChange={(next) => onChange({ ...input, unit: next })}>
          <SelectTrigger aria-label="Unit" className="w-28 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WAIT_UNITS.map((name) => (
              <SelectItem key={name} value={name}>
                {one(typed, name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {problem ? (
        <FieldError>{problem}</FieldError>
      ) : (
        <FieldDescription>
          Then the files it was given carry on to the next step. The run shows when that will be.
        </FieldDescription>
      )}
    </Field>
  );
}

/** Settings for an If or a Wait step. Mount with key={node.id}. */
function SendSettings({
  input,
  onChange,
}: {
  input: Settings;
  onChange: (input: Settings) => void;
}) {
  const url = typeof input.url === "string" ? input.url : "";
  // Said once something is typed, so an empty new step does not open on an error.
  const problem = url.trim() ? sendProblem(input) : null;
  return (
    <Field data-invalid={problem !== null}>
      <FieldLabel htmlFor="send-url">Address</FieldLabel>
      <Input
        id="send-url"
        type="url"
        value={url}
        placeholder="https://n8n.example.com/webhook/clips"
        autoComplete="off"
        className="font-mono text-xs"
        aria-invalid={problem !== null}
        onChange={(event) => onChange({ ...input, url: event.target.value })}
      />
      {problem ? (
        <FieldError>{problem}</FieldError>
      ) : (
        <FieldDescription>
          The files that reach this step are posted here as JSON, with the run&apos;s id, the
          automation and what started it. The post is signed in an <code>X-Takewon-Signature</code>{" "}
          header with the automation&apos;s token. If the address does not answer, it is tried three
          more times, then the step fails. The files carry on to the next step.
        </FieldDescription>
      )}
    </Field>
  );
}

export function LogicSettings({
  node,
  onChange,
}: {
  node: NodeContent;
  onChange: (patch: Partial<NodeContent>) => void;
}) {
  const change = (input: Settings) => onChange({ input });
  if (node.kind === "send") return <SendSettings input={node.input} onChange={change} />;
  return node.kind === "if" ? (
    <IfSettings input={node.input} onChange={change} />
  ) : (
    <WaitSettings input={node.input} onChange={change} />
  );
}
