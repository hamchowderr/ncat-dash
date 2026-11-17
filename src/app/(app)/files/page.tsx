import type { Metadata } from "next";
import { Suspense } from "react";

import { FilesView } from "@/components/files/files-view";

export const metadata: Metadata = { title: "Files" };
export const instant = false;

export default function Page() {
  // The open folder is in the address (?path=), which is only known in the browser.
  return (
    <Suspense>
      <FilesView />
    </Suspense>
  );
}
