import { api } from "@convex/_generated/api";
import { actionTypesByGroup } from "@ncat-dash/automation-core";
import { getStep, setTeamSteps } from "@ncat-dash/step-catalog";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { TeamStepsSync, useTeamStepsVersion } from "@/lib/team-steps-sync";
import { answerQuery, mutationOf } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { TeamStepsList } from "./team-steps-list";

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

describe("the team's own steps on the Steps page", () => {
  test("says how to get one when there are none", () => {
    answerQuery(api.teamSteps.list, []);
    renderInApp(<TeamStepsList />);
    expect(screen.getByRole("heading", { name: "Your team's steps" })).toBeTruthy();
    expect(screen.getByText(/ask the agent/)).toBeTruthy();
  });

  test("lists each with what it does and the settings it takes", () => {
    answerQuery(api.teamSteps.list, [BLUR]);
    renderInApp(<TeamStepsList />);
    expect(screen.getByText(BLUR.title)).toBeTruthy();
    expect(screen.getByText(BLUR.description)).toBeTruthy();
    expect(screen.getByText("Blur amount")).toBeTruthy();
  });

  test("removes one, and says why when an automation still uses it", async () => {
    answerQuery(api.teamSteps.list, [BLUR]);
    const remove = mutationOf(api.teamSteps.remove);
    remove.mockRejectedValueOnce(
      Object.assign(new Error("x"), {
        data: { code: "in_use", message: "Vertical podcast still uses this step. Take it out of that automation first." },
      }),
    );
    renderInApp(<TeamStepsList />);
    fireEvent.click(screen.getByRole("button", { name: `Remove ${BLUR.title}` }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Vertical podcast/));
    expect(remove).toHaveBeenCalledWith({ organizationId: TEAM.id, stepId: "team-abc" });
  });
});

function Picker() {
  useTeamStepsVersion();
  const team = actionTypesByGroup().find((group) => group.group === "team");
  return <p data-testid="picker">{team ? team.types.map((type) => type.title).join(", ") : "none"}</p>;
}

describe("the team's steps in the browser's catalog", () => {
  test("are known to the canvas and the step picker", () => {
    answerQuery(api.teamSteps.list, [BLUR]);
    renderInApp(
      <TeamStepsSync organizationId={TEAM.id}>
        <Picker />
      </TeamStepsSync>,
    );
    expect(getStep("team-abc")?.title).toBe(BLUR.title);
    expect(screen.getByTestId("picker").textContent).toBe(BLUR.title);
  });
});
