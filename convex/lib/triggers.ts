// Automations with more than one trigger (automation-core triggers.ts): finding the ones a
// trigger kind should start, and the schedule and folder bookkeeping for each trigger.
import {
  FIRST_TRIGGER,
  hasMoreTriggers,
  nextRunAt,
  type StarterTrigger,
  triggersOf,
} from "@takewon/automation-core";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

type Kind = StarterTrigger["kind"];
type Triggers = Pick<Doc<"automations">, "trigger" | "moreTriggers">;

/** The automation's triggers of one kind, with their ids, the first one first. */
export function triggersOfKind<K extends Kind>(
  automation: Triggers,
  kind: K,
): { id: string; trigger: Extract<StarterTrigger, { kind: K }> }[] {
  return triggersOf(automation as Parameters<typeof triggersOf>[0]).filter(
    (each): each is { id: string; trigger: Extract<StarterTrigger, { kind: K }> } =>
      each.trigger.kind === kind,
  );
}

/** Whether any of the automation's triggers is of this kind. */
export function hasTriggerOf(automation: Triggers, kind: Kind): boolean {
  return triggersOfKind(automation, kind).length > 0;
}

// A team has far fewer switched-on automations of one trigger kind than this.
const TEAM_LIMIT = 1000;

/**
 * The team's switched-on automations with a trigger of this kind: those whose first
 * trigger is one, and those with more than one trigger where another is. Reads only this
 * team's automations, so it finds them all however many teams there are.
 */
export async function teamEnabledWithTrigger(
  ctx: QueryCtx,
  organizationId: string,
  kind: Kind,
): Promise<Doc<"automations">[]> {
  const first = await ctx.db
    .query("automations")
    .withIndex("by_organization_and_enabled_and_trigger_kind", (q) =>
      q.eq("organizationId", organizationId).eq("enabled", true).eq("trigger.kind", kind),
    )
    .take(TEAM_LIMIT);
  const several = await ctx.db
    .query("automations")
    .withIndex("by_organization_and_enabled_and_multiTrigger", (q) =>
      q.eq("organizationId", organizationId).eq("enabled", true).eq("multiTrigger", true),
    )
    .take(TEAM_LIMIT);
  const seen = new Set(first.map((automation) => automation._id));
  return [
    ...first,
    ...several.filter((automation) => !seen.has(automation._id) && hasTriggerOf(automation, kind)),
  ];
}

/**
 * One page of every team's switched-on automations with a trigger of this kind, for the
 * checks that look at all of them (watched folders). "first" pages through those whose
 * first trigger is of the kind, "several" through those with more than one trigger, where
 * one that also has a first trigger of the kind is left out so it comes once.
 */
export async function enabledWithTriggerPage(
  ctx: QueryCtx,
  kind: Kind,
  source: "first" | "several",
  cursor: string | null,
  numItems: number,
): Promise<{ page: Doc<"automations">[]; continueCursor: string; isDone: boolean }> {
  if (source === "first") {
    return await ctx.db
      .query("automations")
      .withIndex("by_enabled_and_trigger_kind", (q) =>
        q.eq("enabled", true).eq("trigger.kind", kind),
      )
      .paginate({ cursor, numItems });
  }
  const result = await ctx.db
    .query("automations")
    .withIndex("by_enabled_and_multiTrigger", (q) => q.eq("enabled", true).eq("multiTrigger", true))
    .paginate({ cursor, numItems });
  return {
    ...result,
    page: result.page.filter(
      (automation) => automation.trigger.kind !== kind && hasTriggerOf(automation, kind),
    ),
  };
}

/**
 * When each schedule trigger next fires, keeping the times of those that already had one
 * (so publishing a change does not move them), and the soonest of them.
 */
export function scheduleTimesOf(
  automation: Pick<Doc<"automations">, "nextRunAt" | "scheduleTimes"> | null,
  version: Triggers,
  enabled: boolean,
  now = Date.now(),
  fired: string[] = [],
): { nextRunAt: number | null; scheduleTimes?: { triggerId: string; at: number }[] } {
  const schedules = enabled ? triggersOfKind(version, "schedule") : [];
  if (schedules.length === 0) return { nextRunAt: null, scheduleTimes: undefined };
  const times = schedules.map(({ id, trigger }) => {
    const known =
      automation && !fired.includes(id)
        ? (automation.scheduleTimes?.find((each) => each.triggerId === id)?.at ?? null)
        : null;
    return { triggerId: id, at: known ?? nextRunAt(trigger.schedule, now) };
  });
  const soonest = Math.min(...times.map((each) => each.at));
  // One schedule, as the first trigger: stored the way it always was.
  if (times.length === 1 && times[0].triggerId === FIRST_TRIGGER) {
    return { nextRunAt: soonest, scheduleTimes: undefined };
  }
  return { nextRunAt: soonest, scheduleTimes: times };
}

/** When each schedule trigger of a switched-on automation is due, as stored. */
export function dueSchedules(
  automation: Doc<"automations">,
  now: number,
): { id: string; at: number }[] {
  const schedules = triggersOfKind(automation, "schedule");
  if (!automation.scheduleTimes) {
    const first = schedules.find((each) => each.id === FIRST_TRIGGER);
    return first && automation.nextRunAt !== null && automation.nextRunAt <= now
      ? [{ id: FIRST_TRIGGER, at: automation.nextRunAt }]
      : [];
  }
  return automation.scheduleTimes
    .filter((each) => each.at <= now && schedules.some((s) => s.id === each.triggerId))
    .map((each) => ({ id: each.triggerId, at: each.at }));
}

/** The trigger fields to store with a live version. */
export function multiTriggerOf(version: Triggers): boolean | undefined {
  return hasMoreTriggers(version as Parameters<typeof hasMoreTriggers>[0]) ? true : undefined;
}

/** A watched folder starts counting from the moment it is switched on, or added. */
export function watchStartOf(
  automation: Doc<"automations">,
  version: Triggers,
  enabled: boolean,
): number | undefined {
  const folders = triggersOfKind(version, "folder");
  if (!enabled || folders.length === 0) return undefined;
  const before = new Set(triggersOfKind(automation, "folder").map((each) => each.trigger.prefix));
  const same = automation.enabled && folders.every((each) => before.has(each.trigger.prefix));
  return same ? (automation.watchFrom ?? Date.now()) : Date.now();
}
