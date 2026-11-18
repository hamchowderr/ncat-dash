import type { Metadata } from "next";
import { Suspense } from "react";

import { PortalView } from "@/components/portal/portal-view";

// A client opens this from a link the team sent; nobody signs in here.
export const metadata: Metadata = { title: "Projects", robots: { index: false, follow: false } };
export const instant = false;

async function Portal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PortalView token={token} />;
}

export default function Page(props: PageProps<"/portal/[token]">) {
  return (
    <div className="bg-background min-h-svh">
      <Suspense>
        <Portal params={props.params} />
      </Suspense>
    </div>
  );
}
