import {
  approvalProblem,
  guessWorkflowKind,
  isUgcStarter,
  reviewFromApprovals,
  reviewSentence,
  STARTERS,
  type WorkflowKind,
  WORKFLOW_KIND_WORDS,
  workflowName,
  workflowEnds,
  workflowReview,
  type WorkflowReview,
  chainIds,
} from "@ncat-dash/automation-core";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { switchAutomation } from "./automations";
import { membersOf } from "./lib/approvals";
import { requireMember } from "./lib/authz";
import {
  chainMembersOf,
  MAX_WORKFLOWS,
  type PlacedWorkflow,
  placedWorkflows,
  teamAutomations,
} from "./lib/workflows";

/**
 * Workflows: a chain of linked automations with a name, a kind of work, a client, and one
 * review before the files go out. Made from the Chain tab, by the agent or over MCP; the
 * runner adds the review to the runs (lib/workflows.ts).
 */

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

export const kindValidator = v.union(
  v.literal("client"),
  v.literal("ugc"),
  v.literal("own"),
  v.literal("quick"),
);

export const reviewValidator = v.object({
  on: v.boolean(),
  reviewers: v.array(v.string()),
  timeLimit: v.optional(v.number()),
  timeLimitUnit: v.optional(v.union(v.literal("hours"), v.literal("days"))),
  whenTimeUp: v.optional(v.union(v.literal("reject"), v.literal("approve"))),
});

const reviewChange = v.object({
  on: v.optional(v.boolean()),
  reviewers: v.optional(v.array(v.string())),
  // 0 takes the time limit away.
  timeLimit: v.optional(v.number()),
  timeLimitUnit: v.optional(v.union(v.literal("hours"), v.literal("days"))),
  whenTimeUp: v.optional(v.union(v.literal("reject"), v.literal("approve"))),
});

const memberValidator = v.object({
  automationId: v.id("automations"),
  name: v.string(),
  enabled: v.boolean(),
  // Its files go out from here, so the review happens at its end.
  end: v.boolean(),
  // It has an Approval step of its own, which the review covers while it is on.
  ownApproval: v.boolean(),
});

const viewValidator = v.object({
  workflowId: v.id("workflows"),
  name: v.string(),
  kind: kindValidator,
  clientId: v.union(v.id("clients"), v.null()),
  clientName: v.union(v.string(), v.null()),
  review: reviewValidator,
  reviewWords: v.string(),
  on: v.union(v.literal("on"), v.literal("off"), v.literal("partly")),
  automations: v.array(memberValidator),
  joinedTo: v.union(v.string(), v.null()),
});

type View = typeof viewValidator.type;

const hasOwnApproval = (automation: Doc<"automations">) =>
  automation.nodes.some((node) => node.kind === "approval" && !node.off);

function membersView(ids: Id<"automations">[], ends: Set<string>, team: Doc<"automations">[]) {
  const byId = new Map(team.map((each) => [each._id as string, each]));
  return ids.flatMap((id) => {
    const each = byId.get(id);
    return each
      ? [
          {
            automationId: each._id,
            name: each.name,
            enabled: each.enabled,
            end: ends.has(id),
            ownApproval: hasOwnApproval(each),
          },
        ]
      : [];
  });
}

function onState(automations: { enabled: boolean }[]): View["on"] {
  if (automations.length > 0 && automations.every((each) => each.enabled)) return "on";
  return automations.some((each) => each.enabled) ? "partly" : "off";
}

async function viewOf(
  ctx: QueryCtx,
  placed: PlacedWorkflow,
  team: Doc<"automations">[],
  nameOf: (userId: string) => string | undefined,
): Promise<View> {
  const { workflow } = placed;
  const review = workflowReview(workflow.review, workflow.kind);
  const automations = membersView(placed.ids, placed.ends, team);
  const client = workflow.clientId ? await ctx.db.get(workflow.clientId) : null;
  return {
    workflowId: workflow._id,
    name: workflow.name,
    kind: workflow.kind,
    clientId: client?._id ?? null,
    clientName: client?.name ?? null,
    review,
    reviewWords: reviewSentence(review, nameOf),
    on: onState(automations),
    automations,
    joinedTo: placed.joinedTo,
  };
}

