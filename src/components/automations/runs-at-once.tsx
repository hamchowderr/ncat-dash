"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { RUNS_AT_ONCE } from "@ncat-dash/automation-core";
import { useMutation } from "convex/react";
import { useState } from "react";

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NO_LIMIT = "none";

/** How many of an automation's runs go at once; the rest wait their turn. */
export function RunsAtOnce({
  automationId,
  runsAtOnce,
}: {
  automationId: string;
  runsAtOnce: number | null;
}) {
  const save = useMutation(api.automations.setRunsAtOnce);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Field>
      <FieldLabel htmlFor="runs-at-once">Runs at once</FieldLabel>
      <Select
        value={runsAtOnce === null ? NO_LIMIT : String(runsAtOnce)}
        onValueChange={async (value) => {
          setProblem(null);
          try {
            await save({
              automationId: automationId as Id<"automations">,
              runsAtOnce: value === NO_LIMIT ? null : Number(value),
            });
          } catch {
            setProblem("That could not be saved. Try again.");
          }
        }}
      >
        <SelectTrigger id="runs-at-once" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_LIMIT}>As many as are started</SelectItem>
          {RUNS_AT_ONCE.map((limit) => (
            <SelectItem key={limit} value={String(limit)}>
              {limit === 1 ? "One at a time" : `${limit} at a time`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {problem ??
          "Runs started while that many are going wait their turn, and start in the order they came in."}
      </FieldDescription>
    </Field>
  );
}
