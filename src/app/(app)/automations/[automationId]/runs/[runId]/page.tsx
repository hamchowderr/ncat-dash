import type { Id } from "@convex/_generated/dataModel";
import type { Metadata } from "next";
import { Suspense } from "react";

import { RunView } from "@/components/automations/run-view";

export const metadata: Metadata = { title: "Run" };
export const instant = false;

async function Run({ params }: { params: Promise<{ automationId: string; runId: string }> }) {
  const { automationId, runId } = await params;
  return <RunView automationId={automationId as Id<"automations">} runId={runId as Id<"runs">} />;
}

export default function Page(props: PageProps<"/automations/[automationId]/runs/[runId]">) {
  return (
    <Suspense>
      <Run params={props.params} />
    </Suspense>
  );
}
