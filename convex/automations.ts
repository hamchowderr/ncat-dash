import {
  applyOperations,
  type AutomationDraft,
  automationFileName,
  type AutomationEdge,
  type AutomationNode,
  type Brand,
  BRAND_WORDS,
  canonical,
  type ChainMember,
  chainLoop,
  draftProblems,
  followOnsByEnd,
  followOnsFor,
  followOnTrigger,
  followProblem,
  isFollowOn,
  loopWords,
  targetOf,
  getNodeType,
  exportAutomation,
  getPlatform,
  graphProblem,
  logicProblem,
  MAX_AUTOMATION_FILE_CHARS,
  missingBrandOf,
  withinLength,
  missingSettings,
  nextRunAt,
  platformGuideText,
  nodeTypeIndex,
  nodeTypeOf,
  OperationError,
  outline,
  readAutomationFile,
  scheduleProblem,
  starterOf,
  STARTERS,
} from "@ncat-dash/automation-core";
import { getStep } from "@ncat-dash/step-catalog";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { getCaller } from "./lib/caller";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { membersOf } from "./lib/approvals";
import { isMember, requireMember } from "./lib/authz";
import { brandAndMusicOf, brandOf } from "./lib/queue";
import { startRun } from "./lib/runner";
import { withTeamSteps } from "./lib/teamSteps";
import { deleteVersions, recordVersion } from "./lib/versions";
import { deleteNotes, notesOf } from "./notes";
import { bucketOf, presign, storageConnection } from "./lib/bucket";
import { edgeValidator, nodeValidator, operationValidator, triggerValidator } from "./schema";

const READ_LINK_SECONDS = 7 * 24 * 60 * 60;

export function randomToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

async function loadForMember(
  ctx: Parameters<typeof requireMember>[0],
  automationId: Doc<"automations">["_id"],
) {
  const automation = await ctx.db.get(automationId);
  if (!automation) fail("not_found", "This automation no longer exists.");
  const member = await requireMember(ctx, automation.organizationId);
  return { automation, ...member };
}

type Version = Pick<Doc<"automations">, "name" | "trigger" | "nodes" | "edges">;

function versionOf(source: Version): Version {
  return { name: source.name, trigger: source.trigger, nodes: source.nodes, edges: source.edges };
}

/** What the editor and the agent work on: the draft when there is one, else the live version. */
function workingCopy(automation: Doc<"automations">): Version {
  return versionOf(automation.draft ?? automation);
}

/** A watched folder starts counting from the moment it is switched on. */
function watchStart(
  automation: Doc<"automations">,
  trigger: Doc<"automations">["trigger"],
  enabled: boolean,
): number | undefined {
  if (!enabled || trigger.kind !== "folder") return undefined;
  const same =
    automation.enabled &&
    automation.trigger.kind === "folder" &&
    automation.trigger.prefix === trigger.prefix;
  return same ? (automation.watchFrom ?? Date.now()) : Date.now();
}

export async function storageProblem(
  ctx: Parameters<typeof requireMember>[0],
  organizationId: string,
  trigger: Doc<"automations">["trigger"],
): Promise<string | null> {
  if (trigger.kind !== "folder" && trigger.kind !== "upload") return null;
  const storage = await storageConnection(ctx, organizationId);
  return storage ? null : "Connect your toolkit from Home first.";
}

function scheduledNext(trigger: Doc<"automations">["trigger"], enabled: boolean): number | null {
  return enabled && trigger.kind === "schedule" ? nextRunAt(trigger.schedule, Date.now()) : null;
}

/** Problems that stop an automation being switched on or run. Null when there are none. */
export function automationProblem(
  trigger: Doc<"automations">["trigger"],
  nodes: AutomationNode[],
  edges: AutomationEdge[],
  brand: Brand,
): string | null {
  const graph = graphProblem(nodes, edges);
  if (graph) return graph;
  for (const node of nodes) {
    if (node.kind === "step" && !getStep(node.stepId ?? "")) {
      return "One of the steps is no longer in the catalog.";
    }
    if (node.kind === "clips" && !getPlatform(node.input.platform)) {
      return "Pick a platform for the clips.";
    }
    const nodeType = nodeTypeOf(node);
    const title = node.label ?? nodeType?.title ?? "A step";
    const fromBrand = nodeType ? missingBrandOf(nodeType, node.input, brand) : [];
    if (fromBrand.length > 0) {
      return `${title} needs your team's ${fromBrand.map((key) => BRAND_WORDS[key]).join(" and ")}. Add it in Settings, under Brand.`;
    }
    if (missingSettings(node, brand).length > 0) {
      return `${title} still needs its settings. Select it on the canvas.`;
    }
    const logic = logicProblem(node);
    if (logic) return `${title}: ${logic}`;
  }
  if (trigger.kind === "schedule") return scheduleProblem(trigger.schedule);
  if (trigger.kind === "finished") return followProblem(trigger);
  if (trigger.kind === "folder" && trigger.prefix.length > 500)
    return "That folder name is too long.";
  return null;
}

