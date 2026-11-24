import { followShapeLine } from "@takewon/automation-core";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { NodePanel } from "./node-panel";
import { PlatformPicker } from "./platform-picker";
import { STEP_ICONS } from "./step-icons";

const CLIPS = {
  id: "clips",
  kind: "clips" as const,
  input: { platform: "TikTok" },
  position: { x: 0, y: 0 },
};
const FOLLOW = {
  id: "follow_1",
  kind: "step" as const,
  stepId: "video-reframe",
  input: {},
  position: { x: 300, y: 0 },
};
const EDGES = [{ id: "clips>follow_1", source: "clips", target: "follow_1" }];

function panel(
  node: Parameters<typeof NodePanel>[0]["node"],
  extra: Partial<Parameters<typeof NodePanel>[0]> = {},
) {
  renderInApp(
    <NodePanel
      node={node}
      before={[]}
      startGivesFile
      filled={{}}
      brand={{}}
      music={[]}
      onChange={vi.fn()}
      onRemove={vi.fn()}
      {...extra}
    />,
  );
}

describe("the Follow the speaker step", () => {
  test("has its own icon", () => {
    expect(STEP_ICONS["video-reframe"]).toBeTruthy();
    expect(STEP_ICONS["video-reframe"]).not.toBe(STEP_ICONS["recipe-crop-vertical"]);
  });

  test("its panel is titled for people and offers the shape and what to follow", () => {
    panel(FOLLOW);
    expect(screen.getAllByText("Follow the speaker").length).toBeGreaterThan(0);
    expect(screen.getByText("Nothing to set. This step works as it is.")).toBeTruthy();
    fireEvent.click(screen.getByText("More options"));
    expect(screen.getByText("Shape")).toBeTruthy();
    expect(screen.getByText("Default (Vertical 9:16)")).toBeTruthy();
    expect(screen.getByText("Default (The person talking)")).toBeTruthy();
    expect(screen.getByText("Wait before switching")).toBeTruthy();
    expect(screen.getByText("Shortest shot")).toBeTruthy();
    expect(screen.queryByText("Min hold")).toBeNull();
  });

  test("after Clips, its shape says it comes from the platform by itself", () => {
    panel(FOLLOW, { filled: followShapeLine(FOLLOW, [CLIPS, FOLLOW], EDGES) });
    expect(
      screen.getByText(
        "Automatic. Makes the vertical 9:16 shape TikTok clips need. Pick one to use your own instead.",
      ),
    ).toBeTruthy();
  });
});

describe("a Clips step that feeds Follow the speaker", () => {
  test("says its clips keep the wide picture and get their shape from the next step", () => {
    renderInApp(<PlatformPicker compact followed value="TikTok" onChange={vi.fn()} />);
    expect(
      screen.getByText(
        "Cut in the video's own shape, then Follow the speaker makes them vertical 9:16 and keeps the person talking in frame.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/blurred background/)).toBeNull();
  });

  test("its panel passes that on", () => {
    panel(CLIPS, { feedsFollow: true });
    expect(screen.getByText(/then Follow the speaker makes them/)).toBeTruthy();
  });
});
