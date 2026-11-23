import type { Metadata } from "next";

import { AuthView } from "@/components/auth/auth-view";

export const metadata: Metadata = { title: "Check your email" };

export default function Page() {
  return <AuthView view="resetLinkSent" />;
}
