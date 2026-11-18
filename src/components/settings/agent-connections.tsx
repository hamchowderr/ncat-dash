"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { SettingsSection } from "./settings-shell";

function day(at: number) {
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The agents people let in with OAuth. Everyone sees and can disconnect their own; team
 * owners and admins see everyone's.
 */
export function AgentConnections() {
  const team = useActiveTeam();
  const connections = useQuery(api.oauth.connections, { organizationId: team.id });
  const disconnect = useMutation(api.oauth.disconnect);
  const [busy, setBusy] = useState<string | null>(null);

  async function onDisconnect(grantId: Id<"oauthGrants">, name: string) {
    setBusy(grantId);
    try {
      await disconnect({ organizationId: team.id, grantId });
      toast.success(`${name} disconnected. It has to sign in again to come back.`);
    } catch (caught) {
      toast.error(errorMessage(caught, "It could not be disconnected. Try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsSection
      title="Connected agents"
      description="Agents that signed in to this team. Disconnecting one turns it away straight away."
    >
      {connections === undefined ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : connections.length === 0 ? (
        <p className="text-muted-foreground text-sm">No agent has signed in yet.</p>
      ) : (
        <ul className="flex flex-col divide-y text-sm" aria-label="Connected agents">
          {connections.map((each) => (
            <li key={each.grantId} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="font-medium">{each.clientName}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {each.mine ? "you" : each.person} · since {day(each.createdAt)} ·{" "}
                  {each.lastUsedAt ? `last used ${day(each.lastUsedAt)}` : "not used yet"}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === each.grantId}
                onClick={() => onDisconnect(each.grantId, each.clientName)}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
