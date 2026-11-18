import type { Metadata } from "next";
import { Suspense } from "react";

import { PortalProject } from "@/components/portal/portal-view";

export const metadata: Metadata = { title: "Project", robots: { index: false, follow: false } };
export const instant = false;

async function One({ params }: { params: Promise<{ token: string; projectId: string }> }) {
  const { token, projectId } = await params;
  return <PortalProject token={token} projectId={projectId} />;
}

export default function Page(props: PageProps<"/portal/[token]/[projectId]">) {
  return (
    <div className="bg-background min-h-svh">
      <Suspense>
        <One params={props.params} />
      </Suspense>
    </div>
  );
}
