import { platformApp, platformsThatFit, type VideoShape } from "@takewon/automation-core";

import { PostingAppLogo } from "@/components/onboarding/posting-app-logo";
import { cn } from "@/lib/utils";

/** The platform a clip was made for, with the app's logo: "[logo] Instagram Reels". */
export function PlatformTag({ platform, className }: { platform: string; className?: string }) {
  const app = platformApp(platform);
  return (
    <span
      className={cn(
        "bg-muted text-foreground inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md pr-2 pl-1.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
      title={`Made for ${platform}`}
    >
      {app && <PostingAppLogo app={app} className="size-3.5 rounded-[3px]" />}
      <span className="sr-only">Made for </span>
      {platform}
    </span>
  );
}

// More logos than this read as noise; the rest are counted.
const MOST_LOGOS = 4;

/**
 * The platforms a video fits by its shape and length, as a quiet row of logos, for files
 * no step made for one platform. `apps` keeps it to where the team posts.
 */
export function PlatformFits({
  video,
  apps,
  className,
}: {
  video: VideoShape;
  apps?: readonly string[] | null;
  className?: string;
}) {
  const fits = platformsThatFit(video, apps);
  if (fits.length === 0) return null;
  // One logo per app: Instagram Reels, Stories and feed all show Instagram's.
  const logos = [...new Set(fits.map(platformApp).filter((app) => app !== null))];
  const shown = logos.slice(0, MOST_LOGOS);
  const label = `Fits ${fits.join(", ")}`;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1", className)}
      title={label}
      aria-label={label}
      role="img"
    >
      {shown.map((app) => (
        <PostingAppLogo key={app} app={app} className="size-3.5 rounded-[3px]" />
      ))}
      {logos.length > shown.length && (
        <span className="text-muted-foreground text-xs tabular-nums">
          +{logos.length - shown.length}
        </span>
      )}
    </span>
  );
}
