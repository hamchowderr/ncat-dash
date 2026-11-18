"use client";

import { api } from "@convex/_generated/api";
import { statusLabel } from "@ncat-dash/review-core";
import { useQuery } from "convex/react";
import { Check, ChevronRight, Workflow } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { isStill } from "./clip-stage";

type Listed = NonNullable<ReturnType<typeof useQuery<typeof api.reviews.list>>>[number];

const opened = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function count(amount: number, one: string, many: string) {
  return `${amount} ${amount === 1 ? one : many}`;
}

/** One clip's picture in a review's strip: a still as itself, a video as its first frame. */
function Cover({ url }: { url: string }) {
  return (
    <span className="flex aspect-[9/16] h-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black">
      {isStill(url) ? (
        // The file sits in the team's own storage, so there is nothing for Next to resize.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <video
          src={`${url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden="true"
          className="size-full object-cover"
        />
      )}
    </span>
  );
}

/** One fact in its own column of a review's row, shown on wide screens. */
function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <span
      data-fact={label}
      className={cn("hidden shrink-0 flex-col gap-0.5 2xl:flex", wide ? "w-44" : "w-36")}
    >
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm first-letter:uppercase">{value}</span>
    </span>
  );
}

/** A review as one full-width row: every clip's picture, what it is, and where it stands. */
function ReviewRow({ review }: { review: Listed }) {
  // A backend older than this screen sends only the first clip's picture.
  const covers: string[] = review.covers ?? (review.cover ? [review.cover] : []);
  const more = review.clips - covers.length;
  const comments =
    review.comments === 0
      ? "no comments"
      : review.open === 0
        ? "all comments resolved"
        : `${review.open} to resolve`;
  return (
    <li>
      <Link
        href={`/review/${review._id}`}
        transitionTypes={["nav-forward"]}
        className="group hover:bg-muted focus-visible:ring-ring/50 flex flex-col gap-4 rounded-xl bg-surface p-3 outline-none transition-colors focus-visible:ring-3 sm:flex-row sm:items-center"
      >
        <span data-strip="" className="flex h-36 shrink-0 gap-1.5 overflow-hidden">
          {covers.map((url, at) => (
            <Cover key={`${at}:${url}`} url={url} />
          ))}
          {more > 0 && (
            <span className="text-muted-foreground flex aspect-[9/16] h-full items-center justify-center rounded-lg bg-muted text-sm font-medium">
              +{more}
            </span>
          )}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="line-clamp-2 text-base leading-snug font-medium">{review.title}</span>
          {/* On a narrow screen the facts sit under the title; wide, they get columns. */}
          <span className="text-muted-foreground text-sm 2xl:hidden">
            {count(review.clips, "clip", "clips")} · {comments}
          </span>
          <span className="text-muted-foreground text-xs 2xl:hidden">
            Opened {opened.format(review.createdAt)}
          </span>
          {review.fromRun && (
            <span className="pt-1">
              <Badge variant="outline">
                <Workflow />
                From an automation
              </Badge>
            </span>
          )}
        </span>

        <Fact label="Clips" value={String(review.clips)} />
        <Fact label="Comments" value={comments} />
        <Fact label="Opened" value={opened.format(review.createdAt)} wide />

        <span className="flex shrink-0 items-center justify-end gap-3 sm:pr-2 2xl:w-40">
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
          <ChevronRight
            aria-hidden="true"
            className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </li>
  );
}

function Section({ title, reviews, empty }: { title: string; reviews: Listed[]; empty?: string }) {
  if (reviews.length === 0 && !empty) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        {title}
        <span className="text-muted-foreground font-normal">{reviews.length}</span>
      </h2>
      {reviews.length === 0 ? (
        <p className="text-muted-foreground rounded-xl bg-surface px-4 py-3 text-sm">{empty}</p>
      ) : (
        <ul className="reveal flex flex-col gap-2">
          {reviews.map((review) => (
            <ReviewRow key={review._id} review={review} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function ReviewsView() {
  const team = useActiveTeam();
  const reviews = useQuery(api.reviews.list, { organizationId: team.id });

  const waiting = reviews?.filter((review) => review.status === "open") ?? [];
  const decided = reviews?.filter((review) => review.status !== "open") ?? [];
  const toResolve = waiting.reduce((sum, review) => sum + review.open, 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
          <p className="text-muted-foreground max-w-prose text-sm">
            Watch clips together, leave notes on the exact moment, and approve what is ready.
          </p>
        </div>
        {reviews !== undefined && reviews.length > 0 && (
          <dl aria-label="At a glance" className="flex gap-2">
            {[
              ["Waiting for a decision", waiting.length],
              ["Comments to resolve", toResolve],
              ["Decided", decided.length],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col rounded-xl bg-surface px-4 py-2.5">
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {reviews === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-38 rounded-xl" />
          <Skeleton className="h-38 rounded-xl" />
        </div>
      ) : reviews.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-surface p-6">
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
        <>
          <Section
            title="Waiting for a decision"
            reviews={waiting}
            empty="Nothing is waiting for a decision right now."
          />
          <Section title="Decided" reviews={decided} />
        </>
      )}
    </>
  );
}
