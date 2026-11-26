import type { Metadata } from "next";
import { Suspense } from "react";

import { SupportInbox } from "@/components/support/support-inbox";

export const metadata: Metadata = { title: "Support" };
export const instant = false;

export default function Page() {
  // Which question is open (?ticket=) is in the address, which is only known in the browser.
  return (
    <Suspense>
      <SupportInbox />
    </Suspense>
  );
}
