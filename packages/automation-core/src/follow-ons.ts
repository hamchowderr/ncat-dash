/**
 * Follow-on automations: ready-made ones that start when another automation finishes
 * (see `follows` on a starter). This is how the dashboard knows which ones go well after
 * an automation, and how one is wired to the automation it is set up after.
 */
import type { AutomationNode } from "./graph";
import { type Starter, type StarterTrigger, STARTERS } from "./starters";

/** The ready-made automations that start after another one finishes. */
export function isFollowOn(starter: Starter): boolean {
  return starter.trigger.kind === "finished" && (starter.follows?.length ?? 0) > 0;
}

/** The follow-ons made to run after the ready-made automation `starterId`, in list order. */
export function followOnsFor(starterId: string | null | undefined): Starter[] {
  if (!starterId) return [];
  return STARTERS.filter((starter) => isFollowOn(starter) && starter.follows!.includes(starterId));
}

/** The ready-made automations a follow-on is made to run after, by name, best fit first. */
export function followedNames(starter: Starter): string[] {
  return (starter.follows ?? []).flatMap(
    (id) => STARTERS.find((other) => other.id === id)?.name ?? [],
  );
}

/** What a follow-on's trigger becomes once it is set up after the automation `automationId`. */
export function followOnTrigger(starter: Starter, automationId: string): StarterTrigger {
  if (starter.trigger.kind !== "finished") return starter.trigger;
  return { ...starter.trigger, automationId };
}

/** The steps an automation is made of, as far as telling which ready-made it is goes. */
function shapeOf(
  trigger: Pick<StarterTrigger, "kind">,
  nodes: Pick<AutomationNode, "kind" | "stepId">[],
) {
  const steps = nodes.map((node) => `${node.kind}:${node.stepId ?? ""}`).sort();
  return `${trigger.kind}|${steps.join(",")}`;
}

/**
 * Which ready-made automation one was made from. Newer automations remember it; for older
 * ones, the ready-made with the same trigger and the same steps, when exactly one has them.
 */
export function starterOf(automation: {
  starterId?: string | null;
  trigger: Pick<StarterTrigger, "kind">;
  nodes: Pick<AutomationNode, "kind" | "stepId">[];
}): string | null {
  if (automation.starterId && STARTERS.some((starter) => starter.id === automation.starterId)) {
    return automation.starterId;
  }
  if (automation.nodes.length === 0) return null;
  const shape = shapeOf(automation.trigger, automation.nodes);
  const same = STARTERS.filter((starter) => shapeOf(starter.trigger, starter.nodes) === shape);
  return same.length === 1 ? same[0].id : null;
}

/** On a ready-made follow-on's card: which ready-made automations it is made to run after. */
export function followsLine(starter: Starter): string | null {
  const names = followedNames(starter);
  if (names.length === 0) return null;
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return starter.trigger.kind === "finished" && starter.trigger.when === "failed"
    ? `Runs if ${list} fails`
    : `Runs after ${list}`;
}
