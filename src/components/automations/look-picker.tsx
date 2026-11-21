"use client";

import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CopyLookFromVideo, useLooks } from "@/components/looks/look-study";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

/** The step's setting that names the look. */
export const LOOK_SETTING = "look";
const FIRST = "__first__";

/**
 * Which saved look the Match A Saved Look step uses, picked from the team's looks by name.
 * Left on the first, a look added or renamed later needs nothing changed here. A new look
 * is copied from a video right here, and the step then uses it.
 */
export function LookPicker({
  nodeId,
  input,
  onChange,
}: {
  nodeId: string;
  input: Record<string, unknown>;
  onChange: (input: Record<string, unknown>) => void;
}) {
  const team = useActiveTeam();
  const shown = useLooks();
  const remove = useMutation(api.looks.remove);
  const [copying, setCopying] = useState(false);
  const id = `node-${nodeId}-look`;
  if (!shown) return null;
  const { looks } = shown;
  const named = typeof input[LOOK_SETTING] === "string" ? (input[LOOK_SETTING] as string) : "";
  const picked = looks.find((look) => look.name.toLowerCase() === named.trim().toLowerCase());
  const { [LOOK_SETTING]: _old, ...rest } = input;
  const use = (name: string) => {
    setCopying(false);
    onChange({ ...rest, [LOOK_SETTING]: name });
  };

  if (looks.length === 0) {
    return (
      <div className="flex flex-col gap-2" data-look-copy>
        <p className="text-sm font-medium">Look</p>
        <p className="text-muted-foreground text-sm text-pretty">
          Your team has no saved looks yet. Copy one from a video you like, and this step will use
          it.
        </p>
        <CopyLookFromVideo shown={shown} onSaved={use} />
      </div>
    );
  }
  const shownLook = picked ?? (named ? null : looks[0]);
  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor={id}>Look</FieldLabel>
        <Select
          value={picked?.name ?? (named ? named : FIRST)}
          onValueChange={(value) =>
            onChange(value === FIRST ? rest : { ...rest, [LOOK_SETTING]: value })
          }
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FIRST}>{`Your first look (${looks[0].name})`}</SelectItem>
            {looks.map((look) => (
              <SelectItem key={look._id} value={look.name}>
                {look.name}
              </SelectItem>
            ))}
            {named && !picked && <SelectItem value={named}>{`${named} (removed)`}</SelectItem>}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs text-pretty">
          {shownLook ? (
            <>
              {shownLook.summary}. Copied from {shownLook.sourceName}.
              {shownLook.captionStyle &&
                ` Its captions are the caption style "${shownLook.captionStyle}": pick it in a captions step after this one.`}
            </>
          ) : (
            `There is no look called "${named}" any more, so this step will stop. Pick another.`
          )}
        </p>
      </Field>
      {shown.study || copying ? (
        <div className="flex flex-col gap-2" data-look-copy>
          <CopyLookFromVideo shown={shown} onSaved={use} />
          {copying && !shown.study && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setCopying(false)}
            >
              Cancel
            </Button>
          )}
        </div>
      ) : (
        shown.canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCopying(true)}>
              <Plus />
              Copy a new look from a video
            </Button>
            {shownLook && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    await remove({ organizationId: team.id, lookId: shownLook._id });
                    toast.success(`Removed "${shownLook.name}"`);
                  } catch (caught) {
                    toast.error(errorMessage(caught, "The look could not be removed."));
                  }
                }}
              >
                {`Remove "${shownLook.name}"`}
              </Button>
            )}
          </div>
        )
      )}
    </div>
  );
}
