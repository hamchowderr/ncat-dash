import { api } from "@convex/_generated/api";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, place, replaced, toastError } from "@/test/convex";
import { TEAM } from "@/test/render";

import OnboardingPage from "./page";

// The team is made; these screens start at the toolkit question.
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
});

describe("asking whether there is a toolkit", () => {
  test("asks first, as step 2, before any toolkit field", () => {
    render(<OnboardingPage />);
    expect(screen.getByRole("heading", { name: "Do You Have A Toolkit?" })).toBeTruthy();
    expect(screen.getByText("Step 2 of 7")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Yes, I Have One/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /No, Not Yet/ })).toBeTruthy();
    expect(screen.queryByLabelText("Toolkit address")).toBeNull();
    expect(screen.queryByLabelText("API key")).toBeNull();
  });

  test("No skips every toolkit field and carries on to the brand, then the goals", () => {
    render(<OnboardingPage />);
    fireEvent.click(screen.getByRole("button", { name: /No, Not Yet/ }));
    expect(screen.queryByLabelText("Toolkit address")).toBeNull();
    expect(screen.getByRole("heading", { name: "Add your brand" })).toBeTruthy();
    expect(screen.getByText("Step 3 of 7")).toBeTruthy();
    expect(actionOf(api.toolkitConnections.connect)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.getByText("Goals without a toolkit")).toBeTruthy();
  });

  test("Yes asks for the address and key, can go back, and connects before going on", async () => {
    actionOf(api.toolkitConnections.connect).mockResolvedValue({ ok: true, buildNumber: "219" });
    render(<OnboardingPage />);
    fireEvent.click(screen.getByRole("button", { name: /Yes, I Have One/ }));
    expect(screen.getByRole("heading", { name: "Connect your toolkit" })).toBeTruthy();
    expect(screen.getByText("Step 2 of 7")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Do You Have A Toolkit?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Yes, I Have One/ }));
    fireEvent.change(screen.getByLabelText("Toolkit address"), {
      target: { value: "https://toolkit.example" },
    });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(actionOf(api.toolkitConnections.connect)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      baseUrl: "https://toolkit.example",
      apiKey: "secret",
    });
    expect(screen.getByRole("heading", { name: "Add your brand" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.getByText("Goals with a toolkit")).toBeTruthy();
  });
});

describe("just using ours", () => {
  test("No says to use ours for now and connects the team to it", async () => {
    answerQuery(api.toolkitConnections.offersOurs, true);
    actionOf(api.toolkitConnections.connectOurs).mockResolvedValue({
      ok: true,
      buildNumber: "219",
    });
    render(<OnboardingPage />);
    const no = screen.getByRole("button", { name: /No, Not Yet/ });
    expect(no.textContent).toContain("Just use ours for now.");
    fireEvent.click(no);
    expect(await screen.findByRole("heading", { name: "Add your brand" })).toBeTruthy();
    expect(actionOf(api.toolkitConnections.connectOurs)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
    });
    expect(actionOf(api.toolkitConnections.connect)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.getByText("Goals with a toolkit")).toBeTruthy();
  });

  test("carries on without a toolkit, saying so, when ours does not answer", async () => {
    answerQuery(api.toolkitConnections.offersOurs, true);
    actionOf(api.toolkitConnections.connectOurs).mockResolvedValue({
      ok: false,
      reason: "unreachable",
      detail: "",
    });
    render(<OnboardingPage />);
    fireEvent.click(screen.getByRole("button", { name: /No, Not Yet/ }));
    expect(await screen.findByRole("heading", { name: "Add your brand" })).toBeTruthy();
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/did not answer/));
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.getByText("Goals without a toolkit")).toBeTruthy();
  });

  test("is not offered on a copy that lends no toolkit", () => {
    render(<OnboardingPage />);
    expect(screen.getByRole("button", { name: /No, Not Yet/ }).textContent).not.toContain(
      "use ours",
    );
  });
});

describe("connecting later", () => {
  test("the Connect your toolkit links open the form directly and go home once connected", async () => {
    place.search = "?toolkit=connect";
    actionOf(api.toolkitConnections.connect).mockResolvedValue({ ok: true, buildNumber: null });
    render(<OnboardingPage />);
    expect(screen.queryByRole("heading", { name: "Do You Have A Toolkit?" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Connect your toolkit" })).toBeTruthy();
    expect(screen.queryByText(/Step 2 of 7/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Toolkit address"), {
      target: { value: "https://toolkit.example" },
    });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(replaced).toHaveBeenCalledWith("/");
  });

  test("can be left without connecting", () => {
    place.search = "?toolkit=connect";
    render(<OnboardingPage />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(replaced).toHaveBeenCalledWith("/");
  });

  test("a team that is already connected goes straight to the dashboard", () => {
    answerQuery(api.toolkitConnections.list, [{ _id: "c1", baseUrl: "https://toolkit.example" }]);
    render(<OnboardingPage />);
    expect(replaced).toHaveBeenCalledWith("/");
  });
});
