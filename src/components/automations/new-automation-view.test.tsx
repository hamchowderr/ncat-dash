import { api } from "@convex/_generated/api";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";

import { DashboardTour } from "@/components/app-shell/dashboard-tour";
import { SidebarProvider } from "@/components/ui/sidebar";
import { answerQuery, mutationOf, replaced, toastError } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { NewAutomationView } from "./new-automation-view";
import { missingTourTargets } from "@/test/tours";
import { NEW_AUTOMATION_TOUR } from "./new-automation-tour";

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

describe("the tour of a new automation", () => {
  test("has a place on the page for every part it points at", () => {
    renderInApp(<NewAutomationView />);
    expect(missingTourTargets(NEW_AUTOMATION_TOUR)).toEqual([]);
  });
});

describe("a template picked before the tour shows", () => {
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });

  test("the tour still opens by itself for someone who has not picked yet", async () => {
    answerQuery(api.tours.ended, false);
    renderInApp(
      <SidebarProvider>
        <DashboardTour>
          <NewAutomationView />
        </DashboardTour>
      </SidebarProvider>,
    );
    await act(async () => {});
    expect(document.querySelector("[data-tour-card]")).not.toBeNull();
  });

  test("keeps the tour from opening over a page on its way out", async () => {
    // Whether the tour was had is not known yet, as on a slow connection.
    answerQuery(api.tours.ended, undefined);
    let made: (id: string) => void = () => {};
    mutationOf(api.automations.create).mockReturnValueOnce(
      new Promise<string>((resolve) => (made = resolve)),
    );
    const view = renderInApp(
      <SidebarProvider>
        <DashboardTour>
          <NewAutomationView />
        </DashboardTour>
      </SidebarProvider>,
    );
    await userEvent.setup().click(screen.getAllByRole("button", { name: /Empty canvas/ })[0]);
    // The answer arrives while the automation is being made.
    answerQuery(api.tours.ended, false);
    view.rerender(
      <SidebarProvider>
        <DashboardTour>
          <NewAutomationView />
        </DashboardTour>
      </SidebarProvider>,
    );
    await act(async () => {});
    expect(document.querySelector("[data-tour-card]")).toBeNull();
    await act(async () => made("auto_8"));
    await waitFor(() =>
      expect(replaced).toHaveBeenCalledWith("/automations/auto_8", {
        transitionTypes: ["nav-forward"],
      }),
    );
  });
});
