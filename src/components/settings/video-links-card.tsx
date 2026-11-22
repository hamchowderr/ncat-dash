"use client";

import { api } from "@convex/_generated/api";
import { useAction, useMutation } from "convex/react";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { SettingRow, SettingsLoading, SettingsSection, useTeamSettings } from "./settings-shell";

const EXTENSION =
  "https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc";

/**
 * Settings → Video Links. Pasting a link brings a video in from most sites as they are;
 * YouTube, Vimeo, Reddit and private posts answer a server only when it is signed in. The
 * cookies of a browser signed in to them get past that. Shown afterwards by site only.
 */
export function VideoLinksCard() {
  const settings = useTeamSettings();
  if (!settings) return <SettingsLoading />;
  return <CookiesForm cookies={settings.videoCookies} canEdit={settings.canEdit} />;
}

function CookiesForm({
  cookies,
  canEdit,
}: {
  cookies: { sites: string[]; setAt: number } | null;
  canEdit: boolean;
}) {
  const team = useActiveTeam();
  const save = useAction(api.videoCookies.set);
  const remove = useMutation(api.videoCookies.remove);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const editing = canEdit && (cookies === null || replacing);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const saved = await save({ organizationId: team.id, text });
      setText("");
      setReplacing(false);
      toast.success(`Saved. Links from ${saved.sites.join(", ")} now go in signed in.`);
    } catch (caught) {
      toast.error(errorMessage(caught, "The cookies could not be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (chosen) setText(await chosen.text());
  }

  async function onRemove() {
    setBusy(true);
    try {
      await remove({ organizationId: team.id });
      toast.success("Your cookies are removed.");
    } catch (caught) {
      toast.error(errorMessage(caught, "The cookies could not be removed. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const added = cookies
    ? new Date(cookies.setAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col gap-12">
      <SettingsSection
        id="links"
        title="Pasting a link"
        description="On Uploads, or in the Match A Saved Look step, paste a link to a post and the toolkit brings its video in."
      >
        <SettingRow
          label="Works as it is"
          description="TikTok, public Instagram reels, Facebook, X, LinkedIn, Dailymotion and links to video files."
        />
        <SettingRow
          label="Needs your cookies"
          description="YouTube, Vimeo, Reddit and private posts. They ask a server to sign in first."
        />
      </SettingsSection>

      <SettingsSection
        id="cookies"
        title="Your cookies"
        description={
          <>
            Sign in to the sites in your browser, then export their cookies as a cookies.txt file,
            for example with{" "}
            <a
              href={EXTENSION}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Get cookies.txt LOCALLY
            </a>
            . Use an account made for this rather than your own: a site may sign it out when a
            server uses it. Cookies run out after a while; export them again when links stop
            working.
          </>
        }
      >
        {cookies && !replacing && (
          <SettingRow
            label={`For ${cookies.sites.join(", ")}`}
            description={`Added ${added}. Kept encrypted, and only the sites they are for are ever shown.`}
          >
            {canEdit && (
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setReplacing(true)}>
                  Replace
                </Button>
                <Button type="button" variant="ghost" onClick={onRemove} disabled={busy}>
                  Remove
                </Button>
              </div>
            )}
          </SettingRow>
        )}

        {editing && (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <label htmlFor="video-cookies" className="text-sm font-medium">
              cookies.txt
            </label>
            <Textarea
              id="video-cookies"
              rows={5}
              spellCheck={false}
              autoComplete="off"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="font-mono text-xs"
            />
            <input
              ref={file}
              type="file"
              accept=".txt,text/plain"
              className="sr-only"
              aria-label="Choose a cookies.txt file"
              onChange={onFile}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !text.trim()}>
                {busy ? "Saving" : "Save cookies"}
              </Button>
              <Button type="button" variant="outline" onClick={() => file.current?.click()}>
                Choose the file
              </Button>
              {replacing && (
                <Button type="button" variant="ghost" onClick={() => setReplacing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}

        {!canEdit && cookies === null && (
          <p className="text-muted-foreground text-sm">
            No cookies yet. Only a team owner or admin can add them.
          </p>
        )}
      </SettingsSection>
    </div>
  );
}
