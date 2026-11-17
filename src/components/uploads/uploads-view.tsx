"use client";

import { api } from "@convex/_generated/api";
import { describeFileDetails } from "@ncat-dash/automation-core";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { Copy, Trash2, UploadCloud } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorMessage, formatBytes } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { putWithProgress } from "@/lib/upload";

import { StorageForm } from "./storage-form";

type InFlight = { name: string; percent: number };

export function UploadsView() {
  const team = useActiveTeam();
  const storage = useQuery(api.storage.get, { organizationId: team.id });
  const uploads = useQuery(api.storage.listUploads, { organizationId: team.id });
  const startUpload = useAction(api.storage.startUpload);
  const finishUpload = useMutation(api.storage.finishUpload);
  const removeUpload = useMutation(api.storage.removeUpload);
  const linkFor = useAction(api.storage.linkFor);

  const input = useRef<HTMLInputElement>(null);
  const [inFlight, setInFlight] = useState<Record<string, InFlight>>({});
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);

  async function send(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      let uploadId: Id<"uploads"> | null = null;
      try {
        const started = await startUpload({
          organizationId: team.id,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        });
        uploadId = started.uploadId;
        const id = started.uploadId;
        setInFlight((current) => ({ ...current, [id]: { name: file.name, percent: 0 } }));
        await putWithProgress(started.uploadUrl, file, (percent) =>
          setInFlight((current) => ({ ...current, [id]: { name: file.name, percent } })),
        );
        await finishUpload({ uploadId: id });
      } catch (caught) {
        if (uploadId) await removeUpload({ uploadId });
        toast.error(
          errorMessage(
            caught,
            `${file.name} did not upload. Check your bucket's CORS rule allows PUT from this site.`,
          ),
        );
      } finally {
        if (uploadId) {
          const id = uploadId;
          setInFlight((current) =>
            Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)),
          );
        }
      }
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void send(event.dataTransfer.files);
  }

  async function copyLink(uploadId: Id<"uploads">) {
    try {
      await navigator.clipboard.writeText(await linkFor({ uploadId }));
      toast.success("Link copied. It works for seven days.");
    } catch {
      toast.error("The link could not be copied.");
    }
  }

  const heading = (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Uploads</h1>
      <p className="text-muted-foreground text-sm">
        Your files. They go straight from your browser to your own storage, and each one is read for
        its length, size and format.
      </p>
    </div>
  );

  if (storage === undefined) {
    return (
      <>
        {heading}
        <Skeleton className="h-48 rounded-xl" />
      </>
    );
  }

  if (storage === null || editing) {
    return (
      <>
        {heading}
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>
              <h2>Connect your storage</h2>
            </CardTitle>
            <CardDescription>
              Uploads need a bucket you own. We test the connection before saving anything.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <StorageForm organizationId={team.id} onSaved={() => setEditing(false)} />
            {editing && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setEditing(false)}
              >
                Keep the current storage
              </Button>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  const active = Object.entries(inFlight);
  const ready = uploads?.filter((upload) => upload.status === "ready");

  return (
    <>
      {heading}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-dragging={dragging}
        className="data-[dragging=true]:border-primary data-[dragging=true]:bg-accent/50 flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center transition-colors"
      >
        <UploadCloud className="text-muted-foreground size-8" aria-hidden="true" />
        <p className="text-sm">Drop files here, or choose them from your computer.</p>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          aria-label="Choose files to upload"
          onChange={(event) => {
            if (event.target.files?.length) void send(event.target.files);
            event.target.value = "";
          }}
        />
        <Button size="sm" onClick={() => input.current?.click()}>
          Choose files
        </Button>
        <p className="text-muted-foreground text-xs">
          Going to bucket {storage.bucket}.{" "}
          <button type="button" className="underline" onClick={() => setEditing(true)}>
            Change storage
          </button>
        </p>
      </div>

      {active.length > 0 && (
        <ul className="flex flex-col gap-3" aria-live="polite">
          {active.map(([id, upload]) => (
            <li key={id} className="flex flex-col gap-1.5 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium">{upload.name}</span>
                <span className="text-muted-foreground tabular-nums">{upload.percent}%</span>
              </div>
              <Progress value={upload.percent} aria-label={`Uploading ${upload.name}`} />
            </li>
          ))}
        </ul>
      )}

      {ready === undefined ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : ready.length === 0 ? null : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ready.map((upload) => (
                <TableRow key={upload._id}>
                  <TableCell className="w-2/5 max-w-0 truncate font-medium">
                    {upload.fileName}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">
                    {upload.details ? describeFileDetails(upload.details) : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatBytes(upload.size)}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => copyLink(upload._id)}>
                      <Copy />
                      Copy link
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${upload.fileName} from this list`}
                      onClick={() => removeUpload({ uploadId: upload._id })}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
