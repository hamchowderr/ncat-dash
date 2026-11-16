"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getStep, userInputJsonSchema } from "@ncat-dash/step-catalog";
import { useAction, useMutation, useQuery } from "convex/react";
import { Play, Upload } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { JobResult } from "@/components/jobs/job-result";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, fieldLabel } from "@/lib/catalog";
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
function UploadPicker({ onPick }: { onPick: (url: string) => void }) {
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

/**
 * The test bench for one step: a form built from the step's schema in the catalog, and
 * the live result of the latest run beside it.
 */
export function StepForm({ stepId }: { stepId: string }) {
  const team = useActiveTeam();
  const step = getStep(stepId);
  const run = useMutation(api.jobs.run);
  const schema = useMemo(() => (step ? (userInputJsonSchema(step) as JsonSchema) : null), [step]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [jobId, setJobId] = useState<Id<"jobs"> | null>(null);

  if (!step || !schema) return <p className="text-muted-foreground text-sm">Unknown step.</p>;

  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties ?? {}).sort(
    ([a], [b]) => Number(required.has(b)) - Number(required.has(a)),
  );
  const set = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const input: Record<string, unknown> = {};
    for (const [name, field] of fields) {
      const raw = (values[name] ?? "").trim();
      if (raw === "" || raw === UNSET) continue;
      const kind = kindOf(field);
      if (kind === "number") input[name] = Number(raw);
      else if (kind === "yesno") input[name] = raw === "true";
      else if (kind === "json") {
        try {
          input[name] = JSON.parse(raw);
        } catch {
          setError(`${fieldLabel(name)} is not valid JSON.`);
          return;
        }
      } else input[name] = raw;
    }

    setPending(true);
    try {
      setJobId(await run({ organizationId: team.id, stepId: step!.id, input }));
    } catch (caught) {
      setError(errorMessage(caught, "The step could not be started. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2 lg:gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Input</h2>
          </CardTitle>
          <CardDescription>
            Sent to <code className="text-xs">{step.endpoint}</code> on your toolkit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit}>
            <FieldGroup>
              {fields.map(([name, field]) => {
                const kind = kindOf(field);
                const id = `field-${name}`;
                const isRequired = required.has(name);
                return (
                  <Field key={name}>
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel htmlFor={id}>
                        {fieldLabel(name)}
                        {!isRequired && (
                          <span className="text-muted-foreground font-normal">optional</span>
                        )}
                      </FieldLabel>
                      {kind === "url" && <UploadPicker onPick={(url) => set(name, url)} />}
                    </div>
                    {kind === "choice" || kind === "yesno" ? (
                      <Select value={values[name] ?? UNSET} onValueChange={(v) => set(name, v)}>
                        <SelectTrigger id={id} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {!isRequired && <SelectItem value={UNSET}>Toolkit default</SelectItem>}
                          {(kind === "yesno" ? ["true", "false"] : (field.enum ?? [])).map(
                            (option) => (
                              <SelectItem key={option} value={option}>
                                {kind === "yesno" ? (option === "true" ? "Yes" : "No") : option}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    ) : kind === "json" ? (
                      <Textarea
                        id={id}
                        value={values[name] ?? ""}
                        onChange={(event) => set(name, event.target.value)}
                        placeholder={JSON.stringify(exampleOf(field), null, 2)}
                        required={isRequired}
                        rows={5}
                        spellCheck={false}
                        className="font-mono text-xs"
                      />
                    ) : (
                      <Input
                        id={id}
                        type={kind === "number" ? "number" : kind === "url" ? "url" : "text"}
                        step={field.type === "integer" ? 1 : "any"}
                        inputMode={kind === "url" ? "url" : undefined}
                        placeholder={kind === "url" ? "https://" : undefined}
                        value={values[name] ?? ""}
                        onChange={(event) => set(name, event.target.value)}
                        required={isRequired}
                        autoComplete="off"
                      />
                    )}
                    {field.description && <FieldDescription>{field.description}</FieldDescription>}
                  </Field>
                );
              })}

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Field>
                <Button type="submit" disabled={pending}>
                  <Play />
                  {pending ? "Starting" : "Run step"}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Result</h2>
          </CardTitle>
          <CardDescription>
            The latest run from this page. Every run is kept in Jobs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {jobId ? (
            <JobResult jobId={jobId} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Fill in the input and run the step. The result appears here when your toolkit
              finishes.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