/** A team's automations with the state of each one's latest run. */
export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const automations = await ctx.db
      .query("automations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(100);
    return await Promise.all(
      automations.map(async (automation) => {
        const lastRun = await ctx.db
          .query("runs")
          .withIndex("by_automation", (q) => q.eq("automationId", automation._id))
          .order("desc")
          .first();
        return {
          _id: automation._id,
          name: automation.name,
          enabled: automation.enabled,
          // True when there are changes that have not been published yet.
          hasDraft: automation.draft !== undefined,
          trigger: automation.trigger,
          stepCount: automation.nodes.length,
          nodes: automation.nodes,
          edges: automation.edges,
          nextRunAt: automation.nextRunAt,
          updatedAt: automation.updatedAt,
          lastRun: lastRun
            ? { _id: lastRun._id, status: lastRun.status, startedAt: lastRun._creationTime }
            : null,
        };
      }),
    );
  },
});

export const get = query({
  args: { automationId: v.id("automations") },
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation) return null;
    // Someone who is not on the team sees the same as for a deleted automation.
    if (!(await isMember(ctx, automation.organizationId))) return null;
    const draft = automation.draft;
    return {
      _id: automation._id,
      // The version being worked on: the draft when there is one, else the live version.
      ...workingCopy(automation),
      enabled: automation.enabled,
      // The client it works for; null when it is for the team itself.
      clientId: automation.clientId ?? null,
      // The version triggers run, when the canvas is showing a draft of something else.
      // Null when what is above is the live version.
      live: draft ? versionOf(automation) : null,
      // When the draft began as an earlier version brought back, that version's number.
      restoredFrom: draft?.restoredFrom ?? null,
      // Team members need the full address to give to whatever calls it.
      hookToken: automation.hookToken,
      nextRunAt: automation.nextRunAt,
      updatedAt: automation.updatedAt,
    };
  },
});

export const create = mutation({
  args: { organizationId: v.string(), name: v.string(), starterId: v.optional(v.string()) },
  returns: v.id("automations"),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    return await createAutomation(ctx, args.organizationId, userId, args.name, args.starterId);
  },
});

/** Makes a new automation, switched off: empty, or from a ready-made one. */
async function createAutomation(
  ctx: MutationCtx,
  organizationId: string,
  userId: string,
  givenName: string,
  starterId?: string,
) {
  const starter = starterId ? STARTERS.find((s) => s.id === starterId) : undefined;
  if (starterId && !starter) fail("not_found", "Unknown starter.");
  const name = (givenName.trim() || starter?.name || "").slice(0, 80);
  if (!name) fail("invalid_input", "Give the automation a name.");
  // A follow-on is wired to the team's newest automation it is made to run after, if any.
  const followed =
    starter && isFollowOn(starter) ? await followedBy(ctx, organizationId, starter.follows!) : null;
  const content = {
    name,
    trigger: starter
      ? followed
        ? followOnTrigger(starter, followed)
        : starter.trigger
      : ({ kind: "manual" } as const),
    nodes: starter?.nodes ?? [],
    edges: starter?.edges ?? [],
  };
  const automationId = await ctx.db.insert("automations", {
    organizationId,
    ...content,
    ...(starter ? { starterId: starter.id } : {}),
    enabled: false,
    hookToken: randomToken(),
    nextRunAt: null,
    createdBy: userId,
    updatedAt: Date.now(),
  });
  await recordVersion(ctx, { _id: automationId, organizationId }, content, {
    userId,
    source: "created",
  });
  return automationId;
}

/**
 * The team's most recently changed automation made from one of `starterIds`, earlier ones
 * in the list first, or null when the team has none of them.
 */
export async function followedBy(
  ctx: QueryCtx,
  organizationId: string,
  starterIds: string[],
): Promise<string | null> {
  const team = await ctx.db
    .query("automations")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(500);
  for (const id of starterIds) {
    const made = team
      .filter((automation) => starterOf(automation) === id)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (made) return made._id;
  }
  return null;
}

const followOnsValidator = v.object({
  // The team's automations that already start when this one finishes.
  following: v.array(
    v.object({
      automationId: v.id("automations"),
      name: v.string(),
      enabled: v.boolean(),
      when: v.union(v.literal("done"), v.literal("failed"), v.literal("either")),
    }),
  ),
  // Ready-made automations made to run after this one that the team has not set up after it.
  suggestions: v.array(v.string()),
});

/**
 * What goes on after an automation: the team's automations that already start when it
 * finishes, and the ready-made follow-ons that suit it and are not set up after it yet.
 */
export const followOns = query({
  args: { automationId: v.id("automations") },
  returns: followOnsValidator,
  handler: async (ctx, args) => {
    const { automation } = await loadForMember(ctx, args.automationId);
    return await followOnsOf(ctx, automation);
  },
});

async function followOnsOf(ctx: QueryCtx, automation: Doc<"automations">) {
  const team = await ctx.db
    .query("automations")
    .withIndex("by_organization", (q) => q.eq("organizationId", automation.organizationId))
    .take(500);
  return followOnsAmong(team, automation);
}

/** What `followOns` says about `automation`, given all of its team's automations. */
function followOnsAmong(team: Doc<"automations">[], automation: Doc<"automations">) {
  const following = team.flatMap((other) => {
    const { trigger } = workingCopy(other);
    return trigger.kind === "finished" && trigger.automationId === automation._id
      ? [{ automationId: other._id, name: other.name, enabled: other.enabled, when: trigger.when }]
      : [];
  });
  const setUp = new Set(
    following.flatMap(({ automationId }) => {
      const other = team.find((each) => each._id === automationId);
      return other ? [starterOf(other)] : [];
    }),
  );
  const working = workingCopyWithStarter(automation);
  const starterId = starterOf(working);
  // Made from a ready-made: the follow-ons made for it. Otherwise: those that suit its end.
  const fitting = starterId
    ? followOnsFor(starterId)
    : working.trigger.kind === "finished"
      ? []
      : followOnsByEnd(working.nodes, working.edges);
  const suggestions = fitting.map((starter) => starter.id).filter((id) => !setUp.has(id));
  return { following, suggestions };
}

