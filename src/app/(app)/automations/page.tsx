import type { Metadata } from "next";
import { Suspense } from "react";

import { AutomationsView } from "@/components/automations/automations-view";

export const metadata: Metadata = { title: "Automations" };
export const instant = false;

export default function Page() {
  // Which folder is open (?folder=) is in the address, which is only known in the browser.
  return (
    <Suspense>
      <AutomationsView />
    </Suspense>
  );
}
