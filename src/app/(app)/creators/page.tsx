import type { Metadata } from "next";

import { CreatorsView } from "@/components/creators/creators-view";

export const metadata: Metadata = { title: "Creators" };
export const instant = false;

export default function Page() {
  return <CreatorsView />;
}
