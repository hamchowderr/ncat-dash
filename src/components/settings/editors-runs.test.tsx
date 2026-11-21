import { api } from "@convex/_generated/api";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { answerQuery, mutationOf, resetConvex } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { EditorsCard } from "./editors-card";
import { RunsSettings } from "./settings-view";

vi.mock("convex/react", async () => (await import("@/test/convex")).convexReact);
vi.mock("sonner", async () => (await import("@/test/convex")).sonner);
vi.mock("next/navigation", async () => ({
  ...(await import("@/test/convex")).nextNavigation,
  usePathname: () => "/settings/runs",
}));

const SETTINGS = {
  canEdit: true,
  maxParallelJobs: 2,
  mostAllowed: 20,
  stepRetries: 3,
  mostRetries: 10,
  aiLimit: null,
  aiLimitRange: { min: 0.05, max: 100 },
  brand: {},
};

describe("Video editors", () => {
  beforeEach(() => resetConvex());

  test("each editor is a row with a switch, and turning one on saves it", () => {
    const save = mutationOf(api.teamSettings.setEditors);
    renderInApp(<EditorsCard editors={["premiere"]} canEdit />);
    const premiere = screen.getByRole("switch", { name: "Premiere Pro" });
    expect(premiere).toBeChecked();
    expect(screen.getByText(/CapCut cannot open a timeline/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /DaVinci Resolve/ }));
    expect(save).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      editors: ["premiere", "resolve"],
    });
  });

  test("someone who cannot change them sees them switched off for editing", () => {
    renderInApp(<EditorsCard editors={[]} canEdit={false} />);
    for (const toggle of screen.getAllByRole("switch")) expect(toggle).toBeDisabled();
    expect(screen.getByText("Only a team owner or admin can change this.")).toBeInTheDocument();
  });
});

describe("Runs", () => {
  beforeEach(() => resetConvex());

  test("each setting is a row; Save shows only once its number is changed", async () => {
    answerQuery(api.teamSettings.get, SETTINGS);
    const setLimit = mutationOf(api.teamSettings.setMaxParallelJobs);
    renderInApp(<RunsSettings />);
    const jobs = screen.getByLabelText("Jobs at once");
    expect(jobs).toHaveValue(2);
    expect(screen.getByLabelText("Tries after a failure")).toHaveValue(3);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    fireEvent.change(jobs, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(setLimit).toHaveBeenCalledWith({ organizationId: TEAM.id, maxParallelJobs: 4 });
  });

  test("the limit for AI reads No limit when blank, and saves dollars as typed", () => {
    answerQuery(api.teamSettings.get, SETTINGS);
    const save = mutationOf(api.teamSettings.setAiLimit);
    renderInApp(<RunsSettings />);
    const limit = screen.getByLabelText("Limit for AI per run");
    expect(limit).toHaveValue("");
    expect(limit).toHaveAttribute("placeholder", "No limit");
    expect(screen.getByText(/ask the AI once for each video/)).toBeInTheDocument();
    fireEvent.change(limit, { target: { value: "0.75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith({ organizationId: TEAM.id, dollars: 0.75 });
  });

  test("clearing a saved limit saves no limit", () => {
    answerQuery(api.teamSettings.get, { ...SETTINGS, aiLimit: 2 });
    const save = mutationOf(api.teamSettings.setAiLimit);
    renderInApp(<RunsSettings />);
    const limit = screen.getByLabelText("Limit for AI per run");
    expect(limit).toHaveValue("2.00");
    fireEvent.change(limit, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith({ organizationId: TEAM.id, dollars: null });
  });

  test("someone who cannot change them gets no Save and is told why", () => {
    answerQuery(api.teamSettings.get, { ...SETTINGS, canEdit: false });
    renderInApp(<RunsSettings />);
    expect(screen.getByLabelText("Jobs at once")).toBeDisabled();
    expect(screen.getByLabelText("Limit for AI per run")).toBeDisabled();
    expect(screen.getByText("Only a team owner or admin can change these.")).toBeInTheDocument();
  });
});
