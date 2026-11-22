import type { Id } from "@convex/_generated/dataModel";
import type { Metadata } from "next";
import { Suspense } from "react";

import { CreatorView } from "@/components/creators/creator-view";

export const metadata: Metadata = { title: "Creator" };
export const instant = false;

async function One({ params }: { params: Promise<{ creatorId: string }> }) {
  const { creatorId } = await params;
  return <CreatorView creatorId={creatorId as Id<"creators">} />;
}

export default function Page(props: PageProps<"/creators/[creatorId]">) {
  return (
    <Suspense>
      <One params={props.params} />
    </Suspense>
  );
}
