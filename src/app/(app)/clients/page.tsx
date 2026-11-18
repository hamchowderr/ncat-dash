import type { Metadata } from "next";

import { ClientsView } from "@/components/clients/clients-view";

export const metadata: Metadata = { title: "Clients" };
export const instant = false;

export default function Page() {
  return <ClientsView />;
}
