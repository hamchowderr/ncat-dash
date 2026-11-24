import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test } from "vitest";

import { answerQuery } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { fileTypesLine, OnThisUpload } from "./on-this-upload";

const seen: { skipped: Id<"automations">[] } = { skipped: [] };
function Host() {
  const [skipped, setSkipped] = useState<Id<"automations">[]>([]);
  return (
    <OnThisUpload
      organizationId={TEAM.id}
      skipped={skipped}
      onSkippedChange={(next) => {
        seen.skipped = next;
        setSkipped(next);
      }}
    />
  );
}

describe("On this upload", () => {
  test("names the kinds of file in words", () => {
    expect(fileTypesLine(["any"])).toBe("any file");
    expect(fileTypesLine(["video", "audio"])).toBe("videos and audio");
  });

  test("says what every upload gets, and lets one automation sit out", () => {
    answerQuery(api.automations.runOnUpload, [
      { _id: "a1", name: "Podcast clips", fileTypes: ["video"] },
      { _id: "a2", name: "Captions", fileTypes: ["any"] },
    ]);
    renderInApp(<Host />);
    expect(
      screen.getByText(/Every upload gets its transcript, SRT and storyboard draft/),
    ).toBeTruthy();
    const clips = screen.getByRole("checkbox", { name: /Podcast clips/ });
    expect(clips.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(clips);
    expect(seen.skipped).toEqual(["a1"]);
    expect(clips.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(clips);
    expect(seen.skipped).toEqual([]);
    expect(screen.getByRole("link", { name: "Change Podcast clips" }).getAttribute("href")).toBe(
      "/automations/a1",
    );
  });

  test("says nothing runs by itself when none is set to", () => {
    answerQuery(api.automations.runOnUpload, []);
    renderInApp(<Host />);
    expect(screen.getByText(/No automation runs on uploads by itself/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