async function namesOf(ctx: QueryCtx, organizationId: string) {
  const members = await membersOf(ctx, organizationId);
  return (userId: string) => members.find((member) => member.userId === userId)?.name;
}

async function listFor(ctx: QueryCtx, organizationId: string): Promise<View[]> {
  const team = await teamAutomations(ctx, organizationId);
  const placed = await placedWorkflows(ctx, organizationId, team);
  if (placed.length === 0) return [];
  const nameOf = await namesOf(ctx, organizationId);
  return await Promise.all(placed.map((each) => viewOf(ctx, each, team, nameOf)));
}

/** The team's workflows, oldest first, with their automations as they are linked now. */
export const list = query({
  args: { organizationId: v.string() },
  returns: v.array(viewValidator),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    return await listFor(ctx, args.organizationId);
  },
});

/** What a new workflow made from this chain starts with. */
const proposalValidator = v.object({
  name: v.string(),
  kind: kindValidator,
  clientId: v.union(v.id("clients"), v.null()),
  review: reviewValidator,
  automations: v.array(memberValidator),
});

async function proposalFor(
  ctx: QueryCtx,
  automation: Doc<"automations">,
  team: Doc<"automations">[],
) {
  const members = chainMembersOf(team);
  const ids = chainIds(members, automation._id) as Id<"automations">[];
  const ends = workflowEnds(members, ids);
  const inChain = team.filter((each) => ids.includes(each._id));
  const clients = [...new Set(inChain.map((each) => each.clientId).filter(Boolean))];
  const ugc = inChain.some((each) => {
    const starter = STARTERS.find((one) => one.id === each.starterId);
    return isUgcStarter(each.starterId, starter?.category);
  });
  const kind = guessWorkflowKind({ hasClient: clients.length > 0, ugc });
  const first = team.find((each) => each._id === ids[0]) ?? automation;
  return {
    name: workflowName(undefined, first.name),
    kind,
    clientId: (clients.length === 1 ? clients[0] : null) ?? null,
    review: workflowReview(reviewFromApprovals(inChain), kind),
    automations: membersView(ids, ends, team),
  };
}

/**
 * For the Chain tab: the workflow this automation is part of, or what one made from its
 * chain would start with.
 */
export const forAutomation = query({
  args: { automationId: v.id("automations") },
  returns: v.union(
    v.null(),
    v.object({ workflow: v.union(viewValidator, v.null()), proposal: proposalValidator }),
  ),
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation) return null;
    await requireMember(ctx, automation.organizationId);
    const team = await teamAutomations(ctx, automation.organizationId);
    const placed = await placedWorkflows(ctx, automation.organizationId, team);
    const mine = placed.find((each) => each.ids.includes(automation._id) && !each.joinedTo);
    const nameOf = await namesOf(ctx, automation.organizationId);
    return {
      workflow: mine ? await viewOf(ctx, mine, team, nameOf) : null,
      proposal: await proposalFor(ctx, automation, team),
    };
  },
});

type Change = {
  name?: string;
  kind?: WorkflowKind;
  clientId?: Id<"clients"> | null;
  review?: Partial<WorkflowReview>;
};

/** The review after a change, checked. Changing the kind brings that kind's on/off. */
function changedReview(
  current: Partial<WorkflowReview>,
  change: Partial<WorkflowReview> | undefined,
  kind: WorkflowKind,
  kindChanged: boolean,
): WorkflowReview {
  const merged: Record<string, unknown> = { ...current, ...(change ?? {}) };
  if (kindChanged && change?.on === undefined) merged.on = WORKFLOW_KIND_WORDS[kind].review;
  if (change?.timeLimit === 0) {
    delete merged.timeLimit;
    delete merged.timeLimitUnit;
    delete merged.whenTimeUp;
  }
  const problem = approvalProblem(merged);
  if (problem) fail("invalid_input", problem);
  return workflowReview(merged as Partial<WorkflowReview>, kind);
}

