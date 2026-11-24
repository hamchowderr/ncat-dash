"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Link2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

/**
 * # A video from a link
 *
 * Paste a link to a post on TikTok, Instagram, YouTube, X, Facebook, LinkedIn or another
 * video site, and the toolkit brings the video into the Library. Used on the Library, and
 * in the Match A Saved Look step to copy the look of a video the team never had a file of.
 */

export type LinkShown = NonNullable<ReturnType<typeof useLinks>>[number];

export function useLinks() {
  const team = useActiveTeam();
  return useQuery(api.links.recent, { organizationId: team.id });
}

export function PasteLink({
  forLook = false,
  disabled = false,
  className,
  onBrought,
}: {
  /** Called once the link is on its way, so a dialog holding the field can close. */
  onBrought?: () => void;
  /** Study its look once it is in. */
  forLook?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const team = useActiveTeam();
  const bringIn = useMutation(api.links.bringIn);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      await bringIn({ organizationId: team.id, url, forLook });
      setUrl("");
      if (!forLook) toast.success("On its way. It shows in the Library once it is in.");
      onBrought?.();
    } catch (caught) {
      toast.error(errorMessage(caught, "The link could not be brought in. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={cn("flex w-full flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {forLook ? "Or paste a link to a video" : "Paste a link to a video"}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="min-w-0 flex-1"
          disabled={disabled}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={disabled || busy || !url.trim()}
          aria-label={forLook ? "Copy the look of the video at this link" : undefined}
        >
          <Link2 />
          {busy ? "Starting" : forLook ? "Copy its look" : "Bring in"}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs text-pretty">
        TikTok, Instagram, YouTube, X, Facebook, LinkedIn and most other video sites. Sites that
        want a sign-in need your cookies in{" "}
        <Link href="/settings/integrations/video-links" className="underline underline-offset-2">
          Settings, Video Links
        </Link>
        .
      </p>
    </form>
  );
}

/** One link on its way in, or one that could not be brought in, with a way to put it away. */
export function LinkRow({ link }: { link: LinkShown }) {
  const team = useActiveTeam();
  const dismiss = useMutation(api.links.dismiss);
  const putAway = () =>
    dismiss({ organizationId: team.id, importId: link._id as Id<"linkImports"> });

  if (link.status === "importing" || (link.forLook === "waiting" && !link.error)) {
    return (
      <div className="flex items-start gap-2 text-sm" data-link="coming">
        <Spinner className="mt-0.5 shrink-0" />
        <span className="min-w-0 text-pretty">
          {link.status === "importing"
            ? `Bringing in the video from ${link.site}.`
            : `The video from ${link.site} is in. Reading its size and length.`}
          {link.forLook ? " Its look is studied as soon as it is in." : ""}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1.5" data-link="failed">
      <p className="text-sm text-pretty">
        <span className="font-medium">{link.site}</span>{" "}
        <span className="text-destructive">
          <WithSettingsLink text={link.error ?? ""} />
        </span>
      </p>
      <Button variant="outline" size="sm" onClick={putAway}>
        {link.forLook ? "Try another link" : "Put away"}
      </Button>
    </div>
  );
}

const VIDEO_LINKS = "Settings, Video Links";

/** A message that sends the reader to Settings, Video Links links there, so it is one click away. */
function WithSettingsLink({ text }: { text: string }) {
  const at = text.indexOf(VIDEO_LINKS);
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Link href="/settings/integrations/video-links" className="underline underline-offset-2">
        {VIDEO_LINKS}
      </Link>
      {text.slice(at + VIDEO_LINKS.length)}
    </>
  );
}
