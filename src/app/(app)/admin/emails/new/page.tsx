import type { Metadata } from "next";

import { SendEmailView } from "@/components/admin/send-email-view";

export const metadata: Metadata = { title: "Send An Email" };
export const instant = false;

export default function Page() {
  return <SendEmailView />;
}
