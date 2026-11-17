import type { Metadata } from "next";
import { Suspense } from "react";

import { SharedReview } from "@/components/review/shared-review";

// A client opens this from a link the team sent; nobody signs in here.
export const metadata: Metadata = { title: "Review", robots: { index: false, follow: false } };
export const instant = false;

async function Shared({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedReview token={token} />;
}

export default function Page(props: PageProps<"/share/[token]">) {
  return (
    <main className="bg-background min-h-svh">
      <Suspense>
        <Shared params={props.params} />
      </Suspense>
    </main>
  );
}
