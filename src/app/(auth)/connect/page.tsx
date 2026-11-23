import type { Metadata } from "next";
import { Suspense } from "react";

import { ConnectAgent } from "@/components/auth/connect-agent";
import { FullPageLoader } from "@/components/full-page-loader";

export const metadata: Metadata = { title: "Connect an AI agent" };

export default function Page() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <ConnectAgent step="consent" />
    </Suspense>
  );
}
