import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";

// The shell shows a loader until the browser knows who is signed in, so pages inside it
// cannot be checked for instant navigation. Opted out on purpose.
export const instant = false;

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
