/**
 * Several triggers on one automation, the way n8n has them: each trigger starts the steps
 * it is connected to, and a run started by one trigger only does the steps that can be
 * reached from there. All of them share the automation's one on/off switch.
 *
 * Stored so that an automation with one trigger looks exactly as it always has:
 * - `trigger` is the first trigger, with the id FIRST_TRIGGER.
 * - `moreTriggers` holds any others, each with the first steps it starts.
 * - `triggerStarts` is which first steps the first trigger starts. Left out, it starts
 *   every step that nothing feeds and that no other trigger starts.
 *
 * A trigger only ever starts a step that nothing else feeds; once a line comes into a
 * step from another step, that step is no longer one of the start steps.
 */
import type { AutomationEdge, AutomationNode } from "./graph";
import type { StarterTrigger } from "./starters";

/** The id of the first trigger, which every automation has. Also its id on the canvas. */
export const FIRST_TRIGGER = "__trigger";
/** The most triggers one automation can have. */
export const MAX_TRIGGERS = 8;

export interface MoreTrigger {
  id: string;
  trigger: StarterTrigger;
  /** The steps it starts: ids of steps that nothing else feeds. */
  starts: string[];
}

/** What this file needs from an automation. */
export interface WithTriggers {
  trigger: StarterTrigger;
  moreTriggers?: MoreTrigger[];
  triggerStarts?: string[];
  nodes: Pick<AutomationNode, "id">[];
  edges: Pick<AutomationEdge, "source" | "target">[];
}

/** Whether an id is a trigger's rather than a step's. Step ids never start with "__". */
export function isTriggerId(id: string): boolean {
  return id === FIRST_TRIGGER || /^__trigger_\d+$/.test(id);
}

/** Every trigger, the first one first. */
export function triggersOf(
  automation: Pick<WithTriggers, "trigger" | "moreTriggers">,
): { id: string; trigger: StarterTrigger }[] {
  return [
    { id: FIRST_TRIGGER, trigger: automation.trigger },
    ...(automation.moreTriggers ?? []).map(({ id, trigger }) => ({ id, trigger })),
  ];
}

/** The trigger with this id, or undefined. */
export function triggerWithId(
  automation: Pick<WithTriggers, "trigger" | "moreTriggers">,
  id: string,
): StarterTrigger | undefined {
  return triggersOf(automation).find((each) => each.id === id)?.trigger;
}

/** Whether the automation has more than one trigger. */
export function hasMoreTriggers(automation: Pick<WithTriggers, "moreTriggers">): boolean {
  return (automation.moreTriggers?.length ?? 0) > 0;
}

/** Steps nothing else feeds, in the order they are listed. */
export function startSteps(automation: Pick<WithTriggers, "nodes" | "edges">): string[] {
  const fed = new Set(automation.edges.map((edge) => edge.target));
  return automation.nodes.map((node) => node.id).filter((id) => !fed.has(id));
}

/** The start steps each trigger starts, by trigger id. */
export function startsByTrigger(automation: WithTriggers): Map<string, string[]> {
  const roots = startSteps(automation);
  const isRoot = new Set(roots);
  const more = automation.moreTriggers ?? [];
  const byOthers = new Set(more.flatMap((each) => each.starts));
  const first =
    automation.triggerStarts !== undefined
      ? automation.triggerStarts.filter((id) => isRoot.has(id))
      : roots.filter((id) => !byOthers.has(id));
  const starts = new Map<string, string[]>([[FIRST_TRIGGER, first]]);
  for (const each of more) {
    starts.set(
      each.id,
      roots.filter((id) => each.starts.includes(id)),
    );
  }
  return starts;
}

/** The start steps the trigger `id` starts. */
export function startsOf(automation: WithTriggers, id: string): string[] {
  return startsByTrigger(automation).get(id) ?? [];
}

/** The ids of the triggers that start the step `nodeId`, which nothing else feeds. */
export function triggersStarting(automation: WithTriggers, nodeId: string): string[] {
  return [...startsByTrigger(automation)]
    .filter(([, starts]) => starts.includes(nodeId))
    .map(([id]) => id);
}

/** Start steps no trigger starts, which would never run. */
export function unstartedSteps(automation: WithTriggers): string[] {
  const started = new Set([...startsByTrigger(automation).values()].flat());
  return startSteps(automation).filter((id) => !started.has(id));
}

/**
 * What a run started by the trigger `id` does: the steps that can be reached from the
 * ones that trigger starts, and the lines between them. With one trigger, everything.
 */
export function branchOf<N extends { id: string }, E extends { source: string; target: string }>(
  automation: Omit<WithTriggers, "nodes" | "edges"> & { nodes: N[]; edges: E[] },
  id: string,
): { nodes: N[]; edges: E[] } {
  if (!hasMoreTriggers(automation) && automation.triggerStarts === undefined) {
    return { nodes: automation.nodes, edges: automation.edges };
  }
  const reached = new Set<string>();
  const queue = [...startsOf(automation, id)];
  while (queue.length > 0) {
    const at = queue.shift()!;
    if (reached.has(at)) continue;
    reached.add(at);
    for (const edge of automation.edges) if (edge.source === at) queue.push(edge.target);
  }
  return {
    nodes: automation.nodes.filter((node) => reached.has(node.id)),
    edges: automation.edges.filter((edge) => reached.has(edge.source) && reached.has(edge.target)),
  };
}

