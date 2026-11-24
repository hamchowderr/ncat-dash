"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { type Starter, STARTERS } from "@takewon/automation-core";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/catalog";
import { cn } from "@/lib/utils";

import { FlowStrip } from "./flow-strip";

type FollowOns = {
  following: {
    automationId: Id<"automations">;
    name: string;
    enabled: boolean;
    when: "done" | "failed" | "either";
  }[];
  suggestions: string[];
};

const WHEN: Record<FollowOns["following"][number]["when"], string> = {
  done: "after it works",
  failed: "if it fails",
  either: "whenever it ends",
};

/** The ready-made follow-ons named by id, in the order given. */
export function suggestedStartersOf(ids: string[]): Starter[] {
  return ids.flatMap((id) => STARTERS.find((starter) => starter.id === id) ?? []);
}

/** What goes on after an automation, or undefined while it loads. */
export function useFollowOns(automationId: Id<"automations">): FollowOns | undefined {
  return useQuery(api.automations.followOns, { automationId });
}

/**
 * Makes a follow-on wired to start after `automationId`, and opens it so it can be looked
 * over and switched on. With `open` false it stays where it is, for a page that shows the
 * new one by itself.
 */
export function useSetUp({ open = true }: { open?: boolean } = {}) {
  const setUp = useMutation(api.automations.setUpFollowOn);
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  async function onSetUp(
    automationId: Id<"automations">,
    automationName: string,
    starter: Starter,
  ) {
    setPending(`${automationId}:${starter.id}`);
    try {
      const made = await setUp({ automationId, starterId: starter.id });
      if (made.on) {
        toast.success(
          `${starter.name} is built and on. It starts by itself each time ${automationName} finishes.`,
        );
      } else {
        toast.info(`${starter.name} is built but off for now. ${made.problem ?? ""}`.trim());
      }
      if (open) {
        router.push(`/automations/${made.automationId}`, { transitionTypes: ["nav-forward"] });
      } else {
        setPending(null);
      }
    } catch (caught) {
      toast.error(errorMessage(caught, "It could not be set up. Try again."));
      setPending(null);
    }
  }
  return { pending, onSetUp };
}

function Suggestion({
  starter,
  after,
  disabled,
  pending,
  onSetUp,
}: {
  starter: Starter;
  /** The automation it would follow, when that is not plain from where it is shown. */
  after?: string;
  disabled: boolean;
  pending: boolean;
  onSetUp: () => void;
}) {
  return (
    <li className="grid gap-2" data-follow-on={starter.id}>
      <FlowStrip
        size="sm"
        trigger={starter.trigger}
        nodes={starter.nodes}
        edges={starter.edges}
        className="justify-start"
      />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{starter.name}</span>
        {after && <span className="text-muted-foreground text-xs">After {after}</span>}
        <span className="text-muted-foreground text-sm">{starter.description}</span>
      </span>
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        disabled={disabled}
        aria-label={`Build ${starter.name}`}
        onClick={onSetUp}
      >
        <Plus />
        {pending ? "Building it" : "Build it"}
      </Button>
    </li>
  );
}

/**
 * The side column on an automation's canvas: the team's automations that start when this
 * one finishes, and ready-made ones that go well after it, each built in one click.
 */
