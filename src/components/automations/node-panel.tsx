"use client";

import type { AutomationNode } from "@ncat-dash/automation-core";
import { getPlatform, nodeTypeOf, writeSource } from "@ncat-dash/automation-core";
import { getStep } from "@ncat-dash/step-catalog";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { StepFields, fromInput, toInput, useStepFields } from "@/components/steps/step-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { nodeTitle } from "@/lib/automations";

import { PlatformPicker } from "./platform-picker";

type NodeContent = Omit<AutomationNode, "position">;

/** Settings for the step selected on the canvas. Mount with key={node.id}. */
export function NodePanel({
  node,
  before,
  startGivesFile,
  filled,
  onChange,
  onRemove,
}: {
  node: NodeContent;
  /** The steps that run before this one, nearest first. Their files can be used here. */
  before: NodeContent[];
  /** Whether the automation's start hands over a file. */
  startGivesFile: boolean;
  /** Settings an earlier step fills in by itself, with a line saying from where. */
  filled: Record<string, string>;
  onChange: (patch: Partial<NodeContent>) => void;
  onRemove: () => void;
}) {
  const step = node.kind === "step" ? getStep(node.stepId ?? "") : undefined;
  const fields = useStepFields(node.stepId ?? "");
  const [values, setValues] = useState(() => fromInput(node.input));
  const [problem, setProblem] = useState<string | null>(null);

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

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="node-label">Name</FieldLabel>
        <Input
          id="node-label"
          value={node.label ?? ""}
          placeholder={nodeTitle({ ...node, label: undefined })}
          maxLength={60}
          onChange={(event) => onChange({ label: event.target.value || undefined })}
          autoComplete="off"
        />
        <FieldDescription>
          {node.kind === "approval"
            ? "The run stops here until someone on the team approves. The files it was shown carry on to the next step."
            : node.kind === "clips"
              ? "Cuts each video at pauses in speech into the fewest clips that fit the platform, and reframes them for it."
              : step?.description}
        </FieldDescription>
      </Field>

      {node.kind === "clips" && (
        <Field>
          <FieldLabel>Platform</FieldLabel>
          <PlatformPicker
            compact
            value={getPlatform(node.input.platform)?.name}
            onChange={(platform) => onChange({ input: { ...node.input, platform } })}
          />
        </Field>
      )}

      {node.kind === "step" && fields && (
        <StepFields
          fields={fields}
          values={values}
          idPrefix={`node-${node.id}`}
          automatic={{
            field: step?.primaryInput ?? step?.listInput?.field ?? null,
            sources,
            filled,
          }}
          onChange={(name, value) => {
            const next = { ...values, [name]: value };
            setValues(next);
            const parsed = toInput(fields, next);
            setProblem(parsed.ok ? null : parsed.message);
            if (parsed.ok) onChange({ input: parsed.input });
          }}
        />
      )}
      {problem && (
        <Alert variant="destructive">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}

      <Button type="button" variant="outline" size="sm" className="self-start" onClick={onRemove}>
        <Trash2 />
        Remove step
      </Button>
    </FieldGroup>
  );
}
