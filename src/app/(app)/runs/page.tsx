import type { Metadata } from "next";
import { Suspense } from "react";

import { RunsView } from "@/components/runs/runs-view";

export const metadata: Metadata = { title: "Runs" };
export const instant = false;

export default function Page() {
  // Which runs show (?show=failed) is in the address, which is only known in the browser.
  return (
    <Suspense>
      <RunsView />
    </Suspense>
  );
}
