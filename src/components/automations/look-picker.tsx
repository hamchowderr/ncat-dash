"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";

import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveTeam } from "@/lib/team-context";

/** The step's setting that names the look. */
export const LOOK_SETTING = "look";
const FIRST = "__first__";

/**
 * Which saved look the Match A Saved Look step uses, picked from the team's looks by name.
 * Left on the first, a look added or renamed later needs nothing changed here.
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
  const shown = useQuery(api.looks.list, { organizationId: team.id });
  const id = `node-${nodeId}-look`;
  if (!shown) return null;
  const { looks } = shown;
  const named = typeof input[LOOK_SETTING] === "string" ? (input[LOOK_SETTING] as string) : "";
  const picked = looks.find((look) => look.name.toLowerCase() === named.trim().toLowerCase());

  if (looks.length === 0) {
    return (
      <p className="text-muted-foreground text-sm text-pretty">
        Your team has no saved looks yet.{" "}
        <Link href="/settings/looks" className="text-foreground underline underline-offset-2">
          Copy one from a video you like
        </Link>{" "}
        in Settings, then pick it here.
      </p>
    );
  }
  const shownLook = picked ?? (named ? null : looks[0]);
  return (
    <Field>
      <FieldLabel htmlFor={id}>Look</FieldLabel>
      <Select
        value={picked?.name ?? (named ? named : FIRST)}
        onValueChange={(value) => {
          const { [LOOK_SETTING]: _old, ...rest } = input;
          onChange(value === FIRST ? rest : { ...rest, [LOOK_SETTING]: value });
        }}
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
            {shownLook.summary}.
            {shownLook.captionStyle &&
              ` Its captions are the caption style "${shownLook.captionStyle}": pick it in a captions step after this one.`}
          </>
        ) : (
          `There is no look called "${named}" any more, so this step will stop. Pick another.`
        )}
      </p>
    </Field>
  );
}