async function checkedClient(
  ctx: QueryCtx,
  organizationId: string,
  clientId: Id<"clients"> | null | undefined,
) {
  if (!clientId) return;
  const client = await ctx.db.get(clientId);
  if (!client || client.organizationId !== organizationId) fail("not_found", "That client is gone.");
}

/** Puts every automation of the workflow to work for its client, or for the team. */
async function applyClient(
  ctx: MutationCtx,
  ids: Id<"automations">[],
  clientId: Id<"clients"> | null,
) {
  for (const id of ids) {
    const automation = await ctx.db.get(id);
    if (automation && automation.clientId !== (clientId ?? undefined)) {
      await ctx.db.patch(id, { clientId: clientId ?? undefined });
    }
  }
}

/** Makes a workflow of the chain `automationId` is in. Returns its id. */
export async function createWorkflow(
  ctx: MutationCtx,
  organizationId: string,
  userId: string,
  automationId: Id<"automations">,
  change: Change,
): Promise<Id<"workflows">> {
  const automation = await ctx.db.get(automationId);
  if (!automation || automation.organizationId !== organizationId) {
    fail("not_found", "This automation no longer exists.");
  }
  const team = await teamAutomations(ctx, organizationId);
  const placed = await placedWorkflows(ctx, organizationId, team);
  if (placed.length >= MAX_WORKFLOWS) {
    fail("invalid_input", `A team can have at most ${MAX_WORKFLOWS} workflows.`);
  }
  const taken = placed.find((each) => !each.joinedTo && each.ids.includes(automationId));
  if (taken) fail("invalid_input", `These automations are already the ${taken.workflow.name} workflow.`);
  const proposal = await proposalFor(ctx, automation, team);
  const clientId = change.clientId === undefined ? proposal.clientId : change.clientId;
  const kind = change.kind ?? (clientId ? "client" : proposal.kind);
  await checkedClient(ctx, organizationId, clientId);
  const review = changedReview(
    { ...proposal.review, on: WORKFLOW_KIND_WORDS[kind].review },
    change.review,
    kind,
    false,
  );
  const ids = proposal.automations.map((each) => each.automationId);
  const workflowId = await ctx.db.insert("workflows", {
    organizationId,
    name: workflowName(change.name, proposal.name),
    kind,
    automationIds: ids,
    ...(clientId ? { clientId } : {}),
    review,
    createdBy: userId,
    updatedAt: Date.now(),
  });
  if (clientId !== null) await applyClient(ctx, ids, clientId);
  return workflowId;
}

async function placedOf(ctx: QueryCtx, workflow: Doc<"workflows">) {
  const placed = await placedWorkflows(ctx, workflow.organizationId);
  return placed.find((each) => each.workflow._id === workflow._id)!;
}

/** Changes a workflow's name, kind, client or review. */
export async function changeWorkflow(
  ctx: MutationCtx,
  workflow: Doc<"workflows">,
  change: Change,
): Promise<void> {
  const kind = change.kind ?? workflow.kind;
  const review = changedReview(workflow.review, change.review, kind, kind !== workflow.kind);
  await checkedClient(ctx, workflow.organizationId, change.clientId);
  const placed = await placedOf(ctx, workflow);
  await ctx.db.patch(workflow._id, {
    ...(change.name !== undefined ? { name: workflowName(change.name, workflow.name) } : {}),
    kind,
    review,
    // Kept up to date, so the chain is still found after links change.
    ...(placed.ids.length > 0 ? { automationIds: placed.ids } : {}),
    ...(change.clientId !== undefined ? { clientId: change.clientId ?? undefined } : {}),
    updatedAt: Date.now(),
  });
  if (change.clientId !== undefined) await applyClient(ctx, placed.ids, change.clientId);
}

