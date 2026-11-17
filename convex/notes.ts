import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { isMember, requireMember } from "./lib/authz";

/**
 * Sticky notes on an automation's canvas. They explain part of an automation to the
 * team and never change what it does, so they are not part of its versions or drafts:
 * each change is kept as it is made, and teammates see it straight away.
 */

export const MAX_NOTES = 30;
export const MAX_NOTE_CHARS = 2000;
const DEFAULT_SIZE = { width: 220, height: 140 };
export const MIN_WIDTH = 120;
export const MIN_HEIGHT = 80;
export const MAX_SIDE = 800;

const noteValidator = v.object({
  _id: v.id("automationNotes"),
  text: v.string(),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});

function shown(note: Doc<"automationNotes">) {
  const { _id, text, x, y, width, height } = note;
  return { _id, text, x, y, width, height };
}

async function automationFor(ctx: QueryCtx | MutationCtx, automationId: Id<"automations">) {
  const automation = await ctx.db.get(automationId);
  if (!automation) {
    throw new ConvexError({ code: "not_found", message: "This automation no longer exists." });
  }
  await requireMember(ctx, automation.organizationId);
  return automation;
}

async function noteFor(ctx: MutationCtx, noteId: Id<"automationNotes">) {
  const note = await ctx.db.get(noteId);
  if (!note) throw new ConvexError({ code: "not_found", message: "This note was removed." });
  await requireMember(ctx, note.organizationId);
  return note;
}

const finite = (value: number) => Number.isFinite(value) && Math.abs(value) < 1_000_000;

export const list = query({
  args: { automationId: v.id("automations") },
  returns: v.array(noteValidator),
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation || !(await isMember(ctx, automation.organizationId))) return [];
    const notes = await ctx.db
      .query("automationNotes")
      .withIndex("by_automation", (q) => q.eq("automationId", args.automationId))
      .take(MAX_NOTES);
    return notes.map(shown);
  },
});

export const add = mutation({
  args: { automationId: v.id("automations"), x: v.number(), y: v.number() },
  returns: v.id("automationNotes"),
  handler: async (ctx, args) => {
    const automation = await automationFor(ctx, args.automationId);
    const userId = (await requireMember(ctx, automation.organizationId)).userId;
    const existing = await ctx.db
      .query("automationNotes")
      .withIndex("by_automation", (q) => q.eq("automationId", args.automationId))
      .take(MAX_NOTES);
    if (existing.length >= MAX_NOTES) {
      throw new ConvexError({
        code: "invalid_input",
        message: `An automation can have at most ${MAX_NOTES} notes.`,
      });
    }
    if (!finite(args.x) || !finite(args.y)) {
      throw new ConvexError({
        code: "invalid_input",
        message: "That is not a place on the canvas.",
      });
    }
    return await ctx.db.insert("automationNotes", {
      organizationId: automation.organizationId,
      automationId: args.automationId,
      text: "",
      x: Math.round(args.x),
      y: Math.round(args.y),
      ...DEFAULT_SIZE,
      createdBy: userId,
      updatedAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    noteId: v.id("automationNotes"),
    text: v.optional(v.string()),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await noteFor(ctx, args.noteId);
    const { noteId, text, ...place } = args;
    const patch: Partial<Doc<"automationNotes">> = { updatedAt: Date.now() };
    if (text !== undefined) {
      if (text.length > MAX_NOTE_CHARS) {
        throw new ConvexError({
          code: "invalid_input",
          message: `A note can be at most ${MAX_NOTE_CHARS} characters.`,
        });
      }
      patch.text = text;
    }
    for (const [key, value] of Object.entries(place)) {
      if (value === undefined) continue;
      if (!finite(value)) {
        throw new ConvexError({
          code: "invalid_input",
          message: "That is not a place on the canvas.",
        });
      }
      const smallest = key === "width" ? MIN_WIDTH : key === "height" ? MIN_HEIGHT : null;
      patch[key as "x" | "y" | "width" | "height"] =
        smallest === null
          ? Math.round(value)
          : Math.min(MAX_SIDE, Math.max(smallest, Math.round(value)));
    }
    await ctx.db.patch(noteId, patch);
    return null;
  },
});

export const remove = mutation({
  args: { noteId: v.id("automationNotes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await noteFor(ctx, args.noteId);
    await ctx.db.delete(args.noteId);
    return null;
  },
});

/** Removes every note on an automation, when the automation itself is deleted. */
export async function deleteNotes(ctx: MutationCtx, automationId: Id<"automations">) {
  const notes = await ctx.db
    .query("automationNotes")
    .withIndex("by_automation", (q) => q.eq("automationId", automationId))
    .take(MAX_NOTES * 2);
  for (const note of notes) await ctx.db.delete(note._id);
}
