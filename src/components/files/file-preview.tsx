"use client";

import { api } from "@convex/_generated/api";
import { fileDetailRows } from "@takewon/automation-core";
import { useAction } from "convex/react";
import { Download, Link2 } from "lucide-react";
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
import { formatBytes } from "@/lib/catalog";

import type { FileEntry } from "./files-view";

const changedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Plays or shows one file from the bucket, with what is known about it. */
export function FilePreview({
  organizationId,
  file,
  onDownload,
  onCopyLink,
  onClose,
}: {
  organizationId: string;
  file: FileEntry;
  onDownload: () => void;
  onCopyLink: () => void;
  onClose: () => void;
}) {
  const linkFor = useAction(api.files.linkFor);
  const [link, setLink] = useState<{ key: string; url: string } | null>(null);
  const playable = file.kind !== "other";

  useEffect(() => {
    if (!playable) return;
    let live = true;
    linkFor({ organizationId, key: file.key, use: "view" })
      .then((url) => live && setLink({ key: file.key, url }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [file.key, linkFor, organizationId, playable]);

  const url = link?.key === file.key ? link.url : null;
  const rows: [string, string][] = [
    ...(file.details ? fileDetailRows(file.details, file.name) : []),
    ["File size", formatBytes(file.size)],
    ["Changed", changedAt.format(file.lastModified)],
    ["Where", file.key],
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{file.name}</DialogTitle>
          <DialogDescription className="sr-only">A preview of this file.</DialogDescription>
        </DialogHeader>

        {playable && (
          <div className="bg-surface overflow-hidden rounded-lg">
            {!url ? (
              <Skeleton className="aspect-video w-full rounded-none" />
            ) : file.kind === "video" ? (
              <video
                src={url}
                controls
                preload="metadata"
                className="aspect-video w-full bg-black"
              />
            ) : file.kind === "audio" ? (
              <div className="p-3">
                <audio src={url} controls preload="metadata" className="w-full" />
              </div>
            ) : (
              // The file sits in the team's own storage, so there is nothing for Next to resize.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="max-h-80 w-full object-contain" />
            )}
          </div>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="col-span-2 grid grid-cols-subgrid">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <DialogFooter>
          <Button variant="outline" onClick={onCopyLink}>
            <Link2 />
            Copy link
          </Button>
          <Button onClick={onDownload}>
            <Download />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
