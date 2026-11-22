import { z } from "zod";

/**
 * What a trigger must look like before it goes to Convex (`triggerValidator` in
 * convex/schema.ts; keep the two in step). Convex checks it too, but a deployed backend
 * hides why it refused ("Server Error"), so the model kept guessing. Checked here, a
 * wrong trigger comes back with the reason, settings it may leave out get their default
 * (an upload or folder trigger takes any file), and settings no trigger has are dropped.
 */
const fileType = z.enum(["any", "video", "audio", "image"]).default("any");
const deliverableKind = z.enum(["video", "short", "thumbnail", "audio", "other"]);

const TRIGGERS = {
  manual: z.object({ kind: z.literal("manual") }),
  webhook: z.object({ kind: z.literal("webhook") }),
  schedule: z.object({
    kind: z.literal("schedule"),
    schedule: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("interval"), minutes: z.number() }),
      z.object({ mode: z.literal("daily"), time: z.string(), timeZone: z.string() }),
    ]),
  }),
  upload: z.object({
    kind: z.literal("upload"),
    fileType,
    minSeconds: z.number().optional(),
    maxSeconds: z.number().optional(),
  }),
  folder: z.object({
    kind: z.literal("folder"),
    prefix: z.string(),
    fileType,
    layout: z.literal("creators").optional(),
  }),
  finished: z.object({
    kind: z.literal("finished"),
    automationId: z.string().default(""),
    when: z.enum(["done", "failed", "either"]).default("done"),
  }),
  slot: z.object({
    kind: z.literal("slot"),
    status: z.enum(["todo", "in_progress", "review", "approved", "published"]),
    slotKind: z.union([z.literal("any"), deliverableKind]).default("any"),
  }),
} as const;

export class TriggerShapeError extends Error {}

/** The trigger as Convex takes it, or a TriggerShapeError that says what is wrong. */
export function triggerAsSent(trigger: { kind: string } & Record<string, unknown>) {
  const kind = trigger.kind.startsWith("trigger:")
    ? trigger.kind.slice("trigger:".length)
    : trigger.kind;
  const shape = TRIGGERS[kind as keyof typeof TRIGGERS];
  if (!shape) {
    throw new TriggerShapeError(
      `There is no trigger "${kind}". It is one of: ${Object.keys(TRIGGERS).join(", ")}.`,
    );
  }
  const parsed = shape.safeParse({ ...trigger, kind });
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join(".") : "the trigger";
    return `${where}: ${issue.message}`;
  });
  throw new TriggerShapeError(
    `The ${kind} trigger is not right: ${problems.join("; ")}. See list_step_types for trigger:${kind}.`,
  );
}
