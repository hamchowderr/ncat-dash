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
          Get Takewon
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
        <h2 className="text-sm font-medium">
          {trial.repeat ? "You've had your free trial" : "Your free trial has ended"}
        </h2>
        <p className="text-muted-foreground text-sm">
          {trial.repeat
            ? "This team's owner had a free trial already, so this team doesn't get another. "
            : "Everything you made is kept. "}
          Automations and the agent start once you have the dashboard.
        </p>
      </div>
      {trial.buyUrl && (
        <Button asChild size="sm">
          <a href={trial.buyUrl}>Get Takewon</a>
        </Button>
      )}
    </section>
  );
}

/**
 * Why nothing new can start for this team, or for the person looking: the trial is over,
 * or the operator blocked them. Null when all is well, undefined while it is loading.
 */
export function useAccessRefusal(organizationId: string) {
  return useQuery(api.access.mine, { organizationId });
}

/**
 * Once the operator has blocked the team or the person: a quiet band above the page, in
 * the page's own flow, like the trial's. A trial that ended has its own band.
 */
export function TeamPaused({ organizationId }: { organizationId: string }) {
  const refusal = useAccessRefusal(organizationId);
  if (refusal?.reason !== "team_blocked" && refusal?.reason !== "user_blocked") return null;
  return (
    <section
      aria-label="Paused"
      data-access="paused"
      className="bg-muted/60 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl px-5 py-4"
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium">
          {refusal.reason === "team_blocked" ? "This team is paused" : "Your account is paused"}
        </h2>
        <p className="text-muted-foreground text-sm">{refusal.message}</p>
      </div>
    </section>
  );
}

/**
 * Shown in the agent's place once nothing new can start (every reply costs AI tokens):
 * the trial is over, or the team or person is blocked.
 */
export function AgentResting({
  message = TRIAL_ENDED_REPLY,
  onClose,
}: {
  message?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-3 p-6" data-trial="agent">
      <h2 className="text-sm font-medium">The agent is resting</h2>
      <p className="text-muted-foreground text-sm">{message}</p>
      <div>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
