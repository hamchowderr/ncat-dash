"use client";

import type { AutomationNode } from "@ncat-dash/automation-core";
import { getStep } from "@ncat-dash/step-catalog";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { StepFields, fromInput, toInput, useStepFields } from "@/components/steps/step-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { nodeTitle } from "@/lib/automations";

import { CopyButton } from "./trigger-panel";

type NodeContent = Omit<AutomationNode, "position">;

/** Settings for the step selected on the canvas. Mount with key={node.id}. */
export function NodePanel({
  node,
  others,
  onChange,
  onRemove,
}: {
  node: NodeContent;
  /** The other steps, whose files this one can point at. */
  others: NodeContent[];
  onChange: (patch: Partial<NodeContent>) => void;
  onRemove: () => void;
}) {
  const step = node.kind === "step" ? getStep(node.stepId ?? "") : undefined;
  const fields = useStepFields(node.stepId ?? "");
  const [values, setValues] = useState(() => fromInput(node.input));
  const [problem, setProblem] = useState<string | null>(null);

  const placeholders = [
    { text: "{{trigger.file_url}}", hint: "The file that started the run" },
    ...others.map((other) => ({
      text: `{{steps.${other.id}.url}}`,
      hint: `The file from ${nodeTitle(other)}`,
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
            : step?.description}
        </FieldDescription>
      </Field>

      {node.kind === "step" && fields && (
        <StepFields
          fields={fields}
          values={values}
          idPrefix={`node-${node.id}`}
          automatic={{ field: step?.primaryInput ?? step?.listInput?.field ?? null }}
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

      {node.kind === "step" && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Placeholders</h3>
          <p className="text-muted-foreground text-sm">
            Paste one into any text field to fill it in when the run reaches this step.
          </p>
          <ul className="flex flex-col gap-2">
            {placeholders.map((placeholder) => (
              <li key={placeholder.text} className="flex items-center justify-between gap-2">
                <div className="grid min-w-0">
                  <code className="truncate text-xs">{placeholder.text}</code>
                  <span className="text-muted-foreground truncate text-xs">{placeholder.hint}</span>
                </div>
                <CopyButton text={placeholder.text} label="Copy" />
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button type="button" variant="outline" size="sm" className="self-start" onClick={onRemove}>
        <Trash2 />
        Remove step
      </Button>
    </FieldGroup>
  );
}
