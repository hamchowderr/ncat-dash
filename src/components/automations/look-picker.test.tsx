import { api } from "@convex/_generated/api";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { answerQuery, resetConvex } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { NodePanel } from "./node-panel";

const look = (name: string, captionStyle: string | null = null) => ({
  _id: name,
  name,
  frame: { shape: "square", fill: "bars", brightness: 0, contrast: 1, saturation: 1, warmth: 0 },
  captionStyle,
  shotSeconds: null,
  notes: "",
  sourceName: "x.mp4",
  sheetUrl: null,
  summary: `${name} summary`,
  at: 0,
});

function panel(input: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  renderInApp(
    <NodePanel
      node={{ id: "step_1", kind: "step", stepId: "recipe-saved-look", input }}
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

describe("the Match A Saved Look step", () => {
  beforeEach(() => resetConvex());

  test("picks a saved look by name, never a typed one", async () => {
    answerQuery(api.looks.list, {
      canEdit: true,
      study: null,
      looks: [look("Cafe Reels", "Cafe Reels"), look("Square Bars")],
    });
    const onChange = panel();
    expect(
      screen.getByText(/Cafe Reels summary\. Its captions are the caption style "Cafe Reels"/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Nothing to set. This step works as it is.")).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Look"));
    await user.click(await screen.findByRole("option", { name: "Square Bars" }));
    expect(onChange).toHaveBeenCalledWith({ input: { look: "Square Bars" } });
  });

  test("says where to make one when the team has none", () => {
    answerQuery(api.looks.list, { canEdit: true, study: null, looks: [] });
    panel();
    expect(screen.getByRole("link", { name: "Copy one from a video you like" })).toHaveAttribute(
      "href",
      "/settings/looks",
    );
  });

  test("says plainly when the picked look was removed", () => {
    answerQuery(api.looks.list, { canEdit: true, study: null, looks: [look("Square Bars")] });
    panel({ look: "Gone" });
    expect(
      screen.getByText(
        'There is no look called "Gone" any more, so this step will stop. Pick another.',
      ),
    ).toBeInTheDocument();
  });
});
