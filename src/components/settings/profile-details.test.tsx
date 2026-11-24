import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { answerQuery, mutationOf, toastSuccess } from "@/test/convex";
import { renderInApp } from "@/test/render";
import { setPreferredTimeZone } from "@/lib/time-zone";

import { ProfileDetails } from "./profile-details";

afterEach(() => setPreferredTimeZone(undefined));

describe("role and time zone on the profile", () => {
  test("shows what is saved, and saves a new job title", async () => {
    answerQuery(api.profiles.mine, { title: "Editor", timeZone: "Europe/Berlin" });
    renderInApp(<ProfileDetails />);
    const role = screen.getByLabelText("Job title");
    expect(role).toHaveValue("Editor");
    expect(screen.getByText(/Berlin/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save work details" });
    expect(save).toBeDisabled();
    fireEvent.change(role, { target: { value: "Producer" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(mutationOf(api.profiles.update)).toHaveBeenCalledWith({
        title: "Producer",
        timeZone: "Europe/Berlin",
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Saved."));
  });

  test("says where the job title and the time zone show up", () => {
    answerQuery(api.profiles.mine, { title: null, timeZone: null });
    renderInApp(<ProfileDetails />);
    expect(screen.getByText(/beside your name on Members/)).toBeInTheDocument();
    expect(
      screen.getByText(/Daily summaries, calendar times, schedules and the agent/),
    ).toBeInTheDocument();
  });
});
