"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { LookProposal } from "@takewon/automation-core";
import { useMutation, useQuery } from "convex/react";
import { SwatchBook } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CaptionPreview } from "@/components/settings/caption-preview";
import { LinkRow, PasteLink, useLinks } from "@/components/uploads/paste-link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

/**
 * # Copying a look from a video
 *
 * A look is copied where the video is, or where it is used: from a video in the Library,
 * or from inside the Match A Saved Look step. Both show the same study: the toolkit
 * takes six frames and finds the cuts, the agent looks once, and the team names and saves
 * what it saw.
 */

export type LooksShown = NonNullable<ReturnType<typeof useLooks>>;
type Study = NonNullable<LooksShown["study"]>;

export function useLooks() {
  const team = useActiveTeam();
  return useQuery(api.looks.list, { organizationId: team.id });
}

const SHAPE_WORDS = { vertical: "vertical", wide: "wide", square: "square" } as const;

/** A file's name without its ending, as a first name for the look. */
const nameFrom = (fileName: string) => fileName.replace(/\.[a-z0-9]{2,4}$/i, "").slice(0, 60);

function useStartStudy() {
  const team = useActiveTeam();
  const study = useMutation(api.looks.study);
  const [busy, setBusy] = useState(false);
  async function start(uploadId: string) {
    setBusy(true);
    try {
      await study({ organizationId: team.id, uploadId: uploadId as Id<"uploads"> });
    } catch (caught) {
      toast.error(errorMessage(caught, "The video could not be studied. Try again."));
    } finally {
      setBusy(false);
    }
  }
  return { start, busy };
}

/**
 * On a video in the Library: "Copy its look", then the study of that video right there. Only
 * owners and admins see it, since a saved look changes what steps do.
 */
export function CopyLookFromUpload({ upload }: { upload: { _id: string; fileName: string } }) {
  const shown = useLooks();
  const { start, busy } = useStartStudy();
  if (!shown?.canEdit) return null;
  const study = shown.study;
  if (study && study.uploadId === upload._id) return <StudyView study={study} canEdit />;
  const another = study?.status === "working";
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        variant="secondary"
        size="sm"
        disabled={busy || another}
        onClick={() => start(upload._id)}
      >
        <SwatchBook />
        {busy ? "Starting" : "Copy its look"}
      </Button>
      <p className="text-muted-foreground text-xs text-pretty">
        {another
          ? `Another video, ${study.sourceName}, is being studied. Wait for it to finish.`
          : "Save how this video is framed, graded and captioned, then put any video into it with the Match A Saved Look step."}
      </p>
    </div>
  );
}

/**
 * Inside the step: pick one of the team's videos and copy its look, or paste a link to a
 * video on another site. A pasted video comes into the Library, then its look is studied.
 */
export function CopyLookFromVideo({
  shown,
  onSaved,
}: {
  shown: LooksShown;
  onSaved: (name: string) => void;
}) {
  const team = useActiveTeam();
  const uploads = useQuery(api.storage.listUploads, { organizationId: team.id });
  const pasted = (useLinks() ?? []).find((link) => link.forLook);
  const { start, busy } = useStartStudy();
  const [picked, setPicked] = useState<string | null>(null);

  if (shown.study) {
    return <StudyView study={shown.study} canEdit={shown.canEdit} onSaved={onSaved} />;
  }
  if (!shown.canEdit) {
    return (
      <p className="text-muted-foreground text-sm text-pretty">
        A team owner or admin can copy a look from a video.
      </p>
    );
  }
  if (pasted) return <LinkRow link={pasted} />;
  const videos = (uploads ?? []).filter(
    (upload) =>
      upload.status === "ready" &&
      upload.purpose !== "brand" &&
      upload.contentType.startsWith("video/"),
  );
  return (
    <div className="flex flex-col gap-4">
      {videos.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="look-sample">Copy a look from a video</Label>
          <div className="flex flex-wrap gap-2">
            <Select value={picked ?? ""} onValueChange={setPicked}>
              <SelectTrigger id="look-sample" className="min-w-0 flex-1">
                <SelectValue placeholder="Pick one of your videos" />
              </SelectTrigger>
              <SelectContent>
                {videos.map((upload) => (
                  <SelectItem key={upload._id} value={upload._id}>
                    {upload.fileName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={!picked || busy} onClick={() => picked && start(picked)}>
              {busy ? "Starting" : "Copy its look"}
            </Button>
          </div>
        </div>
      )}
      <PasteLink forLook />
      <p className="text-muted-foreground text-xs text-pretty">
        The toolkit takes six frames and finds the cuts, and the agent looks at them once. Every run
        after that runs on your toolkit by plain rules, with no AI spent per video.
      </p>
    </div>
  );
}

function StudyView({
  study,
  canEdit,
  onSaved,
  wide,
}: {
  study: Study;
  canEdit: boolean;
  onSaved?: (name: string) => void;
  /** Frames beside the words, where there is room (the open video on the Library). */
  wide?: boolean;
}) {
  const team = useActiveTeam();
  const dismiss = useMutation(api.looks.dismiss);
  const putAway = () => dismiss({ organizationId: team.id, studyId: study._id });

  if (study.status === "working") {
    return (
      <div className="flex items-start gap-2 text-sm" data-look-study="working">
        <Spinner className="mt-0.5 shrink-0" />
        <span className="text-pretty">
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
    <Proposal
      study={study}
      proposal={study.proposal!}
      canEdit={canEdit}
      onPutAway={putAway}
      onSaved={onSaved}
      wide={wide}
    />
  );
}

function Proposal({
  study,
  proposal,
  canEdit,
  onPutAway,
  onSaved,
  wide,
}: {
  study: Study;
  proposal: LookProposal;
  canEdit: boolean;
  onPutAway: () => void;
  onSaved?: (name: string) => void;
  wide?: boolean;
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
      onSaved?.(name.trim());
    } catch (caught) {
      toast.error(errorMessage(caught, "The look could not be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-look-study="ready">
      <div
        className={wide ? "flex flex-col gap-4 md:flex-row md:items-start" : "flex flex-col gap-4"}
      >
        {study.sheetUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={study.sheetUrl}
            alt={`Six frames from ${study.sourceName}`}
            className="bg-muted w-full max-w-sm rounded-lg"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-sm font-medium">The look of {study.sourceName}</p>
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="look-name">Name</Label>
            <Input
              id="look-name"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </div>
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
