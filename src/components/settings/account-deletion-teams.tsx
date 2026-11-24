"use client";

import { api } from "@convex/_generated/api";
import type { AccountPlan } from "@convex/accountDeletion";
import { useQuery } from "convex/react";

import { cn } from "@/lib/utils";

/** What deleting the signed-in person's account would do to each of their teams. */
export function useAccountDeletionPlan(): AccountPlan | null | undefined {
  return useQuery(api.accountDeletion.plan);
}

function names(teams: { name: string }[]) {
  const all = teams.map((team) => team.name);
  return all.length <= 1 ? all.join("") : `${all.slice(0, -1).join(", ")} and ${all.at(-1)}`;
}

/**
 * The teams side of deleting an account, said plainly: which go with it, which it leaves,
 * and which have to be handed over first. Like Vercel and GitHub, a team is never left
 * without an owner.
 */
export function AccountDeletionTeams({
  plan,
  className,
}: {
  plan: AccountPlan;
  className?: string;
}) {
  const { deleteWithYou, leave, handOverFirst } = plan;
  if (handOverFirst.length > 0) {
    return (
      <p role="alert" className={cn("text-destructive text-sm", className)}>
        You are the only owner of {names(handOverFirst)}. Make someone else an owner in Settings,
        Members, or delete {handOverFirst.length === 1 ? "the team" : "those teams"}, before
        deleting your account.
      </p>
    );
  }
  if (deleteWithYou.length === 0 && leave.length === 0) return null;
  return (
    <ul className={cn("text-muted-foreground flex flex-col gap-1 text-sm", className)}>
      {deleteWithYou.length > 0 && (
        <li>
          <span className="text-foreground font-medium">{names(deleteWithYou)}</span>{" "}
          {deleteWithYou.length === 1 ? "has" : "have"} nobody else on{" "}
          {deleteWithYou.length === 1 ? "it" : "them"}, so{" "}
          {deleteWithYou.length === 1 ? "it is" : "they are"} deleted too, with every automation,
          file, run and upload in {deleteWithYou.length === 1 ? "it" : "them"}.
        </li>
      )}
      {leave.length > 0 && (
        <li>
          You leave <span className="text-foreground font-medium">{names(leave)}</span>. What you
          made there stays with the team.
        </li>
      )}
    </ul>
  );
}
