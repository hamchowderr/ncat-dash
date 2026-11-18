"use client";

import { baseName, isFolderKey, parentOf } from "@ncat-dash/automation-core";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { FolderBrowser } from "./folder-browser";

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
  const [at, setAt] = useState(startAt);
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

        <FolderBrowser
          organizationId={organizationId}
          bucket={bucket}
          at={at}
          onOpen={setAt}
          disabled={new Set(keys)}
        />

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
