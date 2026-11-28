import type { Metadata } from "next";
import { Suspense } from "react";

import { HelpView } from "@/components/support/help-view";

export const metadata: Metadata = { title: "Get Help" };
export const instant = false;

export default function Page() {
  // Which question is open (?ticket=) is in the address, which is only known in the browser.
  return (
    <Suspense>
      <HelpView />
    </Suspense>
  );
}
