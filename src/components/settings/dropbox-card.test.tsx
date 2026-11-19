import { api } from "@convex/_generated/api";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { crumbsOf, DropboxCard } from "./dropbox-card";

const empty = { ready: true, me: null, others: [], imports: [], sends: [] };
const me = {
  name: "Jordan Lee",
  email: "jordan@salthouse.test",
  connectedAt: Date.UTC(2026, 10, 19, 18),
  autoImport: true,
  needsReconnect: false,
  teamSpace: true,
  folders: [] as { _id: string; path: string }[],
};
const connected = {
  ...empty,
  me: { ...me, folders: [{ _id: "f1", path: "/Raw footage" }] },
  others: [{ name: "Maya O", memberName: "Maya Ortiz" }],
  imports: [
    {
      _id: "i1",
      name: "Interview.mov",
      path: "/Raw footage/Day 1/Interview.mov",
      status: "done",
      error: null,
    },
    {
      _id: "i2",
      name: "Broll.mp4",
      path: "/Raw footage/Broll.mp4",
      status: "failed",
      error: "The file is no longer in Dropbox.",
    },
  ],
  sends: [
    {
      _id: "s1",
      name: "Space clip.mp4",
      automationName: "Weekly shorts",
      folder: "/Kontifi/Weekly shorts",
      dropboxPath: null,
      size: 100,
      offset: 40,
      status: "sending",
      error: null,
    },
    {
      _id: "s2",
      name: "Moon clip.mp4",
      automationName: "Weekly shorts",
      folder: "/Kontifi/Weekly shorts",
      dropboxPath: null,
      size: 100,
      offset: 0,
      status: "failed",
      error: "The Dropbox is full, so the file could not be added.",
    },
  ],
};

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("the Dropbox card", () => {
  test("says when this dashboard has no Dropbox app yet, with nothing to press", () => {
    answerQuery(api.dropbox.forTeam, { ...empty, ready: false });
    renderInApp(<DropboxCard />);
    expect(screen.getByText(/not set up on this dashboard yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("connecting opens Dropbox", async () => {
    answerQuery(api.dropbox.forTeam, empty);
    const start = mutationOf(api.dropbox.startLink);
    start.mockResolvedValue("https://www.dropbox.com/oauth2/authorize?state=abc");
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: "http://localhost/settings/dropbox",
      assign,
    } as Location);
    renderInApp(<DropboxCard />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Connect Dropbox" }));
    expect(start).toHaveBeenCalledWith({ organizationId: TEAM.id });
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://www.dropbox.com/oauth2/authorize?state=abc"),
    );
    vi.restoreAllMocks();
  });

  test("coming back says how it went, once", () => {
    window.history.replaceState(null, "", "/settings/dropbox?dropbox=taken");
    answerQuery(api.dropbox.forTeam, empty);
    renderInApp(<DropboxCard />);
    expect(toastError).toHaveBeenCalledWith("That Dropbox is already connected to another team.");
    expect(window.location.search).toBe("");
  });

  test("shows the account, watched folders, what came in and what was sent", async () => {
    answerQuery(api.dropbox.forTeam, connected);
    const setAuto = mutationOf(api.dropbox.setAutoImport);
    const remove = mutationOf(api.dropbox.removeFolder);
    const again = mutationOf(api.dropbox.sendAgain);
    renderInApp(<DropboxCard />);
    expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
    expect(screen.getByText(/Maya Ortiz \(Maya O\)/)).toBeInTheDocument();
    const folders = screen.getByRole("region", { name: "Watched folders" });
    expect(within(folders).getByText("/Raw footage")).toBeInTheDocument();
    const came = screen.getByRole("region", { name: "Brought in from Dropbox" });
    expect(within(came).getByRole("link", { name: "In Uploads" })).toHaveAttribute(
      "href",
      "/uploads",
    );
    expect(within(came).getByText("The file is no longer in Dropbox.")).toBeInTheDocument();
    const sent = screen.getByRole("region", { name: "Sent to Dropbox" });
    expect(within(sent).getByText("Sending 40%")).toBeInTheDocument();
    expect(within(sent).getByText(/Dropbox is full/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("switch"));
    expect(setAuto).toHaveBeenCalledWith({ organizationId: TEAM.id, autoImport: false });
    await user.click(within(folders).getByRole("button", { name: "Stop watching" }));
    expect(remove).toHaveBeenCalledWith({ folderId: "f1" });
    await user.click(within(sent).getByRole("button", { name: "Send again" }));
    expect(again).toHaveBeenCalledWith({ sendId: "s2" });
  });

  test("a folder is picked by opening folders, team folders marked, and watched", async () => {
    answerQuery(api.dropbox.forTeam, { ...empty, me });
    const browse = actionOf(api.dropbox.browse);
    browse.mockImplementation(async ({ path }: { path: string }) =>
      path === ""
        ? [
            { name: "Marketing", path: "/Marketing", shared: true },
            { name: "Raw footage", path: "/Raw footage", shared: false },
          ]
        : [{ name: "Day 1", path: "/Raw footage/Day 1", shared: false }],
    );
    const add = actionOf(api.dropbox.addFolder);
    add.mockResolvedValue("f2");
    renderInApp(<DropboxCard />);
    expect(screen.getByText(/your own or your team's/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add a folder" }));
    expect(await screen.findByText("Team folder")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Raw footage" }));
    expect(await screen.findByRole("button", { name: "Open Day 1" })).toBeInTheDocument();
    expect(browse).toHaveBeenLastCalledWith({ organizationId: TEAM.id, path: "/Raw footage" });
    await user.click(screen.getByRole("button", { name: "Watch Raw footage" }));
    expect(add).toHaveBeenCalledWith({ organizationId: TEAM.id, path: "/Raw footage" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Watching /Raw footage"));
    // The way back up runs along the top.
    expect(crumbsOf("/Raw footage/Day 1").map((one) => one.name)).toEqual([
      "Dropbox",
      "Raw footage",
      "Day 1",
    ]);
  });

  test("files already in watched folders are listed, ticked, and brought over", async () => {
    answerQuery(api.dropbox.forTeam, connected);
    actionOf(api.dropbox.pastFiles).mockResolvedValue([
      {
        fileId: "id:a",
        name: "Interview.mov",
        path: "/Raw footage/Interview.mov",
        folder: "/Raw footage",
        kind: "video",
        size: 2_000_000,
        modifiedAt: Date.UTC(2026, 10, 18),
        brought: false,
      },
      {
        fileId: "id:b",
        name: "Voice.wav",
        path: "/Raw footage/Voice.wav",
        folder: "/Raw footage",
        kind: "audio",
        size: 1_000,
        modifiedAt: Date.UTC(2026, 10, 17),
        brought: false,
      },
      {
        fileId: "id:c",
        name: "Logo.png",
        path: "/Raw footage/Logo.png",
        folder: "/Raw footage",
        kind: "image",
        size: 1_000,
        modifiedAt: Date.UTC(2026, 10, 16),
        brought: true,
      },
    ]);
    const bring = actionOf(api.dropbox.bringOver);
    bring.mockResolvedValue({ started: 1, skipped: 0 });
    renderInApp(<DropboxCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Find files" }));
    expect(await screen.findByText("All 2 picked")).toBeInTheDocument();
    expect(screen.getAllByText("In Uploads").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("checkbox", { name: "Pick Voice.wav" }));
    expect(screen.getByText("1 of 2 picked")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bring over 1 file" }));
    expect(bring).toHaveBeenCalledWith({ organizationId: TEAM.id, fileIds: ["id:a"] });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("1 file on the way to Uploads"));
    // Search narrows the list.
    await user.type(screen.getByRole("textbox", { name: "Search files" }), "voice");
    expect(screen.queryByText("Logo.png")).toBeNull();
  });
});
