import type { Metadata } from "next";
import { Suspense } from "react";

import { AcceptInvitation } from "@/components/auth/accept-invitation";
import { FullPageLoader } from "@/components/full-page-loader";

export const metadata: Metadata = { title: "Join a team" };

export default function Page() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <AcceptInvitation />
    </Suspense>
  );
}
