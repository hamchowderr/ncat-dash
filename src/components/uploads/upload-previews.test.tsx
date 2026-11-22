import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { UploadsView } from "./uploads-view";

/** Uploads shows each file itself: a frame per video, played at full size when opened. */

const STORAGE = { bucket: "ncat", publicUrl: null, baseUrl: "https://toolkit.example" };
const VIDEO_DETAILS = {
  duration: 412,
  hasVideo: true,
  hasAudio: true,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: "h264",
  audioCodec: "aac",
  format: "mov,mp4,m4a,3gp,3g2,mj2",
};

function upload(id: string, fileName: string, contentType: string, details: object | null = null) {
  return {
    _id: id,
    _creationTime: 0,
    fileName,
    contentType,
    size: 48 * 1024 * 1024,
    status: "ready",
    purpose: null,
    details,
  };
}

const UPLOADS = [
  upload("u1", "Big Talk.mp4", "video/mp4", VIDEO_DETAILS),
  upload("u2", "Theme.mp3", "audio/mpeg", { duration: 30, hasAudio: true, audioCodec: "mp3" }),
  upload("u3", "Plan.pdf", "application/pdf"),
  upload("u4", "still-reading.mov", "video/quicktime"),
];

function linkFor({ uploadIds }: { uploadIds: string[] }) {
  return uploadIds.map((uploadId) => ({ uploadId, url: `https://r2.example/${uploadId}` }));
}

beforeEach(() => {
  window.localStorage.clear();
  answerQuery(api.storage.get, STORAGE);
  answerQuery(api.storage.listUploads, UPLOADS);
  actionOf(api.storage.previewLinks).mockImplementation(async (args: unknown) =>
    linkFor(args as { uploadIds: string[] }),
  );
});

