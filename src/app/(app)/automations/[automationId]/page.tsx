import type { Id } from "@convex/_generated/dataModel";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AutomationEditor } from "@/components/automations/automation-editor";

export const metadata: Metadata = { title: "Automation" };
export const instant = false;

// Automation ids are only known once someone is signed in, so the page reads its
// address in the browser's own pass.
async function Editor({ params }: { params: Promise<{ automationId: string }> }) {
  const { automationId } = await params;
  return <AutomationEditor automationId={automationId as Id<"automations">} />;
}

export default function Page(props: PageProps<"/automations/[automationId]">) {
  return (
    <Suspense>
      <Editor params={props.params} />
    </Suspense>
  );
}
