"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { selectClass } from "@/components/projects/slot-status";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

/**
 * Who an automation works for: the team itself or one of its clients. A client's runs use
 * its brand and deliver to its folder. Saved at once, apart from the canvas's own Save.
 * Nothing shows until the team has a client.
 */
export function ClientPicker({
  automationId,
  clientId,
}: {
  automationId: Id<"automations">;
  clientId: Id<"clients"> | null;
}) {
  const team = useActiveTeam();
  const clients = useQuery(api.clients.list, { organizationId: team.id });
  const setFor = useMutation(api.clients.setForAutomation);
  if (!clients || clients.length === 0) return null;

  async function onChange(value: string) {
    try {
      await setFor({ automationId, clientId: value ? (value as Id<"clients">) : null });
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be changed."));
    }
  }

  return (
    <label
      className="text-muted-foreground flex items-center gap-2 text-sm"
      data-tour-step-id="tour-editor-client"
    >
      For
      <select
        aria-label="Client"
        value={clientId ?? ""}
        onChange={(event) => void onChange(event.target.value)}
        className={cn(selectClass, "text-foreground h-8 max-w-44")}
      >
        <option value="">Your team</option>
        {clients.map((client) => (
          <option key={client._id} value={client._id}>
            {client.name}
          </option>
        ))}
      </select>
    </label>
  );
}
