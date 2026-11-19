import { api } from "@convex/_generated/api";
import { MOTION_PRESETS, NO_MOTION_SETUP } from "@ncat-dash/automation-core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { MotionCard } from "./motion-card";

function show(motion = NO_MOTION_SETUP, canEdit = true) {
  return renderInApp(<MotionCard motion={motion} presets={MOTION_PRESETS} canEdit={canEdit} />);
}

describe("Settings > Motion", () => {
  test("shows every preset by group, the picked one chosen, and nothing to save yet", () => {
    show();
    expect(screen.getAllByRole("radio")).toHaveLength(18);
    expect(screen.getByRole("radio", { name: /Clean Talking Head/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("Educational")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("picking a preset takes its style; changing one piece marks it changed", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("radio", { name: /Bold Hook/ }));
    expect(screen.getByRole("combobox", { name: "Look" })).toHaveTextContent("Bold");
    expect(screen.getByRole("combobox", { name: "Sound effects" })).toHaveTextContent("Heavy");
    expect(screen.getByRole("checkbox", { name: /Stat card/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(screen.getByRole("checkbox", { name: /Stat card/ }));
    expect(screen.getByText("Bold Hook, changed")).toBeInTheDocument();
  });

  test("saves the style and the names for the team", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("radio", { name: /Neon/ }));
    await user.type(screen.getByRole("textbox", { name: "Usual speaker" }), "Ana");
    await user.type(screen.getByRole("textbox", { name: "Handle" }), "@saltstudio");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const neon = MOTION_PRESETS.find((preset) => preset.id === "neon")!;
    expect(mutationOf(api.teamSettings.setMotion)).toHaveBeenCalledWith({
      organizationId: "team_1",
      motion: {
        ...NO_MOTION_SETUP,
        preset: "neon",
        style: neon.style,
        hostName: "Ana",
        handle: "@saltstudio",
      },
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Motion settings saved."));
  });

  test("says why it could not save", async () => {
    const user = userEvent.setup();
    mutationOf(api.teamSettings.setMotion).mockRejectedValueOnce(new Error("offline"));
    show();
    await user.click(screen.getByRole("radio", { name: /Hype/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  test("is read-only for members", () => {
    show(NO_MOTION_SETUP, false);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("Only a team owner or admin can change this.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Bold Hook/ })).toBeDisabled();
  });
});
