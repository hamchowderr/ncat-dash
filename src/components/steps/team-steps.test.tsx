import { api } from "@convex/_generated/api";
import { actionTypesByGroup } from "@ncat-dash/automation-core";
import { getStep, setTeamSteps } from "@ncat-dash/step-catalog";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { pickerGroups } from "@/lib/step-picker";
import { TeamStepsSync, useTeamStepsVersion } from "@/lib/team-steps-sync";
import { answerQuery } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

const BLUR = {
  stepId: "team-abc",
  title: "Blur the background behind a vertical video",
  description: "Puts the video in the middle of a 9:16 frame over a blurred copy of itself.",
  blanks: [
    { name: "video_url", label: "Video", kind: "file" as const },
    { name: "blur", label: "Blur amount", kind: "number" as const, default: 20 },
  ],
  primary: "video_url",
  request: {
    inputs: [{ file_url: "{{video_url}}" }],
    filters: [{ filter: "boxblur={{blur}}" }],
    outputs: [{ options: [{ option: "-f", argument: "mp4" }] }],
  },
  updatedAt: 1,
};

afterEach(() => setTeamSteps([]));

function Picker() {
  useTeamStepsVersion();
  const team = actionTypesByGroup().find((group) => group.group === "team");
  return (
    <p data-testid="picker">{team ? team.types.map((type) => type.title).join(", ") : "none"}</p>
  );
}

describe("the team's steps in the browser's catalog", () => {
  test("are known to the catalog the canvas draws from", () => {
    answerQuery(api.teamSteps.list, [BLUR]);
    renderInApp(
      <TeamStepsSync organizationId={TEAM.id}>
        <Picker />
      </TeamStepsSync>,
    );
    expect(getStep("team-abc")?.title).toBe(BLUR.title);
    expect(screen.getByTestId("picker").textContent).toBe(BLUR.title);
  });

  test("stay out of the canvas's list of steps to add", () => {
    setTeamSteps([
      {
        id: "abc",
        title: BLUR.title,
        description: BLUR.description,
        blanks: BLUR.blanks,
        primary: BLUR.primary,
        request: BLUR.request,
      },
    ]);
    expect(actionTypesByGroup().some((group) => group.group === "team")).toBe(true);
    expect(pickerGroups().some((group) => group.group === "team")).toBe(false);
    expect(pickerGroups().length).toBeGreaterThan(3);
  });
});
