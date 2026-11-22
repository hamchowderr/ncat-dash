"use client";

import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { useEffect } from "react";

/**
 * Every video and sound a team brings in is transcribed as it arrives. Files brought in
 * before that have no transcript, so the first time someone opens the dashboard each team
 * catches up by itself, a few at a time, and so does each upload's storyboard draft. Draws
 * nothing.
 */
export function TranscriptCatchUp({ organizationId }: { organizationId: string }) {
  const catchUp = useMutation(api.library.catchUpTranscripts);
  const catchUpDrafts = useMutation(api.storyboards.catchUpDrafts);
  useEffect(() => {
    void catchUp({ organizationId }).catch(() => {});
    // Uploads transcribed before every upload got a storyboard draft get theirs too.
    void catchUpDrafts({ organizationId }).catch(() => {});
  }, [catchUp, catchUpDrafts, organizationId]);
  return null;
}
