"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, Link2, Link2Off } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/catalog";

/** The address a client opens. */
export function shareUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/share/${token}`;
}

function Choice({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

/**
 * Shares a review with someone outside the team, such as a client: a link they open
 * without an account to watch, comment and, if the team wants, approve.
 */
export function ShareDialog({ reviewId }: { reviewId: Id<"reviews"> }) {
  const [open, setOpen] = useState(false);
  const share = useQuery(api.reviewShares.forReview, open ? { reviewId } : "skip");
  const set = useMutation(api.reviewShares.set);
  const stop = useMutation(api.reviewShares.stop);
  // Before the link exists, the choices are only kept here.
  const [draft, setDraft] = useState({ allowVerdict: true, showTeamComments: false });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Only the two choices, never the token, go back to the server.
  const settings = {
    allowVerdict: (share ?? draft).allowVerdict,
    showTeamComments: (share ?? draft).showTeamComments,
  };

  async function save(next: { allowVerdict: boolean; showTeamComments: boolean }) {
    if (!share) {
      setDraft(next);
      return;
    }
    try {
      await set({ reviewId, ...next });
    } catch (error) {
      toast.error(errorMessage(error, "That could not be saved."));
    }
  }

  async function create() {
    setBusy(true);
    try {
      await set({ reviewId, ...draft });
    } catch (error) {
      toast.error(errorMessage(error, "The link could not be made."));
    } finally {
      setBusy(false);
    }
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy the link by hand: the browser did not allow it.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-tour-step-id="tour-review-share">
          <Link2 />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share with a client</DialogTitle>
          <DialogDescription>
            Anyone with the link can watch these clips and leave comments, without an account. They
            give their name the first time.
          </DialogDescription>
        </DialogHeader>

        {share === undefined ? null : (
          <div className="grid gap-5">
            {share && (
              <div className="flex gap-2">
                <Input
                  readOnly
                  aria-label="Share link"
                  value={shareUrl(share.token)}
                  onFocus={(event) => event.currentTarget.select()}
                  className="font-mono text-xs"
                />
                <Button variant="outline" onClick={() => void copy(share.token)}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            )}
            <Choice
              id="share-verdict"
              label="Let them approve"
              hint="They can approve or ask for changes. The team is told; a teammate still makes the final call."
              checked={settings.allowVerdict}
              onChange={(allowVerdict) => void save({ ...settings, allowVerdict })}
            />
            <Choice
              id="share-team-comments"
              label="Show the team's comments"
              hint="Off: they only see their own threads and the team's replies to them."
              checked={settings.showTeamComments}
              onChange={(showTeamComments) => void save({ ...settings, showTeamComments })}
            />
            {share ? (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive justify-self-start"
                onClick={() =>
                  void stop({ reviewId }).catch((error) =>
                    toast.error(errorMessage(error, "The link could not be switched off.")),
                  )
                }
              >
                <Link2Off />
                Stop sharing
              </Button>
            ) : (
              <Button onClick={() => void create()} disabled={busy} className="justify-self-start">
                <Link2 />
                Create link
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
