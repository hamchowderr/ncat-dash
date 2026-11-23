import type { Metadata } from "next";

import { AuthView } from "@/components/auth/auth-view";

export const metadata: Metadata = { title: "Confirm your email address" };

export default function Page() {
  return <AuthView view="verifyEmail" />;
}
