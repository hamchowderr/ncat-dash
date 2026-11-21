import { api } from "@convex/_generated/api";
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery } from "@/test/convex";
import { windowWidth } from "@/test/media";
import { renderInApp } from "@/test/render";

import { UploadsView } from "./uploads-view";

// Uploads from a phone: the camera roll's wording, tiles two across instead of a nine-column
// list, the file opened on the whole screen with big buttons, and the screen kept on while
// a file is still sending.

vi.mock("@/lib/upload", () => ({
  // Halfway there and never finishing, so the page can be looked at mid-upload.
  putWithProgress: (_url: string, _file: File, onProgress: (percent: number) => void) => {
    onProgress(40);
    return new Promise<void>(() => {});
  },
}));

const STORAGE = { bucket: "ncat", publicUrl: null, baseUrl: "https://toolkit.example" };

const ready = (id: string, fileName: string) => ({
  _id: id,
  _creationTime: 0,
  fileName,
  contentType: "video/mp4",
  size: 2048,
  status: "ready",
  purpose: null,
  details: null,
});

const release = vi.fn(() => Promise.resolve());
const request = vi.fn(() => Promise.resolve({ release }));

beforeEach(() => {
  window.localStorage.clear();
  answerQuery(api.storage.get, STORAGE);
  answerQuery(api.storage.listUploads, [ready("u1", "Beach day.mp4"), ready("u2", "Intro.mp4")]);
  actionOf(api.storage.previewLinks).mockResolvedValue([]);
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  request.mockClear();
  release.mockClear();
});

describe("Uploads on a phone", () => {
  test("says the files come from the phone on a touch screen, and from the computer otherwise", () => {
    windowWidth(390);
    renderInApp(<UploadsView />);
    expect(screen.getByText("Choose videos and photos from your phone.")).toHaveClass(
      "pointer-coarse:block",
    );
    expect(screen.getByText("Drop files here, or choose them from your computer.")).toHaveClass(
      "pointer-coarse:hidden",
    );
  });

  test("always shows tiles, two across, even when list was picked on a computer", () => {
    window.localStorage.setItem("uploads-layout", "list");
    windowWidth(390);
    renderInApp(<UploadsView />);
    expect(screen.queryByRole("table")).toBeNull();
    const grid = within(screen.getByRole("region", { name: "Your uploads" })).getByRole("list");
    expect(grid).toHaveClass("grid-cols-2");
    // The tile is just the picture and its name; the buttons are in the opened file.
    expect(
      screen.getByRole("button", { name: "Copy a link to Beach day.mp4" }).parentElement,
    ).toHaveClass("max-sm:hidden");
  });

  test("the list picked on a computer still shows there", () => {
    window.localStorage.setItem("uploads-layout", "list");
    windowWidth(1440);
    renderInApp(<UploadsView />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  test("opens a file on the whole screen with big buttons", () => {
    windowWidth(390);
    renderInApp(<UploadsView />);
    fireEvent.click(screen.getByRole("button", { name: "Open Beach day.mp4" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("max-sm:inset-0", "max-sm:h-dvh", "max-sm:rounded-none");
    expect(within(dialog).getByRole("button", { name: "Copy link" })).toHaveClass("max-sm:h-11");
    expect(within(dialog).getByRole("button", { name: "Remove from this list" })).toHaveClass(
      "max-sm:h-11",
    );
  });

  test("keeps the screen on while a file sends, and says to keep the page open", async () => {
    windowWidth(390);
    actionOf(api.storage.startUpload).mockResolvedValue({
      uploadId: "u9",
      uploadUrl: "https://r2.example/put",
    });
    renderInApp(<UploadsView />);
    expect(screen.queryByText(/Keep this page open/)).toBeNull();
    expect(request).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Choose files to upload"), {
      target: { files: [new File(["x"], "Beach day 2.mp4", { type: "video/mp4" })] },
    });
    expect(await screen.findByText(/Keep this page open until your files finish/)).toBeVisible();
    expect(request).toHaveBeenCalledWith("screen");
  });
});
