import type { Metadata } from "next";

import { AuthView } from "@/components/auth/auth-view";

export const metadata: Metadata = { title: "Choose a new password" };

export default function Page() {
  return <AuthView view="resetPassword" />;
}
