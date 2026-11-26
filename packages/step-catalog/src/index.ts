import { beatRecipes } from "./beats";
import { micRecipes } from "./mic";
import type { StepDefinition } from "./define";
import { editingRecipes } from "./editing";
import { moreRecipes, recipes } from "./recipes";
import { hiddenSteps, steps } from "./steps";
import { savedLookStep } from "./looks";
import { variantRecipes } from "./variants";
import { type SavedTeamStep, teamStepDefinition } from "./team-steps";

export * from "./define";
export * from "./client";
export * from "./compose-guard";
export * from "./editing";
export * from "./recipes";
export * from "./steps";
export * from "./team-steps";
export * from "./variants";
export * from "./disclosure";
export * from "./codes";
export * from "./looks";
export * from "./beats";
export * from "./ducking";
export * from "./mic";

/** Every step a person can run: the toolkit's endpoints, then the ready-made recipes. */
export const allSteps: StepDefinition[] = [
  ...steps,
  ...recipes,
  ...moreRecipes,
  ...editingRecipes,
  ...variantRecipes,
  savedLookStep,
  ...beatRecipes,
  ...micRecipes,
];

// Steps only other steps send, such as the motion graphics render: known by id, not listed.
const byId = new Map<string, StepDefinition>(
  [...allSteps, ...hiddenSteps].map((step) => [step.id, step]),
);

export type StepId = (typeof steps)[number]["id"];

/** The team steps in use right now: the one team whose work is being done. */
let teamSteps = new Map<string, StepDefinition>();

/**
 * Makes these team steps the ones `getStep` knows, replacing any before. Call it with the
 * team's saved steps before working on that team's automations (in Convex, at the start
 * of the function; in the browser, whenever the team's list arrives).
 */
export function setTeamSteps(saved: SavedTeamStep[]): void {
  teamSteps = new Map(
    saved.map((one) => {
      const definition = teamStepDefinition(one);
      return [definition.id, definition];
    }),
  );
}

/** The team steps `setTeamSteps` was given last. */
export function currentTeamSteps(): StepDefinition[] {
  return [...teamSteps.values()];
}

/** Whether a step is one only other steps send, never one a person adds. */
export function isHiddenStep(id: string): boolean {
  return hiddenSteps.some((step) => step.id === id);
}

export function getStep(id: string): StepDefinition | undefined {
  return byId.get(id) ?? teamSteps.get(id);
}

export function stepsByCategory(): Record<string, StepDefinition[]> {
  const grouped: Record<string, StepDefinition[]> = {};
  for (const step of allSteps) (grouped[step.category] ??= []).push(step);
  return grouped;
}
