import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, place, replaced } from "@/test/convex";
import { TEAM } from "@/test/render";

import OnboardingPage from "./page";

// The team is made; these screens start at the brand.
vi.mock("@/lib/use-team", () => ({
  useTeam: () => ({
    status: "ready",
    user: { id: "u1", name: "Dana Reyes", email: "dana@example.test" },
    team: TEAM,
  }),
}));
vi.mock("@/lib/use-guard-redirect", () => ({ useGuardRedirect: () => {} }));
// The brand form and the content goals screens have their own tests.
vi.mock("@/components/settings/brand-form", () => ({
  BrandForm: () => <p>Brand form</p>,
}));
vi.mock("@/components/onboarding/content-goals-flow", () => ({
  ContentGoalsFlow: ({ hasToolkit }: { hasToolkit: boolean }) => (
    <p>{hasToolkit ? "Goals with a toolkit" : "Goals without a toolkit"}</p>
  ),
}));

beforeEach(() => {
  answerQuery(api.toolkitConnections.list, []);
  answerQuery(api.teamSettings.get, { brand: null, music: null, canEdit: true });
  answerQuery(api.toolkitConnections.offersOurs, false);
  answerQuery(api.contentGoals.get, { kinds: [], apps: [], answered: false, canEdit: true });
});

const ours = { _id: "c1", ours: true, baseUrl: "https://media.example" };

describe("setting up never asks about a toolkit", () => {
  test("goes from the team straight to the brand, as step 2 of 6", () => {
    answerQuery(api.toolkitConnections.list, [ours]);
    answerQuery(api.toolkitConnections.offersOurs, true);
    render(<OnboardingPage />);
    expect(screen.getByRole("heading", { name: "Add your brand" })).toBeTruthy();
    expect(screen.getByText("Step 2 of 6")).toBeTruthy();
    expect(screen.queryByText(/Do You Have A Toolkit/)).toBeNull();
    expect(screen.queryByLabelText("Toolkit address")).toBeNull();
    expect(screen.queryByLabelText("API key")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.getByText("Goals with a toolkit")).toBeTruthy();
  });

  test("a team already on ours is still setting up, so it is not sent home", () => {
    answerQuery(api.toolkitConnections.list, [ours]);
    answerQuery(api.toolkitConnections.offersOurs, true);
    render(<OnboardingPage />);
    expect(replaced).not.toHaveBeenCalled();
    expect(actionOf(api.toolkitConnections.connectOurs)).not.toHaveBeenCalled();
  });

  test("asks for ours once more when the team is not on it yet, and carries on", async () => {
    answerQuery(api.toolkitConnections.offersOurs, true);
    actionOf(api.toolkitConnections.connectOurs).mockRejectedValue(new Error("slow"));
    render(<OnboardingPage />);
    await waitFor(() =>
      expect(actionOf(api.toolkitConnections.connectOurs)).toHaveBeenCalledWith({
        organizationId: TEAM.id,
      }),
    );
    expect(actionOf(api.toolkitConnections.connectOurs)).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    // Ours is being connected, so the first upload is offered.
    expect(screen.getByText("Goals with a toolkit")).toBeTruthy();
  });

  test("on a copy that lends no toolkit, the goals end without an upload", () => {
    render(<OnboardingPage />);
    expect(actionOf(api.toolkitConnections.connectOurs)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.getByText("Goals without a toolkit")).toBeTruthy();
  });
});

describe("teams that set up before", () => {
  test("old Connect your toolkit links go to Settings, under Toolkit", () => {
    place.search = "?toolkit=connect";
    render(<OnboardingPage />);
    expect(replaced).toHaveBeenCalledWith("/settings/toolkit");
    expect(screen.queryByLabelText("Toolkit address")).toBeNull();
  });

  test("a team that said what it makes goes straight to the dashboard", () => {
    answerQuery(api.contentGoals.get, {
      kinds: ["podcast"],
      apps: [],
      answered: true,
      canEdit: true,
    });
    render(<OnboardingPage />);
    expect(replaced).toHaveBeenCalledWith("/");
  });

  test("a team that connected its own toolkit partway through carries on setting up", () => {
    answerQuery(api.toolkitConnections.list, [
      { _id: "c1", ours: false, baseUrl: "https://toolkit.example" },
    ]);
    render(<OnboardingPage />);
    expect(replaced).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Add your brand" })).toBeTruthy();
  });
});
