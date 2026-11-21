import { api } from "@convex/_generated/api";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { DropboxCard, folderLabel } from "./dropbox-card";

const empty = { ready: true, me: null, others: [], imports: [], sends: [] };
const me = {
  name: "Jordan Lee",
  email: "jordan@salthouse.test",
  connectedAt: Date.UTC(2026, 10, 19, 18),
  autoImport: true,
  needsReconnect: false,
  teamSpace: true,
  folders: [] as { _id: string; path: string; recursive: boolean }[],
};
const connected = {
  ...empty,
  me: { ...me, folders: [{ _id: "f1", path: "/Raw footage", recursive: true }] },
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
      folder: "/Takewon/Weekly shorts",
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
      folder: "/Takewon/Weekly shorts",
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
    actionOf(api.dropbox.scan).mockResolvedValue({ folders: [], partial: false });
    renderInApp(<DropboxCard />);
    expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
    expect(screen.getByText(/Maya Ortiz \(Maya O\)/)).toBeInTheDocument();
    const folders = screen.getByRole("region", { name: "Folders with media" });
    expect(await within(folders).findByText("/Raw footage")).toBeInTheDocument();
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
    // Unticking a watched folder and pressing the one button stops watching it.
    await user.click(within(folders).getByRole("checkbox", { name: "Bring in /Raw footage" }));
    await user.click(within(folders).getByRole("button", { name: "Stop watching 1 folder" }));
    expect(remove).toHaveBeenCalledWith({ folderId: "f1" });
    await user.click(within(sent).getByRole("button", { name: "Send again" }));
    expect(again).toHaveBeenCalledWith({ sendId: "s2" });
  });

  test("reads the whole Dropbox and lists folders with media, fullest first", async () => {
    answerQuery(api.dropbox.forTeam, { ...empty, me });
    let finish: (value: unknown) => void = () => {};
    actionOf(api.dropbox.scan).mockReturnValue(new Promise((done) => (finish = done)));
    renderInApp(<DropboxCard />);
    expect(screen.getByText("Reading your Dropbox")).toBeInTheDocument();
    finish({
      folders: [
        { path: "/Raw footage", name: "Raw footage", files: 12, fresh: 12, watched: false },
        { path: "/Shoots/Day 1", name: "Day 1", files: 5, fresh: 2, watched: false },
        { path: "/", name: "Dropbox", files: 1, fresh: 0, watched: false },
      ],
      partial: false,
    });
    expect(await screen.findByText("12 files")).toBeInTheDocument();
    expect(screen.getByText("2 new of 5")).toBeInTheDocument();
    expect(screen.getByText("All in Uploads")).toBeInTheDocument();
    expect(screen.getByText("Team folders are included.", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bring in" })).toBeDisabled();
  });

  test("ticking folders and pressing one button brings them in", async () => {
    answerQuery(api.dropbox.forTeam, { ...empty, me });
    const scan = actionOf(api.dropbox.scan);
    scan.mockResolvedValue({
      folders: [
        { path: "/Raw footage", name: "Raw footage", files: 12, fresh: 12, watched: false },
        { path: "/Shoots/Day 1", name: "Day 1", files: 5, fresh: 2, watched: false },
      ],
      partial: false,
    });
    const pull = actionOf(api.dropbox.pullIn);
    pull.mockResolvedValue({ watching: 2, started: 14, more: false });
    renderInApp(<DropboxCard />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Bring in /Raw footage" }));
    await user.click(screen.getByRole("checkbox", { name: "Bring in /Shoots/Day 1" }));
    expect(screen.getByText("2 folders ticked")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bring in 2 folders" }));
    expect(pull).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      paths: ["/Raw footage", "/Shoots/Day 1"],
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("14 files on the way to Uploads"),
    );
    // The list is read again afterwards.
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
  });

  test("a very big Dropbox says only part was read, and folders can be searched", async () => {
    answerQuery(api.dropbox.forTeam, { ...empty, me });
    actionOf(api.dropbox.scan).mockResolvedValue({
      folders: Array.from({ length: 10 }, (_, i) => ({
        path: `/Shoot ${i + 1}`,
        name: `Shoot ${i + 1}`,
        files: 3,
        fresh: 3,
        watched: false,
      })),
      partial: true,
    });
    renderInApp(<DropboxCard />);
    expect(await screen.findByText(/only the first part was read/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Search folders" }), "shoot 10");
    expect(screen.getByText("Shoot 10")).toBeInTheDocument();
    expect(screen.queryByText("Shoot 2")).toBeNull();
    expect(folderLabel("/")).toBe("All of Dropbox");
    expect(folderLabel("/Raw footage")).toBe("/Raw footage");
  });

  test("when Dropbox cannot be read it says so and can try again", async () => {
    answerQuery(api.dropbox.forTeam, { ...empty, me });
    const scan = actionOf(api.dropbox.scan);
    scan.mockRejectedValueOnce(new Error("down"));
    scan.mockResolvedValue({ folders: [], partial: false });
    renderInApp(<DropboxCard />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(toastError).toHaveBeenCalled();
    expect(
      await screen.findByText(/No videos, sounds or pictures in your Dropbox yet/),
    ).toBeInTheDocument();
  });
});
