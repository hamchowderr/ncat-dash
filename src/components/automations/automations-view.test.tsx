import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf, place } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { AutomationsView } from "./automations-view";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

function automation(id: string, over: Record<string, unknown> = {}) {
  return {
    _id: id,
    name: `Automation ${id}`,
    enabled: false,
    hasDraft: false,
    trigger: { kind: "manual" },
    moreTriggers: [],
    stepCount: 1,
    nodes: [
      { id: "thumb", kind: "step", stepId: "video.thumbnail", input: {}, position: { x: 0, y: 0 } },
    ],
    edges: [],
    nextRunAt: null,
    updatedAt: NOW - 14 * DAY,
    createdAt: NOW - 20 * DAY,
    clientId: null,
    lastRun: null,
    ...over,
  };
}

const CLIENTS = [
  {
    _id: "clio",
    name: "Clio",
    logo: null,
    color: null,
    automations: 2,
    projects: 0,
    createdAt: NOW - 60 * DAY,
  },
  {
    _id: "empty",
    name: "Nobody's",
    logo: null,
    color: null,
    automations: 0,
    projects: 1,
    createdAt: NOW,
  },
];

function show(automations: unknown[], search = "") {
  place.pathname = "/automations";
  place.search = search;
  answerQuery(api.automations.list, automations);
  answerQuery(api.clients.list, CLIENTS);
  answerQuery(api.runs.waitingApprovals, []);
  return renderInApp(<AutomationsView />);
}

describe("the Automations page", () => {
  test("lists each automation as a row, with a client's ones in its folder at the top", () => {
    show([
      automation("a1", { name: "Daily reel", enabled: true, hasDraft: true }),
      automation("a2", { name: "For Clio one", clientId: "clio" }),
      automation("a3", { name: "For Clio two", clientId: "clio", updatedAt: NOW - 2 * DAY }),
    ]);
    const list = screen.getByRole("list", { name: "Automations" });
    const rows = within(list).getAllByRole("listitem");
    // The folder comes first; a client with nothing in it has no folder.
    expect(rows[0]).toHaveAttribute("data-folder");
    expect(rows[0]).toHaveTextContent("Clio");
    expect(rows[0]).toHaveTextContent("2 automations");
    expect(rows[0]).toHaveTextContent("Last updated 2 days ago");
    expect(within(list).queryByText("Nobody's")).not.toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "Clio folder" })).toHaveAttribute(
      "href",
      "/automations?folder=clio",
    );
    // What is in the folder is not repeated outside it.
    expect(within(list).queryByText("For Clio one")).not.toBeInTheDocument();

    const reel = list.querySelector("[data-automation='a1']") as HTMLElement;
    expect(within(reel).getByRole("link", { name: "Daily reel" })).toHaveAttribute(
      "href",
      "/automations/a1",
    );
    expect(reel).toHaveTextContent("Last updated 2 weeks ago");
    expect(reel).toHaveTextContent("Starts when you press Run now");
    expect(within(reel).getByText("Draft")).toBeInTheDocument();
    expect(within(reel).getByRole("switch", { name: "Daily reel is on" })).toBeChecked();
    expect(within(reel).getByText("On")).toBeInTheDocument();
  });

  test("a folder opens onto its client's automations, with a way back", () => {
    show(
      [
        automation("a1", { name: "Daily reel" }),
        automation("a2", { name: "For Clio one", clientId: "clio" }),
      ],
      "folder=clio",
    );
    expect(screen.getByRole("navigation", { name: "Folder" })).toHaveTextContent("Clio");
    expect(screen.getByRole("link", { name: /All automations/ })).toHaveAttribute(
      "href",
      "/automations",
    );
    const list = screen.getByRole("list", { name: "Automations for Clio" });
    expect(within(list).getByText("For Clio one")).toBeInTheDocument();
    expect(within(list).queryByText("Daily reel")).not.toBeInTheDocument();
    expect(list.querySelector("[data-folder]")).toBeNull();
  });

  test("switching one on, and moving one into a folder from its menu", async () => {
    const user = userEvent.setup();
    show([automation("a1", { name: "Daily reel" })]);
    fireEvent.click(screen.getByRole("switch", { name: "Daily reel is off" }));
    await waitFor(() =>
      expect(mutationOf(api.automations.setEnabled)).toHaveBeenCalledWith({
        automationId: "a1",
        enabled: true,
      }),
    );
    await user.click(screen.getByRole("button", { name: "More for Daily reel" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to folder" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Clio" }));
    await waitFor(() =>
      expect(mutationOf(api.clients.setForAutomation)).toHaveBeenCalledWith({
        automationId: "a1",
        clientId: "clio",
      }),
    );
  });

  test("a long list comes in pages", () => {
    show(Array.from({ length: 30 }, (_, n) => automation(`a${n}`)));
    expect(document.querySelectorAll("[data-automation]")).toHaveLength(25);
    expect(screen.getByRole("navigation", { name: "Pages of automations" })).toHaveTextContent(
      "Total 30",
    );
  });
});
