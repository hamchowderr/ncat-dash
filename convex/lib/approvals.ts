import {
  type AutomationNode,
  approvalSettings,
  askedToDecide,
  mayDecide,
} from "@takewon/automation-core";
import { components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type TeamMembers = { userId: string; name: string; role: string }[];

export async function membersOf(ctx: QueryCtx, organizationId: string): Promise<TeamMembers> {
  const team = await ctx.runQuery(components.betterAuth.members.contactsFor, { organizationId });
  return team.members;
}

/**
 * What a person looking at an approval step needs to know: who is asked to decide, by
 * when, whether they may decide themselves, and, once it is decided, who did.
 */
export function approvalView(
  step: Doc<"runSteps">,
  run: Doc<"runs">,
  members: TeamMembers,
  viewer: string,
) {
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
  const reviewers = step.reviewers ?? [];
  const asked = askedToDecide(reviewers, members);
  const nameOf = (userId: string | undefined) =>
    members.find((member) => member.userId === userId)?.name ?? null;
  return {
    // The names of the people asked. Empty when it is anyone on the team.
    asked: members.some((member) => reviewers.includes(member.userId))
      ? asked.map((member) => member.name)
      : [],
    forYou: asked.some((member) => member.userId === viewer),
    mayDecide: mayDecide(reviewers, members, viewer),
    decideBy: step.decideBy ?? null,
    // What happens when the time is up.
    whenTimeUp: node ? approvalSettings(node.input).whenTimeUp : "reject",
    decidedBy: nameOf(step.decidedBy),
    decidedAutomatically: step.decidedAutomatically ?? false,
  };
}
