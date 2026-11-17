"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { FileVideo, LoaderCircle, Play, Upload } from "lucide-react";
import Link from "next/link";
import { type DragEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage, formatBytes } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { putWithProgress } from "@/lib/upload";
import { cn } from "@/lib/utils";

/**
 * Hands an automation one file to run on now: drop one, or pick one already uploaded.
 * `start` gets a link to the file, or nothing for a run that needs no file.
 */
export function RunDialog({
  open,
  onOpenChange,
  startsOnUpload,
  start,
  onUploadedOnly,
  title = "Try it on one file",
  description = "Starts one run straight away, the same way it will run by itself.",
  withoutFile = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The automation is on and starts on uploads, so a dropped file starts it by itself. */
  startsOnUpload: boolean;
  start: (fileUrl?: string) => Promise<void>;
  /** Called when a dropped file started the run through the upload trigger. */
  onUploadedOnly: () => void;
  title?: string;
  description?: string;
  /** Offers to run with no file at all. */
  withoutFile?: boolean;
}) {
  const team = useActiveTeam();
  const storage = useQuery(api.storage.get, open ? { organizationId: team.id } : "skip");
  const uploads = useQuery(api.storage.listUploads, open ? { organizationId: team.id } : "skip");
  const startUpload = useAction(api.storage.startUpload);
  const finishUpload = useMutation(api.storage.finishUpload);
  const removeUpload = useMutation(api.storage.removeUpload);
  const linkFor = useAction(api.storage.linkFor);

  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const busy = progress !== null || starting;
  const recent = (uploads ?? []).filter((upload) => upload.status === "ready").slice(0, 6);

  async function run(work: () => Promise<void>, fallback: string) {
    setStarting(true);
    try {
      await work();
    } catch (caught) {
      toast.error(errorMessage(caught, fallback));
    } finally {
      setStarting(false);
    }
  }

  async function send(file: File | undefined) {
    if (!file || busy) return;
    let uploadId: Id<"uploads"> | null = null;
    try {
      const started = await startUpload({
        organizationId: team.id,
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      });
      uploadId = started.uploadId;
      setProgress({ name: file.name, percent: 0 });
      await putWithProgress(started.uploadUrl, file, (percent) =>
        setProgress({ name: file.name, percent }),
      );
      await finishUpload({ uploadId });
    } catch (caught) {
      if (uploadId) await removeUpload({ uploadId });
      setProgress(null);
      toast.error(
        errorMessage(
          caught,
          `${file.name} did not upload. Check your bucket's CORS rule allows PUT from this site.`,
        ),
      );
      return;
    }
    const id = uploadId;
    setProgress(null);
    if (startsOnUpload) {
      onUploadedOnly();
      return;
    }
    await run(async () => start(await linkFor({ uploadId: id })), "The run could not be started.");
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void send(event.dataTransfer.files[0]);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {storage === undefined ? (
          <div className="bg-muted h-36 animate-pulse rounded-xl" />
        ) : storage === null ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-5">
            <p className="text-muted-foreground text-sm">
              Connect your storage first, so there is somewhere for your files to go.
            </p>
            <Button asChild size="sm">
              <Link href="/uploads">Connect storage</Link>
            </Button>
          </div>
        ) : (
          <>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "bg-muted/50 overflow-hidden rounded-xl outline-2 -outline-offset-4 outline-transparent outline-dashed transition-[background-color,outline-color] duration-200",
                dragging && "bg-primary/10 outline-primary",
              )}
            >
              {progress || starting ? (
                <div className="grid gap-3 px-5 py-8" aria-live="polite">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    {progress ? `Uploading ${progress.name}` : "Starting the run"}
                    {progress && (
                      <span className="text-muted-foreground ml-auto font-mono tabular-nums">
                        {progress.percent}%
                      </span>
                    )}
                  </p>
                  <div className="bg-background h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full transition-[width] duration-200 ease-linear"
                      style={{ width: `${progress ? progress.percent : 100}%` }}
                    />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  className="hover:bg-muted focus-visible:ring-ring/50 flex w-full flex-col items-center px-4 py-8 text-center outline-none transition-colors focus-visible:ring-3"
                >
                  <span className="bg-background mb-2.5 grid size-12 place-items-center rounded-full">
                    <Upload className="size-5" aria-hidden="true" />
                  </span>
                  <span className="font-medium">
                    {dragging ? "Let go to add it" : "Drop a file here"}
                  </span>
                  <span className="text-muted-foreground text-sm">or click to choose one</span>
                </button>
              )}
            </div>
            <input
              ref={input}
              type="file"
              className="hidden"
              aria-label="Choose a file"
              onChange={(event) => {
                void send(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            {recent.length > 0 && (
              <div className="grid gap-1">
                <h3 className="text-muted-foreground font-mono text-[11.5px] tracking-[0.08em] uppercase">
                  Or use one you already uploaded
                </h3>
                {recent.map((upload) => (
                  <button
                    key={upload._id}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(
                        async () => start(await linkFor({ uploadId: upload._id })),
                        "The run could not be started.",
                      )
                    }
                    className="hover:bg-muted focus-visible:ring-ring/50 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-3 disabled:opacity-50"
                  >
                    <FileVideo className="text-muted-foreground size-4" aria-hidden="true" />
                    <span className="truncate text-sm">{upload.fileName}</span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {formatBytes(upload.size)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {withoutFile && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => run(() => start(), "The run could not be started.")}
            >
              <Play />
              Run without a file
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
