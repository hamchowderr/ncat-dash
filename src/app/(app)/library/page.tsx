import type { Metadata } from "next";

import { LibraryView } from "@/components/library/library-view";

export const metadata: Metadata = { title: "Library" };
export const instant = false;

export default function Page() {
  return <LibraryView />;
}
