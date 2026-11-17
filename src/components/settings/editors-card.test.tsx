import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { mutationOf, toastError } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { EditorsCard } from "./editors-card";

const box = (name: string) => screen.getByRole("checkbox", { name });

describe("Video editors in Settings", () => {
  test("shows which editors the team uses", () => {
    renderInApp(<EditorsCard editors={["premiere", "finalcut"]} canEdit />);
    expect(box("Premiere Pro")).toBeChecked();
    expect(box("DaVinci Resolve")).not.toBeChecked();
    expect(box("Final Cut Pro")).toBeChecked();
    expect(box("CapCut")).not.toBeChecked();
    // CapCut is offered honestly: it gets clips, never a timeline.
    expect(screen.getByText(/CapCut cannot open a timeline from another tool/)).toBeVisible();
  });

  test("ticking an editor saves the whole list for the team", async () => {
    renderInApp(<EditorsCard editors={["premiere", "finalcut"]} canEdit />);
    await userEvent.setup().click(box("CapCut"));
    expect(mutationOf(api.teamSettings.setEditors)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      editors: ["premiere", "finalcut", "capcut"],
    });
  });

  test("unticking an editor saves the list without it", async () => {
    renderInApp(<EditorsCard editors={["premiere", "finalcut"]} canEdit />);
    await userEvent.setup().click(box("Premiere Pro"));
    expect(mutationOf(api.teamSettings.setEditors)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      editors: ["finalcut"],
    });
  });

  test("someone who is not an owner or admin can look but not change", async () => {
    renderInApp(<EditorsCard editors={["resolve"]} canEdit={false} />);
    expect(box("DaVinci Resolve")).toBeChecked();
    for (const name of ["Premiere Pro", "DaVinci Resolve", "Final Cut Pro", "CapCut"]) {
      expect(box(name)).toBeDisabled();
    }
    expect(screen.getByText("Only a team owner or admin can change this.")).toBeVisible();
    await userEvent.setup().click(box("CapCut"));
    expect(mutationOf(api.teamSettings.setEditors)).not.toHaveBeenCalled();
  });

  test("says so when the change could not be saved, and can be tried again", async () => {
    mutationOf(api.teamSettings.setEditors).mockRejectedValueOnce(new Error("offline"));
    renderInApp(<EditorsCard editors={[]} canEdit />);
    await userEvent.setup().click(box("CapCut"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("The setting could not be saved. Try again."),
    );
    expect(box("CapCut")).toBeEnabled();
  });

  test("shows the reason the backend gave when it gave one", async () => {
    mutationOf(api.teamSettings.setEditors).mockRejectedValueOnce(
      Object.assign(new Error("refused"), { data: { message: "Only owners can change this." } }),
    );
    renderInApp(<EditorsCard editors={[]} canEdit />);
    await userEvent.setup().click(box("Premiere Pro"));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Only owners can change this."));
  });
});
