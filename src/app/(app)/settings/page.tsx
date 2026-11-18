import type { Metadata } from "next";

import { SettingsHome } from "@/components/settings/settings-home";

export const metadata: Metadata = { title: "Settings" };
export const instant = false;

export default function Page() {
  return <SettingsHome />;
}
