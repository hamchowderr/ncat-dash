import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf, pushed, toastError } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { OutputsView } from "./outputs-view";

const GROUPS = [
  {
    jobId: "j1",
    stepId: "video-split",
    finishedAt: 1_700_000_000_000,
    urls: ["https://files.example/a.mp4", "https://files.example/b.mp4"],
  },
];

describe("Send to review on Outputs", () => {
  test("opens a review with that step's files and goes to the room", async () => {
    answerQuery(api.jobs.outputs, GROUPS);
    mutationOf(api.reviews.create).mockResolvedValueOnce("rev_9");
    renderInApp(<OutputsView />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Send to review" }));
    expect(mutationOf(api.reviews.create)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      title: "Split video",
      urls: GROUPS[0].urls,
    });
    await waitFor(() => expect(pushed).toHaveBeenCalledWith("/review/rev_9"));
  });

  test("says so when the review could not be opened, and can be tried again", async () => {
    answerQuery(api.jobs.outputs, GROUPS);
    mutationOf(api.reviews.create).mockRejectedValueOnce(new Error("offline"));
    renderInApp(<OutputsView />);
    const button = screen.getByRole("button", { name: "Send to review" });
    await userEvent.setup().click(button);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("The review could not be opened."));
    expect(pushed).not.toHaveBeenCalled();
    expect(button).toBeEnabled();
  });
});
