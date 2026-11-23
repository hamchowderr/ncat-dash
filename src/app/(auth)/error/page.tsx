import type { Metadata } from "next";

import { AuthView } from "@/components/auth/auth-view";

export const metadata: Metadata = { title: "Something went wrong" };

export default function Page() {
  return <AuthView view="error" />;
}
