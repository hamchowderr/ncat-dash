"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { MessagesSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, stepTitle } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { MediaPreview } from "./media-preview";

const finishedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function OutputsView() {
  const team = useActiveTeam();
  const groups = useQuery(api.jobs.outputs, { organizationId: team.id });
  const createReview = useMutation(api.reviews.create);
  const router = useRouter();
  const [sending, setSending] = useState<string | null>(null);

  // Opens a room with these files so the team can look at them together.
  async function review(jobId: string, title: string, urls: string[]) {
    setSending(jobId);
    try {
      const reviewId = await createReview({ organizationId: team.id, title, urls });
      router.push(`/review/${reviewId}`);
    } catch (error) {
      toast.error(errorMessage(error, "The review could not be opened."));
      setSending(null);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Outputs</h1>
        <p className="text-muted-foreground text-sm">
          Every file your steps have produced. The files live in your toolkit&apos;s own storage.
        </p>
      </div>

      {groups === undefined ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
          <p className="text-muted-foreground text-sm">
            No files yet. They show up here as soon as a step finishes.
          </p>
          <Button asChild size="sm">
            <Link href="/steps">Browse steps</Link>
          </Button>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.jobId} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium">
                {stepTitle(group.stepId)}
                {group.finishedAt && (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    · {finishedAt.format(group.finishedAt)}
                  </span>
                )}
              </h2>
              <Button
                size="sm"
                variant="outline"
                disabled={sending !== null}
                onClick={() => review(group.jobId, stepTitle(group.stepId), group.urls)}
              >
                <MessagesSquare />
                Send to review
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.urls.map((url) => (
                <MediaPreview key={url} url={url} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
