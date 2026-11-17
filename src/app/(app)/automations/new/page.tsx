import type { Metadata } from "next";

import { NewAutomationView } from "@/components/automations/new-automation-view";

export const metadata: Metadata = { title: "New automation" };
export const instant = false;

export default function Page() {
  return <NewAutomationView />;
}
