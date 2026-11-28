import type { ReactNode } from "react";

import { PlatformAdminEyebrow } from "@/components/admin/operator-only";

// Every Platform Admin page carries the section's name above its own heading.
export default function PlatformAdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <PlatformAdminEyebrow />
      {children}
    </div>
  );
}
