/**
 * Workflows: a chain of linked automations (see chain.ts) given a name, a kind of work, a
 * client, and one review for the whole chain. Each automation still runs on its own; the
 * workflow only changes what its runs do:
 *
 * - The automations at the end of the chain, whose files go out, get one Approval step
 *   added after their last steps, with the workflow's reviewers and time limit. Nothing is
 *   handed off (to Files, a project, Dropbox or a follower) until someone approves.
 * - Approval steps inside the chain's automations are passed straight through, so a person
 *   approves once at the end instead of in each piece.
 *
 * With the review switched off, the automations run exactly as they are built.
 */
import { approvalSentence, approvalSettings, TIME_LIMIT_UNITS, type TimeLimitUnit } from "./approval";
import { type ChainMember, chainGroup, targetOf, waitsForRun } from "./chain";
import { type AutomationEdge, type AutomationNode, NODE_GAP } from "./graph";
import { branchesOfKind, FAILURE_WAY } from "./logic";

/** The kinds of work a workflow can be for. Each comes with or without a review. */
export const WORKFLOW_KINDS = ["client", "ugc", "own", "quick"] as const;
export type WorkflowKind = (typeof WORKFLOW_KINDS)[number];

export const WORKFLOW_KIND_WORDS: Record<
  WorkflowKind,
  { label: string; description: string; review: boolean }
> = {
  client: {
    label: "Client work",
    description: "Made for a client. Someone checks it before it goes to them.",
    review: true,
  },
  ugc: {
    label: "UGC and ads",
    description: "Ads and creator videos. Someone checks each batch before it goes out.",
    review: true,
  },
  own: {
    label: "Your own content",
    description: "Posts for your own channels. Checked once before it is handed off.",
    review: true,
  },
  quick: {
    label: "Quick personal job",
    description: "Something quick for yourself. It runs straight through with no review.",
    review: false,
  },
};

/** Whether a workflow of this kind comes with its review switched on. */
export function reviewByDefault(kind: WorkflowKind): boolean {
  return WORKFLOW_KIND_WORDS[kind].review;
}

/**
 * The workflow's review: on or off, and the same settings an Approval step has, so the
 * runner, the review room and the alerts treat it exactly like one.
 */
export interface WorkflowReview {
  on: boolean;
  reviewers: string[];
  timeLimit?: number;
  timeLimitUnit?: TimeLimitUnit;
  whenTimeUp?: "reject" | "approve";
}

/** A review with anything missing or odd read as the default. */
export function workflowReview(
  review: Partial<WorkflowReview> | undefined,
  kind: WorkflowKind,
): WorkflowReview {
  const settings = approvalSettings((review ?? {}) as Record<string, unknown>);
  return {
    on: typeof review?.on === "boolean" ? review.on : reviewByDefault(kind),
    reviewers: settings.reviewers,
    ...(settings.limit
      ? {
          timeLimit: settings.limit.amount,
          timeLimitUnit: TIME_LIMIT_UNITS.includes(settings.limit.unit)
            ? settings.limit.unit
            : "hours",
          whenTimeUp: settings.whenTimeUp,
        }
      : {}),
  };
}

/** The node id of the review a workflow adds to its last automations' runs. */
export const WORKFLOW_REVIEW_ID = "workflow-review";

/** Whether this step is the review a workflow added, not one the automation has itself. */
export function isWorkflowReview(node: Pick<AutomationNode, "id" | "kind">): boolean {
  return node.kind === "approval" && node.id === WORKFLOW_REVIEW_ID;
}

/** Whether this Approval step was passed through because the workflow's review covers it. */
export function coveredByWorkflow(node: Pick<AutomationNode, "kind" | "input">): boolean {
  return node.kind === "approval" && node.input.coveredByWorkflow === true;
}

/**
 * The automations in a workflow whose files go out: those nothing in the chain carries
 * on from when they work. A follower that only starts when one fails does not count,
 * since the files of a run that worked still go out from there. An automation another
 * one runs as a step and waits for hands its files back to that one, so that one is the
 * end instead.
 */
export function workflowEnds(members: ChainMember[], ids: string[]): Set<string> {
  const inside = new Set(ids);
  const carriedOn = new Set<string>();
  for (const member of members) {
    if (!inside.has(member.id)) continue;
    for (const node of member.nodes) {
      const target = targetOf(node);
      if (target && inside.has(target) && waitsForRun(node)) carriedOn.add(target);
    }
    for (const trigger of triggersOf(member)) {
      if (trigger.kind !== "finished" || !inside.has(trigger.automationId)) continue;
      if (trigger.when !== "failed") carriedOn.add(trigger.automationId);
    }
  }
  return new Set(ids.filter((id) => !carriedOn.has(id)));
}

/** Every trigger a member has: its first, and any more when it has several. */
function triggersOf(member: ChainMember): ChainMember["trigger"][] {
  const more = (member as { moreTriggers?: { trigger: ChainMember["trigger"] }[] }).moreTriggers;
  return [member.trigger, ...(Array.isArray(more) ? more.map((each) => each.trigger) : [])];
}