export function FollowOnsPanel({
  automationId,
  automationName,
  followOns,
  onShowChain,
}: {
  automationId: Id<"automations">;
  automationName: string;
  followOns: FollowOns | undefined;
  /** Opens the chain tab, when this automation is linked to others. */
  onShowChain?: () => void;
}) {
  const { pending, onSetUp } = useSetUp();
  if (!followOns) return <p className="text-muted-foreground text-sm">Loading</p>;
  const suggested = suggestedStartersOf(followOns.suggestions);
  return (
    <div className="grid gap-6">
      <section className="grid gap-2" aria-labelledby="follow-ons-running">
        <h2 id="follow-ons-running" className="text-sm font-semibold">
          Runs after this
        </h2>
        {followOns.following.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing starts when this automation finishes yet.
          </p>
        ) : (
          <ul className="grid gap-1">
            {followOns.following.map((next) => (
              <li key={next.automationId}>
                <Link
                  href={`/automations/${next.automationId}`}
                  className="hover:bg-muted focus-visible:ring-ring/50 -mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-3"
                >
                  <ArrowRight
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{next.name}</span>
                  <span className="text-muted-foreground shrink-0">
                    {WHEN[next.when]}
                    {next.enabled ? "" : ", off"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {onShowChain && (
          <Button
            variant="link"
            size="sm"
            className="justify-self-start px-0"
            onClick={onShowChain}
          >
            See the whole chain
          </Button>
        )}
      </section>

      <section className="grid gap-3" aria-labelledby="follow-ons-suggested">
        <div className="grid gap-0.5">
          <h2 id="follow-ons-suggested" className="text-sm font-semibold">
            Goes well after this
          </h2>
          <p className="text-muted-foreground text-sm">
            Each one starts by itself when this automation finishes and works on its files.
          </p>
        </div>
        {suggested.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {followOns.following.length > 0
              ? "Every ready-made follow-on for this one is already set up."
              : "No ready-made automation is made to follow this one. Pick it in another automation's trigger, under Right after another automation runs."}
          </p>
        ) : (
          <ul className="grid gap-5">
            {suggested.map((starter) => (
              <Suggestion
                key={starter.id}
                starter={starter}
                disabled={pending !== null}
                pending={pending === `${automationId}:${starter.id}`}
                onSetUp={() => void onSetUp(automationId, automationName, starter)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Under a finished run: the ready-made automations that would carry on from it, set up in
 * one click. Shows nothing when there are none.
 */
export function FollowOnsAfterRun({
  automationId,
  automationName,
  className,
}: {
  automationId: Id<"automations">;
  automationName: string;
  className?: string;
}) {
  const followOns = useFollowOns(automationId);
  const { pending, onSetUp } = useSetUp();
  const suggested = suggestedStartersOf(followOns?.suggestions ?? []);
  if (suggested.length === 0) return null;
  return (
    <section className={cn("reveal grid gap-3", className)} aria-labelledby="run-follow-ons">
      <div className="grid gap-0.5">
        <h2 id="run-follow-ons" className="text-sm font-semibold">
          Goes well after this
        </h2>
        <p className="text-muted-foreground text-sm">
          Build one and it starts by itself each time {automationName} finishes.
        </p>
      </div>
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {suggested.map((starter) => (
          <Suggestion
            key={starter.id}
            starter={starter}
            disabled={pending !== null}
            pending={pending === `${automationId}:${starter.id}`}
            onSetUp={() => void onSetUp(automationId, automationName, starter)}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * On Home: a few follow-ons that would carry on from the team's automations that are on,
 * each built in one click. Shows nothing when there are none.
 */
export function TeamFollowOns({ organizationId }: { organizationId: string }) {
  const picks = useQuery(api.automations.teamFollowOns, { organizationId });
  const { pending, onSetUp } = useSetUp();
  const shown = (picks ?? []).flatMap((pick) => {
    const starter = STARTERS.find((each) => each.id === pick.starterId);
    return starter ? [{ ...pick, starter }] : [];
  });
  if (shown.length === 0) return null;
  return (
    <section className="grid content-start gap-3" aria-labelledby="home-goes-well">
      <div className="grid gap-0.5">
        <h2 id="home-goes-well" className="text-sm font-medium">
          Goes well with what you have
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">
          Each one starts by itself when the automation it follows finishes.
        </p>
      </div>
      <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((pick) => (
          <Suggestion
            key={`${pick.automationId}:${pick.starterId}`}
            starter={pick.starter}
            after={pick.automationName}
            disabled={pending !== null}
            pending={pending === `${pick.automationId}:${pick.starterId}`}
            onSetUp={() => void onSetUp(pick.automationId, pick.automationName, pick.starter)}
          />
        ))}
      </ul>
    </section>
  );
}
