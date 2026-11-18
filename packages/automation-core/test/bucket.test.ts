import { describe, expect, it } from "vitest";
import {
  baseName,
  folderTrail,
  followFolder,
  followMoves,
  freeName,
  keyInsideMovedFolder,
  keyOfUrl,
  movedKey,
  moveProblem,
  nameProblem,
  parentOf,
  renamedKey,
  teamFolder,
  urlWithKey,
} from "../src";

const bucket = { endpoint: "https://s3.example.com", bucket: "team" };

describe("bucket paths", () => {
  it("reads names and parents of files and folders", () => {
    expect(baseName("a/b/clip.mp4")).toBe("clip.mp4");
    expect(baseName("a/b/")).toBe("b");
    expect(baseName("clip.mp4")).toBe("clip.mp4");
    expect(parentOf("a/b/clip.mp4")).toBe("a/b/");
    expect(parentOf("a/b/")).toBe("a/");
    expect(parentOf("clip.mp4")).toBe("");
    expect(parentOf("a/")).toBe("");
  });

  it("lists the folders above a folder", () => {
    expect(folderTrail("")).toEqual([]);
    expect(folderTrail("clips/tuesday/")).toEqual([
      { name: "clips", prefix: "clips/" },
      { name: "tuesday", prefix: "clips/tuesday/" },
    ]);
  });

  it("refuses names that would break a key", () => {
    expect(nameProblem("Final cut.mp4")).toBeNull();
    expect(nameProblem("  ")).not.toBeNull();
    expect(nameProblem("a/b")).not.toBeNull();
    expect(nameProblem("a\\b")).not.toBeNull();
    expect(nameProblem("..")).not.toBeNull();
    expect(nameProblem("x".repeat(201))).not.toBeNull();
  });

  it("works out the key after a rename or a move", () => {
    expect(renamedKey("a/b/clip.mp4", " final.mp4 ")).toBe("a/b/final.mp4");
    expect(renamedKey("a/b/", "c")).toBe("a/c/");
    expect(movedKey("a/b/clip.mp4", "")).toBe("clip.mp4");
    expect(movedKey("a/b/", "x/y/")).toBe("x/y/b/");
    expect(keyInsideMovedFolder("a/b/deep/clip.mp4", "a/b/", "x/b/")).toBe("x/b/deep/clip.mp4");
  });

  it("stops a folder being moved into itself", () => {
    expect(moveProblem("a/", "a/b/a/")).not.toBeNull();
    expect(moveProblem("a/clip.mp4", "a/clip.mp4")).not.toBeNull();
    expect(moveProblem("a/", "b/a/")).toBeNull();
    // A sibling whose name only starts the same is not inside it.
    expect(moveProblem("a/", "ab/")).toBeNull();
  });

  it("adds a number to a name that is taken", () => {
    const taken = new Set(["clip.mp4", "clip (2).mp4", "notes"]);
    expect(freeName("new.mp4", (name) => taken.has(name))).toBe("new.mp4");
    expect(freeName("clip.mp4", (name) => taken.has(name))).toBe("clip (3).mp4");
    expect(freeName("notes", (name) => taken.has(name))).toBe("notes (2)");
  });
});

