"use client";

import { useAction } from "convex/react";
import { useCallback } from "react";

import { api } from "@convex/_generated/api";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

/**
 * A voice note to the agent: the recording goes straight from the browser to the team's
 * bucket, the team's own toolkit turns it into words, and the words come back to be sent.
 */
class Said extends Error {}

export function useVoiceNote() {
  const team = useActiveTeam();
  const start = useAction(api.voiceNotes.start);
  const transcribe = useAction(api.voiceNotes.transcribe);
  return useCallback(
    async (audio: Blob): Promise<string> => {
      const contentType = audio.type || "audio/webm";
      try {
        const { key, uploadUrl } = await start({
          organizationId: team.id,
          contentType,
          size: audio.size,
        });
        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": contentType.split(";")[0] },
          body: audio,
        });
        if (!put.ok) throw new Said("The voice note could not be sent to your storage.");
        const { text } = await transcribe({ organizationId: team.id, key });
        if (!text) throw new Said("No words could be heard in that voice note. Try again a little closer.");
        return text;
      } catch (caught) {
        if (caught instanceof Said) throw caught;
        throw new Error(errorMessage(caught, "The voice note could not be turned into words."));
      }
    },
    [team.id, start, transcribe],
  );
}
