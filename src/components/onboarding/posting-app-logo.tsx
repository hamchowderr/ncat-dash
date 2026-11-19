import type { PostingAppId } from "@ncat-dash/automation-core";
import Image from "next/image";
import type { SimpleIcon } from "simple-icons";
import {
  siFacebook,
  siInstagram,
  siPinterest,
  siSnapchat,
  siThreads,
  siTiktok,
  siX,
  siYoutube,
} from "simple-icons";

import { cn } from "@/lib/utils";

// Each app's own mark from Simple Icons, in its own colour. LinkedIn is not carried there,
// so its published mark is served from /public/logos.
const MARKS: Record<Exclude<PostingAppId, "linkedin">, SimpleIcon> = {
  instagram: siInstagram,
  tiktok: siTiktok,
  youtube: siYoutube,
  facebook: siFacebook,
  x: siX,
  threads: siThreads,
  pinterest: siPinterest,
  snapchat: siSnapchat,
};

/** A posting app's real logo. Snapchat's yellow ghost sits on its yellow square, as Snap shows it. */
export function PostingAppLogo({ app, className }: { app: PostingAppId; className?: string }) {
  if (app === "linkedin") {
    return (
      <Image
        src="/logos/linkedin.svg"
        alt=""
        aria-hidden="true"
        width={24}
        height={24}
        className={cn("size-6 rounded-[5px]", className)}
      />
    );
  }
  const icon = MARKS[app];
  if (app === "snapchat") {
    return (
      <span
        aria-hidden="true"
        className={cn("grid size-6 place-items-center rounded-[6px]", className)}
        style={{ backgroundColor: `#${icon.hex}` }}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="#000">
          <path d={icon.path} />
        </svg>
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("size-6", className)}
      fill={`#${icon.hex}`}
    >
      <path d={icon.path} />
    </svg>
  );
}