describe("the Uploads page shows each file", () => {
  test("a meeting recording someone shared says who, on its tile and when opened", async () => {
    answerQuery(api.storage.listUploads, [
      {
        ...upload("u9", "Tylan Andrew 2025-04-23.mp4", "video/mp4", VIDEO_DETAILS),
        source: "google_meet",
        sharedBy: "Andrew Fink",
      },
    ]);
    renderInApp(<UploadsView />);
    expect(
      screen.getByText("Video · 6:52 · 1920×1080 · 48 MB · Shared by Andrew Fink"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Tylan Andrew 2025-04-23.mp4" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Shared by")).toBeTruthy();
    expect(within(dialog).getByText("Andrew Fink")).toBeTruthy();
  });

  test("videos show their opening frame as a tile", async () => {
    renderInApp(<UploadsView />);
    const tile = screen.getByRole("button", { name: "Open Big Talk.mp4" });
    await waitFor(() =>
      expect(within(tile).getByTestId("upload-frame-video").getAttribute("src")).toBe(
        "https://r2.example/u1#t=0.1",
      ),
    );
    // A video the toolkit has not read yet is still shown from its type.
    const unread = screen.getByRole("button", { name: "Open still-reading.mov" });
    await waitFor(() => expect(within(unread).getByTestId("upload-frame-video")).toBeTruthy());
    expect(screen.getByText("Video · 6:52 · 1920×1080 · 48 MB")).toBeTruthy();
  });

  test("links are asked for once, only for files that can be shown", async () => {
    renderInApp(<UploadsView />);
    await waitFor(() => expect(actionOf(api.storage.previewLinks)).toHaveBeenCalledTimes(1));
    expect(actionOf(api.storage.previewLinks)).toHaveBeenCalledWith({
      organizationId: "team_1",
      uploadIds: ["u1", "u2", "u4"],
    });
  });

  test("a sound and a file that is neither show what they are", async () => {
    renderInApp(<UploadsView />);
    await waitFor(() => expect(actionOf(api.storage.previewLinks)).toHaveBeenCalled());
    const sound = screen.getByRole("button", { name: "Open Theme.mp3" });
    expect(within(sound).queryByTestId("upload-frame-video")).toBeNull();
    const pdf = screen.getByRole("button", { name: "Open Plan.pdf" });
    expect(within(pdf).queryByTestId("upload-frame-video")).toBeNull();
    expect(screen.getByText("File · 48 MB")).toBeTruthy();
  });

  test("hovering a video plays it without sound, leaving stops it", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    renderInApp(<UploadsView />);
    const tile = screen.getByRole("button", { name: "Open Big Talk.mp4" });
    const video = await waitFor(() => within(tile).getByTestId("upload-frame-video"));
    expect((video as HTMLVideoElement).muted).toBe(true);
    fireEvent.pointerEnter(tile.closest("li")!);
    await waitFor(() => expect(play).toHaveBeenCalled());
    fireEvent.pointerLeave(tile.closest("li")!);
    expect(pause).toHaveBeenCalled();
  });

  test("opening a video plays it beside its details", async () => {
    renderInApp(<UploadsView />);
    await waitFor(() => expect(actionOf(api.storage.previewLinks)).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Open Big Talk.mp4" }));
    const dialog = await screen.findByRole("dialog");
    const player = within(dialog).getByTestId("upload-player") as HTMLVideoElement;
    expect(player.tagName).toBe("VIDEO");
    expect(player.getAttribute("src")).toBe("https://r2.example/u1");
    expect(player.controls).toBe(true);
    expect(within(dialog).getByText("1920×1080")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  test("an opened video links to its transcript and SRT in the library", async () => {
    answerQuery(api.storage.listUploads, [
      { ...UPLOADS[0], libraryItemId: "i1", transcript: "ready" },
      { ...UPLOADS[3], libraryItemId: "i4", transcript: "working" },
    ]);
    renderInApp(<UploadsView />);
    fireEvent.click(screen.getByRole("button", { name: "Open Big Talk.mp4" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("link", { name: "Transcript and SRT" }).getAttribute("href"),
    ).toBe("/library/i1");
  });

  test("a transcript still being made says it is on its way", async () => {
    answerQuery(api.storage.listUploads, [
      { ...UPLOADS[3], libraryItemId: "i4", transcript: "working" },
    ]);
    renderInApp(<UploadsView />);
    fireEvent.click(screen.getByRole("button", { name: "Open still-reading.mov" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "Transcript on its way" })).toBeTruthy();
  });

  test("a file still being read opens too, and says so", async () => {
    renderInApp(<UploadsView />);
    fireEvent.click(screen.getByRole("button", { name: "Open still-reading.mov" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/still reading this file's details/)).toBeTruthy();
  });

  test("removing from the open file closes it", async () => {
    renderInApp(<UploadsView />);
    fireEvent.click(screen.getByRole("button", { name: "Open Big Talk.mp4" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove from this list" }));
    expect(mutationOf(api.storage.removeUpload)).toHaveBeenCalledWith({ uploadId: "u1" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("a list keeps every column, with a frame at the start of each row", async () => {
    renderInApp(<UploadsView />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Frame rate" })).toBeTruthy();
    const row = within(table).getByText("Big Talk.mp4").closest("tr")!;
    await waitFor(() => expect(within(row).getByTestId("upload-frame-video")).toBeTruthy());
    expect(within(row).getByText("30 fps")).toBeTruthy();
    expect(window.localStorage.getItem("uploads-layout")).toBe("list");
    fireEvent.click(screen.getByRole("button", { name: "Tiles" }));
    expect(screen.queryByRole("table")).toBeNull();
  });

  test("when signing fails the tiles still show, and it is tried again later", async () => {
    actionOf(api.storage.previewLinks).mockRejectedValueOnce(new Error("toolkit down"));
    renderInApp(<UploadsView />);
    await waitFor(() => expect(actionOf(api.storage.previewLinks)).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Open Big Talk.mp4" })).toBeTruthy();
    expect(screen.queryByTestId("upload-frame-video")).toBeNull();
  });
});
