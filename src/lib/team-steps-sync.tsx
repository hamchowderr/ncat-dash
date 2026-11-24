"use client";

import { api } from "@convex/_generated/api";
import { setTeamSteps, TEAM_STEP_PREFIX } from "@takewon/step-catalog";
import { useQuery } from "convex/react";
import { createContext, type ReactNode, useContext, useMemo } from "react";

const TeamStepsVersion = createContext("");

/**
 * Tells the step catalog in the browser about the team's own steps (the ones the agent
 * wrote), so the canvas, the step picker and the step panel know them like any other.
 * Nothing is drawn afresh: what reads the catalog calls `useTeamStepsVersion` and is
 * drawn again when the list changes, keeping anything not yet saved.
 */
export function TeamStepsSync({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}) {
  const list = useQuery(api.teamSteps.list, { organizationId });
  const version = useMemo(() => {
    const saved = (list ?? []).map((step) => ({
      id: step.stepId.slice(TEAM_STEP_PREFIX.length),
      title: step.title,
      description: step.description,
      blanks: step.blanks,
      primary: step.primary,
      request: step.request,
    }));
    setTeamSteps(saved);
    return (list ?? []).map((step) => `${step.stepId}:${step.updatedAt}`).join(",");
  }, [list]);
  return <TeamStepsVersion.Provider value={version}>{children}</TeamStepsVersion.Provider>;
}

/** Draws the caller again whenever the team's own steps change. */
export function useTeamStepsVersion(): string {
  return useContext(TeamStepsVersion);
}