describe("links to moved files", () => {
  it("finds the key in a link to the bucket, in either address style", () => {
    expect(keyOfUrl(bucket, "https://s3.example.com/team/out/my%20clip.mp4")).toBe(
      "out/my clip.mp4",
    );
    expect(keyOfUrl(bucket, "https://team.s3.example.com/out/clip.mp4")).toBe("out/clip.mp4");
  });

  it("leaves signed links and links to anywhere else alone", () => {
    expect(keyOfUrl(bucket, "https://s3.example.com/team/clip.mp4?X-Amz-Signature=abc")).toBeNull();
    expect(keyOfUrl(bucket, "https://s3.example.com/other/clip.mp4")).toBeNull();
    expect(keyOfUrl(bucket, "https://cdn.example.com/team/clip.mp4")).toBeNull();
    expect(keyOfUrl(bucket, "not a link")).toBeNull();
  });

  it("writes the new key in the style the link already used", () => {
    expect(urlWithKey(bucket, "https://s3.example.com/team/a.mp4", "done/a b.mp4")).toBe(
      "https://s3.example.com/team/done/a%20b.mp4",
    );
    expect(urlWithKey(bucket, "https://team.s3.example.com/a.mp4", "done/a.mp4")).toBe(
      "https://team.s3.example.com/done/a.mp4",
    );
  });

  it("follows moves through outputs and results, and drops deleted files from lists", () => {
    const moved = new Map<string, string | null>([
      ["out/a.mp4", "keep/a.mp4"],
      ["out/b.mp4", null],
    ]);
    const outputs = [
      "https://s3.example.com/team/out/a.mp4",
      "https://s3.example.com/team/out/b.mp4",
      "https://elsewhere.example.com/c.mp4",
    ];
    expect(followMoves(bucket, outputs, moved)).toEqual([
      "https://s3.example.com/team/keep/a.mp4",
      "https://elsewhere.example.com/c.mp4",
    ]);
    const result = { url: "https://s3.example.com/team/out/a.mp4", seconds: 4, parts: [1, 2] };
    expect(followMoves(bucket, result, moved)).toEqual({
      url: "https://s3.example.com/team/keep/a.mp4",
      seconds: 4,
      parts: [1, 2],
    });
  });

  it("follows links handed out under a public address", () => {
    const shared = { ...bucket, publicUrl: "https://files.example.com/media/" };
    expect(keyOfUrl(shared, "https://files.example.com/media/out/my%20clip.mp4")).toBe(
      "out/my clip.mp4",
    );
    // The bucket's own address still works beside it, and other sites still do not.
    expect(keyOfUrl(shared, "https://s3.example.com/team/out/a.mp4")).toBe("out/a.mp4");
    expect(keyOfUrl(shared, "https://files.example.com/other/a.mp4")).toBeNull();
    expect(keyOfUrl(shared, "https://cdn.example.com/media/a.mp4")).toBeNull();
    expect(urlWithKey(shared, "https://files.example.com/media/a.mp4", "done/a b.mp4")).toBe(
      "https://files.example.com/media/done/a%20b.mp4",
    );
    const moved = new Map<string, string | null>([["out/a.mp4", "keep/a.mp4"]]);
    expect(followMoves(shared, ["https://files.example.com/media/out/a.mp4"], moved)).toEqual([
      "https://files.example.com/media/keep/a.mp4",
    ]);
  });

  it("hands back the very same value when nothing moved", () => {
    const outputs = ["https://s3.example.com/team/untouched.mp4"];
    const result = { url: outputs[0], nested: { list: outputs } };
    const moved = new Map([["out/a.mp4", "keep/a.mp4"]]);
    expect(followMoves(bucket, outputs, moved)).toBe(outputs);
    expect(followMoves(bucket, result, moved)).toBe(result);
    expect(followMoves(bucket, undefined, moved)).toBeUndefined();
  });

  it("points a watched folder at its new place", () => {
    const folders = [{ from: "incoming/", to: "inbox/" }];
    expect(followFolder("incoming/", folders)).toBe("inbox/");
    expect(followFolder("incoming/shorts/", folders)).toBe("inbox/shorts/");
    expect(followFolder("other/", folders)).toBe("other/");
  });
});

describe("a team's folder in a shared bucket", () => {
  const shared = { ...bucket, root: teamFolder("org_1") };

  it("is teams/<id>/", () => {
    expect(teamFolder("org_1")).toBe("teams/org_1/");
  });

  it("reads keys from inside the folder, and has no key for anything outside it", () => {
    expect(keyOfUrl(shared, "https://s3.example.com/team/teams/org_1/out/clip.mp4")).toBe(
      "out/clip.mp4",
    );
    expect(keyOfUrl(shared, "https://s3.example.com/team/teams/org_2/out/clip.mp4")).toBeNull();
    expect(keyOfUrl(shared, "https://s3.example.com/team/job_output.mp4")).toBeNull();
    expect(keyOfUrl(shared, "https://s3.example.com/team/teams/org_1/")).toBeNull();
  });

  it("writes a moved file's link back inside the folder", () => {
    expect(
      urlWithKey(shared, "https://s3.example.com/team/teams/org_1/a.mp4", "Shows/b c.mp4"),
    ).toBe("https://s3.example.com/team/teams/org_1/Shows/b%20c.mp4");
    expect(
      followMoves(
        shared,
        ["https://s3.example.com/team/teams/org_1/a.mp4"],
        new Map([["a.mp4", "b.mp4"]]),
      ),
    ).toEqual(["https://s3.example.com/team/teams/org_1/b.mp4"]);
  });
});
