"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/catalog";

import { SettingRow, SettingsSection } from "./settings-shell";

/**
 * Emails from Takewon itself rather than from a team's work: product news, which
 * nobody gets without switching it on here, at sign-up or on the website. Emails about
 * the account (password resets, invitations) always come; alerts are under Notifications.
 */
export function EmailPreferencesCard() {
  const mine = useQuery(api.news.mine, {});
  const setMine = useMutation(api.news.setMine);
  const [saving, setSaving] = useState(false);

  if (!mine) return <Skeleton className="h-16 w-full" />;

  const change = async (subscribed: boolean) => {
    setSaving(true);
    try {
      await setMine({ subscribed });
      toast.success(subscribed ? "You'll get product news." : "No more product news.");
    } catch (error) {
      toast.error(errorMessage(error, "That didn't work. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection
        title="Email Preferences"
        description={`Sent to ${mine.email}. Every email has a link to stop.`}
      >
        <SettingRow
          label="Product news"
          htmlFor="product-news"
          description={
            mine.subscribed && mine.since
              ? `New features and tips, a few times a month at most. On since ${new Date(mine.since).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.`
              : "New features and tips, a few times a month at most."
          }
        >
          <Switch
            id="product-news"
            checked={mine.subscribed}
            disabled={saving}
            onCheckedChange={(checked) => void change(checked)}
          />
        </SettingRow>
      </SettingsSection>
      <SettingsSection
        title="Always Sent"
        description="Emails about your account, such as password resets, sign-in links and invitations, and rare notices about the service. These can't be switched off. Alerts about your team's work are set above."
      >
        {null}
      </SettingsSection>
    </div>
  );
}
