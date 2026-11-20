"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  approvalProblem,
  approvalSentence,
  WORKFLOW_KIND_WORDS,
  WORKFLOW_KINDS,
  type WorkflowKind,
  type WorkflowReview,
} from "@ncat-dash/automation-core";
import { useMutation, useQuery } from "convex/react";
import { ShieldCheck, Workflow } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PickList } from "@/components/ui/pick-list";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { ApprovalSettings, type Member } from "./approval-panel";

type Seen = NonNullable<ReturnType<typeof useWorkflowOf>>;
export type WorkflowView = NonNullable<Seen["workflow"]>;

/** The workflow an automation is part of, and what a new one would start with. */
export function useWorkflowOf(automationId: Id<"automations">) {
  return useQuery(api.workflows.forAutomation, { automationId });
}

/** What the Chain tab marks on each automation's card while the review is on. */
export function workflowMarks(
  workflow: WorkflowView | null | undefined,
): Map<string, { reviewHere: boolean; covered: boolean }> {
  const marks = new Map<string, { reviewHere: boolean; covered: boolean }>();
  if (!workflow?.review.on || workflow.joinedTo) return marks;
  for (const each of workflow.automations) {
    marks.set(each.automationId, { reviewHere: each.end, covered: each.ownApproval });
  }
  return marks;
}

const ON_WORDS = { on: "On", off: "Off", partly: "Partly on" } as const;

/**
 * The strip above the Chain tab's canvas: the workflow these automations make, with its
 * review and an on/off for all of them, or a way to make them one.
 */
