"use client";

import { api } from "@convex/_generated/api";
import { KIND_WORDS, readUploadRef, uploadRef, wantedKind } from "@ncat-dash/automation-core";
import { getStep, userInputJsonSchema } from "@ncat-dash/step-catalog";
import { useAction, useQuery } from "convex/react";
import { FileCheck, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fieldLabel } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

type JsonSchema = {
  type?: string;
  format?: string;
  enum?: string[];
  description?: string;
  default?: string | number | boolean;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
};

type FieldKind = "url" | "text" | "number" | "choice" | "yesno" | "json";

function kindOf(schema: JsonSchema): FieldKind {
  if (schema.enum) return "choice";
  if (schema.type === "string") return schema.format === "uri" ? "url" : "text";
  if (schema.type === "number" || schema.type === "integer") return "number";
  if (schema.type === "boolean") return "yesno";
  return "json";
}

/** A small example of the shape a list or group field expects, shown as its placeholder. */
function exampleOf(schema: JsonSchema): unknown {
  if (schema.enum) return schema.enum[0];
  if (schema.type === "array") return [exampleOf(schema.items ?? {})];
  if (schema.type === "object") {
    const entries = Object.entries(schema.properties ?? {}).slice(0, 4);
    return Object.fromEntries(entries.map(([key, value]) => [key, exampleOf(value)]));
  }
  if (schema.type === "number" || schema.type === "integer") return 0;
  if (schema.type === "boolean") return true;
  return schema.format === "uri" ? "https://..." : "...";
}

const UNSET = "__unset__";
const AUTO = "__auto__";
const FIXED = "__fixed__";
const BRAND = "__brand__";

