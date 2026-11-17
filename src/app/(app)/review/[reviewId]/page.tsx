import type { Id } from "@convex/_generated/dataModel";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ReviewRoom } from "@/components/review/review-room";

export const metadata: Metadata = { title: "Review" };
export const instant = false;

// Review ids are only known once someone is signed in, so the page reads its address in
// the browser's own pass.
async function Room({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  return <ReviewRoom reviewId={reviewId as Id<"reviews">} />;
}

export default function Page(props: PageProps<"/review/[reviewId]">) {
  return (
    <Suspense>
      <Room params={props.params} />
    </Suspense>
  );
}
