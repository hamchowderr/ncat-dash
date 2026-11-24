import type { Metadata } from "next";
import { Suspense } from "react";

import { FilesPage } from "@/components/files/files-page";

export const metadata: Metadata = { title: "Files" };
export const instant = false;

export default function Page() {
  // The open tab and folder are in the address (?tab=, ?path=), only known in the browser.
  return (
    <Suspense>
      <FilesPage />
    </Suspense>
  );
}
