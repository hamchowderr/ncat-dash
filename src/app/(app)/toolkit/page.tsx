import type { Metadata } from "next";

import { ToolkitView } from "@/components/toolkit/toolkit-view";

export const metadata: Metadata = { title: "Toolkit" };
export const instant = false;

export default function Page() {
  return <ToolkitView />;
}