/** Lets a URL field be filled from one of the team's uploads. */
export function UploadPicker({
  onPick,
  lasting = false,
}: {
  onPick: (url: string) => void;
  /**
   * Hand back a lasting pointer to the upload instead of a link. A link stops working
   * after a week, so anything that is saved and used again later needs the pointer.
   */
  lasting?: boolean;
}) {
  const team = useActiveTeam();
  const uploads = useQuery(api.storage.listUploads, { organizationId: team.id });
  const linkFor = useAction(api.storage.linkFor);
  const ready = uploads?.filter((upload) => upload.status === "ready") ?? [];
  if (ready.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Upload />
          Use an upload
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-72 overflow-y-auto">
        <DropdownMenuLabel>Your uploads</DropdownMenuLabel>
        {ready.map((upload) => (
          <DropdownMenuItem
            key={upload._id}
            onSelect={async () =>
              onPick(lasting ? uploadRef(upload._id) : await linkFor({ uploadId: upload._id }))
            }
          >
            <span className="truncate">{upload.fileName}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One fixed file that is kept and used again: an address, or one of the team's uploads.
 * An upload is shown by its name and saved as a lasting pointer.
 */
export function FileChoice({
  value,
  onChange,
  label,
  id,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  const team = useActiveTeam();
  const uploads = useQuery(api.storage.listUploads, { organizationId: team.id });
  const uploadId = readUploadRef(value);
  if (uploadId) {
    const upload = uploads?.find((candidate) => candidate._id === uploadId);
    return (
      <div className="flex items-center gap-2">
        <div
          id={id}
          className="bg-muted/50 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border px-3 text-sm"
        >
          <FileCheck className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {upload?.fileName ?? (uploads ? "An upload that was removed" : "Your upload")}
          </span>
        </div>
        {!disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => onChange("")}
          >
            <X />
            <span className="sr-only">Clear {label}</span>
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        aria-label={`${label}: address of the file`}
        type="url"
        inputMode="url"
        placeholder="https://"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        disabled={disabled}
      />
      {!disabled && <UploadPicker lasting onPick={onChange} />}
    </div>
  );
}

export type StepFieldList = { name: string; schema: JsonSchema; required: boolean }[];

/** The fields of a step's form, required ones first. Null for an unknown step. */
export function useStepFields(stepId: string): StepFieldList | null {
  return useMemo(() => {
    const step = getStep(stepId);
    if (!step) return null;
    const schema = userInputJsonSchema(step) as JsonSchema;
    const required = new Set(schema.required ?? []);
    return Object.entries(schema.properties ?? {})
      .map(([name, field]) => ({ name, schema: field, required: required.has(name) }))
      .sort((a, b) => Number(b.required) - Number(a.required));
  }, [stepId]);
}

/** Turns what was typed into the values the step takes. Empty fields are left out. */
export function toInput(
  fields: StepFieldList,
  values: Record<string, string>,
): { ok: true; input: Record<string, unknown> } | { ok: false; message: string } {
  const input: Record<string, unknown> = {};
  for (const { name, schema } of fields) {
    const raw = (values[name] ?? "").trim();
    if (raw === "" || raw === UNSET) continue;
    const kind = kindOf(schema);
    if (kind === "number") input[name] = Number(raw);
    else if (kind === "yesno") input[name] = raw === "true";
    else if (kind === "json") {
      try {
        input[name] = JSON.parse(raw);
      } catch {
        return { ok: false, message: `${fieldLabel(name)} is not valid JSON.` };
      }
    } else input[name] = raw;
  }
  return { ok: true, input };
}

/** The reverse of toInput: saved values back into what the form shows. */
export function fromInput(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).map(([name, value]) => [
      name,
      typeof value === "string" ? value : JSON.stringify(value, null, 2),
    ]),
  );
}

/**
 * The inputs for a step, built from its schema in the catalog.
 *
 * In an automation (`automatic` names the field the step before fills in) nothing is
 * required and address fields take plain text, so they can hold {{placeholders}}.
 */
export function StepFields({
  fields,
  values,
  onChange,
  automatic,
  idPrefix = "field",
}: {
  fields: StepFieldList;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  automatic?: {
    field: string | null;
    /** Where a file setting can come from besides a fixed file: the start, earlier steps. */
    sources?: { value: string; label: string }[];
    /** Settings an earlier step fills in when left empty, with a line saying from where. */
    filled?: Record<string, string>;
    /**
     * Settings the team's brand fills in when left empty: what it is called ("logo") and
     * whether Settings has one yet.
     */
    brand?: Record<string, { word: string; set: boolean }>;
  };
  idPrefix?: string;
}) {
  // File settings a person has switched to "a fixed file" but not filled in yet.
  const [fixed, setFixed] = useState<Record<string, boolean>>({});
  return (
    <>
      {fields.map(({ name, schema: field, required }) => {
        const kind = kindOf(field);
        const id = `${idPrefix}-${name}`;
        const isRequired = required && !automatic;
        const filledForYou = automatic?.field === name;
        if (automatic && filledForYou && kind === "json" && !values[name]) {
          const what = KIND_WORDS[wantedKind(name)];
          return (
            <Field key={name}>
              <FieldLabel>{fieldLabel(name).replace(/ URLs?$/, "s")}</FieldLabel>
              <FieldDescription>
                Automatic. Uses every {what} that reaches this step, in the order the steps before
                made them.
              </FieldDescription>
            </Field>
          );
        }
        if (automatic && kind === "url") {
          const sources = automatic.sources ?? [];
          const value = values[name] ?? "";
          const brand = automatic.brand?.[name];
          const pointed = sources.find((source) => source.value === value);
          const mode = pointed
            ? pointed.value
            : value !== "" || fixed[name]
              ? FIXED
              : brand
                ? BRAND
                : filledForYou
                  ? AUTO
                  : FIXED;
          const what = KIND_WORDS[wantedKind(name)];
          const label = fieldLabel(name).replace(/ URLs?$/, "");
          return (
            <Field key={name}>
              <FieldLabel htmlFor={id}>{label}</FieldLabel>
              <Select
                value={mode}
                onValueChange={(next) => {
                  setFixed((current) => ({ ...current, [name]: next === FIXED }));
                  onChange(name, next === AUTO || next === FIXED || next === BRAND ? "" : next);
                }}
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {filledForYou && <SelectItem value={AUTO}>Automatic</SelectItem>}
                  {brand && <SelectItem value={BRAND}>Your team&apos;s {brand.word}</SelectItem>}
                  {sources.map((source) => (
                    <SelectItem key={source.value} value={source.value}>
                      {source.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={FIXED}>
                    {brand ? "A different file for this step" : "A fixed file"}
                  </SelectItem>
                </SelectContent>
              </Select>
              {mode === FIXED && (
                <FileChoice value={value} onChange={(next) => onChange(name, next)} label={label} />
              )}
              <FieldDescription>
                {mode === AUTO
                  ? `Uses the nearest ${what} before this step.`
                  : mode === BRAND
                    ? brand?.set
                      ? `Set once in Settings, under Brand.`
                      : `Not set yet. Add your ${brand?.word} in Settings, under Brand.`
                    : mode === FIXED
                      ? "The same file on every run."
                      : field.description}
              </FieldDescription>
            </Field>
          );
        }
        return (
          <Field key={name}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor={id}>
                {fieldLabel(name)}
                {!required && <span className="text-muted-foreground font-normal">optional</span>}
              </FieldLabel>
              {kind === "url" && !automatic && (
                <UploadPicker onPick={(url) => onChange(name, url)} />
              )}
            </div>
            {kind === "choice" || kind === "yesno" ? (
              <Select value={values[name] ?? UNSET} onValueChange={(v) => onChange(name, v)}>
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!isRequired && (
                    <SelectItem value={UNSET}>
                      {field.default !== undefined
                        ? `Default (${field.default})`
                        : "Toolkit default"}
                    </SelectItem>
                  )}
                  {(kind === "yesno" ? ["true", "false"] : (field.enum ?? [])).map((option) => (
                    <SelectItem key={option} value={option}>
                      {kind === "yesno" ? (option === "true" ? "Yes" : "No") : option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : kind === "json" ? (
              <Textarea
                id={id}
                value={values[name] ?? ""}
                onChange={(event) => onChange(name, event.target.value)}
                placeholder={JSON.stringify(exampleOf(field), null, 2)}
                required={isRequired}
                rows={5}
                spellCheck={false}
                className="font-mono text-xs"
              />
            ) : (
              <Input
                id={id}
                type={kind === "number" ? "number" : kind === "url" && !automatic ? "url" : "text"}
                step={field.type === "integer" ? 1 : "any"}
                inputMode={kind === "url" ? "url" : undefined}
                placeholder={
                  filledForYou
                    ? "From the step before"
                    : automatic?.filled?.[name]
                      ? "Automatic"
                      : automatic?.brand?.[name]?.set
                        ? `Your team's ${automatic.brand[name].word}`
                        : field.default !== undefined
                          ? String(field.default)
                          : kind === "url"
                            ? "https://"
                            : undefined
                }
                value={values[name] ?? ""}
                onChange={(event) => onChange(name, event.target.value)}
                required={isRequired}
                autoComplete="off"
              />
            )}
            {filledForYou ? (
              <FieldDescription>
                Leave empty to use each file from the step before. Fill it in to use one fixed file
                instead.
              </FieldDescription>
            ) : automatic?.filled?.[name] && !values[name] ? (
              <FieldDescription>{automatic.filled[name]}</FieldDescription>
            ) : (
              field.description && <FieldDescription>{field.description}</FieldDescription>
            )}
          </Field>
        );
      })}
    </>
  );
}