/**
 * For the home page: a few follow-ons that would carry on from the team's automations that
 * are on, one per automation first and no ready-made twice.
 */
export const teamFollowOns = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      automationId: v.id("automations"),
      automationName: v.string(),
      starterId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const team = await ctx.db
      .query("automations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(500);
    const on = team
      .filter((automation) => automation.enabled)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const picked: { automationId: Id<"automations">; automationName: string; starterId: string }[] =
      [];
    const used = new Set<string>();
    for (const automation of on) {
      const next = followOnsAmong(team, automation).suggestions.find((id) => !used.has(id));
      if (!next) continue;
      used.add(next);
      picked.push({
        automationId: automation._id,
        automationName: automation.name,
        starterId: next,
      });
      if (picked.length === 3) break;
    }
    return picked;
  },
});

function workingCopyWithStarter(automation: Doc<"automations">) {
  return { ...workingCopy(automation), starterId: automation.starterId };
}

/**
 * Makes a ready-made follow-on that starts when `automationId` finishes, built and wired
 * in one go. It is switched on unless something it needs, such as a logo, is missing.
 */
const madeFollowOnValidator = v.object({
  automationId: v.id("automations"),
  // Switched on straight away, unless something it needs is missing: then `problem` says what.
  on: v.boolean(),
  problem: v.union(v.null(), v.string()),
});

export const setUpFollowOn = mutation({
  args: { automationId: v.id("automations"), starterId: v.string() },
  returns: madeFollowOnValidator,
  handler: async (ctx, args) => {
    const { automation, userId } = await loadForMember(ctx, args.automationId);
    return await makeFollowOn(ctx, automation, userId, args.starterId);
  },
});

async function makeFollowOn(
  ctx: MutationCtx,
  automation: Doc<"automations">,
  userId: string,
  starterId: string,
) {
  const starter = STARTERS.find((each) => each.id === starterId);
  if (!starter) fail("not_found", "Unknown starter.");
  if (!isFollowOn(starter)) {
    fail("invalid_input", `${starter.name} starts by itself, not after another automation.`);
  }
  const team = await ctx.db
    .query("automations")
    .withIndex("by_organization", (q) => q.eq("organizationId", automation.organizationId))
    .take(500);
  // Two of the same follow-on, after different automations, are told apart by name.
  const taken = team.some((other) => other.name === starter.name);
  const name = (taken ? `${starter.name} after ${automation.name}` : starter.name).slice(0, 80);
  const content = {
    name,
    trigger: followOnTrigger(starter, automation._id),
    nodes: starter.nodes,
    edges: starter.edges,
  };
  const brand = await brandOf(ctx, automation.organizationId, automation.clientId);
  const problem = automationProblem(content.trigger, content.nodes, content.edges, brand);
  const automationId = await ctx.db.insert("automations", {
    organizationId: automation.organizationId,
    ...content,
    // Made for the same client, it uses that client's brand like the one it follows.
    ...(automation.clientId ? { clientId: automation.clientId } : {}),
    starterId: starter.id,
    enabled: problem === null,
    hookToken: randomToken(),
    nextRunAt: null,
    createdBy: userId,
    updatedAt: Date.now(),
  });
  await recordVersion(
    ctx,
    { _id: automationId, organizationId: automation.organizationId },
    content,
    {
      userId,
      source: "created",
    },
  );
  return { automationId, on: problem === null, problem };
}

const savedValidator = v.object({
  enabled: v.boolean(),
  // What stops this version running. Null when it is complete.
  problem: v.union(v.null(), v.string()),
  // True when the changes were kept as a draft and the live version is untouched.
  draft: v.boolean(),
  // What is wrong with the other automations it runs or follows, such as a loop. The
  // canvas cannot see the team's other automations, so it is told on every save.
  links: v.optional(v.union(v.null(), v.string())),
});

/**
 * An automation as a file: its name, what starts it, its steps and their connections.
 * Settings that point at the team's own uploads are left out, and `notes` says so.
 */
