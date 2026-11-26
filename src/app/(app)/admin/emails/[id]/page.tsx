import type { Metadata } from "next";

import { SentEmailView } from "@/components/admin/sent-emails-view";

export const metadata: Metadata = { title: "Sent Email" };
export const instant = false;

export default async function Page({ params }: PageProps<"/admin/emails/[id]">) {
  const { id } = await params;
  return <SentEmailView id={id} />;
}
