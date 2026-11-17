import type { Id } from "@convex/_generated/dataModel";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ReviewRoom } from "@/components/review/review-room";

export const metadata: Metadata = { title: "Review" };
export const instant = false;

// Review ids are only known once someone is signed in, so the page reads its address in
// the browser's own pass.
async function Room({
  params,
  searchParams,
}: {
  params: Promise<{ reviewId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reviewId } = await params;
  const query = await searchParams;
  const one = (value: string | string[] | undefined) =>
    typeof value === "string" && value !== "" ? value : undefined;
  return (
    <ReviewRoom
      reviewId={reviewId as Id<"reviews">}
      focus={{ clip: one(query.clip), comment: one(query.comment) }}
    />
  );
}

export default function Page(props: PageProps<"/review/[reviewId]">) {
  return (
    <Suspense>
      <Room params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
