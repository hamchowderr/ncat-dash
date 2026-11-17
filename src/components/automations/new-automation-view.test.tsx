import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { mutationOf, replaced, toastError } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { NewAutomationView } from "./new-automation-view";

// Starting an automation happens on a page of its own, not in a window over the list.
describe("the new automation page", () => {
  test("goes back to the list, sliding the way back", () => {
    renderInApp(<NewAutomationView />);
    expect(screen.getByRole("heading", { name: "New automation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to automations" })).toHaveAttribute(
      "href",
      "/automations",
    );
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  test("picking the empty canvas makes the automation and opens it in place of this page", async () => {
    renderInApp(<NewAutomationView />);
    mutationOf(api.automations.create).mockResolvedValueOnce("auto_7");
    await userEvent.setup().click(screen.getAllByRole("button", { name: /Empty canvas/ })[0]);
    expect(mutationOf(api.automations.create)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      name: "New automation",
      starterId: undefined,
    });
    await waitFor(() =>
      expect(replaced).toHaveBeenCalledWith("/automations/auto_7", {
        transitionTypes: ["nav-forward"],
      }),
    );
  });

  test("says so when the automation could not be made", async () => {
    renderInApp(<NewAutomationView />);
    mutationOf(api.automations.create).mockRejectedValueOnce(new Error("offline"));
    await userEvent.setup().click(screen.getAllByRole("button", { name: /Empty canvas/ })[0]);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(replaced).not.toHaveBeenCalled();
  });
});
