import type { Metadata } from "next";

import { OutputsView } from "@/components/jobs/outputs-view";

export const metadata: Metadata = { title: "Outputs" };
export const instant = false;

export default function Page() {
  return <OutputsView />;
}