export const exportFile = query({
  args: { automationId: v.id("automations") },
  returns: v.object({ fileName: v.string(), file: v.any(), notes: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const { automation } = await loadForMember(ctx, args.automationId);
    const { file, notes } = exportAutomation(
      automation as AutomationDraft,
      await notesOf(ctx, automation._id),
    );
    return { fileName: automationFileName(automation.name), file, notes };
  },
});

/**
 * Makes a new automation from the contents of an exported file. Nothing in the file is
 * trusted: it is checked and rebuilt, and the automation starts switched off. `notes`
 * says what was changed or left out on the way.
 */
export const importFile = mutation({
  args: { organizationId: v.string(), file: v.any() },
  returns: v.object({ automationId: v.id("automations"), notes: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    if (JSON.stringify(args.file ?? null).length > MAX_AUTOMATION_FILE_CHARS) {
      fail("invalid_input", "This file is too large to be an automation.");
    }
    const read = readAutomationFile(args.file);
    if (!read.ok) fail("invalid_input", read.message);
    const automationId = await ctx.db.insert("automations", {
      organizationId: args.organizationId,
      name: read.draft.name,
      enabled: false,
      trigger: read.draft.trigger,
      nodes: read.draft.nodes,
      edges: read.draft.edges,
      hookToken: randomToken(),
      nextRunAt: null,
      createdBy: userId,
      updatedAt: Date.now(),
    });
    await recordVersion(
      ctx,
      { _id: automationId, organizationId: args.organizationId },
      read.draft,
      { userId, source: "imported" },
    );
    for (const note of read.canvasNotes) {
      await ctx.db.insert("automationNotes", {
        organizationId: args.organizationId,
        automationId,
        ...note,
        createdBy: userId,
        updatedAt: Date.now(),
      });
    }
    return { automationId, notes: read.notes };
  },
});

/**
 * Saves the canvas. A half-built automation can be saved; it only has to be complete to
 * be switched on, run or published. While the automation is on, or once it has a draft,
 * what is saved is the draft: the live version keeps running until `publish`.
 */
export const save = mutation({
  args: {
    automationId: v.id("automations"),
    name: v.string(),
    trigger: triggerValidator,
    nodes: v.array(nodeValidator),
    edges: v.array(edgeValidator),
  },
  returns: savedValidator,
  handler: async (ctx, args) => {
    const { automation, userId } = await loadForMember(ctx, args.automationId);
    const saved = await storeChanges(ctx, automation, args, userId);
    return { ...saved, links: await linkProblem(ctx, automation, checked(args)) };
  },
});

function checked(version: Version): Version {
  const name = version.name.trim().slice(0, 80);
  if (!name) fail("invalid_input", "Give the automation a name.");
  if (JSON.stringify(version.nodes).length > 400_000) {
    fail("invalid_input", "This automation's settings are too large to save.");
  }
  return { ...versionOf(version), name };
}

async function problemOf(
  ctx: MutationCtx,
  automation: Doc<"automations">,
  version: Version,
): Promise<string | null> {
  const { organizationId } = automation;
  await withTeamSteps(ctx, organizationId);
  return (
    automationProblem(
      version.trigger,
      version.nodes,
      version.edges,
      await brandOf(ctx, organizationId, automation.clientId),
    ) ??
    (await storageProblem(ctx, organizationId, version.trigger)) ??
    (await linkProblem(ctx, automation, version))
  );
}

/**
 * What is wrong with the other automations this one runs or follows: one that is gone,
 * or links that would make automations start each other in a loop.
 */
async function linkProblem(
  ctx: QueryCtx,
  automation: Doc<"automations">,
  version: Version,
): Promise<string | null> {
  const targets = version.nodes.flatMap((node) => targetOf(node) ?? []);
  const followed = version.trigger.kind === "finished" ? version.trigger.automationId : null;
  if (targets.length === 0 && !followed) return null;
  const team = await ctx.db
    .query("automations")
    .withIndex("by_organization", (q) => q.eq("organizationId", automation.organizationId))
    .take(500);
  const ids = new Set(team.map((other) => other._id as string));
  if (targets.some((id) => !ids.has(id))) {
    return "A Run an automation step points at an automation that no longer exists. Pick another.";
  }
  if (followed && !ids.has(followed)) {
    return "The automation this one waits for no longer exists. Pick another.";
  }
  // Every other automation as it will run (its draft too, which may be published later),
  // with this one as it is about to be saved.
  const members: ChainMember[] = team.flatMap((other) => {
    if (other._id === automation._id) return [];
    const versions = other.draft ? [other, other.draft] : [other];
    return versions.map((each) => ({
      id: other._id,
      name: other.name,
      trigger: each.trigger,
      nodes: each.nodes,
    }));
  });
  members.push({
    id: automation._id,
    name: version.name,
    trigger: version.trigger,
    nodes: version.nodes,
  });
  const loop = chainLoop(automation._id, members);
  return loop ? loopWords(loop) : null;
}

/**
 * Keeps an edit: as the draft when the automation is on or already has one, otherwise
 * straight into the live version. A draft that matches the live version is dropped.
 */
async function storeChanges(
  ctx: MutationCtx,
  automation: Doc<"automations">,
  changed: Version,
  userId: string,
  // Kept as a draft even when the automation is off, for changes someone else publishes.
  asDraft = false,
): Promise<{ enabled: boolean; problem: string | null; draft: boolean }> {
  const version = checked(changed);
  if (!asDraft && !automation.enabled && !automation.draft) {
    const stored = await storeLive(ctx, automation, version, { userId, source: "saved" });
    return { ...stored, draft: false };
  }
  const problem = await problemOf(ctx, automation, version);
  const same = canonical(version) === canonical(versionOf(automation));
  await ctx.db.patch(automation._id, {
    draft: same
      ? undefined
      : {
          ...version,
          updatedBy: userId,
          updatedAt: Date.now(),
          // Still based on the version it was brought back from, after more edits.
          ...(automation.draft?.restoredFrom !== undefined
            ? { restoredFrom: automation.draft.restoredFrom }
            : {}),
        },
  });
  return { enabled: automation.enabled, problem, draft: !same };
}

/**
 * Writes the live version, switching the automation off when it can no longer run, and
 * keeps it as a numbered version so it can be brought back later.
 */
async function storeLive(
  ctx: MutationCtx,
  automation: Doc<"automations">,
  version: Version,
  by: Parameters<typeof recordVersion>[3],
): Promise<{ enabled: boolean; problem: string | null }> {
  const problem = await problemOf(ctx, automation, version);
  const enabled = automation.enabled && problem === null;
  await ctx.db.patch(automation._id, {
    ...version,
    draft: undefined,
    enabled,
    nextRunAt: scheduledNext(version.trigger, enabled),
    watchFrom: watchStart(automation, version.trigger, enabled),
    updatedAt: Date.now(),
  });
  await recordVersion(ctx, automation, version, by);
  return { enabled, problem };
}

/**
 * Makes the draft the live version. An automation that is on stays on, so a draft that
 * could not run is refused and the live version carries on untouched.
 */
export const publish = mutation({
  args: { automationId: v.id("automations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { automation, userId } = await loadForMember(ctx, args.automationId);
    if (!automation.draft) return null;
    const version = checked(automation.draft);
    if (automation.enabled) {
      const problem = await problemOf(ctx, automation, version);
      if (problem) fail("invalid_input", problem);
    }
    await storeLive(ctx, automation, version, {
      userId,
      source: "published",
      restoredFrom: automation.draft.restoredFrom,
    });
    return null;
  },
});

/** Throws the draft away. The canvas goes back to the live version. */
export const discardDraft = mutation({
  args: { automationId: v.id("automations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await loadForMember(ctx, args.automationId);
    await ctx.db.patch(args.automationId, { draft: undefined });
    return null;
  },
});

const describedValidator = v.object({
  // The automation as short text: what starts it, then each step in running order.
  outline: v.string(),
  // What still stops it running. Empty when it can be switched on.
  problems: v.array(v.object({ nodeId: v.union(v.null(), v.string()), message: v.string() })),
  enabled: v.boolean(),
  // The team's music library: a track's name and the value to put in a music setting to
  // use it. A step that leaves the setting empty uses the first one.
  music: v.optional(v.array(v.object({ name: v.string(), value: v.string() }))),
  // True when what is described is a draft: the live version is different and keeps
  // running until `automations.publish`.
  draft: v.optional(v.boolean()),
  // The team, when the automation has an Approval step: put user ids in its `reviewers`
  // setting to name who decides. Owners and admins can always decide.
  team: v.optional(v.array(v.object({ userId: v.string(), name: v.string(), role: v.string() }))),
  // Ready-made automations that go well after this one and are not set up after it yet.
  // `automations.setUpFollowOn` makes one, wired to start when this one finishes.
  followOns: v.optional(
    v.array(v.object({ id: v.string(), name: v.string(), description: v.string() })),
  ),
});

/**
 * An automation as text, with what is still missing. This is what the agent reads before
 * it changes anything; the node types it can use are NODE_TYPES in automation-core.
 */
export const describe = query({
  args: { automationId: v.id("automations") },
  returns: describedValidator,
  handler: async (ctx, args) => {
    const { automation } = await loadForMember(ctx, args.automationId);
    return await describeAutomation(ctx, automation);
  },
});

async function describeAutomation(ctx: QueryCtx, automation: Doc<"automations">) {
  const draft = workingCopy(automation) as AutomationDraft;
  const { brand, music } = await brandAndMusicOf(
    ctx,
    automation.organizationId,
    automation.clientId,
  );
  return {
    outline: outline(draft, brand),
    problems: draftProblems(draft, brand),
    enabled: automation.enabled,
    draft: automation.draft !== undefined,
    music: music.map((track) => ({ name: track.name, value: track.file })),
    ...(await teamFor(ctx, automation.organizationId, draft)),
    ...(await suggestedAfter(ctx, automation)),
  };
}

async function suggestedAfter(ctx: QueryCtx, automation: Doc<"automations">) {
  const { suggestions } = await followOnsOf(ctx, automation);
  if (suggestions.length === 0) return {};
  return {
    followOns: suggestions.flatMap((id) => {
      const starter = STARTERS.find((each) => each.id === id);
      return starter ? [{ id, name: starter.name, description: starter.description }] : [];
    }),
  };
}

// For the MCP server (mcp.ts), which has already checked who is asking and their team.
// Changes it makes are always kept as a draft, for someone to publish in the dashboard.

async function teamAutomation(ctx: QueryCtx, organizationId: string, automationId: string) {
  const id = ctx.db.normalizeId("automations", automationId);
  const automation = id ? await ctx.db.get(id) : null;
  if (!automation || automation.organizationId !== organizationId) {
    fail(
      "not_found",
      "There is no automation with that id on this team. list_automations gives the ids.",
    );
  }
  await withTeamSteps(ctx, organizationId);
  return automation;
}

export const createAs = internalMutation({
  args: { organizationId: v.string(), userId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    await withTeamSteps(ctx, args.organizationId);
    return await createAutomation(ctx, args.organizationId, args.userId, args.name);
  },
});

export const setUpFollowOnAs = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    automationId: v.string(),
    starterId: v.string(),
  },
  handler: async (ctx, args) => {
    const automation = await teamAutomation(ctx, args.organizationId, args.automationId);
    return await makeFollowOn(ctx, automation, args.userId, args.starterId);
  },
});

export const changeAs = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    automationId: v.string(),
    operations: v.array(operationValidator),
  },
  handler: async (ctx, args) => {
    const automation = await teamAutomation(ctx, args.organizationId, args.automationId);
    return await changeAutomation(ctx, automation, args.userId, args.operations, true);
  },
});

