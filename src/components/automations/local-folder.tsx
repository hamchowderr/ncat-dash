"use client";

import { FolderInput } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  chooseFolderOnDesktop,
  type DesktopWatch,
  inDesktopApp,
  unwatchFolderOnDesktop,
  watchedFoldersOnDesktop,
  watchFolderOnDesktop,
} from "@/lib/desktop";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

/**
 * In the desktop app, under a folder trigger: a folder on this computer whose new files go
 * to the trigger's folder in storage, so dropping a recording there starts a run. Nothing
 * shows in a browser.
 */
export function LocalFolder({
  automationId,
  automationName,
  prefix,
}: {
  automationId: string;
  automationName: string;
  prefix: string;
}) {
  const team = useActiveTeam();
  const [desktop] = useState(inDesktopApp);
  const [watch, setWatch] = useState<DesktopWatch | null | undefined>(undefined);

  useEffect(() => {
    if (!desktop) return;
    let live = true;
    void watchedFoldersOnDesktop().then((watches) => {
      if (live) setWatch(watches.find((each) => each.automationId === automationId) ?? null);
    });
    return () => {
      live = false;
    };
  }, [desktop, automationId]);

  // The trigger's storage folder changed: the computer's folder now feeds the new one.
  useEffect(() => {
    if (!watch || watch.prefix === prefix) return;
    void watchFolderOnDesktop({ ...watch, prefix, automationName })
      .then(setWatch)
      .catch(() => null);
  }, [watch, prefix, automationName]);

  if (!desktop || watch === undefined) return null;

  async function choose() {
    try {
      const folder = await chooseFolderOnDesktop();
      if (!folder) return;
      setWatch(
        await watchFolderOnDesktop({
          automationId,
          automationName,
          organizationId: team.id,
          prefix,
          folder,
        }),
      );
    } catch (caught) {
      toast.error(errorMessage(caught, "That folder could not be watched."));
    }
  }

  async function stop() {
    try {
      await unwatchFolderOnDesktop(automationId);
      setWatch(null);
    } catch (caught) {
      toast.error(errorMessage(caught, "That folder could not be let go."));
    }
  }

  return (
    <div className="flex flex-col gap-2" data-local-folder>
      {watch ? (
        <>
          <p className="text-sm">
            Also from <span className="font-medium break-all">{watch.folder}</span> on this
            computer.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void choose()}>
              Choose another
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void stop()}>
              Stop
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" variant="outline" className="self-start" onClick={() => void choose()}>
          <FolderInput />
          Also from a folder on this computer
        </Button>
      )}
      <p className="text-muted-foreground text-xs">
        Files added there, and in folders inside it, go up to this folder while the app is open,
        once they have stopped changing. Files already there are left alone.
      </p>
    </div>
  );
}
