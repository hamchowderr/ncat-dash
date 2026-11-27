import type { Metadata } from "next";

import { BetaTestersView } from "@/components/admin/beta-testers-view";

export const metadata: Metadata = { title: "Beta Testers" };
export const instant = false;

export default function Page() {
  return <BetaTestersView />;
}
