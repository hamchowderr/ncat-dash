"use client";

import { api } from "@convex/_generated/api";
import { baseName, folderTrail, isFolderKey, parentOf } from "@ncat-dash/automation-core";
import { useAction } from "convex/react";
import { ChevronRight, Folder, HardDrive } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

type FolderEntry = { key: string; name: string };

/** Picks the folder to move things into, by walking the bucket's folders. */
export function MoveDialog({
  organizationId,
  bucket,
  keys,
  startAt,
  onMove,
  onClose,
}: {
  organizationId: string;
  bucket: string;
  keys: string[];
  startAt: string;
  onMove: (toFolder: string) => void;
  onClose: () => void;
}) {
  const loadFolders = useAction(api.files.folders);
  const [at, setAt] = useState(startAt);
  const [loaded, setLoaded] = useState<{ at: string; folders: FolderEntry[] } | null>(null);

  useEffect(() => {
    let live = true;
    loadFolders({ organizationId, prefix: at })
      .then((folders) => live && setLoaded({ at, folders }))
      .catch(() => live && setLoaded({ at, folders: [] }));
    return () => {
      live = false;
    };
  }, [at, loadFolders, organizationId]);

  const folders = loaded?.at === at ? loaded.folders : null;
  const moving = new Set(keys);
  // Somewhere is a valid place when nothing being moved is already there or contains it.
  const alreadyHere = keys.every((key) => parentOf(key) === at);
  const insideItself = keys.some((key) => isFolderKey(key) && at.startsWith(key));
  const what = keys.length === 1 ? `"${baseName(keys[0])}"` : `${keys.length} items`;
  const here = at === "" ? bucket : baseName(at);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move {what}</DialogTitle>
          <DialogDescription>Open the folder it should go in, then move it here.</DialogDescription>
        </DialogHeader>

        <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            className="hover:bg-muted flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium"
            onClick={() => setAt("")}
          >
            <HardDrive className="size-4" aria-hidden="true" />
            {bucket}
          </button>
          {folderTrail(at).map((folder) => (
            <span key={folder.prefix} className="flex items-center gap-1">
              <ChevronRight className="text-muted-foreground size-3.5" aria-hidden="true" />
              <button
                type="button"
                className="hover:bg-muted rounded-md px-1.5 py-1 font-medium"
                onClick={() => setAt(folder.prefix)}
              >
                {folder.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="h-64 overflow-y-auto rounded-lg border">
          {folders === null ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : folders.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">No folders inside {here}.</p>
          ) : (
            <ul className="p-1">
              {folders.map((folder) => (
                <li key={folder.key}>
                  <button
                    type="button"
                    disabled={moving.has(folder.key)}
                    className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left disabled:pointer-events-none disabled:opacity-50"
                    onClick={() => setAt(folder.key)}
                  >
                    <Folder className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={alreadyHere || insideItself} onClick={() => onMove(at)}>
            {alreadyHere ? "Already here" : `Move to ${here}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