export const describeAs = internalQuery({
  args: { organizationId: v.string(), automationId: v.string() },
  handler: async (ctx, args) => {
    const automation = await teamAutomation(ctx, args.organizationId, args.automationId);
    return {
      automation_id: automation._id,
      name: workingCopy(automation).name,
      ...(await describeAutomation(ctx, automation)),
    };
  },
});

export const nodeTypesAs = internalQuery({
  args: { organizationId: v.string(), type: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await withTeamSteps(ctx, args.organizationId);
    if (!args.type) return { index: nodeTypeIndex() };
    const found = getNodeType(args.type);
    if (!found) fail("not_found", `There is no step type called ${args.type}.`);
    return { type: withoutReservedKeys(found) };
  },
});

/** The team for an automation with an Approval step, so the agent can name reviewers. */
async function teamFor(ctx: QueryCtx, organizationId: string, draft: AutomationDraft) {
  if (!draft.nodes.some((node) => node.kind === "approval")) return {};
  const members = await membersOf(ctx, organizationId);
  return {
    team: members.map(({ userId, name, role }) => ({ userId, name, role })),
  };
}

/**
 * Makes changes to an automation, in order, and saves the result. All of them are made or
 * none: the first change that cannot be made is reported and nothing is saved. The canvas
 * makes the same changes locally before it saves, so both build the same way. Like `save`,
 * changes to an automation that is on go to its draft; `publish` makes them live.
 */
