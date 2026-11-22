import type { Metadata } from "next";

import { AuthView } from "@/components/auth/auth-view";

export const metadata: Metadata = { title: "Create account" };

export default function Page() {
  return <AuthView view="signUp" />;
}
