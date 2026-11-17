"use client";

import { api } from "@convex/_generated/api";
import { statusLabel } from "@ncat-dash/review-core";
import { useQuery } from "convex/react";
import { Check, Workflow } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveTeam } from "@/lib/team-context";

import { isStill } from "./clip-stage";

const opened = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function count(amount: number, one: string, many: string) {
  return `${amount} ${amount === 1 ? one : many}`;
}

export function ReviewsView() {
  const team = useActiveTeam();
  const reviews = useQuery(api.reviews.list, { organizationId: team.id });

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
        <p className="text-muted-foreground max-w-prose text-sm">
          Watch clips together, leave notes on the exact moment, and approve what is ready.
        </p>
      </div>

      {reviews === undefined ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : reviews.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
          <p className="text-muted-foreground max-w-prose text-sm">
            Nothing to review yet. A review opens by itself when an automation reaches an approval
            step, and you can send any finished files here from Outputs.
          </p>
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link href="/outputs">Go to Outputs</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/automations">Automations</Link>
            </Button>
          </div>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {reviews.map((review) => (
            <li key={review._id}>
              <Link
                href={`/review/${review._id}`}
                className="group bg-card hover:border-foreground/25 focus-visible:ring-ring/50 flex h-full gap-3 rounded-xl border p-3 outline-none transition-colors focus-visible:ring-3"
              >
                <span className="flex h-24 w-[4.25rem] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black">
                  {review.cover &&
                    (isStill(review.cover) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={review.cover}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <video
                        src={`${review.cover}#t=0.1`}
                        muted
                        playsInline
                        preload="metadata"
                        tabIndex={-1}
                        aria-hidden="true"
                        className="size-full object-cover"
                      />
                    ))}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="line-clamp-2 leading-snug font-medium">{review.title}</span>
                  <span className="text-muted-foreground text-xs">
                    {count(review.clips, "clip", "clips")} ·{" "}
                    {review.comments === 0
                      ? "no comments"
                      : review.open === 0
                        ? "all comments resolved"
                        : `${review.open} to resolve`}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {opened.format(review.createdAt)}
                  </span>
                  <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    <Badge
                      variant={
                        review.status === "open"
                          ? "secondary"
                          : review.status === "approved"
                            ? "default"
                            : "destructive"
                      }
                    >
                      {review.status === "approved" && <Check />}
                      {statusLabel(review.status)}
                    </Badge>
                    {review.fromRun && (
                      <Badge variant="outline">
                        <Workflow />
                        From an automation
                      </Badge>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
