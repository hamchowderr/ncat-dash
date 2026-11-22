"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getStep, SAVED_LOOK_STEP } from "@ncat-dash/step-catalog";
import { useMutation } from "convex/react";
import { Play } from "lucide-react";
import { useState, type FormEvent } from "react";

import { LOOK_SETTING, LookPicker } from "@/components/automations/look-picker";
import { JobResult } from "@/components/jobs/job-result";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup } from "@/components/ui/field";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { StepFields, toInput, useStepFields } from "./step-fields";

/**
 * The test bench for one step: a form built from the step's schema in the catalog, and
 * the live result of the latest run beside it.
 */
export function StepForm({ stepId }: { stepId: string }) {
  const team = useActiveTeam();
  const step = getStep(stepId);
  const run = useMutation(api.jobs.run);
  const allFields = useStepFields(stepId);
  // The saved look is picked by name from the team's looks, never typed.
  const picksLook = stepId === SAVED_LOOK_STEP;
  // A setting the team's brand fills in (music, logo...) can be left empty to use it.
  const fields = allFields
    ?.filter(({ name }) => !(picksLook && name === LOOK_SETTING))
    .map((field) => (step?.brandInputs?.[field.name] ? { ...field, required: false } : field));

  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [jobId, setJobId] = useState<Id<"jobs"> | null>(null);

  if (!step || !fields) return <p className="text-muted-foreground text-sm">Unknown step.</p>;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = toInput(fields!, values);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    const input = picksLook
      ? { ...parsed.input, [LOOK_SETTING]: values[LOOK_SETTING] ?? "" }
      : parsed.input;

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
              <StepFields
                fields={fields}
                values={values}
                onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
              />
              {picksLook && (
                <LookPicker
                  nodeId="step-form"
                  input={values}
                  onChange={(input) =>
                    setValues((current) => ({
                      ...current,
                      [LOOK_SETTING]:
                        typeof input[LOOK_SETTING] === "string" ? input[LOOK_SETTING] : "",
                    }))
                  }
                />
              )}

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
