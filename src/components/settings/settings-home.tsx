"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { settingsPathFor } from "./settings-pages";
import { SettingsLoading } from "./settings-shell";

/**
 * Settings opens on Brand. Links made when settings was one long page
 * (`/settings#notifications`) still land on the page that section moved to.
 */
export function SettingsHome() {
  const router = useRouter();
  useEffect(() => {
    router.replace(settingsPathFor(window.location.hash));
  }, [router]);
  return <SettingsLoading />;
}
