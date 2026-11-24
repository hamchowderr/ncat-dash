"use client";

import { api } from "@convex/_generated/api";
import { useAction, useMutation } from "convex/react";
import { useEffect, useRef } from "react";

import {
  inDesktopApp,
  landedFilesOnDesktop,
  landedSentOnDesktop,
  watchedFoldersOnDesktop,
} from "@/lib/desktop";
import { StoppedUpload, useSendFromDisk } from "@/lib/send-file";

/** How often watched folders are looked at. */
export const LOOK_EVERY_MS = 15_000;
/** A file that fails this many times in a row is left until the app restarts. */
const TRIES = 3;

/** The storage folder a landed file goes to: the automation's folder, then where it was. */
export function storageFolder(prefix: string, inside: string): string {
  const base = prefix === "" || prefix.endsWith("/") ? prefix : `${prefix}/`;
  return inside ? `${base}${inside.replace(/^\/+|\/+$/g, "")}/` : base;
}

/**
 * In the desktop app: brings files added to a folder on this computer into the folder in
 * the team's storage that an automation watches, so its folder trigger starts runs as it
 * does for any file that lands there. Runs on every page while the app is open; draws
 * nothing. In a browser it does nothing at all.
 */
export function LocalFolders() {
  const startUpload = useAction(api.files.startUpload);
  const finishUpload = useMutation(api.storage.finishUpload);
  const fromDisk = useSendFromDisk();
  const calls = useRef({ startUpload, finishUpload, fromDisk });
  useEffect(() => {
    calls.current = { startUpload, finishUpload, fromDisk };
  }, [startUpload, finishUpload, fromDisk]);

  useEffect(() => {
    if (!inDesktopApp()) return;
    const failures = new Map<string, number>();
    let busy = false;
    let live = true;

    async function look() {
      if (busy) return;
      busy = true;
      try {
        for (const watch of await watchedFoldersOnDesktop()) {
          let landed;
          try {
            landed = await landedFilesOnDesktop(watch.automationId);
          } catch {
            continue;
          }
          for (const file of landed) {
            if (!live) return;
            if ((failures.get(file.path) ?? 0) >= TRIES) continue;
            const { startUpload, finishUpload, fromDisk } = calls.current;
            try {
              const started = await startUpload({
                organizationId: watch.organizationId,
                prefix: storageFolder(watch.prefix, file.folder),
                fileName: file.name,
                contentType: file.contentType,
                size: file.size,
              });
              try {
                await fromDisk.send(started, file, () => {});
                await finishUpload({ uploadId: started.uploadId });
              } catch (caught) {
                // Stopped part way: it is listed on the Library to carry on from there.
                if (!(caught instanceof StoppedUpload)) throw caught;
              }
              await landedSentOnDesktop(watch.automationId, file.path);
              failures.delete(file.path);
            } catch {
              failures.set(file.path, (failures.get(file.path) ?? 0) + 1);
            }
          }
        }
      } finally {
        busy = false;
      }
    }

    void look();
    const timer = setInterval(() => void look(), LOOK_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return null;
}
