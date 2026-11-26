import type { Metadata } from "next";

import { SentEmailsView } from "@/components/admin/sent-emails-view";

export const metadata: Metadata = { title: "Sent Emails" };
export const instant = false;

export default function Page() {
  return <SentEmailsView />;
}