export function WorkflowBar({ automationId }: { automationId: Id<"automations"> }) {
  const seen = useWorkflowOf(automationId);
  const setOn = useMutation(api.workflows.setOn);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  if (!seen) return null;
  const { workflow, proposal } = seen;

  async function onSwitch(on: boolean) {
    if (!workflow) return;
    setSwitching(true);
    try {
      await setOn({ workflowId: workflow.workflowId, on });
    } catch (caught) {
      toast.error(errorMessage(caught, "The workflow could not be switched."));
    } finally {
      setSwitching(false);
    }
  }

  return (
    <section
      aria-label="Workflow"
      data-testid="workflow-bar"
      className="bg-muted/40 mx-2 mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-3 py-2.5"
    >
      <Workflow className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      {workflow ? (
        <>
          <div className="grid min-w-0 flex-1 gap-0.5">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
              <span className="truncate font-medium">{workflow.name}</span>
              <span className="text-muted-foreground">
                {WORKFLOW_KIND_WORDS[workflow.kind].label}
                {workflow.clientName ? ` for ${workflow.clientName}` : ""}
              </span>
            </p>
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              {workflow.joinedTo ? (
                `This chain is now part of the ${workflow.joinedTo} workflow, so these settings are not used.`
              ) : workflow.review.on ? (
                <>
                  <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
                  One review before the files go out: {workflow.reviewWords}
                </>
              ) : (
                "No review: the files go out as soon as they are made."
              )}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              aria-label={`${workflow.name} is ${ON_WORDS[workflow.on].toLowerCase()}`}
              checked={workflow.on === "on"}
              disabled={switching || workflow.joinedTo !== null}
              onCheckedChange={(on) => void onSwitch(on)}
            />
            <span className="text-muted-foreground w-16">{ON_WORDS[workflow.on]}</span>
          </label>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Settings
          </Button>
        </>
      ) : (
        <>
          <p className="text-muted-foreground min-w-0 flex-1 text-sm">
            {proposal.automations.length > 1
              ? `Make these ${proposal.automations.length} automations one workflow, with one review before the files go out.`
              : "Make this a workflow, with one review before the files go out and a client it is for."}
          </p>
          <Button size="sm" onClick={() => setOpen(true)}>
            Make it a workflow
          </Button>
        </>
      )}
      {open && (
        <WorkflowDialog
          automationId={automationId}
          workflow={workflow}
          proposal={proposal}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

/** A review as an Approval step's settings, so the same settings panel edits it. */
function asInput(review: WorkflowReview): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...review };
  delete rest.on;
  return rest;
}

function fromInput(on: boolean, input: Record<string, unknown>): WorkflowReview {
  const reviewers = Array.isArray(input.reviewers)
    ? input.reviewers.filter((id): id is string => typeof id === "string")
    : [];
  const limit = typeof input.timeLimit === "number" && input.timeLimit > 0 ? input.timeLimit : null;
  return {
    on,
    reviewers,
    ...(limit
      ? {
          timeLimit: limit,
          timeLimitUnit: input.timeLimitUnit === "days" ? "days" : "hours",
          whenTimeUp: input.whenTimeUp === "approve" ? "approve" : "reject",
        }
      : {}),
  };
}

/** Making a workflow, or changing one: its name, kind, client and review. */
export function WorkflowDialog({
  automationId,
  workflow,
  proposal,
  onClose,
}: {
  automationId: Id<"automations">;
  workflow: WorkflowView | null;
  proposal: Seen["proposal"];
  onClose: () => void;
}) {
  const team = useActiveTeam();
  const members = useQuery(api.teams.members, { organizationId: team.id }) as Member[] | undefined;
  const clients = useQuery(api.clients.list, { organizationId: team.id });
  const create = useMutation(api.workflows.create);
  const update = useMutation(api.workflows.update);
  const remove = useMutation(api.workflows.remove);

  const start = workflow ?? proposal;
  const [name, setName] = useState(start.name);
  const [kind, setKind] = useState<WorkflowKind>(start.kind);
  const [clientId, setClientId] = useState<string>(start.clientId ?? "");
  const [review, setReview] = useState<WorkflowReview>(start.review as WorkflowReview);
  const [busy, setBusy] = useState(false);
  const problem = review.on ? approvalProblem(asInput(review)) : null;
  const names = (userId: string) => members?.find((member) => member.userId === userId)?.name;
  const covered = start.automations.filter((each) => each.ownApproval);
  const ends = start.automations.filter((each) => each.end);

  function pickKind(next: WorkflowKind) {
    setKind(next);
    // Each kind of work comes with its own default; the switch below can still change it.
    setReview((current) => ({ ...current, on: WORKFLOW_KIND_WORDS[next].review }));
  }

  async function save() {
    setBusy(true);
    const sent = {
      name,
      kind,
      clientId: clientId ? (clientId as Id<"clients">) : null,
      // Without a time limit, 0 takes away any limit it had.
      review: { ...review, ...(review.timeLimit ? {} : { timeLimit: 0 }) },
    };
    try {
      if (workflow) {
        await update({ workflowId: workflow.workflowId, ...sent });
        toast.success("Workflow saved");
      } else {
        await create({ automationId, ...sent });
        toast.success(`${name || proposal.name} is now a workflow`);
      }
      onClose();
    } catch (caught) {
      toast.error(errorMessage(caught, "The workflow could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function takeAway() {
    if (!workflow) return;
    setBusy(true);
    try {
      await remove({ workflowId: workflow.workflowId });
      toast.success("The automations are on their own again");
      onClose();
    } catch (caught) {
      toast.error(errorMessage(caught, "The workflow could not be taken away."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{workflow ? "Workflow settings" : "Make it a workflow"}</DialogTitle>
          <DialogDescription>
            {start.automations.map((each) => each.name).join(", ")}. Each still runs on its own,
            with the files the one before it made.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="workflow-name">Name</FieldLabel>
            <Input
              id="workflow-name"
              value={name}
              maxLength={80}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <FieldSet>
            <FieldLegend variant="label">What it is for</FieldLegend>
            <RadioGroupPrimitive.Root
              aria-label="What it is for"
              value={kind}
              onValueChange={(next) => pickKind(next as WorkflowKind)}
              className="grid gap-1"
            >
              {WORKFLOW_KINDS.map((each) => (
                <RadioGroupPrimitive.Item
                  key={each}
                  value={each}
                  className={cn(
                    "hover:bg-muted focus-visible:ring-ring/50 grid gap-0.5 rounded-lg px-3 py-2 text-left outline-none transition-colors focus-visible:ring-3",
                    "data-[state=checked]:row-selected",
                  )}
                >
                  <span className="text-sm font-medium">{WORKFLOW_KIND_WORDS[each].label}</span>
                  <span className="text-muted-foreground text-xs">
                    {WORKFLOW_KIND_WORDS[each].description}
                  </span>
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroupPrimitive.Root>
          </FieldSet>

          {clients && clients.length > 0 && (
            <Field>
              <FieldLabel>For</FieldLabel>
              <PickList
                aria-label="Client"
                value={clientId}
                onChange={setClientId}
                options={[
                  { value: "", label: "Your team" },
                  ...clients.map((client) => ({ value: client._id, label: client.name })),
                ]}
              />
              <FieldDescription>
                Every automation in it uses the client&apos;s brand and delivers to its folder.
              </FieldDescription>
            </Field>
          )}

          <Field orientation="horizontal">
            <Switch
              id="workflow-review"
              checked={review.on}
              onCheckedChange={(on) => setReview((current) => ({ ...current, on }))}
            />
            <FieldLabel htmlFor="workflow-review" className="font-normal">
              One review before the files go out
            </FieldLabel>
          </Field>
          <p className="text-muted-foreground -mt-3 text-sm">
            {review.on
              ? `Someone approves once, at the end of ${ends.map((each) => each.name).join(" and ") || "the last automation"}, before anything goes to Files, a project or the next automation.${covered.length > 0 ? ` The Approval steps in ${covered.map((each) => each.name).join(" and ")} are passed through, so nobody is asked twice.` : ""}`
              : "Nothing waits for a person. Approval steps inside the automations still ask as they are built."}
          </p>

          {review.on && (
            <div className="bg-muted/40 rounded-lg p-3">
              <ApprovalSettings
                node={{ id: "workflow-review", kind: "approval", input: asInput(review) }}
                members={members}
                onChange={(patch) => setReview(fromInput(true, patch.input ?? {}))}
              />
            </div>
          )}
          {review.on && !problem && (
            <p className="text-muted-foreground -mt-3 text-xs" data-testid="review-summary">
              {approvalSentence(asInput(review), names)}
            </p>
          )}
        </FieldGroup>

        <DialogFooter className="gap-2 sm:justify-between">
          {workflow ? (
            <Button variant="ghost" disabled={busy} onClick={() => void takeAway()}>
              Take the workflow away
            </Button>
          ) : (
            <span />
          )}
          <Button disabled={busy || problem !== null} onClick={() => void save()}>
            {workflow ? "Save" : "Make workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