export const change = mutation({
  args: { automationId: v.id("automations"), operations: v.array(operationValidator) },
  returns: describedValidator,
  handler: async (ctx, args) => {
    const { automation, userId } = await loadForMember(ctx, args.automationId);
    return await changeAutomation(ctx, automation, userId, args.operations);
  },
});

type Operation = (typeof operationValidator)["type"];

async function changeAutomation(
  ctx: MutationCtx,
  automation: Doc<"automations">,
  userId: string,
  operations: Operation[],
  asDraft = false,
) {
  if (operations.length === 0 || operations.length > 100) {
    fail("invalid_input", "Send between 1 and 100 changes at a time.");
  }
  let next: AutomationDraft;
  try {
    next = applyOperations(workingCopy(automation) as AutomationDraft, operations);
  } catch (caught) {
    if (caught instanceof OperationError) fail("invalid_input", caught.message);
    throw caught;
  }
  const { enabled, draft } = await storeChanges(ctx, automation, next, userId, asDraft);
  const brand = await brandOf(ctx, automation.organizationId, automation.clientId);
  const links = await linkProblem(ctx, automation, next);
  return {
    outline: outline(next, brand),
    problems: [...draftProblems(next, brand), ...(links ? [{ nodeId: null, message: links }] : [])],
    enabled,
    draft,
  };
}

export const setEnabled = mutation({
  args: { automationId: v.id("automations"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { automation } = await loadForMember(ctx, args.automationId);
    if (args.enabled) {
      const problem =
        automationProblem(
          automation.trigger,
          automation.nodes,
          automation.edges,
          await brandOf(ctx, automation.organizationId, automation.clientId),
        ) ??
        (await storageProblem(ctx, automation.organizationId, automation.trigger)) ??
        (await linkProblem(ctx, automation, automation));
      if (problem) fail("invalid_input", problem);
    }
    await ctx.db.patch(args.automationId, {
      enabled: args.enabled,
      nextRunAt: scheduledNext(automation.trigger, args.enabled),
      watchFrom: watchStart(automation, automation.trigger, args.enabled),
    });
  },
});

/** Deletes the automation. Its past runs stay in the run history. */
export const remove = mutation({
  args: { automationId: v.id("automations") },
  handler: async (ctx, args) => {
    await loadForMember(ctx, args.automationId);
    await deleteVersions(ctx, args.automationId);
    await deleteNotes(ctx, args.automationId);
    await ctx.db.delete(args.automationId);
  },
});

/**
 * Starts a run by hand, optionally on a file. Works whether or not the automation is on.
 * It runs what the canvas shows, so a draft can be tried before it is published; pass
 * `version: "live"` to run the published version instead.
 */
export const runNow = mutation({
  args: {
    automationId: v.id("automations"),
    fileUrl: v.optional(v.string()),
    version: v.optional(v.union(v.literal("draft"), v.literal("live"))),
  },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    const { automation, userId } = await loadForMember(ctx, args.automationId);
    const fileUrl = args.fileUrl?.trim();
    if (fileUrl && !/^https?:\/\//.test(fileUrl)) {
      fail("invalid_input", "The file address must start with http:// or https://.");
    }
    const started = await startRun(
      ctx,
      args.version === "live" ? automation : { ...automation, ...workingCopy(automation) },
      "manual",
      fileUrl ? { file_url: fileUrl } : {},
      userId,
    );
    if (!started.ok) fail("invalid_input", started.message);
    return started.runId;
  },
});

/**
 * The file a try run works on: the upload asked for, or else the team's newest upload the
 * automation's trigger would take. Brand files (a logo, music) are never picked.
 */
