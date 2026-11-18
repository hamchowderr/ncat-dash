import type { Metadata } from "next";
import { Suspense } from "react";

import { NewProjectView } from "@/components/projects/new-project-view";

export const metadata: Metadata = { title: "New project" };
export const instant = false;

async function New({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { client } = await searchParams;
  return <NewProjectView clientId={typeof client === "string" ? client : undefined} />;
}

export default function Page(props: PageProps<"/projects/new">) {
  return (
    <Suspense>
      <New searchParams={props.searchParams} />
    </Suspense>
  );
}
