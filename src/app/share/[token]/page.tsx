import type { Metadata } from "next";
import { Suspense } from "react";

import { SharedReview } from "@/components/review/shared-review";

// A client opens this from a link the team sent; nobody signs in here.
export const metadata: Metadata = { title: "Review", robots: { index: false, follow: false } };
export const instant = false;

async function Shared({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  // Opened from a client's portal: a way back to the project there.
  const { back } = await searchParams;
  const backHref =
    typeof back === "string" && /^\/portal\/[a-f0-9]{64}\/[a-z0-9]+$/.test(back) ? back : undefined;
  return <SharedReview token={token} backHref={backHref} />;
}

export default function Page(props: PageProps<"/share/[token]">) {
  return (
    <main className="bg-background min-h-svh">
      <Suspense>
        <Shared params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
