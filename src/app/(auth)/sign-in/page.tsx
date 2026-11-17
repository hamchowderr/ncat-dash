import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/auth-form";
import { FullPageLoader } from "@/components/full-page-loader";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <AuthForm mode="sign-in" />
    </Suspense>
  );
}
