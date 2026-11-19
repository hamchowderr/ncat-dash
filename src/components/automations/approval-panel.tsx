"use client";

import {
  ALWAYS_DECIDE_ROLES,
  type AutomationNode,
  approvalProblem,
  approvalSettings,
  TIME_LIMIT_UNITS,
  type TimeLimitUnit,
} from "@ncat-dash/automation-core";
import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useActiveTeam } from "@/lib/team-context";

type NodeContent = Omit<AutomationNode, "position">;
type Settings = Record<string, unknown>;

export type Member = { userId: string; name: string; email: string; role: string };

function isManager(member: Member): boolean {
  return member.role.split(",").some((role) => ALWAYS_DECIDE_ROLES.includes(role.trim()));
}

/**
 * The settings of an Approval step: who is asked to review, and what happens when nobody
 * decides in time. Mount with key={node.id}.
 */
export function ApprovalSettings({
  node,
  members,
  onChange,
}: {
  node: NodeContent;
  /** The team, or undefined while it loads. */
  members: Member[] | undefined;
  onChange: (patch: Partial<NodeContent>) => void;
}) {
  const settings = approvalSettings(node.input);
  const [typed, setTyped] = useState(String(settings.limit?.amount ?? 24));
  const change = (patch: Settings) => onChange({ input: { ...node.input, ...patch } });
  const problem = approvalProblem(node.input);
  const unit: TimeLimitUnit = settings.limit?.unit ?? "hours";

  function toggleReviewer(userId: string, on: boolean) {
    const next = on
      ? [...settings.reviewers, userId]
      : settings.reviewers.filter((id) => id !== userId);
    change({ reviewers: next });
  }

  const named = (members ?? []).filter((member) => settings.reviewers.includes(member.userId));

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend variant="label">Who reviews</FieldLegend>
        <FieldDescription>
          {named.length === 0
            ? "Nobody picked, so anyone on the team can approve."
            : `Only ${named.map((member) => member.name).join(" and ")} can approve, plus team owners and admins.`}{" "}
          They are told in their Inbox and by email.
        </FieldDescription>
        {members === undefined ? (
          <p className="text-muted-foreground text-sm">Loading the team…</p>
        ) : (
          <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto" aria-label="Team members">
            {members.map((member) => {
              const id = `reviewer-${member.userId}`;
              return (
                <li
                  key={member.userId}
                  className="hover:bg-muted has-data-checked:row-selected flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors"
                >
                  <Checkbox
                    id={id}
                    checked={settings.reviewers.includes(member.userId)}
                    onCheckedChange={(checked) => toggleReviewer(member.userId, checked === true)}
                  />
                  <label htmlFor={id} className="flex min-w-0 flex-1 items-baseline gap-2 text-sm">
                    <span className="truncate">{member.name}</span>
                    {isManager(member) && (
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {member.role.includes("owner") ? "Owner" : "Admin"}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </FieldSet>

      <Field orientation="horizontal">
        <Switch
          id="approval-limit"
          checked={settings.limit !== null}
          onCheckedChange={(on) =>
            change(
              on
                ? {
                    timeLimit: Number(typed) > 0 ? Number(typed) : 24,
                    timeLimitUnit: unit,
                    whenTimeUp: settings.whenTimeUp,
                  }
                : { timeLimit: undefined },
            )
          }
        />
        <FieldLabel htmlFor="approval-limit" className="font-normal">
          Decide by itself if nobody does in time
        </FieldLabel>
      </Field>

      {settings.limit !== null && (
        <Field data-invalid={problem !== null}>
          <FieldLabel htmlFor="approval-amount">If nobody decides within</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="approval-amount"
              inputMode="decimal"
              value={typed}
              autoComplete="off"
              className="min-w-0 flex-1 tabular-nums"
              aria-invalid={problem !== null}
              onChange={(event) => {
                setTyped(event.target.value);
                const amount = Number(event.target.value);
                if (Number.isFinite(amount) && amount > 0) change({ timeLimit: amount });
              }}
            />
            <Select value={unit} onValueChange={(next) => change({ timeLimitUnit: next })}>
              <SelectTrigger aria-label="Unit" className="w-24 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_LIMIT_UNITS.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Select
            value={settings.whenTimeUp}
            onValueChange={(next) => change({ whenTimeUp: next })}
          >
            <SelectTrigger aria-label="Then" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reject">reject it and stop the run</SelectItem>
              <SelectItem value="approve">approve it and carry on</SelectItem>
            </SelectContent>
          </Select>
          {problem ? (
            <FieldError>{problem}</FieldError>
          ) : (
            <FieldDescription>
              {settings.whenTimeUp === "reject"
                ? "A run rejected this way shows up in the Inbox like any failed run."
                : "The files it was shown carry on as if someone had approved."}
            </FieldDescription>
          )}
        </Field>
      )}
    </FieldGroup>
  );
}

/** The Approval settings with the active team loaded. */
export function TeamApprovalSettings(props: {
  node: NodeContent;
  onChange: (patch: Partial<NodeContent>) => void;
}) {
  const team = useActiveTeam();
  const members = useQuery(api.teams.members, { organizationId: team.id });
  return <ApprovalSettings {...props} members={members} />;
}
