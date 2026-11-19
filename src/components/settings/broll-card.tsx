"use client";

import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { SettingRow, SettingsSection } from "./settings-shell";

type Site = "pixabay" | "pexels";
type KeyState = "built-in" | "team" | "none";

const SITES: { site: Site; name: string; where: string }[] = [
  { site: "pixabay", name: "Pixabay", where: "https://pixabay.com/api/docs/" },
  { site: "pexels", name: "Pexels", where: "https://www.pexels.com/api/" },
];

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** One stock site: built in, the team's own key, or a box to add one. */
function StockKey({
  site,
  name,
  where,
  state,
  manager,
}: {
  site: Site;
  name: string;
  where: string;
  state: KeyState;
  manager: boolean;
}) {
  const team = useActiveTeam();
  const saveKey = useAction(api.broll.saveKey);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(key: string) {
    setBusy(true);
    try {
      const saved = await saveKey({ organizationId: team.id, site, key });
      if (!saved.ok) toast.error(saved.detail ?? "The key could not be saved.");
      else {
        toast.success(key ? `${name} is set up` : `${name} key removed`);
        setTyped("");
      }
    } catch (caught) {
      toast.error(errorMessage(caught, "The key could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  const id = `stock-key-${site}`;
  if (state === "built-in") {
    return (
      <SettingRow label={name} description="Built in. Nothing to set up.">
        <span className="text-muted-foreground text-sm">Ready</span>
      </SettingRow>
    );
  }
  if (state === "team") {
    return (
      <SettingRow label={name} description="Your team's own free key.">
        {manager && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => save("")}>
            Remove
          </Button>
        )}
      </SettingRow>
    );
  }
  return (
    <SettingRow
      label={name}
      htmlFor={manager ? id : undefined}
      description={
        <>
          Free. Make an account, then copy the key from{" "}
          <a href={where} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {name}&apos;s API page
          </a>
          .
        </>
      }
    >
      {manager ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (typed.trim()) void save(typed.trim());
          }}
        >
          <Input
            id={id}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Paste the key"
            className="w-48"
            autoComplete="off"
            spellCheck={false}
          />
          <Button size="sm" type="submit" disabled={busy || !typed.trim()}>
            {busy ? "Checking" : "Save"}
          </Button>
        </form>
      ) : (
        <span className="text-muted-foreground text-sm">Not set up</span>
      )}
    </SettingRow>
  );
}

/**
 * Settings, B-Roll: the team's own footage the picture model has looked at, and the free
 * stock sites a run can search when the library has nothing that fits.
 */
export function BrollCard() {
  const team = useActiveTeam();
  const status = useQuery(api.broll.status, { organizationId: team.id });
  const lookThrough = useAction(api.broll.lookThroughLibrary);
  const [busy, setBusy] = useState(false);

  if (status === undefined) return <Skeleton className="h-40 rounded-xl" />;
  const waiting = status.videos - status.looked - status.looking;

  async function look() {
    setBusy(true);
    try {
      const sent = await lookThrough({ organizationId: team.id });
      toast.success(
        sent === 0 ? "Every video has been looked at" : `Looking at ${plural(sent, "video")}`,
      );
    } catch (caught) {
      toast.error(errorMessage(caught, "That did not start. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-10" data-broll-settings>
      <SettingsSection
        title="Your library"
        description={
          <>
            Add B-Roll looks for footage in your{" "}
            <Link href="/library" className="underline underline-offset-2">
              Content Library
            </Link>{" "}
            first. Each video is looked at once on your own toolkit, with no AI tokens spent, and
            ones without a talking face count as B-Roll. Mark any video yourself from its page.
          </>
        }
      >
        <SettingRow
          label={`${plural(status.broll, "video")} ready as B-Roll`}
          description={
            status.videos === 0
              ? "No videos in the library yet."
              : `${status.looked} of ${plural(status.videos, "video")} looked at${
                  status.looking ? `, ${status.looking} being looked at now` : ""
                }. New videos are looked at when Make new files searchable is on.`
          }
        >
          {status.manager && waiting > 0 && (
            <Button size="sm" variant="outline" disabled={busy} onClick={look}>
              {busy ? "Starting" : `Look at ${plural(waiting, "video")}`}
            </Button>
          )}
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Free stock"
        description="When your library has nothing that fits, runs can use free stock footage. It is free to use in your videos, and each run shows where every clip came from."
      >
        <div className="flex flex-col gap-4">
          {SITES.map((one) => (
            <StockKey
              key={one.site}
              {...one}
              state={status.keys[one.site]}
              manager={status.manager}
            />
          ))}
        </div>
        {!status.manager && status.keys.pixabay === "none" && status.keys.pexels === "none" && (
          <p className="text-muted-foreground text-sm">Only an owner or admin can add a key.</p>
        )}
      </SettingsSection>
    </div>
  );
}
