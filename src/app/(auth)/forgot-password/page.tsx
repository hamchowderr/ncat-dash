import type { Metadata } from "next";

import { AuthView } from "@/components/auth/auth-view";

export const metadata: Metadata = { title: "Reset your password" };

export default function Page() {
  return <AuthView view="forgotPassword" />;
}
