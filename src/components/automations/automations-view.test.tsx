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
    folderId: null,
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
    automations: 1,
    projects: 0,
    createdAt: NOW,
  },
];

const FOLDERS = [
  { _id: "empty", name: "Ads", count: 0, createdAt: NOW, updatedAt: NOW },
  { _id: "shorts", name: "Shorts", count: 2, createdAt: NOW - 60 * DAY, updatedAt: NOW - 2 * DAY },
];

function show(automations: unknown[], search = "") {
  place.pathname = "/automations";
  place.search = search;
  answerQuery(api.automations.list, automations);
  answerQuery(api.clients.list, CLIENTS);
  answerQuery(api.automationFolders.list, FOLDERS);
  answerQuery(api.runs.waitingApprovals, []);
  return renderInApp(<AutomationsView />);
}

describe("the Automations page", () => {
  test("lists each automation as a row, with folders at the top", () => {
    show([
      automation("a1", { name: "Daily reel", enabled: true, hasDraft: true, clientId: "clio" }),
      automation("a2", { name: "Shorts one", folderId: "shorts" }),
      automation("a3", { name: "Shorts two", folderId: "shorts" }),
    ]);
    const list = screen.getByRole("list", { name: "Automations" });
    const rows = within(list).getAllByRole("listitem");
    // Folders come first, empty ones too, like n8n.
    expect(rows[0]).toHaveAttribute("data-folder");
    expect(rows[0]).toHaveTextContent("Ads");
    expect(rows[1]).toHaveTextContent("Shorts");
    expect(rows[1]).toHaveTextContent("2 automations");
    expect(rows[1]).toHaveTextContent("Last updated 2 days ago");
    expect(within(list).getByRole("link", { name: "Shorts folder" })).toHaveAttribute(
      "href",
      "/automations?folder=shorts",
    );
    // What is in a folder is not repeated outside it.
    expect(within(list).queryByText("Shorts one")).not.toBeInTheDocument();

    const reel = list.querySelector("[data-automation='a1']") as HTMLElement;
    expect(within(reel).getByRole("link", { name: "Daily reel" })).toHaveAttribute(
      "href",
      "/automations/a1",
    );
    expect(reel).toHaveTextContent("Last updated 2 weeks ago");
    expect(reel).toHaveTextContent("Starts when you press Run now");
    // The client it works for shows as a badge; clients are not folders.
    expect(within(reel).getByText("Clio")).toBeInTheDocument();
    expect(within(reel).getByText("Draft")).toBeInTheDocument();
    expect(within(reel).getByRole("switch", { name: "Daily reel is on" })).toBeChecked();
  });

  test("suggests what goes well with the team's automations below the list, not in a folder", () => {
    answerQuery(api.automations.teamFollowOns, [
      { automationId: "a1", automationName: "Daily reel", starterId: "brand-every-clip" },
    ]);
    const { unmount } = show([automation("a1", { name: "Daily reel" })]);
    const section = screen.getByRole("region", { name: "Goes well with what you have" });
    expect(within(section).getByText("After Daily reel")).toBeInTheDocument();
    unmount();
    show([automation("a2", { folderId: "shorts" })], "?folder=shorts");
    expect(screen.queryByRole("region", { name: "Goes well with what you have" })).toBeNull();
  });

  test("a folder opens onto what is in it, with a way back", () => {
    show(
      [
        automation("a1", { name: "Daily reel" }),
        automation("a2", { name: "Shorts one", folderId: "shorts" }),
      ],
      "folder=shorts",
    );
    expect(screen.getByRole("navigation", { name: "Folder" })).toHaveTextContent("Shorts");
    expect(screen.getByRole("link", { name: /All automations/ })).toHaveAttribute(
      "href",
      "/automations",
    );
    const list = screen.getByRole("list", { name: "Automations for Shorts" });
    expect(within(list).getByText("Shorts one")).toBeInTheDocument();
    expect(within(list).queryByText("Daily reel")).not.toBeInTheDocument();
    expect(list.querySelector("[data-folder]")).toBeNull();
    expect(screen.queryByRole("button", { name: "New folder" })).not.toBeInTheDocument();
  });

  test("New folder names a folder and makes it", async () => {
    const user = userEvent.setup();
    show([automation("a1")]);
    await user.click(screen.getByRole("button", { name: "New folder" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Create folder" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Folder name"), "Podcasts");
    await user.click(within(dialog).getByRole("button", { name: "Create folder" }));
    await waitFor(() =>
      expect(mutationOf(api.automationFolders.create)).toHaveBeenCalledWith({
        organizationId: "team_1",
        name: "Podcasts",
      }),
    );
  });

  test("a folder's menu renames or deletes it", async () => {
    const user = userEvent.setup();
    show([automation("a1")]);
    await user.click(screen.getByRole("button", { name: "More for the Shorts folder" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const name = within(screen.getByRole("dialog")).getByLabelText("Folder name");
    expect(name).toHaveValue("Shorts");
    await user.clear(name);
    await user.type(name, "Reels");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mutationOf(api.automationFolders.rename)).toHaveBeenCalledWith({
        folderId: "shorts",
        name: "Reels",
      }),
    );

    await user.click(screen.getByRole("button", { name: "More for the Shorts folder" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "The 2 automations in it stay, back on the main list.",
    );
    await user.click(screen.getByRole("button", { name: "Delete folder" }));
    await waitFor(() =>
      expect(mutationOf(api.automationFolders.remove)).toHaveBeenCalledWith({ folderId: "shorts" }),
    );
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
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Shorts" }));
    await waitFor(() =>
      expect(mutationOf(api.automationFolders.moveAutomation)).toHaveBeenCalledWith({
        automationId: "a1",
        folderId: "shorts",
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
