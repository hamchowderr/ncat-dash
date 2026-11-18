"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

/**
 * The steps the agent wrote for this team. Each is one FFmpeg request with a few
 * settings, and runs like any other step. One no automation uses can be removed.
 */
export function TeamStepsList() {
  const team = useActiveTeam();
  const steps = useQuery(api.teamSteps.list, { organizationId: team.id });
  const remove = useMutation(api.teamSteps.remove);
  const [problem, setProblem] = useState<{ stepId: string; message: string } | null>(null);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="team-steps-heading">
      <div className="flex flex-col gap-1">
        <h2 id="team-steps-heading" className="text-sm font-medium">
          Your team&apos;s steps
        </h2>
        <p className="text-muted-foreground text-sm">
          {steps && steps.length === 0
            ? "None yet. When no step here does what you want, ask the agent: it writes one, tries it on one of your files, and saves it here."
            : "Written by the agent for your team. They run as plain FFmpeg, with no AI, and can go in any automation."}
        </p>
      </div>
      {steps && steps.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {steps.map((step) => (
            <li
              key={step.stepId}
              className="bg-card flex h-full flex-col gap-2 rounded-xl p-4 ring-1 ring-foreground/10"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="font-medium">{step.title}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mt-1 -mr-2 size-8"
                  aria-label={`Remove ${step.title}`}
                  onClick={async () => {
                    setProblem(null);
                    try {
                      await remove({ organizationId: team.id, stepId: step.stepId });
                    } catch (caught) {
                      setProblem({
                        stepId: step.stepId,
                        message: errorMessage(caught, "That step could not be removed."),
                      });
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              </span>
              <span className="text-muted-foreground line-clamp-2 text-sm">{step.description}</span>
              {step.blanks.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {step.blanks.map((blank) => (
                    <Badge key={blank.name} variant="outline">
                      {blank.label}
                    </Badge>
                  ))}
                </span>
              )}
              {problem?.stepId === step.stepId && (
                <p role="alert" className="text-destructive text-sm">
                  {problem.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
