"use client";

import { AccountSettings } from "@/components/auth/settings/account/account-settings";
import { SecuritySettings } from "@/components/auth/settings/security/security-settings";

import { TabsContent } from "@/components/ui/tabs";

import { ProfileDetails } from "./profile-details";
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

/**
 * Your photo, name and email address (a new address is approved from the old one first),
 * then your role and time zone.
 */
export function AccountProfile() {
  return (
    <SettingsSection>
      <AccountSettings />
      <ProfileDetails />
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
