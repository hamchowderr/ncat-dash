"use client";

import { api } from "@convex/_generated/api";
import { EDITORS, type EditorId } from "@takewon/timeline-export";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { SettingRow, SettingsSection } from "./settings-shell";

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
    <SettingsSection>
      {EDITORS.map((editor) => (
        <SettingRow
          key={editor.id}
          label={editor.name}
          htmlFor={`editor-${editor.id}`}
          description={NOTES[editor.id]}
        >
          <Switch
            id={`editor-${editor.id}`}
            checked={editors.includes(editor.id)}
            disabled={!canEdit || pending}
            onCheckedChange={(checked) => toggle(editor.id, checked)}
          />
        </SettingRow>
      ))}
      {!canEdit && (
        <p className="text-muted-foreground text-sm">Only a team owner or admin can change this.</p>
      )}
    </SettingsSection>
  );
}
