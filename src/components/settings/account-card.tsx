"use client";

import { AccountSettings } from "@/components/auth/settings/account/account-settings";
import { SecuritySettings } from "@/components/auth/settings/security/security-settings";

import { SettingsSection } from "./settings-shell";

/**
 * Your account: Better Auth UI's own cards (src/components/auth/settings). Each part is its
 * own component so the page can be split into tabs.
 */
export function AccountCard() {
  return (
    <div className="flex flex-col gap-10">
      <AccountProfile />
      <AccountSecurity />
    </div>
  );
}

/** Your name and email address. A new address is approved from the old one first. */
export function AccountProfile() {
  return (
    <SettingsSection>
      <AccountSettings />
    </SettingsSection>
  );
}

/** Your password, linked sign-ins, and every device you are signed in on. */
export function AccountSecurity() {
  return (
    <SettingsSection>
      <SecuritySettings />
    </SettingsSection>
  );
}
