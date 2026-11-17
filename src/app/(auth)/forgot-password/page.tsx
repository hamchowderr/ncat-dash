import type { Metadata } from "next";
import { Suspense } from "react";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { FullPageLoader } from "@/components/full-page-loader";

export const metadata: Metadata = { title: "Reset your password" };

export default function Page() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
