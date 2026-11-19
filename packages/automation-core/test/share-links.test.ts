import { describe, expect, it } from "vitest";
import {
  downloadLink,
  driveDownloadUrl,
  readShareLink,
  unusableShareLink,
  withDownloadLinks,
} from "../src";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

describe("share links", () => {
  it("turns every shape of Google Drive file link into its download link", () => {
    for (const link of [
      `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
      `https://drive.google.com/file/d/${ID}/view?usp=drive_link`,
      `https://drive.google.com/file/d/${ID}`,
      `https://drive.google.com/file/u/0/d/${ID}/view`,
      `https://drive.google.com/open?id=${ID}`,
      `https://drive.google.com/uc?id=${ID}&export=download`,
      `https://docs.google.com/uc?export=download&id=${ID}`,
      `  https://drive.google.com/file/d/${ID}/view  `,
    ]) {
      expect(readShareLink(link)).toEqual({
        kind: "fixed",
        url: driveDownloadUrl(ID),
        service: "Google Drive",
      });
    }
    expect(driveDownloadUrl(ID)).toBe(
      `https://drive.usercontent.google.com/download?id=${ID}&export=download&confirm=t`,
    );
  });

  it("turns a Dropbox file link into a download, keeping its key", () => {
    expect(
      downloadLink("https://www.dropbox.com/scl/fi/abc123/Episode 12.mp4?rlkey=k9x&dl=0"),
    ).toBe("https://www.dropbox.com/scl/fi/abc123/Episode%2012.mp4?rlkey=k9x&dl=1");
    expect(downloadLink("https://www.dropbox.com/scl/fi/abc123/episode.mp4?rlkey=k9x&st=q1")).toBe(
      "https://www.dropbox.com/scl/fi/abc123/episode.mp4?rlkey=k9x&st=q1&dl=1",
    );
    expect(downloadLink("https://dropbox.com/s/abc123/old.mov?dl=0")).toBe(
      "https://dropbox.com/s/abc123/old.mov?dl=1",
    );
    expect(readShareLink("https://www.dropbox.com/s/abc123/old.mov").kind).toBe("fixed");
  });

  it("leaves download links, other addresses and plain text alone", () => {
    for (const value of [
      "https://www.dropbox.com/scl/fi/abc/a.mp4?rlkey=k&dl=1",
      "https://www.dropbox.com/scl/fi/abc/a.mp4?rlkey=k&raw=1",
      "https://www.dropbox.com/home",
      "https://files.example/uploads/talk.mp4",
      "https://drive.usercontent.google.com/download?id=abc&export=download",
      "not a link",
      "ftp://drive.google.com/file/d/x",
      "",
    ]) {
      expect(readShareLink(value)).toEqual({ kind: "plain", url: value });
    }
  });

  it("explains links no download exists for", () => {
    const problem = (url: string) => {
      const link = readShareLink(url);
      return link.kind === "unusable" ? link.problem : null;
    };
    expect(problem("https://drive.google.com/drive/folders/1xyzabcdefghij")).toMatch(/folder/);
    expect(problem("https://drive.google.com/drive/u/0/my-drive")).toMatch(/folder/);
    expect(problem("https://docs.google.com/document/d/1xyzabcdefghij/edit")).toMatch(/Docs/);
    expect(problem("https://docs.google.com/spreadsheets/d/1xyzabcdefghij/edit")).toMatch(/Docs/);
    expect(problem("https://drive.google.com/file/d/short/view")).toMatch(/no file/);
    expect(problem("https://www.dropbox.com/scl/fo/abc/xyz?rlkey=k&dl=0")).toMatch(/folder/);
    expect(problem("https://www.dropbox.com/sh/abc/xyz?dl=0")).toMatch(/folder/);
  });

  it("fixes links anywhere in a job's settings and keeps the rest as it was", () => {
    const settings = {
      video_url: `https://drive.google.com/file/d/${ID}/view`,
      video_urls: [{ video_url: "https://www.dropbox.com/s/abc/b.mp4?dl=0" }],
      captions: "Visit https://drive.google.com/file/d/x for more",
      font_size: 40,
      keep: { a: "https://files.example/a.mp4", b: null },
    };
    const fixed = withDownloadLinks(settings);
    expect(fixed).toEqual({
      ...settings,
      video_url: driveDownloadUrl(ID),
      video_urls: [{ video_url: "https://www.dropbox.com/s/abc/b.mp4?dl=1" }],
    });
    // Parts with nothing to fix are the same objects, so nothing is copied needlessly.
    expect(fixed.keep).toBe(settings.keep);
    const plain = { a: "https://files.example/a.mp4", b: [1, 2] };
    expect(withDownloadLinks(plain)).toBe(plain);
  });

  it("finds a folder link buried in settings", () => {
    expect(
      unusableShareLink({ list: [{ url: "https://www.dropbox.com/scl/fo/abc/x?dl=0" }] }),
    ).toMatchObject({ service: "Dropbox" });
    expect(unusableShareLink({ a: [`https://drive.google.com/file/d/${ID}/view`] })).toBeNull();
    expect(unusableShareLink(null)).toBeNull();
  });
});
