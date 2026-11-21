"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { DropboxLogo } from "@/components/brand-logos";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/catalog";

/**
 * "Send to Dropbox": when on, each finished run's files also go to a Dropbox folder.
 * Shows only once someone has connected Dropbox in Settings. The folder can be changed
 * in place; saved at once, apart from the canvas's own Save.
 */
export function DropboxSend({ automationId }: { automationId: Id<"automations"> }) {
  const state = useQuery(api.dropbox.forAutomation, { automationId });
  const setSend = useMutation(api.dropbox.setSend);
  const [editing, setEditing] = useState<string | null>(null);
  if (!state) return null;

  async function save(on: boolean, folder?: string) {
    try {
      // The folder shown beside the switch says where files go, so no message pops up.
      await setSend({ automationId, on, ...(folder !== undefined ? { folder } : {}) });
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be changed."));
    }
  }

  return (
    <div className="text-muted-foreground flex items-center gap-2 text-sm" data-dropbox-send>
      <DropboxLogo className="size-4 shrink-0 text-[#0061FF]" />
      <Switch
        id="dropbox-send"
        checked={state.on}
        disabled={!state.canSwitch}
        onCheckedChange={(on) => void save(on)}
        aria-label="Send finished files to Dropbox"
      />
      <label htmlFor="dropbox-send" className="shrink-0">
        Send to Dropbox
      </label>
      {state.on &&
        (editing !== null ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const folder = editing.trim();
              setEditing(null);
              void save(true, folder);
            }}
          >
            <Input
              autoFocus
              value={editing}
              onChange={(event) => setEditing(event.target.value)}
              onBlur={() => setEditing(null)}
              onKeyDown={(event) => event.key === "Escape" && setEditing(null)}
              aria-label="Dropbox folder for finished files"
              placeholder="/Kontentifi/Your automation"
              className="h-8 w-56"
            />
          </form>
        ) : (
          <button
            type="button"
            className="text-foreground max-w-56 truncate underline-offset-4 hover:underline disabled:no-underline"
            disabled={!state.mine}
            title={
              state.mine
                ? "Change the Dropbox folder"
                : `Goes to ${state.account}'s Dropbox. Only they can change the folder.`
            }
            onClick={() => setEditing(state.folder)}
          >
            {state.folder}
          </button>
        ))}
    </div>
  );
}
