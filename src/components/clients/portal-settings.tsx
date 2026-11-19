"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, ExternalLink, Link2, Link2Off } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/catalog";

export function portalUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/portal/${token}`;
}

type Settings = { allowVerdict: boolean; showTeamComments: boolean };

function Row({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-muted-foreground text-sm">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/**
 * The client's portal on their page: one link to send, where they see only their own
 * projects in your logo and colours, and review each one. Like a review's share link,
 * switching it off kills the link for good.
 */
export function PortalSettings({ clientId }: { clientId: Id<"clients"> }) {
  const portal = useQuery(api.portal.forClient, { clientId });
  const set = useMutation(api.portal.set);
  const stop = useMutation(api.portal.stop);
  const [draft, setDraft] = useState<Settings>({ allowVerdict: true, showTeamComments: false });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (portal === undefined) return null;
  const settings: Settings = portal
    ? { allowVerdict: portal.allowVerdict, showTeamComments: portal.showTeamComments }
    : draft;

  async function save(next: Settings) {
    if (!portal) return setDraft(next);
    try {
      await set({ clientId, ...next });
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be saved."));
    }
  }

  async function create() {
    setBusy(true);
    try {
      await set({ clientId, ...draft });
    } catch (caught) {
      toast.error(errorMessage(caught, "The portal could not be switched on."));
    } finally {
      setBusy(false);
    }
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(portalUrl(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy the link by hand: the browser did not allow it.");
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      {portal && (
        <div className="flex gap-2">
          <Input
            readOnly
            aria-label="Portal link"
            value={portalUrl(portal.token)}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-xs"
          />
          <Button variant="outline" onClick={() => void copy(portal.token)}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button asChild variant="ghost" size="icon">
            <a href={portalUrl(portal.token)} target="_blank" rel="noreferrer">
              <ExternalLink />
              <span className="sr-only">Open the portal</span>
            </a>
          </Button>
        </div>
      )}
      <Row
        id="portal-verdict"
        label="Let them approve"
        hint="In each review room they can approve or ask for changes. A teammate still makes the final call."
        checked={settings.allowVerdict}
        onChange={(allowVerdict) => void save({ ...settings, allowVerdict })}
      />
      <Row
        id="portal-team-comments"
        label="Show the team's comments"
        hint="Off: they only see their own threads and the team's replies to them."
        checked={settings.showTeamComments}
        onChange={(showTeamComments) => void save({ ...settings, showTeamComments })}
      />
      <div>
        {portal ? (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() =>
              void stop({ clientId }).catch((caught) =>
                toast.error(errorMessage(caught, "The portal could not be switched off.")),
              )
            }
          >
            <Link2Off />
            Switch off the portal
          </Button>
        ) : (
          <Button onClick={() => void create()} disabled={busy}>
            <Link2 />
            Make the portal link
          </Button>
        )}
      </div>
    </div>
  );
}
