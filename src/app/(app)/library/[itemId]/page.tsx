import type { Id } from "@convex/_generated/dataModel";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LibraryItemView } from "@/components/library/library-item-view";

export const metadata: Metadata = { title: "Library" };
export const instant = false;

// Library ids are only known once someone is signed in, so the page reads its address in
// the browser's own pass. ?t= opens it at a moment, ?q= marks the words searched for.
async function Item({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { itemId } = await params;
  const query = await searchParams;
  const at = typeof query.t === "string" ? Number(query.t) : NaN;
  return (
    <LibraryItemView
      itemId={itemId as Id<"libraryItems">}
      at={Number.isFinite(at) && at >= 0 ? at : undefined}
      search={typeof query.q === "string" ? query.q : undefined}
    />
  );
}

export default function Page(props: PageProps<"/library/[itemId]">) {
  return (
    <Suspense>
      <Item params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
