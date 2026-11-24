import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { UploadingCard } from "./upload-media";
import { LibraryView } from "@/components/library/library-view";
import { emptyLibrary } from "@/test/library";

// Files are brought in on the Library page; it starts empty here.
beforeEach(() => emptyLibrary());

vi.mock("@/lib/upload", () => ({
  // Halfway there, and never finishing, so the page can be looked at mid-upload.
  putWithProgress: (_url: string, _file: File, onProgress: (percent: number) => void) => {
    onProgress(37);
    return new Promise<void>(() => {});
  },
}));

const STORAGE = { bucket: "ncat", publicUrl: null, baseUrl: "https://toolkit.example" };

function row(id: string, fileName: string, status: "uploading" | "ready") {
  return {
    _id: id,
    _creationTime: 0,
    fileName,
    contentType: "video/mp4",
    size: 1024,
    status,
    purpose: null,
    details: null,
  };
}

/** A file on its way up sits where it will land, as a skeleton with a circle and percentage. */
describe("a file being uploaded", () => {
  beforeEach(() => {
    window.localStorage.clear();
    answerQuery(api.storage.get, STORAGE);
    // Newest first: the new file is already listed, still going up.
    answerQuery(api.storage.listUploads, [
      row("u9", "Podcast 8.mp4", "uploading"),
      row("u1", "Older.mp4", "ready"),
      row("u5", "Left half-way yesterday.mp4", "uploading"),
    ]);
    actionOf(api.storage.previewLinks).mockResolvedValue([]);
    actionOf(api.storage.startUpload).mockResolvedValue({
      uploadId: "u9",
      uploadUrl: "https://r2.example/put",
    });
  });

  test("shows above the library as a tile with its percentage, not a bar of its own", async () => {
    renderInApp(<LibraryView />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    // Someone else's or an abandoned upload is not shown.
    expect(screen.queryByText("Left half-way yesterday.mp4")).toBeNull();

    fireEvent.change(screen.getByLabelText("Choose files to upload"), {
      target: { files: [new File(["x"], "Podcast 8.mp4", { type: "video/mp4" })] },
    });

    const progress = await screen.findByRole("progressbar", { name: "Uploading Podcast 8.mp4" });
    expect(progress).toHaveAttribute("aria-valuenow", "37");
    expect(progress).toHaveTextContent("37%");
    const tiles = within(screen.getByRole("list", { name: "Uploading" })).getAllByRole("listitem");
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toContainElement(progress);
    // The empty library's big drop area steps aside while the file goes up.
    await waitFor(() => expect(screen.queryByText("Nothing in the library yet")).toBeNull());
  });

  test("is a spinning circle with the percentage and the file's name", () => {
    render(<UploadingCard name="Podcast 8.mp4" percent={42.4} />);
    const progress = screen.getByRole("progressbar", { name: "Uploading Podcast 8.mp4" });
    expect(progress).toHaveAttribute("aria-valuenow", "42");
    expect(progress).toHaveTextContent("42%");
    expect(progress.querySelector("svg")).toHaveClass("animate-spin");
    expect(screen.getByText("Podcast 8.mp4")).toBeInTheDocument();
  });

  test("keeps the percentage between 0 and 100", () => {
    render(<UploadingCard name="a.mp4" percent={130} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});

/** A Zoom recording the toolkit is still bringing in is named above the files until it lands. */
describe("a Zoom recording on its way", () => {
  test("is named as coming in from Zoom, and not as a stray upload", () => {
    window.localStorage.clear();
    answerQuery(api.storage.get, STORAGE);
    answerQuery(api.storage.listUploads, [
      { ...row("z1", "Weekly Sync 2026-11-18.mp4", "uploading"), source: "zoom" },
      row("u5", "Left half-way yesterday.mp4", "uploading"),
    ]);
    actionOf(api.storage.previewLinks).mockResolvedValue([]);
    renderInApp(<LibraryView />);
    expect(
      screen.getByText(/Coming in from Zoom: Weekly Sync 2026-11-18\.mp4\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Left half-way yesterday/)).toBeNull();
  });
});

/** A Google Meet recording on its way is named the same way, by where it comes from. */
describe("a Google Meet recording on its way", () => {
  test("is named as coming in from Google Meet", () => {
    window.localStorage.clear();
    answerQuery(api.storage.get, STORAGE);
    answerQuery(api.storage.listUploads, [
      { ...row("g1", "Client Kickoff 2026-11-18.mp4", "uploading"), source: "google_meet" },
    ]);
    actionOf(api.storage.previewLinks).mockResolvedValue([]);
    renderInApp(<LibraryView />);
    expect(
      screen.getByText(/Coming in from Google Meet: Client Kickoff 2026-11-18\.mp4\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Coming in from Zoom/)).toBeNull();
  });
});

/** A Teams recording the toolkit is still bringing in is named above the files too. */
describe("a Teams recording on its way", () => {
  test("is named as coming in from Microsoft Teams", () => {
    window.localStorage.clear();
    answerQuery(api.storage.get, STORAGE);
    answerQuery(api.storage.listUploads, [
      { ...row("m1", "Client Kickoff 2026-11-18.mp4", "uploading"), source: "microsoft" },
    ]);
    actionOf(api.storage.previewLinks).mockResolvedValue([]);
    renderInApp(<LibraryView />);
    expect(
      screen.getByText(/Coming in from Microsoft Teams: Client Kickoff 2026-11-18\.mp4\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Coming in from Zoom/)).toBeNull();
    expect(screen.queryByText(/Coming in from Google Meet/)).toBeNull();
  });
});

/** A file from a watched Dropbox folder still on its way is named above the files too. */
describe("a Dropbox file on its way", () => {
  test("is named as coming in from Dropbox", () => {
    window.localStorage.clear();
    answerQuery(api.storage.get, STORAGE);
    answerQuery(api.storage.listUploads, [
      { ...row("d1", "Interview.mov", "uploading"), source: "dropbox" },
    ]);
    actionOf(api.storage.previewLinks).mockResolvedValue([]);
    renderInApp(<LibraryView />);
    expect(screen.getByText(/Coming in from Dropbox: Interview\.mov\./)).toBeInTheDocument();
    expect(screen.queryByText(/Coming in from Microsoft Teams/)).toBeNull();
  });
});
