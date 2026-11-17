"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveTeam } from "@/lib/team-context";

/**
 * Picks one of the team's other automations by name. What is saved is its id; nobody
 * sees or types it. `exclude` is the automation being edited, which cannot pick itself.
 */
export function AutomationPicker({
  id,
  value,
  exclude,
  onChange,
}: {
  id: string;
  value: string;
  exclude: string;
  onChange: (automationId: string) => void;
}) {
  const team = useActiveTeam();
  const automations = useQuery(api.automations.list, { organizationId: team.id });
  const others = (automations ?? [])
    .filter((automation) => automation._id !== exclude)
    .sort((a, b) => a.name.localeCompare(b.name));
  const known = others.some((automation) => automation._id === value);

  if (automations !== undefined && others.length === 0) {
    return (
      <p className="text-muted-foreground text-sm text-pretty">
        Your team has no other automations yet.{" "}
        <Link href="/automations/new" className="text-foreground underline underline-offset-4">
          Make one
        </Link>{" "}
        first, then pick it here.
      </p>
    );
  }

  return (
    <Select value={known ? value : ""} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        className="w-full"
        aria-invalid={value !== "" && automations !== undefined && !known}
      >
        <SelectValue
          placeholder={
            value && automations !== undefined && !known
              ? "That automation was deleted. Pick another"
              : "Pick an automation"
          }
        />
      </SelectTrigger>
      <SelectContent>
        {others.map((automation) => (
          <SelectItem key={automation._id} value={automation._id}>
            {automation.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
