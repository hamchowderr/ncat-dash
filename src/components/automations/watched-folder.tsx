"use client";

import { api } from "@convex/_generated/api";
import { baseName } from "@takewon/automation-core";
import { useQuery } from "convex/react";
import { Folder, HardDrive } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { FolderBrowser } from "@/components/files/folder-browser";
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
import { useActiveTeam } from "@/lib/team-context";

/**
 * Shows the folder a watched-folder trigger looks at and lets the person pick another
 * from the bucket. Nobody types a path.
 */
export function WatchedFolder({
  id,
  prefix,
  onChange,
}: {
  id: string;
  prefix: string;
  onChange: (prefix: string) => void;
}) {
  const team = useActiveTeam();
  const storage = useQuery(api.storage.get, { organizationId: team.id });
  const [picking, setPicking] = useState(false);

  if (storage === undefined) return <Skeleton className="h-10" />;
  if (storage === null) {
    return (
      <p className="text-muted-foreground text-sm text-pretty">
        Your files go to your toolkit&apos;s storage.{" "}
        <Link href="/" className="text-foreground underline underline-offset-4">
          Connect your toolkit
        </Link>{" "}
        first, then pick a folder in it here.
      </p>
    );
  }

  const whole = prefix === "";
  return (
    <>
      <div className="bg-surface flex items-center gap-3 rounded-lg px-3 py-2">
        {whole ? (
          <HardDrive className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        ) : (
          <Folder className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p id={`${id}-name`} className="truncate text-sm font-medium">
            {whole ? "All your files" : baseName(prefix)}
          </p>
          <p className="text-muted-foreground truncate text-xs">Your files/{prefix}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          id={id}
          aria-describedby={`${id}-name`}
          onClick={() => setPicking(true)}
        >
          Change
        </Button>
      </div>
      {picking && (
        <FolderPickerDialog
          organizationId={team.id}
          bucket="Your files"
          startAt={prefix}
          onPick={(picked) => {
            onChange(picked);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

function FolderPickerDialog({
  organizationId,
  bucket,
  startAt,
  onPick,
  onClose,
}: {
  organizationId: string;
  bucket: string;
  startAt: string;
  onPick: (prefix: string) => void;
  onClose: () => void;
}) {
  const [at, setAt] = useState(startAt);
  const here = at === "" ? "all your files" : baseName(at);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pick the folder to watch</DialogTitle>
          <DialogDescription>
            Open the folder, then watch it. Files that land in it, or in folders inside it, start a
            run.
          </DialogDescription>
        </DialogHeader>
        <FolderBrowser
          organizationId={organizationId}
          bucket={bucket}
          at={at}
          onOpen={setAt}
          canCreate
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onPick(at)}>Watch {here}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
