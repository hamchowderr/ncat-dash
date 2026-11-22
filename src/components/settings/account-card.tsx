"use client";

import { AccountSettings } from "@/components/auth/settings/account/account-settings";
import { SecuritySettings } from "@/components/auth/settings/security/security-settings";

import { TabsContent } from "@/components/ui/tabs";

import { SettingsSection, SettingsTabs } from "./settings-shell";

/**
 * Your account: Better Auth UI's own cards (src/components/auth/settings). Each part is its
 * own component, one per tab.
 */
export function AccountCard() {
  return (
    <SettingsTabs
      label="Account"
      tabs={[
        { id: "profile", label: "Profile" },
        { id: "security", label: "Password And Devices" },
      ]}
    >
      <TabsContent value="profile">
        <AccountProfile />
      </TabsContent>
      <TabsContent value="security">
        <AccountSecurity />
      </TabsContent>
    </SettingsTabs>
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
