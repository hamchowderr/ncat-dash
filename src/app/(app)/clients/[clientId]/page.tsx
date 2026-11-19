import type { Id } from "@convex/_generated/dataModel";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ClientView } from "@/components/clients/client-view";

export const metadata: Metadata = { title: "Client" };
export const instant = false;

async function One({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return <ClientView clientId={clientId as Id<"clients">} />;
}

export default function Page(props: PageProps<"/clients/[clientId]">) {
  return (
    <Suspense>
      <One params={props.params} />
    </Suspense>
  );
}
