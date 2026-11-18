import type { Id } from "@convex/_generated/dataModel";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ProjectView } from "@/components/projects/project-view";

export const metadata: Metadata = { title: "Project" };
export const instant = false;

async function One({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectView projectId={projectId as Id<"projects">} />;
}

export default function Page(props: PageProps<"/projects/[projectId]">) {
  return (
    <Suspense>
      <One params={props.params} />
    </Suspense>
  );
}
