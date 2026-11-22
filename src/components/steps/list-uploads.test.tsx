import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { actionOf, answerQuery, mutationOf } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { StepForm } from "./step-form";

const UPLOADS = [
  { _id: "up1", fileName: "Skate park.mp4", status: "ready" },
  { _id: "up2", fileName: "Night ride.mp4", status: "ready" },
];
const link = (id: string) => `https://files.example/uploads/${id}.mp4`;

function open() {
  answerQuery(api.storage.listUploads, UPLOADS);
  actionOf(api.storage.linkFor).mockImplementation(async (args: unknown) =>
    link((args as { uploadId: string }).uploadId),
  );
  renderInApp(<StepForm stepId="recipe-beat-cut" />);
  return userEvent.setup();
}

describe("lists of files on the Steps page", () => {
  test("adds uploads as clips, one row each, and runs with their links", async () => {
    const user = open();
    for (const name of ["Skate park.mp4", "Night ride.mp4"]) {
      await user.click(screen.getByRole("button", { name: /^Add an upload as a/ }));
      await user.click(await screen.findByRole("menuitem", { name }));
    }
    await waitFor(() =>
      expect(screen.getAllByDisplayValue(/files\.example\/uploads/)).toHaveLength(2),
    );
    // Music is left empty: the team's first track is used.
    expect(screen.getByRole("textbox", { name: /^Music/ }).hasAttribute("required")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Run step" }));
    expect(mutationOf(api.jobs.run)).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: TEAM.id,
        stepId: "recipe-beat-cut",
        input: expect.objectContaining({
          video_urls: [{ video_url: link("up1") }, { video_url: link("up2") }],
        }),
      }),
    );
  });

  test("a row already there can take an upload instead of a pasted address", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: /^Add a / }));
    await user.click(screen.getByRole("button", { name: /^Use an upload for / }));
    await user.click(await screen.findByRole("menuitem", { name: "Night ride.mp4" }));
    await waitFor(() => expect(screen.getByDisplayValue(link("up2"))).toBeTruthy());
  });
});