function pickUpload(
  uploads: Doc<"uploads">[],
  trigger: Doc<"automations">["trigger"],
  uploadId: string | undefined,
): Doc<"uploads"> | string {
  const ready = uploads.filter((upload) => upload.status === "ready" && !upload.purpose);
  if (uploadId) {
    const asked = ready.find((upload) => upload._id === uploadId);
    return asked ?? "That file is not in your team's uploads.";
  }
  const wants = trigger.kind === "upload" ? trigger : null;
  const fits = ready.filter(
    (upload) =>
      !wants ||
      ((wants.fileType === "any" || upload.contentType.split("/")[0] === wants.fileType) &&
        withinLength(wants, upload.details)),
  );
  if (fits.length > 0) return fits[0];
  return ready.length === 0
    ? "There are no uploads to try it on. Upload a file on the Uploads page first."
    : "None of your uploads is the kind of file this automation starts with.";
}

/** The upload a try run would use, and the team's storage to make its link. Members only. */
export const tryTarget = internalQuery({
  args: { automationId: v.id("automations"), uploadId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { automation } = await loadForMember(ctx, args.automationId);
    const uploads = await ctx.db
      .query("uploads")
      .withIndex("by_organization", (q) => q.eq("organizationId", automation.organizationId))
      .order("desc")
      .take(100);
    const upload = pickUpload(uploads, workingCopy(automation).trigger, args.uploadId);
    if (typeof upload === "string") fail("invalid_input", upload);
    const storage = await storageConnection(ctx, automation.organizationId);
    if (!storage) fail("no_storage", "Connect your toolkit first.");
    return { upload, storage };
  },
});

/** Starts the try run. Members only, checked again here. */
export const startTry = internalMutation({
  args: { automationId: v.id("automations"), trigger: v.any() },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    const { automation, userId } = await loadForMember(ctx, args.automationId);
    const started = await startRun(
      ctx,
      { ...automation, ...workingCopy(automation) },
      "manual",
      args.trigger as Record<string, unknown>,
      userId,
    );
    if (!started.ok) fail("invalid_input", started.message);
    return started.runId;
  },
});

/**
 * Tries an automation on one of the team's uploads, as that upload would start it,
 * whether or not the automation is on. Runs what the canvas shows. With no upload named,
 * takes the newest one the automation's trigger would take.
 */
export const tryOnUpload = action({
  args: { automationId: v.id("automations"), uploadId: v.optional(v.string()) },
  returns: v.object({ runId: v.id("runs"), fileName: v.string() }),
  handler: async (ctx, args): Promise<{ runId: Id<"runs">; fileName: string }> => {
    const { upload, storage } = await ctx.runQuery(internal.automations.tryTarget, args);
    const fileUrl = await presign(await bucketOf(storage), "GET", upload.key, READ_LINK_SECONDS);
    const runId: Id<"runs"> = await ctx.runMutation(internal.automations.startTry, {
      automationId: args.automationId,
      trigger: {
        file_url: fileUrl,
        file_name: upload.fileName,
        content_type: upload.contentType,
        size: upload.size,
        details: upload.details ?? null,
        upload_id: upload._id,
      },
    });
    return { runId, fileName: upload.fileName };
  },
});

/**
 * Tests one step on its own, as it stands in the editor (saved or not), on one file.
 * Settings that point at an earlier step's file take the chosen file instead, since the
 * steps before do not run. Returns the run, which then updates live like any other.
 */
export const testStep = mutation({
  args: {
    automationId: v.id("automations"),
    node: nodeValidator,
    fileUrl: v.optional(v.string()),
  },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    const { automation, userId } = await loadForMember(ctx, args.automationId);
    const testable = [
      "step",
      "clips",
      "moments",
      "chapters",
      "broll",
      "broll-plan",
      "motion-plan",
      "motion",
      "sound-effects",
    ];
    if (!testable.includes(args.node.kind)) {
      fail("invalid_input", "Only steps that do work on a file can be tested on their own.");
    }
    const fileUrl = args.fileUrl?.trim();
    if (fileUrl && !/^https?:\/\//.test(fileUrl)) {
      fail("invalid_input", "The file address must start with http:// or https://.");
    }
    // A test is for trying the step's work, so it runs even while the step is turned off.
    const { off: _off, ...rest } = args.node;
    const node = { ...rest, input: standAlone(args.node.input) };
    const started = await startRun(
      ctx,
      { ...automation, nodes: [node], edges: [] },
      "manual",
      fileUrl ? { file_url: fileUrl } : {},
      userId,
      { test: node.id },
    );
    if (!started.ok) fail("invalid_input", started.message);
    return started.runId;
  },
});

/**
 * A step's settings with nothing pointing back at earlier steps: a file from one becomes
 * the file the test runs on, and anything else read from one is left for the step to
 * work out, as it does when nothing is set.
 */
