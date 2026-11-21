"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { LookProposal } from "@ncat-dash/automation-core";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { CaptionPreview } from "./caption-preview";
import { SettingRow, SettingsLoading, SettingsSection } from "./settings-shell";

type Shown = NonNullable<ReturnType<typeof useLooks>>;
type Study = NonNullable<Shown["study"]>;

function useLooks() {
  const team = useActiveTeam();
  return useQuery(api.looks.list, { organizationId: team.id });
}

const SHAPE_WORDS = { vertical: "vertical", wide: "wide", square: "square" } as const;

/** A file's name without its ending, as a first name for the look. */
const nameFrom = (fileName: string) => fileName.replace(/\.[a-z0-9]{2,4}$/i, "").slice(0, 60);

/** Settings → Looks: copy a look from a video once, and the looks the team has saved. */
export function LooksCard() {
  const shown = useLooks();
  if (!shown) return <SettingsLoading />;
  return (
    <div className="flex flex-col gap-12">
      <SettingsSection
        title="Copy a look"
        description="Pick a video whose look you like. The toolkit takes six frames from it and finds its cuts, and the agent looks at the frames once. After that, the Match A Saved Look step puts any video into this look with plain FFmpeg, with no AI spent on each video."
      >
        {shown.study ? (
          <StudyView study={shown.study} canEdit={shown.canEdit} />
        ) : (
          shown.canEdit && <PickSample />
        )}
      </SettingsSection>
      <SettingsSection title="Saved looks">
        {shown.looks.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No saved looks yet. Copy one above to use it in your automations.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {shown.looks.map((look) => (
              <SavedLook key={look._id} look={look} canEdit={shown.canEdit} />
            ))}
          </ul>
        )}
      </SettingsSection>
      {!shown.canEdit && (
        <p className="text-muted-foreground text-sm">
          Only a team owner or admin can change these.
        </p>
      )}
    </div>
  );
}

function PickSample() {
  const team = useActiveTeam();
  const uploads = useQuery(api.storage.listUploads, { organizationId: team.id });
  const study = useMutation(api.looks.study);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const videos = (uploads ?? []).filter(
    (upload) =>
      upload.status === "ready" &&
      upload.purpose !== "brand" &&
      upload.contentType.startsWith("video/"),
  );

  if (uploads && videos.length === 0) {
    return (
      <p className="text-muted-foreground text-sm text-pretty">
        Upload a video you like first, on the Uploads page. Then pick it here.
      </p>
    );
  }

  async function start() {
    if (!picked) return;
    setBusy(true);
    try {
      await study({ organizationId: team.id, uploadId: picked as Id<"uploads"> });
    } catch (caught) {
      toast.error(errorMessage(caught, "The video could not be studied. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingRow
      label="Video to copy"
      htmlFor="look-sample"
      description="One of your uploads. It is only read, never changed."
    >
      <Select value={picked ?? ""} onValueChange={setPicked}>
        <SelectTrigger id="look-sample" className="w-64">
          <SelectValue placeholder="Pick a video" />
        </SelectTrigger>
        <SelectContent>
          {videos.map((upload) => (
            <SelectItem key={upload._id} value={upload._id}>
              {upload.fileName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button disabled={!picked || busy} onClick={start}>
        {busy ? "Starting" : "Copy its look"}
      </Button>
    </SettingRow>
  );
}

function StudyView({ study, canEdit }: { study: Study; canEdit: boolean }) {
  const team = useActiveTeam();
  const dismiss = useMutation(api.looks.dismiss);
  const putAway = () => dismiss({ organizationId: team.id, studyId: study._id });

  if (study.status === "working") {
    return (
      <div className="flex items-center gap-2 text-sm" data-look-study="working">
        <Spinner />
        <span>
          Studying {study.sourceName}. The toolkit is taking frames, then the agent looks at them.
          This takes a minute or two.
        </span>
      </div>
    );
  }
  if (study.status === "failed") {
    return (
      <div className="flex flex-col items-start gap-2" data-look-study="failed">
        <p className="text-destructive text-sm text-pretty">{study.error}</p>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={putAway}>
            Try another video
          </Button>
        )}
      </div>
    );
  }
  return (
    <Proposal study={study} proposal={study.proposal!} canEdit={canEdit} onPutAway={putAway} />
  );
}

function Proposal({
  study,
  proposal,
  canEdit,
  onPutAway,
}: {
  study: Study;
  proposal: LookProposal;
  canEdit: boolean;
  onPutAway: () => void;
}) {
  const team = useActiveTeam();
  const save = useMutation(api.looks.save);
  const [name, setName] = useState(() => nameFrom(study.sourceName));
  const [forShape, setForShape] = useState(false);
  const [busy, setBusy] = useState(false);
  const shape = proposal.frame.shape;

  async function onSave() {
    setBusy(true);
    try {
      await save({
        organizationId: team.id,
        studyId: study._id,
        name,
        captionsForShape: forShape,
      });
      toast.success(`Saved "${name.trim()}"`);
    } catch (caught) {
      toast.error(errorMessage(caught, "The look could not be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-look-study="ready">
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        {study.sheetUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={study.sheetUrl}
            alt={`Six frames from ${study.sourceName}`}
            className="bg-muted w-full max-w-md rounded-lg"
          />
        )}
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium">From {study.sourceName}</p>
          <p className="text-sm text-pretty">{study.summary}.</p>
          {proposal.notes && (
            <p className="text-muted-foreground text-sm text-pretty">{proposal.notes}</p>
          )}
          {proposal.captions ? (
            <div className="flex items-center gap-3 pt-1">
              <CaptionPreview look={proposal.captions} shape={shape} />
              <span className="text-muted-foreground text-sm text-pretty">
                Its captions, saved as a caption style with the same name.
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No captions were seen in it.</p>
          )}
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-col gap-3">
          <SettingRow label="Name" htmlFor="look-name" description="How steps pick this look.">
            <Input
              id="look-name"
              className="w-64"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </SettingRow>
          {proposal.captions && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="look-captions-shape"
                checked={forShape}
                onCheckedChange={(on) => setForShape(on === true)}
              />
              <label htmlFor="look-captions-shape" className="text-sm">
                Use its captions for every {SHAPE_WORDS[shape]} video
              </label>
            </div>
          )}
          <div className="flex gap-2">
            <Button disabled={busy || !name.trim()} onClick={onSave}>
              {busy ? "Saving" : "Save look"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onPutAway}>
              Put away
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SavedLook({ look, canEdit }: { look: Shown["looks"][number]; canEdit: boolean }) {
  const team = useActiveTeam();
  const remove = useMutation(api.looks.remove);
  return (
    <li className="flex items-start justify-between gap-4" data-saved-look={look.name}>
      <div className="flex min-w-0 items-start gap-3">
        {look.sheetUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={look.sheetUrl} alt="" className="bg-muted hidden w-28 rounded-md sm:block" />
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{look.name}</span>
          <span className="text-muted-foreground text-sm text-pretty">
            {look.summary}. Copied from {look.sourceName}.
            {look.captionStyle && ` Captions: the "${look.captionStyle}" caption style.`}
          </span>
        </div>
      </div>
      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await remove({ organizationId: team.id, lookId: look._id });
              toast.success(`Removed "${look.name}"`);
            } catch (caught) {
              toast.error(errorMessage(caught, "The look could not be removed."));
            }
          }}
        >
          Remove
        </Button>
      )}
    </li>
  );
}