/** The automations in the chain that holds `startId`, in the order they run. */
export function chainIds(members: ChainMember[], startId: string): string[] {
  return chainGroup(members, startId).columns.flat();
}

/**
 * Which stored automations a workflow is made of now. Links change after it is made, so
 * it is the chain around whichever of its automations still holds the most of the others.
 */
export function workflowMembers(members: ChainMember[], stored: string[]): string[] {
  const known = new Set(members.map((member) => member.id));
  let best: string[] = [];
  let bestCount = 0;
  for (const id of stored) {
    if (!known.has(id)) continue;
    const ids = chainIds(members, id);
    const count = ids.filter((each) => stored.includes(each)).length;
    if (count > bestCount) {
      best = ids;
      bestCount = count;
    }
  }
  return best;
}

/**
 * A run's steps with the workflow's review in them: Approval steps passed through, and,
 * for an automation at the end of the chain, one Approval step after all of its last
 * steps. Steps the automation already turned off stay as they are.
 */
export function withWorkflowReview(
  nodes: AutomationNode[],
  edges: AutomationEdge[],
  review: WorkflowReview,
  workflow: { id: string; name: string },
  atEnd: boolean,
): { nodes: AutomationNode[]; edges: AutomationEdge[] } {
  if (!review.on) return { nodes, edges };
  const passed = nodes.map((node) =>
    node.kind === "approval" && !node.off
      ? { ...node, off: true, input: { ...node.input, coveredByWorkflow: true } }
      : node,
  );
  if (!atEnd || nodes.length === 0) return { nodes: passed, edges };

  // The last steps: nothing takes their files when they work.
  const leads = (id: string) =>
    edges.some((edge) => edge.source === id && edge.branch !== FAILURE_WAY);
  const last = passed.filter((node) => !leads(node.id));
  const right = Math.max(...passed.map((node) => node.position.x));
  const middle = last.reduce((sum, node) => sum + node.position.y, 0) / Math.max(last.length, 1);
  const reviewNode: AutomationNode = {
    id: WORKFLOW_REVIEW_ID,
    kind: "approval",
    label: `${workflow.name} review`,
    input: {
      reviewers: review.reviewers,
      ...(review.timeLimit
        ? {
            timeLimit: review.timeLimit,
            timeLimitUnit: review.timeLimitUnit ?? "hours",
            whenTimeUp: review.whenTimeUp ?? "reject",
          }
        : {}),
      workflowId: workflow.id,
      workflowName: workflow.name,
    },
    position: { x: right + NODE_GAP, y: middle },
  };
  const added: AutomationEdge[] = last.flatMap((node) => {
    const ways = branchesOfKind(node.kind);
    return ways.length === 0
      ? [{ id: `${node.id}->${WORKFLOW_REVIEW_ID}`, source: node.id, target: WORKFLOW_REVIEW_ID }]
      : ways.map((way) => ({
          id: `${node.id}:${way}->${WORKFLOW_REVIEW_ID}`,
          source: node.id,
          target: WORKFLOW_REVIEW_ID,
          branch: way,
        }));
  });
  return { nodes: [...passed, reviewNode], edges: [...edges, ...added] };
}

/** The kind a new workflow most likely is, from what it is made of. */
export function guessWorkflowKind(info: { hasClient: boolean; ugc: boolean }): WorkflowKind {
  if (info.hasClient) return "client";
  if (info.ugc) return "ugc";
  return "own";
}

/** The review in one line: "Anyone on the team, rejects after 2 days" or "No review". */
export function reviewSentence(
  review: WorkflowReview,
  nameOf: (userId: string) => string | undefined,
): string {
  if (!review.on) return "No review: the files go out as soon as they are made";
  return approvalSentence(review as unknown as Record<string, unknown>, nameOf);
}

/** The first Approval step's settings among the automations, to start the review from. */
export function reviewFromApprovals(
  members: { nodes: Pick<AutomationNode, "kind" | "input" | "off">[] }[],
): Partial<WorkflowReview> {
  for (const member of members) {
    const found = member.nodes.find((node) => node.kind === "approval" && !node.off);
    if (!found) continue;
    const { reviewers, limit, whenTimeUp } = approvalSettings(found.input);
    return {
      reviewers,
      ...(limit ? { timeLimit: limit.amount, timeLimitUnit: limit.unit, whenTimeUp } : {}),
    };
  }
  return {};
}

/** A workflow's name: what was typed, or the first automation's. */
export function workflowName(typed: string | undefined, first: string): string {
  const name = (typed ?? "").trim() || first;
  return name.slice(0, 80);
}

/** Whether an automation made from this ready-made is UGC or ad work. */
export function isUgcStarter(starterId: string | undefined, category?: string): boolean {
  if (category === "ugc" || category === "ads") return true;
  return typeof starterId === "string" && /(^|[-_])(ugc|ads?|hooks?)([-_]|$)/i.test(starterId);
}
