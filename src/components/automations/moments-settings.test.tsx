import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { nodeLook } from "./flow-nodes";
import { NodePanel } from "./node-panel";

function panel(node: Parameters<typeof NodePanel>[0]["node"]) {
  const onChange = vi.fn();
  renderInApp(
    <NodePanel
      node={node}
      before={[]}
      startGivesFile
      filled={{}}
      brand={{}}
      music={[]}
      onChange={onChange}
      onRemove={vi.fn()}
    />,
  );
  return onChange;
}

const MOMENTS = {
  id: "moments",
  kind: "moments" as const,
  input: { platform: "TikTok" },
  position: { x: 0, y: 0 },
};

describe("the Best moments step's settings", () => {
  test("shows the usual count and length, and the platform's limit", () => {
    panel(MOMENTS);
    expect(screen.getAllByText("Best moments").length).toBeGreaterThan(0);
    expect((screen.getByLabelText("Clips per video") as HTMLInputElement).value).toBe("5");
    expect((document.getElementById("node-moments-min") as HTMLInputElement).value).toBe("15");
    expect((document.getElementById("node-moments-max") as HTMLInputElement).value).toBe("60");
    expect(screen.getByText(/TikTok takes clips up to/)).toBeTruthy();
    expect(screen.getByLabelText("Topics to favour")).toBeTruthy();
  });

  test("saves a typed count, and emptying it goes back to the usual one", () => {
    const onChange = panel(MOMENTS);
    const count = screen.getByLabelText("Clips per video");
    fireEvent.change(count, { target: { value: "8" } });
    expect(onChange).toHaveBeenLastCalledWith({ input: { platform: "TikTok", count: 8 } });
    fireEvent.change(count, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ input: { platform: "TikTok" } });
  });

  test("does not save a count over the most it can make", () => {
    const onChange = panel(MOMENTS);
    fireEvent.change(screen.getByLabelText("Clips per video"), { target: { value: "99" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  test("keeps what counts as good and how edges are cut under More options", () => {
    panel(MOMENTS);
    expect(screen.queryByText("What makes a good moment")).toBeNull();
    fireEvent.click(screen.getByText("More options"));
    expect(screen.getByText("What makes a good moment")).toBeTruthy();
    expect(screen.getByText("Whole sentences")).toBeTruthy();
    expect(screen.getByText("Room before and after")).toBeTruthy();
    expect(screen.getByText("Skip moments already picked from the same video")).toBeTruthy();
  });
});

describe("the Chapters step's settings", () => {
  test("lets it decide how many, with three bullets each", () => {
    panel({ id: "chapters", kind: "chapters", input: {} });
    expect((screen.getByLabelText("Chapters, at most") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Bullets each") as HTMLInputElement).value).toBe("3");
    expect(screen.getByText(/Leave chapters empty to let it decide/)).toBeTruthy();
  });
});

describe("on the canvas", () => {
  test("each step has its own icon and says what it makes", () => {
    const moments = nodeLook({ kind: "moments", input: { platform: "TikTok", count: 3 } });
    const chapters = nodeLook({ kind: "chapters", input: {} });
    const clips = nodeLook({ kind: "clips", input: { platform: "TikTok" } });
    expect(moments.kind).toBe("3 for TikTok");
    expect(chapters.kind).toBe("From the transcript");
    expect(new Set([moments.icon, chapters.icon, clips.icon]).size).toBe(3);
  });
});
