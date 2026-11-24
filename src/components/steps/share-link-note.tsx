"use client";

import { readShareLink } from "@takewon/automation-core";
import { CircleAlert, Link2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Under an address field: says a pasted Google Drive or Dropbox share link will work
 * (the file is downloaded straight from it), or why that link cannot.
 */
export function ShareLinkNote({ value, className }: { value: string; className?: string }) {
  const link = readShareLink(value);
  if (link.kind === "plain") return null;
  if (link.kind === "unusable") {
    return (
      <p
        role="alert"
        data-share-link="unusable"
        className={cn("text-destructive flex items-start gap-1.5 text-sm", className)}
      >
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {link.problem}
      </p>
    );
  }
  return (
    <p
      data-share-link="fixed"
      className={cn("text-muted-foreground flex items-start gap-1.5 text-sm", className)}
    >
      <Link2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {link.service} share link. The file is downloaded straight from it, so it has to be shared
      with anyone who has the link.
    </p>
  );
}