/** Switches every automation of the workflow on or off together, or none of them. */
export async function switchWorkflow(
  ctx: MutationCtx,
  workflow: Doc<"workflows">,
  on: boolean,
): Promise<void> {
  const placed = await placedOf(ctx, workflow);
  if (placed.joinedTo) {
    fail("invalid_input", `This chain is now part of the ${placed.joinedTo} workflow.`);
  }
  for (const id of placed.ids) {
    const automation = await ctx.db.get(id);
    if (!automation || automation.enabled === on) continue;
    try {
      await switchAutomation(ctx, automation, on);
    } catch (caught) {
      const data = caught instanceof ConvexError ? (caught.data as { message?: string }) : null;
      fail("invalid_input", `${automation.name}: ${data?.message ?? "it could not be switched on."}`);
    }
  }
}

async function loadWorkflow(ctx: QueryCtx, workflowId: Id<"workflows">) {
  const workflow = await ctx.db.get(workflowId);
  if (!workflow) fail("not_found", "This workflow no longer exists.");
  const member = await requireMember(ctx, workflow.organizationId);
  return { workflow, ...member };
}

const changeArgs = {
  name: v.optional(v.string()),
  kind: v.optional(kindValidator),
  clientId: v.optional(v.union(v.id("clients"), v.null())),
  review: v.optional(reviewChange),
};

function changeOf(args: {
  name?: string;
  kind?: WorkflowKind;
  clientId?: Id<"clients"> | null;
  review?: Partial<WorkflowReview>;
}): Change {
  return { name: args.name, kind: args.kind, clientId: args.clientId, review: args.review };
}

export const create = mutation({
  args: { automationId: v.id("automations"), ...changeArgs },
  returns: v.id("workflows"),
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation) fail("not_found", "This automation no longer exists.");
    const { userId } = await requireMember(ctx, automation.organizationId);
    return await createWorkflow(
      ctx,
      automation.organizationId,
      userId,
      args.automationId,
      changeOf(args),
    );
  },
});

export const update = mutation({
  args: { workflowId: v.id("workflows"), ...changeArgs },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workflow } = await loadWorkflow(ctx, args.workflowId);
    await changeWorkflow(ctx, workflow, changeOf(args));
    return null;
  },
});

export const setOn = mutation({
  args: { workflowId: v.id("workflows"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workflow } = await loadWorkflow(ctx, args.workflowId);
    await switchWorkflow(ctx, workflow, args.on);
    return null;
  },
});

/** Takes the workflow away. Its automations stay as they are, with their own approvals. */
export const remove = mutation({
  args: { workflowId: v.id("workflows") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workflow } = await loadWorkflow(ctx, args.workflowId);
    await ctx.db.delete(workflow._id);
    return null;
  },
});

// For the MCP server, which acts as a person on a team it has already checked.

function said(message: string): never {
  throw new ConvexError({ code: "mcp", message });
}

/** The team's workflows, for an agent: plain fields, no ids it does not need. */
export const listAs = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const views = await listFor(ctx, args.organizationId);
    return views.map(forAgent);
  },
});

export function forAgent(view: View) {
  return {
    workflow_id: view.workflowId,
    name: view.name,
    kind: WORKFLOW_KIND_WORDS[view.kind].label,
    client: view.clientName,
    on: view.on,
    review: view.review.on
      ? {
          who: view.reviewWords,
          reviewers: view.review.reviewers,
          time_limit: view.review.timeLimit
            ? `${view.review.timeLimit} ${view.review.timeLimitUnit ?? "hours"}, then ${view.review.whenTimeUp ?? "reject"}`
            : null,
        }
      : null,
    automations: view.automations.map((each) => ({
      automation_id: each.automationId,
      name: each.name,
      on: each.enabled,
      reviewed_here: view.review.on && each.end,
      own_approval_covered: view.review.on && each.ownApproval,
    })),
    joined_to: view.joinedTo,
  };
}

