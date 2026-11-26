import type { Metadata } from "next";

import { SubscribersView } from "@/components/admin/subscribers-view";

export const metadata: Metadata = { title: "Subscribers" };
export const instant = false;

export default function Page() {
  return <SubscribersView />;
}
