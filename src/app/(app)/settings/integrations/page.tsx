import type { Metadata } from "next";

import { IntegrationsList } from "@/components/settings/integrations-list";

export const metadata: Metadata = { title: "Integrations · Settings" };
export const instant = false;

export default function Page() {
  return <IntegrationsList />;
}
