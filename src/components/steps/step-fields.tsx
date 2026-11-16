"use client";

import { api } from "@convex/_generated/api";
import { getStep, userInputJsonSchema } from "@ncat-dash/step-catalog";
import { useAction, useQuery } from "convex/react";
import { Upload } from "lucide-react";
import { useMemo } from "react";

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

/** Lets a URL field be filled from one of the team's uploads. */
export function UploadPicker({ onPick }: { onPick: (url: string) => void }) {
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
            onSelect={async () => onPick(await linkFor({ uploadId: upload._id }))}
          >
            <span className="truncate">{upload.fileName}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  automatic?: { field: string | null };
  idPrefix?: string;
}) {
  return (
    <>
      {fields.map(({ name, schema: field, required }) => {
        const kind = kindOf(field);
        const id = `${idPrefix}-${name}`;
        const isRequired = required && !automatic;
        const filledForYou = automatic?.field === name;
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
                  {!isRequired && <SelectItem value={UNSET}>Toolkit default</SelectItem>}
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
                  filledForYou ? "From the step before" : kind === "url" ? "https://" : undefined
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
            ) : (
              field.description && <FieldDescription>{field.description}</FieldDescription>
            )}
          </Field>
        );
      })}
    </>
  );
}
