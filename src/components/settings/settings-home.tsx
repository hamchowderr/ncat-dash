"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { settingsPageFor } from "./settings-pages";
import { SettingsLoading } from "./settings-shell";

/**
 * Settings opens on its first page. Links made when settings was one long page
 * (`/settings#notifications`) still land on the page that section moved to.
 */
export function SettingsHome() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/settings/${settingsPageFor(window.location.hash)}`);
  }, [router]);
  return <SettingsLoading />;
}
