"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { PickList } from "@/components/ui/pick-list";

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
      <PickList
        aria-label="Client"
        size="sm"
        className="text-foreground max-w-44"
        value={clientId ?? ""}
        onChange={(next) => void onChange(next)}
        options={[
          { value: "", label: "Your team" },
          ...clients.map((client) => ({ value: client._id, label: client.name })),
        ]}
      />
    </label>
  );
}
