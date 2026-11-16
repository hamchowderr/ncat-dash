import type { Metadata } from "next";

import { JobsView } from "@/components/jobs/jobs-view";

export const metadata: Metadata = { title: "Jobs" };
export const instant = false;

export default function Page() {
  return <JobsView />;
}
