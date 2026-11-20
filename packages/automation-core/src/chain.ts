/**
 * Automations that start other automations: a "Run an automation" step hands its files
 * to another automation and, if asked, waits for that run's finished files; a "When
 * another automation finishes" trigger starts an automation once another one's run ends.
 *
 * Two guards keep this from running forever. When an automation is saved, the links
 * between all of a team's automations are followed, and a link that would lead back to
 * where it started is refused (`chainLoop`). And every run remembers which automations
 * started it, so a run is never started for one of them again, nor deeper than
 * MAX_CHAIN_DEPTH (`chainProblem`).
 */
import type { AutomationNode } from "./graph";
import type { StarterTrigger } from "./starters";

/** How many automations deep one chain of runs can go, counting the first. */
export const MAX_CHAIN_DEPTH = 5;

/** Which ends of another automation's run start a follower. */
export const FINISH_CHOICES = ["done", "failed", "either"] as const;
export type FinishChoice = (typeof FINISH_CHOICES)[number];

export const FINISH_WORDS: Record<FinishChoice, string> = {
  done: "finishes without a problem",
  failed: "fails",
  either: "finishes, whether it worked or failed",
};

export type FinishedTrigger = Extract<StarterTrigger, { kind: "finished" }>;

/** The automation a "Run an automation" step runs, or null while none is picked. */
export function targetOf(node: Pick<AutomationNode, "kind" | "input">): string | null {
  if (node.kind !== "automation") return null;
  const id = node.input.automation;
  return typeof id === "string" && id !== "" ? id : null;
}

/** Whether a "Run an automation" step waits for the other run and hands on its files. */
export function waitsForRun(node: Pick<AutomationNode, "input">): boolean {
  return node.input.wait !== false;
}

/** Whether a run that ended this way starts an automation that follows with `trigger`. */
export function followsEnd(trigger: FinishedTrigger, status: "done" | "failed"): boolean {
  const when: FinishChoice = FINISH_CHOICES.includes(trigger.when) ? trigger.when : "done";
  return when === "either" || when === status;
}

/** What is wrong with a "When another automation finishes" trigger, or null. */
export function followProblem(trigger: StarterTrigger): string | null {
  if (trigger.kind !== "finished") return null;
  if (!trigger.automationId) return "Pick which automation it waits for.";
  if (!FINISH_CHOICES.includes(trigger.when)) return "Pick when it starts.";
  return null;
}

/** One automation, as far as the links between automations go. */
export interface ChainMember {
  id: string;
  name: string;
  trigger: StarterTrigger;
  nodes: Pick<AutomationNode, "kind" | "input">[];
}

/**
 * The automations each one can start: those its "Run an automation" steps run, and
 * those whose trigger follows it.
 */
export function chainLinks(members: ChainMember[]): Map<string, Set<string>> {
  const links = new Map<string, Set<string>>(members.map((member) => [member.id, new Set()]));
  const add = (from: string, to: string) => {
    if (!links.has(from)) links.set(from, new Set());
    links.get(from)!.add(to);
  };
  for (const member of members) {
    for (const node of member.nodes) {
      const target = targetOf(node);
      if (target) add(member.id, target);
    }
    if (member.trigger.kind === "finished" && member.trigger.automationId) {
      add(member.trigger.automationId, member.id);
    }
  }
  return links;
}

/**
 * The names along a loop that runs through `id`, starting and ending with it, such as
 * ["Clips", "Captions", "Clips"]. Null when nothing it starts can lead back to it.
 */
export function chainLoop(id: string, members: ChainMember[]): string[] | null {
  const links = chainLinks(members);
  const names = new Map(members.map((member) => [member.id, member.name]));
  const nameOf = (step: string) => names.get(step) ?? "an automation that was deleted";
  // Breadth first from what `id` starts, so the shortest loop is the one shown.
  const cameFrom = new Map<string, string>();
  const queue: string[] = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of links.get(current) ?? []) {
      if (next === id) {
        const path = [id];
        for (let at = current; at !== id; at = cameFrom.get(at)!) path.unshift(at);
        path.unshift(id);
        return path.map(nameOf);
      }
      if (!cameFrom.has(next)) {
        cameFrom.set(next, current);
        queue.push(next);
      }
    }
  }
  return null;
}

/** The loop as a sentence for the person who made it. */
export function loopWords(path: string[]): string {
  return path.length <= 2
    ? `${path[0]} cannot start itself.`
    : `This would make automations start each other in a loop: ${path.join(" → ")}. Remove one of those links.`;
}

/**
 * Why a run of `target` cannot be started from a run whose chain is `chain` (the
 * automations that started it, the first one first, itself last). Null when it can.
 */
export function chainProblem(chain: string[], target: string, targetName: string): string | null {
  if (chain.includes(target)) {
    return `${targetName} is already part of this chain of runs, so it was not started again.`;
  }
  if (chain.length >= MAX_CHAIN_DEPTH) {
    return `Runs can start other runs at most ${MAX_CHAIN_DEPTH} automations deep, so ${targetName} was not started.`;
  }
  return null;
}

/** How one automation starts another on the chain view. */
export type ChainLinkHow = FinishChoice | "step";

export interface ChainViewLink {
  from: string;
  to: string;
  how: ChainLinkHow;
}

/**
 * Every automation linked to `startId`, however far away and in either direction, laid
 * out for showing them together: `columns` lists them from the ones nothing starts to the
 * last ones started, each column in the order the team's automations were given. A link
 * to an automation that was deleted is left out.
 */
export function chainGroup(
  members: ChainMember[],
  startId: string,
): { columns: string[][]; links: ChainViewLink[] } {
  const known = new Set(members.map((member) => member.id));
  if (!known.has(startId)) return { columns: [], links: [] };
  const all: ChainViewLink[] = [];
  for (const member of members) {
    for (const node of member.nodes) {
      const target = targetOf(node);
      if (target && known.has(target)) all.push({ from: member.id, to: target, how: "step" });
    }
    if (
      member.trigger.kind === "finished" &&
      member.trigger.automationId &&
      known.has(member.trigger.automationId)
    ) {
      const when = FINISH_CHOICES.includes(member.trigger.when) ? member.trigger.when : "done";
      all.push({ from: member.trigger.automationId, to: member.id, how: when });
    }
  }
  // Everything reachable from where it starts, following links either way.
  const group = new Set([startId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const link of all) {
      if (group.has(link.from) !== group.has(link.to)) {
        group.add(link.from);
        group.add(link.to);
        grew = true;
      }
    }
  }
  const links = all.filter(
    (link, index) =>
      group.has(link.from) &&
      all.findIndex((other) => other.from === link.from && other.to === link.to) === index,
  );
  // Each one sits one column after the furthest one that starts it. Saving refuses loops,
  // but the depth is capped in case an old one is still there.
  const depth = new Map([...group].map((id) => [id, 0]));
  for (let pass = 0; pass < group.size; pass++) {
    let moved = false;
    for (const link of links) {
      const next = depth.get(link.from)! + 1;
      if (next > depth.get(link.to)! && next < group.size) {
        depth.set(link.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const columns: string[][] = [];
  for (const member of members) {
    if (!group.has(member.id)) continue;
    const at = depth.get(member.id)!;
    (columns[at] ??= []).push(member.id);
  }
  return { columns: columns.filter((column) => column !== undefined), links };
}