/** A free id for another trigger: "__trigger_2", "__trigger_3" and so on. */
export function newTriggerId(automation: Pick<WithTriggers, "moreTriggers">): string {
  const taken = new Set((automation.moreTriggers ?? []).map((each) => each.id));
  for (let n = 2; ; n++) {
    const id = `__trigger_${n}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * The trigger fields kept tidy: start lists only hold steps that are still start steps,
 * and the first trigger's list is left out when it says the same as leaving it out.
 */
export function tidyTriggers<T extends WithTriggers>(automation: T): T {
  const { moreTriggers, triggerStarts, ...rest } = automation;
  const roots = new Set(startSteps(automation));
  const more = (moreTriggers ?? []).map((each) => ({
    ...each,
    starts: each.starts.filter((id, index) => roots.has(id) && each.starts.indexOf(id) === index),
  }));
  const tidied = { ...rest, ...(more.length > 0 ? { moreTriggers: more } : {}) } as T;
  // On its own, the one trigger starts every step nothing else feeds, as it always has.
  if (triggerStarts === undefined || more.length === 0) return tidied;
  const first = triggerStarts.filter(
    (id, index) => roots.has(id) && triggerStarts.indexOf(id) === index,
  );
  const byDefault = startsByTrigger(tidied).get(FIRST_TRIGGER) ?? [];
  const same = first.length === byDefault.length && first.every((id) => byDefault.includes(id));
  return same ? tidied : ({ ...tidied, triggerStarts: first } as T);
}

/**
 * Makes the trigger `id` start (or stop starting) the start step `nodeId`. The first
 * trigger's list is written out when it no longer matches what it starts by itself.
 */
export function setTriggerStarts<T extends WithTriggers>(
  automation: T,
  id: string,
  nodeId: string,
  on: boolean,
): T {
  const current = startsOf(automation, id);
  const next = on
    ? current.includes(nodeId)
      ? current
      : [...current, nodeId]
    : current.filter((each) => each !== nodeId);
  if (id === FIRST_TRIGGER) {
    // Written out first, so that what the other triggers start is not taken away from it.
    const firstOthers = (automation.moreTriggers ?? []).map((each) => ({
      ...each,
      starts: startsOf(automation, each.id),
    }));
    return tidyTriggers({ ...automation, moreTriggers: firstOthers, triggerStarts: next });
  }
  // The first trigger keeps what it starts now, so a step moved to this trigger is not
  // also started by the first one, and one it already started stays started.
  const firstNow = startsOf(automation, FIRST_TRIGGER);
  const more = (automation.moreTriggers ?? []).map((each) =>
    each.id === id ? { ...each, starts: next } : each,
  );
  return tidyTriggers({ ...automation, moreTriggers: more, triggerStarts: firstNow });
}

/** Adds a trigger that starts nothing yet. Returns the automation and the new id. */
export function addTrigger<T extends WithTriggers>(
  automation: T,
  trigger: StarterTrigger,
  starts: string[] = [],
): { automation: T; id: string } {
  const id = newTriggerId(automation);
  // The first trigger keeps exactly what it starts now.
  const firstNow = startsOf(automation, FIRST_TRIGGER);
  const added = tidyTriggers({
    ...automation,
    triggerStarts: firstNow,
    moreTriggers: [...(automation.moreTriggers ?? []), { id, trigger, starts }],
  });
  return { automation: added, id };
}

/**
 * Removes the trigger `id`. Removing the first one makes the next one the first. The
 * steps it alone started are left on the canvas, started by nothing until connected.
 */
export function removeTrigger<T extends WithTriggers>(automation: T, id: string): T {
  const more = automation.moreTriggers ?? [];
  if (id === FIRST_TRIGGER) {
    const [next, ...rest] = more;
    if (!next) return automation;
    const nextStarts = startsOf(automation, next.id);
    const restStarts = rest.map((each) => ({ ...each, starts: startsOf(automation, each.id) }));
    const base = { ...automation };
    delete base.triggerStarts;
    delete base.moreTriggers;
    return tidyTriggers({
      ...base,
      trigger: next.trigger,
      triggerStarts: nextStarts,
      ...(restStarts.length > 0 ? { moreTriggers: restStarts } : {}),
    } as T);
  }
  const firstNow = startsOf(automation, FIRST_TRIGGER);
  return tidyTriggers({
    ...automation,
    triggerStarts: firstNow,
    moreTriggers: more.filter((each) => each.id !== id),
  });
}

/** Changes what the trigger `id` is, keeping what it starts. */
export function replaceTrigger<T extends WithTriggers>(
  automation: T,
  id: string,
  trigger: StarterTrigger,
): T {
  if (id === FIRST_TRIGGER) return { ...automation, trigger };
  return {
    ...automation,
    moreTriggers: (automation.moreTriggers ?? []).map((each) =>
      each.id === id ? { ...each, trigger } : each,
    ),
  };
}

/** Kinds that can only be on an automation once: there is one address and one button. */
const ONCE_ONLY: StarterTrigger["kind"][] = ["webhook", "manual"];

/** What is wrong with how the triggers are set up, in plain words. Null when nothing. */
export function triggersProblem(automation: WithTriggers): string | null {
  const all = triggersOf(automation);
  if (all.length > MAX_TRIGGERS) return `An automation can have at most ${MAX_TRIGGERS} triggers.`;
  for (const kind of ONCE_ONLY) {
    if (all.filter((each) => each.trigger.kind === kind).length > 1) {
      return kind === "webhook"
        ? "An automation can have only one webhook trigger, since it has one address."
        : "An automation needs only one Run now trigger.";
    }
  }
  if (all.length > 1) {
    const idle = all.find((each) => startsOf(automation, each.id).length === 0);
    if (idle && automation.nodes.length > 0) {
      return "One of the triggers is not connected to a step. Connect it, or remove it.";
    }
    if (unstartedSteps(automation).length > 0) {
      return "A step at the start is not connected to any trigger. Connect one to it.";
    }
  }
  return null;
}
