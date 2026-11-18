import type { StepDefinition } from "./define";
import { moreRecipes, recipes } from "./recipes";
import { steps } from "./steps";
import { type SavedTeamStep, teamStepDefinition } from "./team-steps";

export * from "./define";
export * from "./client";
export * from "./recipes";
export * from "./steps";
export * from "./team-steps";

/** Every step a person can run: the toolkit's endpoints, then the ready-made recipes. */
export const allSteps: StepDefinition[] = [...steps, ...recipes, ...moreRecipes];

const byId = new Map<string, StepDefinition>(allSteps.map((step) => [step.id, step]));

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

export function getStep(id: string): StepDefinition | undefined {
  return byId.get(id) ?? teamSteps.get(id);
}

export function stepsByCategory(): Record<string, StepDefinition[]> {
  const grouped: Record<string, StepDefinition[]> = {};
  for (const step of allSteps) (grouped[step.category] ??= []).push(step);
  return grouped;
}
