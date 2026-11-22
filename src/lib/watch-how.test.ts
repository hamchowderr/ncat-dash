import { describe, expect, test } from "vitest";

import { EXPLAINERS, lengthOf, videosFor, videoUrl } from "./watch-how";

const titles = (pathname: string) => videosFor(pathname).map((video) => video.title);

describe("the videos for a page", () => {
  test("Home leads with its own video", () => {
    expect(titles("/")[0]).toBe("Home");
  });

  test("an automation's editor and its runs get different videos", () => {
    expect(titles("/automations/abc")).toContain("Build Your Own Automation");
    expect(titles("/automations/abc/runs/xyz")).toEqual([
      "When Something Fails",
      "A Backup Plan When A Step Fails",
    ]);
  });

  test("the Automations list starts with a template, then building your own", () => {
    expect(titles("/automations").slice(0, 3)).toEqual([
      "Start From A Template",
      "Other Ways To Start",
      "Build Your Own Automation",
    ]);
  });

  test("Jobs, a step's page and Settings > Brand each have theirs", () => {
    expect(titles("/jobs")[0]).toBe("Jobs");
    expect(titles("/steps/video-motion")).toEqual(["Test A Step"]);
    expect(titles("/settings/brand")).toEqual(["Set Your Brand Once"]);
  });

  test("meeting and chat app pages get Meeting Imports and Chat Alerts", () => {
    expect(titles("/settings/zoom")).toEqual(["Meeting Imports"]);
    expect(titles("/settings/microsoft")).toEqual(["Meeting Imports"]);
    expect(titles("/uploads")).toEqual(["Meeting Imports"]);
    expect(titles("/settings/telegram")).toEqual(["Chat Alerts"]);
    expect(titles("/settings/notifications")).toEqual(["Chat Alerts"]);
    expect(titles("/inbox")).toContain("Chat Alerts");
  });

  test("Settings > Microsoft Teams is not mistaken for Settings > Team", () => {
    expect(titles("/settings/team")).toEqual(["Your Team"]);
    expect(titles("/settings/teams")).toEqual(["Chat Alerts"]);
  });

  test("a page no video explains has none", () => {
    expect(videosFor("/toolkit")).toEqual([]);
    expect(videosFor("/settings/mcp")).toEqual([]);
  });

  test("every video is on at least one page", () => {
    const pages = [
      "/",
      "/get-started",
      "/inbox",
      "/automations",
      "/automations/new",
      "/automations/a",
      "/automations/a/runs/b",
      "/runs",
      "/review",
      "/calendar",
      "/clients",
      "/library",
      "/files",
      "/steps",
      "/jobs",
      "/settings/brand",
      "/settings/team",
      "/settings/zoom",
      "/settings/telegram",
    ];
    const shown = new Set(pages.flatMap(titles));
    expect(EXPLAINERS.filter((video) => !shown.has(video.title))).toEqual([]);
  });
});

describe("where a video plays from", () => {
  test("the Takewon website unless the copy names another place", () => {
    expect(videoUrl("26-jobs", "")).toBe("https://takewon.com/watch/26-jobs.mp4");
    expect(videoUrl("26-jobs", "https://cdn.example.test/videos/")).toBe(
      "https://cdn.example.test/videos/26-jobs.mp4",
    );
  });
});

test("lengths read as minutes and seconds", () => {
  expect(lengthOf(96)).toBe("1:36");
  expect(lengthOf(52)).toBe("0:52");
});