/** Makes the chain an automation is in a workflow, or changes the one it is already in. */
export const setUpAs = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    automationId: v.string(),
    ...changeArgs,
    clientId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("automations", args.automationId);
    const automation = id ? await ctx.db.get(id) : null;
    if (!automation || automation.organizationId !== args.organizationId) {
      said("There is no automation with that id on this team. list_automations gives the ids.");
    }
    let clientId: Id<"clients"> | null | undefined = undefined;
    if (args.clientId === null) clientId = null;
    else if (typeof args.clientId === "string") {
      const normalized = ctx.db.normalizeId("clients", args.clientId);
      if (!normalized) said("There is no client with that id on this team.");
      clientId = normalized;
    }
    return await setUpWorkflow(
      ctx,
      args.organizationId,
      args.userId,
      automation,
      changeOf({ ...args, clientId }),
    );
  },
});

async function setUpWorkflow(
  ctx: MutationCtx,
  organizationId: string,
  userId: string,
  automation: Doc<"automations">,
  change: Change,
) {
  const placed = await placedWorkflows(ctx, organizationId);
  const mine = placed.find((each) => !each.joinedTo && each.ids.includes(automation._id));
  let workflowId: Id<"workflows">;
  if (mine) {
    await changeWorkflow(ctx, mine.workflow, change);
    workflowId = mine.workflow._id;
  } else {
    workflowId = await createWorkflow(ctx, organizationId, userId, automation._id, change);
  }
  const views = await listFor(ctx, organizationId);
  return { made: !mine, ...forAgent(views.find((each) => each.workflowId === workflowId)!) };
}

/** For the agent: the same as setUpAs, as the signed-in person. */
export const setUp = mutation({
  args: { automationId: v.id("automations"), ...changeArgs },
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation) fail("not_found", "This automation no longer exists.");
    const { userId } = await requireMember(ctx, automation.organizationId);
    return await setUpWorkflow(ctx, automation.organizationId, userId, automation, changeOf(args));
  },
});

/** For the agent: the team's workflows in plain fields. */
export const listForAgent = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    return (await listFor(ctx, args.organizationId)).map(forAgent);
  },
});

export const switchAs = internalMutation({
  args: { organizationId: v.string(), workflowId: v.string(), on: v.boolean() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("workflows", args.workflowId);
    const workflow = id ? await ctx.db.get(id) : null;
    if (!workflow || workflow.organizationId !== args.organizationId) {
      said("There is no workflow with that id on this team. list_workflows gives the ids.");
    }
    await switchWorkflow(ctx, workflow, args.on);
    return { workflow_id: workflow._id, on: args.on };
  },
});

/**
 * For the agent: the workflow an automation is part of in plain fields, or, when it is
 * in none, what one made from its chain would start with.
 */
export const describeFor = query({
  args: { automationId: v.id("automations") },
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation) fail("not_found", "This automation no longer exists.");
    await requireMember(ctx, automation.organizationId);
    const team = await teamAutomations(ctx, automation.organizationId);
    const placed = await placedWorkflows(ctx, automation.organizationId, team);
    const mine = placed.find((each) => each.ids.includes(automation._id) && !each.joinedTo);
    const nameOf = await namesOf(ctx, automation.organizationId);
    if (mine) return { workflow: forAgent(await viewOf(ctx, mine, team, nameOf)), proposal: null };
    const proposal = await proposalFor(ctx, automation, team);
    return {
      workflow: null,
      proposal: {
        name: proposal.name,
        kind: proposal.kind,
        review_on: proposal.review.on,
        reviewers: proposal.review.reviewers,
        automations: proposal.automations.map((each) => ({
          automation_id: each.automationId,
          name: each.name,
          reviewed_here: proposal.review.on && each.end,
          own_approval: each.ownApproval,
        })),
      },
    };
  },
});