export function standAlone(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && /\{\{\s*steps\./.test(value)) {
      if (/^\{\{\s*steps\.[A-Za-z0-9_]+\.url\s*\}\}$/.test(value)) {
        out[key] = "{{trigger.file_url}}";
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

// Internal: the triggers that start runs with nobody logged in.

/** Called from the webhook address. Says why when it cannot start a run. */
export const startFromHook = internalMutation({
  args: { automationId: v.string(), token: v.string(), body: v.any() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("automations", args.automationId);
    const automation = id ? await ctx.db.get(id) : null;
    if (!automation) return { outcome: "not_found" as const };
    if (automation.hookToken !== args.token) return { outcome: "forbidden" as const };
    if (!automation.enabled || automation.trigger.kind !== "webhook") {
      return { outcome: "off" as const };
    }
    const body = args.body as Record<string, unknown> | null;
    const fileUrl = [body?.file_url, body?.url].find(
      (value): value is string => typeof value === "string" && /^https?:\/\//.test(value),
    );
    const started = await startRun(
      ctx,
      automation,
      "webhook",
      { ...(fileUrl ? { file_url: fileUrl } : {}), body: body ?? {} },
      null,
    );
    if (!started.ok) return { outcome: "invalid" as const, message: started.message };
    return { outcome: "started" as const, runId: started.runId };
  },
});

/** Runs every minute: starts each schedule that has come due. */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("automations")
      .withIndex("by_enabled_and_nextRunAt", (q) =>
        q.eq("enabled", true).gt("nextRunAt", 0).lte("nextRunAt", now),
      )
      .take(50);
    for (const automation of due) {
      if (automation.trigger.kind !== "schedule") {
        await ctx.db.patch(automation._id, { nextRunAt: null });
        continue;
      }
      await ctx.db.patch(automation._id, {
        nextRunAt: nextRunAt(automation.trigger.schedule, now),
      });
      // If the last run is still going, skip this turn so runs never pile up.
      const lastRun = await ctx.db
        .query("runs")
        .withIndex("by_automation", (q) => q.eq("automationId", automation._id))
        .order("desc")
        .first();
      if (lastRun && (lastRun.status === "running" || lastRun.status === "waiting")) continue;
      await startRun(ctx, automation, "schedule", { scheduled_for: automation.nextRunAt }, null);
    }
  },
});

export const loadUploadForTrigger = internalQuery({
  args: { uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.status !== "ready") return null;
    const automations = await ctx.db
      .query("automations")
      .withIndex("by_organization", (q) => q.eq("organizationId", upload.organizationId))
      .take(200);
    const family = upload.contentType.split("/")[0];
    const matching = automations.filter(
      (automation) =>
        automation.enabled &&
        automation.trigger.kind === "upload" &&
        (automation.trigger.fileType === "any" || automation.trigger.fileType === family) &&
        withinLength(automation.trigger, upload.details),
    );
    if (matching.length === 0) return null;
    const storage = await storageConnection(ctx, upload.organizationId);
    if (!storage) return null;
    return { upload, storage, automationIds: matching.map((automation) => automation._id) };
  },
});

/** After an upload finishes: makes a link to the file and starts the automations that want it. */
export const uploadFinished = internalAction({
  args: { uploadId: v.id("uploads") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.automations.loadUploadForTrigger, args);
    if (!found) return;
    const { upload, storage } = found;
    const fileUrl = await presign(await bucketOf(storage), "GET", upload.key, READ_LINK_SECONDS);
    await ctx.runMutation(internal.automations.startFromUpload, {
      automationIds: found.automationIds,
      trigger: {
        file_url: fileUrl,
        file_name: upload.fileName,
        content_type: upload.contentType,
        size: upload.size,
        // What the toolkit read from the file: duration, width, height and so on.
        details: upload.details ?? null,
        // So what the run makes joins the content library as made from this upload.
        upload_id: upload._id,
      },
    });
  },
});

export const startFromUpload = internalMutation({
  args: { automationIds: v.array(v.id("automations")), trigger: v.any() },
  handler: async (ctx, args) => {
    for (const automationId of args.automationIds) {
      const automation = await ctx.db.get(automationId);
      if (!automation || !automation.enabled || automation.trigger.kind !== "upload") continue;
      await startRun(ctx, automation, "upload", args.trigger, null);
    }
  },
});

/**
 * The pieces an automation is built from, for the agent: with no type, one line per kind
 * of trigger and step; with a type, that one in full, including the settings it accepts.
 * Served from here so the agent always sees what this deployment really has.
 */
/**
 * `value` without keys that start with "$", which Convex cannot send. A step's settings
 * are described by a JSON Schema, and those carry "$schema".
 */
function withoutReservedKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutReservedKeys) as T;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith("$"))
      .map(([key, inner]) => [key, withoutReservedKeys(inner)]),
  ) as T;
}

export const nodeTypes = query({
  // With a team, its own steps (teamSteps.ts) are listed too.
  args: { type: v.optional(v.string()), organizationId: v.optional(v.string()) },
  returns: v.object({ index: v.optional(v.string()), type: v.optional(v.any()) }),
  handler: async (ctx, args) => {
    const user = await getCaller(ctx);
    if (!user) fail("unauthenticated", "Sign in first.");
    if (args.organizationId) await requireMember(ctx, args.organizationId);
    if (!args.type) return { index: nodeTypeIndex() };
    const found = getNodeType(args.type);
    if (!found) fail("not_found", `There is no step type called ${args.type}.`);
    return { type: withoutReservedKeys(found) };
  },
});

/**
 * What the agent knows about each place content goes (automation-core's platform guide):
 * lengths, shapes, files, text limits and tips. Kept here, not in the agent, so it is
 * always the running dashboard's own.
 */
export const platformGuide = query({
  args: { platforms: v.optional(v.array(v.string())) },
  returns: v.object({ text: v.string(), unknown: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const user = await getCaller(ctx);
    if (!user) fail("unauthenticated", "Sign in first.");
    return platformGuideText(args.platforms?.slice(0, 30));
  },
});
