import type { StepDefinition } from "./define";
import { moreRecipes, recipes } from "./recipes";
import { steps } from "./steps";

export * from "./define";
export * from "./client";
export * from "./recipes";
export * from "./steps";

/** Every step a person can run: the toolkit's endpoints, then the ready-made recipes. */
export const allSteps: StepDefinition[] = [...steps, ...recipes, ...moreRecipes];

const byId = new Map<string, StepDefinition>(allSteps.map((step) => [step.id, step]));

export type StepId = (typeof steps)[number]["id"];

export function getStep(id: string): StepDefinition | undefined {
  return byId.get(id);
}

export function stepsByCategory(): Record<string, StepDefinition[]> {
  const grouped: Record<string, StepDefinition[]> = {};
  for (const step of allSteps) (grouped[step.category] ??= []).push(step);
  return grouped;
}
