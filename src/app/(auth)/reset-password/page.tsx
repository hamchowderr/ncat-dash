import type { Metadata } from "next";
import { Suspense } from "react";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { FullPageLoader } from "@/components/full-page-loader";

export const metadata: Metadata = { title: "Choose a new password" };

export default function Page() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
