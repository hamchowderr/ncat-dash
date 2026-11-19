"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { readUploadRef, uploadRef } from "@ncat-dash/automation-core";
import { useAction, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { useSendFile } from "@/lib/send-file";

/**
 * Sends a logo or a music track to the team's storage and hands back a lasting pointer to
 * it. These files are kept for steps to use, so they never start an automation.
 */
export function useBrandUpload() {
  const team = useActiveTeam();
  const startUpload = useAction(api.storage.startUpload);
  const sendFile = useSendFile();
  const finishUpload = useMutation(api.storage.finishUpload);
  const removeUpload = useMutation(api.storage.removeUpload);
  const [busy, setBusy] = useState(false);

  async function send(file: File): Promise<string | null> {
    let uploadId: Id<"uploads"> | null = null;
    setBusy(true);
    try {
      const started = await startUpload({
        organizationId: team.id,
        fileName: file.name,
        contentType: file.type,
        size: file.size,
        purpose: "brand",
      });
      uploadId = started.uploadId;
      await sendFile(started, file, () => {});
      await finishUpload({ uploadId });
      return uploadRef(uploadId);
    } catch (caught) {
      if (uploadId) await removeUpload({ uploadId });
      toast.error(
        errorMessage(
          caught,
          `${file.name} did not upload. Check your bucket's CORS rule allows PUT from this site.`,
        ),
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { send, busy };
}

/**
 * An address a browser can show a saved file from: the address itself, or a fresh link
 * for a pointer to one of the team's uploads. Null until there is one.
 */
export function useFileLink(value: string | undefined): string | null {
  const linkFor = useAction(api.storage.linkFor);
  const uploadId = readUploadRef(value);
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!uploadId) return;
    let live = true;
    linkFor({ uploadId: uploadId as Id<"uploads"> })
      .then((url) => live && setLink({ id: uploadId, url }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [uploadId, linkFor]);
  if (uploadId) return link?.id === uploadId ? link.url : null;
  return value && /^https?:\/\/\S+$/.test(value) ? value : null;
}
