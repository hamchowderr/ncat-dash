"use client";

import { api } from "@convex/_generated/api";
import { EDITORS, type EditorId } from "@ncat-dash/timeline-export";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

const NOTES: Record<EditorId, string> = {
  premiere: "Gets a timeline with every cut adjustable.",
  resolve: "Gets a timeline with every cut adjustable.",
  finalcut: "Gets a timeline with every cut adjustable.",
  capcut: "CapCut cannot open a timeline from another tool. It gets the finished clips.",
};

/** The video editors the team uses. Set once; every export makes the files they open. */
export function EditorsCard({ editors, canEdit }: { editors: EditorId[]; canEdit: boolean }) {
  const team = useActiveTeam();
  const setEditors = useMutation(api.teamSettings.setEditors);
  const [pending, setPending] = useState(false);

  async function toggle(id: EditorId, on: boolean) {
    setPending(true);
    try {
      await setEditors({
        organizationId: team.id,
        editors: EDITORS.map((editor) => editor.id).filter((other) =>
          other === id ? on : editors.includes(other),
        ),
      });
    } catch (caught) {
      toast.error(errorMessage(caught, "The setting could not be saved. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Video editors</h2>
        </CardTitle>
        <CardDescription>
          Tick the editors your team finishes videos in. Any run that makes cuts can then be opened
          in them, and no automation step has to ask.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup className="gap-3">
          {EDITORS.map((editor) => (
            <Field key={editor.id} orientation="horizontal">
              <Checkbox
                id={`editor-${editor.id}`}
                checked={editors.includes(editor.id)}
                disabled={!canEdit || pending}
                onCheckedChange={(checked) => toggle(editor.id, checked === true)}
              />
              <div className="grid gap-0.5">
                <FieldLabel htmlFor={`editor-${editor.id}`}>{editor.name}</FieldLabel>
                <FieldDescription>{NOTES[editor.id]}</FieldDescription>
              </div>
            </Field>
          ))}
          {!canEdit && (
            <FieldDescription>Only a team owner or admin can change this.</FieldDescription>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
