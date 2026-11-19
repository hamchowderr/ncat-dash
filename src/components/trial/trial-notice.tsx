"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";

import { Button } from "@/components/ui/button";
import { TRIAL_ENDED_REPLY, daysLeftLabel } from "@/lib/trial";

/** The team's free trial, as the bar along the top shows it: days left, and where to buy. */
export function TrialDays({ organizationId }: { organizationId: string }) {
  const trial = useQuery(api.trial.status, { organizationId });
  if (trial?.kind !== "trial") return null;
  return (
    <span className="text-muted-foreground flex items-center gap-2 text-sm" data-trial="days">
      <span>{daysLeftLabel(trial.daysLeft)}</span>
      {trial.buyUrl && (
        <a
          className="text-foreground font-medium underline-offset-4 hover:underline"
          href={trial.buyUrl}
        >
          Get Kontifi
        </a>
      )}
    </span>
  );
}

/**
 * Once a team's trial is over: a quiet band above the page, in the page's own flow, so it
 * moves the page down rather than covering any of it.
 */
export function TrialEnded({ organizationId }: { organizationId: string }) {
  const trial = useQuery(api.trial.status, { organizationId });
  if (trial?.kind !== "ended") return null;
  return (
    <section
      aria-label="Free trial"
      data-trial="ended"
      className="bg-muted/60 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl px-5 py-4"
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium">Your free trial has ended</h2>
        <p className="text-muted-foreground text-sm">
          Everything you made is kept. Automations and the agent start again once you have the
          dashboard.
        </p>
      </div>
      {trial.buyUrl && (
        <Button asChild size="sm">
          <a href={trial.buyUrl}>Get Kontifi</a>
        </Button>
      )}
    </section>
  );
}

/** True once the team's free trial is over. Undefined while it is loading. */
export function useTrialEnded(organizationId: string): boolean | undefined {
  const trial = useQuery(api.trial.status, { organizationId });
  return trial === undefined ? undefined : trial.kind === "ended";
}

/** Shown in the agent's place once the trial is over: every reply costs AI tokens. */
export function AgentResting({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-full flex-col gap-3 p-6" data-trial="agent">
      <h2 className="text-sm font-medium">The agent is resting</h2>
      <p className="text-muted-foreground text-sm">{TRIAL_ENDED_REPLY}</p>
      <div>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
