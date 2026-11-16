import type { StepDefinition } from "./define";
import { steps } from "./steps";

export * from "./define";
export * from "./client";
export * from "./steps";

const byId = new Map<string, StepDefinition>(steps.map((step) => [step.id, step]));

export type StepId = (typeof steps)[number]["id"];

export function getStep(id: string): StepDefinition | undefined {
  return byId.get(id);
}

export function stepsByCategory(): Record<string, StepDefinition[]> {
  const grouped: Record<string, StepDefinition[]> = {};
  for (const step of steps) (grouped[step.category] ??= []).push(step);
  return grouped;
}
