import { api } from "@convex/_generated/api";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { actionOf, mutationOf } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { MeetPastRecordings } from "./google-meet-past";

const thisYear = new Date().getFullYear();

function recording(
  driveFileId: string,
  topic: string,
  { minutes = 40, sharedBy = null as string | null, year = thisYear, standing = "new" } = {},
) {
  return {
    driveFileId,
    topic,
    startTime: new Date(year, 2, 4, 10).getTime(),
    minutes,
    size: 300_000_000,
    standing,
    sharedBy,
  };
}

async function findAll(recordings: ReturnType<typeof recording>[], names = true) {
  actionOf(api.googleMeet.pastRecordings).mockResolvedValue({ recordings, complete: true, names });
  renderInApp(<MeetPastRecordings organizationId={TEAM.id} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Find recordings" }));
  await screen.findByRole("button", { name: "Look again" });
  return user;
}

describe("past Google Meet recordings", () => {
  test("very short recordings start unticked, and say why", async () => {
    actionOf(api.googleMeet.thumbnails).mockResolvedValue([]);
    await findAll([
      recording("fileLong1", "Podcast Taping", { minutes: 58 }),
      recording("fileShort1", "cos-kgiq-cpk", { minutes: 2 }),
    ]);
    expect(screen.getByRole("checkbox", { name: /^Pick Podcast Taping/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Pick cos-kgiq-cpk/ })).not.toBeChecked();
    expect(screen.getByText("1 of 2 picked")).toBeInTheDocument();
    expect(screen.getByText(/under 5 minutes start unticked/)).toBeInTheDocument();
  });

  test("shared recordings are counted, labelled, and can be shown on their own; search narrows the list", async () => {
    actionOf(api.googleMeet.thumbnails).mockResolvedValue([]);
    const user = await findAll([
      recording("fileOwn1", "Podcast Taping"),
      recording("fileShared1", "Tylan / Andrew", { sharedBy: "Andrew Fink" }),
      recording("fileOwn2", "Client Kickoff"),
    ]);
    expect(
      screen.getByText("3 recordings in your Drive, 1 shared with you. 3 not in Uploads yet."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Shared with you" }));
    expect(screen.getAllByRole("checkbox", { name: /^Pick .*,/ })).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /^Pick Tylan \/ Andrew/ })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Yours" }));
    expect(screen.getAllByRole("checkbox", { name: /^Pick .*,/ })).toHaveLength(2);
    await user.click(screen.getByRole("tab", { name: "All" }));

    await user.type(screen.getByRole("textbox", { name: "Search recordings" }), "kick");
    expect(screen.getAllByRole("checkbox", { name: /^Pick .*,/ })).toHaveLength(1);
    // Unpicking what is shown leaves the rest picked.
    await user.click(
      screen.getByRole("checkbox", { name: "Pick every recording shown that is not in Uploads" }),
    );
    expect(screen.getByText("2 of 3 picked")).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "Search recordings" }));
    await user.type(screen.getByRole("textbox", { name: "Search recordings" }), "zzz");
    expect(screen.getByText("No recordings match.")).toBeInTheDocument();
  });

  test("without calendar names, untitled meetings offer to connect Google again", async () => {
    actionOf(api.googleMeet.thumbnails).mockResolvedValue([]);
    const start = mutationOf(api.googleMeet.startLink);
    start.mockResolvedValue("https://accounts.google.test/auth");
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign } as Location);
    const user = await findAll([recording("fileCode1", "yhf-hxfg-gcu")], false);
    expect(screen.getByText(/name them from your calendar/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use calendar names" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.test/auth"));
    expect(start).toHaveBeenCalledWith({ organizationId: TEAM.id });
    vi.restoreAllMocks();
  });

  test("each recording shows Drive's picture and opens to watch", async () => {
    const pictures = actionOf(api.googleMeet.thumbnails);
    pictures.mockResolvedValue([
      { driveFileId: "fileOwn1", picture: "data:image/png;base64,AAAA" },
      { driveFileId: "fileOwn2", picture: null },
    ]);
    const user = await findAll([
      recording("fileOwn1", "Podcast Taping"),
      recording("fileOwn2", "Client Kickoff"),
      recording("fileOld1", "Strategy Day", { year: thisYear - 1 }),
    ]);
    // Only the open year's recordings are asked for.
    await waitFor(() =>
      expect(pictures).toHaveBeenCalledWith({
        organizationId: TEAM.id,
        driveFileIds: ["fileOwn1", "fileOwn2"],
      }),
    );
    // Each recording also links to its file in Google Drive.
    expect(
      screen.getByRole("link", { name: /^Open Client Kickoff, .*in Google Drive$/ }),
    ).toHaveAttribute("href", "https://drive.google.com/file/d/fileOwn2/view");
    const watch = screen.getByRole("button", { name: /^Watch Podcast Taping/ });
    await waitFor(() =>
      expect(within(watch).getByRole("presentation", { hidden: true })).toHaveAttribute(
        "src",
        "data:image/png;base64,AAAA",
      ),
    );
    await user.click(watch);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTitle("Podcast Taping recording")).toHaveAttribute(
      "src",
      "https://drive.google.com/file/d/fileOwn1/preview",
    );
    expect(within(dialog).getByRole("link", { name: "Open in Google Drive" })).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/fileOwn1/view",
    );
  });
});
