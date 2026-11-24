import { api } from "@convex/_generated/api";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { actionOf, resetConvex } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { FilePreview } from "./file-preview";
import type { FileEntry } from "./files-view";

const FILE: FileEntry = {
  key: "team_1/Shoot/Interview.mp4",
  name: "Interview.mp4",
  size: 48 * 1024 * 1024,
  lastModified: Date.UTC(2026, 10, 20),
  kind: "video",
  uploadId: null,
  details: {
    duration: 412,
    hasVideo: true,
    hasAudio: true,
    width: 1920,
    height: 1080,
    fps: 29.97,
    videoCodec: "h264",
    audioCodec: "aac",
  },
  usedAs: null,
};

function open(file: FileEntry) {
  renderInApp(
    <FilePreview
      organizationId={TEAM.id}
      file={file}
      onDownload={vi.fn()}
      onCopyLink={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return screen.getByRole("dialog");
}

/** A file opened on the Files page shows its numbers the same way as its page in the Library. */
describe("a file's preview on Files", () => {
  beforeEach(() => {
    resetConvex();
    actionOf(api.files.linkFor).mockResolvedValue("https://files.example/interview.mp4");
  });

  test("its numbers are labels, each with its own icon and name", () => {
    const dialog = open(FILE);
    const facts = within(within(dialog).getByRole("list", { name: "About the file" })).getAllByRole(
      "listitem",
    );
    expect(facts.map((fact) => fact.getAttribute("aria-label"))).toEqual([
      "Length: 6:52",
      "Picture size: 1920×1080",
      "Frame rate: 29.97 fps",
      "Format: h264",
      "Sound: aac",
      "File size: 48 MB",
    ]);
    expect(facts.every((fact) => fact.querySelector("svg"))).toBe(true);
    // Not said twice in rows under them.
    expect(within(dialog).queryByText("File size")).toBeNull();
    expect(within(dialog).getByText("team_1/Shoot/Interview.mp4")).toBeTruthy();
  });

  test("a file whose details are not read yet still says its size", () => {
    const dialog = open({ ...FILE, kind: "other", name: "notes.pdf", details: null });
    expect(within(dialog).queryByRole("list", { name: "About the file" })).toBeNull();
    expect(within(dialog).getByText("File size")).toBeTruthy();
    expect(within(dialog).getByText("48 MB")).toBeTruthy();
  });
});
